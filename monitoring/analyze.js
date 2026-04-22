const SECRET_KEY_RE = /(pass(word)?|secret|token|authorization|cookie|session|api[-_]?key|refresh[-_]?token|access[-_]?token)/i;

function toSafeString(value, maxLength = 240) {
  if (value === null || value === undefined) {
    return "";
  }

  let text = String(value);
  if (typeof text.normalize === "function") {
    text = text.normalize("NFKC");
  }

  text = text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

function redactSensitiveMetadata(value, key = null, depth = 0) {
  if (key && SECRET_KEY_RE.test(key)) {
    return "[REDACTED]";
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return toSafeString(value, 280);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (depth >= 4) {
    return toSafeString(value, 120);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => redactSensitiveMetadata(entry, key, depth + 1));
  }

  if (Object.prototype.toString.call(value) === "[object Object]") {
    const out = {};
    Object.entries(value).slice(0, 40).forEach(([childKey, entry]) => {
      out[toSafeString(childKey, 80)] = redactSensitiveMetadata(entry, childKey, depth + 1);
    });
    return out;
  }

  return toSafeString(value, 120);
}

function normalizeEventRecord(raw) {
  const eventAt = raw && (raw.event_at || raw.created_at) ? new Date(raw.event_at || raw.created_at) : new Date(NaN);
  return {
    id: toSafeString(raw && raw.id, 80) || null,
    event_at: Number.isNaN(eventAt.getTime()) ? null : eventAt.toISOString(),
    event_type: toSafeString(raw && raw.event_type, 80) || "unknown_event",
    severity: toSafeString(raw && raw.severity, 20) || "info",
    source: toSafeString(raw && raw.source, 40) || "unknown",
    route: toSafeString(raw && raw.route, 120) || null,
    flow: toSafeString(raw && raw.flow, 80) || null,
    request_id: toSafeString(raw && raw.request_id, 120) || null,
    actor_user_id: toSafeString(raw && raw.actor_user_id, 120) || null,
    ip_hash: toSafeString(raw && raw.ip_hash, 80) || null,
    identifier_hash: toSafeString(raw && raw.identifier_hash, 80) || null,
    client_token_hash: toSafeString(raw && raw.client_token_hash, 80) || null,
    metadata: redactSensitiveMetadata(raw && raw.metadata ? raw.metadata : {}),
  };
}

function parseJsonLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeEventRecord(JSON.parse(line)));
}

function serializeJsonLines(events) {
  return events
    .map((event) => JSON.stringify(normalizeEventRecord(event)))
    .join("\n") + (events.length ? "\n" : "");
}

function countBy(items, selector) {
  const counts = new Map();
  items.forEach((item) => {
    const key = selector(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function sortCountMap(countMap) {
  return Array.from(countMap.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

function getWindow(events, now, ms) {
  return events.filter((event) => {
    if (!event.event_at) return false;
    const eventMs = Date.parse(event.event_at);
    return !Number.isNaN(eventMs) && eventMs >= now.getTime() - ms;
  });
}

function summarizeWindow(events, now, ms) {
  const subset = getWindow(events, now, ms);
  return {
    total_events: subset.length,
    by_severity: Object.fromEntries(sortCountMap(countBy(subset, (event) => event.severity)).map((entry) => [entry.key, entry.count])),
    by_event_type: Object.fromEntries(sortCountMap(countBy(subset, (event) => event.event_type)).map((entry) => [entry.key, entry.count])),
  };
}

function buildFrequencyFinding(type, severity, title, summary, count, firstSeen, lastSeen, entity, metadata = {}) {
  return {
    id: `${type}:${entity || "global"}:${firstSeen || "unknown"}`,
    type,
    severity,
    title,
    summary,
    count,
    first_seen: firstSeen,
    last_seen: lastSeen,
    entity,
    metadata,
  };
}

function detectRepeatedFailedLogins(events) {
  const loginFailures = events.filter((event) => event.event_type === "login_failure");
  const groups = new Map();

  loginFailures.forEach((event) => {
    const key = event.identifier_hash || event.client_token_hash || event.ip_hash || "unknown";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(event);
  });

  const findings = [];
  groups.forEach((group, key) => {
    if (group.length < 3) {
      return;
    }

    group.sort((a, b) => String(a.event_at).localeCompare(String(b.event_at)));
    findings.push(buildFrequencyFinding(
      "repeated_failed_logins",
      group.length >= 5 ? "high" : "medium",
      "Repeated failed logins detected",
      `${group.length} failed logins were recorded for the same hashed identifier/device scope.`,
      group.length,
      group[0].event_at,
      group[group.length - 1].event_at,
      key,
    ));
  });

  return findings;
}

function detectLockoutBursts(events) {
  const lockouts = events.filter((event) => event.event_type === "bruteforce_lockout_triggered");
  const groups = new Map();

  lockouts.forEach((event) => {
    if (!event.event_at) return;
    const eventMs = Date.parse(event.event_at);
    const bucket = new Date(Math.floor(eventMs / (15 * 60 * 1000)) * (15 * 60 * 1000)).toISOString();
    groups.set(bucket, (groups.get(bucket) || 0) + 1);
  });

  return Array.from(groups.entries())
    .filter(([, count]) => count >= 2)
    .map(([bucket, count]) => buildFrequencyFinding(
      "lockout_burst",
      count >= 4 ? "high" : "medium",
      "Lockout burst detected",
      `${count} lockout events occurred inside the same 15-minute window.`,
      count,
      bucket,
      bucket,
      bucket,
    ));
}

function detectSuspiciousInputFindings(events) {
  const suspicious = events.filter((event) =>
    event.event_type === "suspicious_input_detected" ||
    event.event_type === "auth_request_rejected"
  );

  if (!suspicious.length) {
    return [];
  }

  suspicious.sort((a, b) => String(a.event_at).localeCompare(String(b.event_at)));
  return [
    buildFrequencyFinding(
      "suspicious_input_attempts",
      suspicious.length >= 5 ? "high" : "medium",
      "Suspicious input attempts recorded",
      `${suspicious.length} security-relevant input events were detected or rejected.`,
      suspicious.length,
      suspicious[0].event_at,
      suspicious[suspicious.length - 1].event_at,
      "security_inputs",
    ),
  ];
}

function detectHighFrequencySources(events) {
  const groups = new Map();

  events.forEach((event) => {
    const key = event.client_token_hash || event.actor_user_id || event.ip_hash || `${event.source}:anonymous`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(event);
  });

  const findings = [];
  groups.forEach((group, key) => {
    if (group.length < 8) {
      return;
    }

    group.sort((a, b) => String(a.event_at).localeCompare(String(b.event_at)));
    findings.push(buildFrequencyFinding(
      "high_frequency_source",
      group.length >= 15 ? "high" : "medium",
      "High event volume from one source",
      `${group.length} monitored events were associated with the same hashed client/user scope.`,
      group.length,
      group[0].event_at,
      group[group.length - 1].event_at,
      key,
    ));
  });

  return findings;
}

function detectCsvAbuse(events) {
  const csvFailures = events.filter((event) => event.event_type === "csv_validation_failure");
  const groups = new Map();

  csvFailures.forEach((event) => {
    const key = event.client_token_hash || event.actor_user_id || "csv_unknown";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(event);
  });

  const findings = [];
  groups.forEach((group, key) => {
    const rejectedRows = group.reduce((sum, event) => {
      const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
      const rows = typeof metadata.rejected_rows === "number" ? metadata.rejected_rows : 0;
      return sum + rows;
    }, 0);

    if (group.length < 2 && rejectedRows < 10) {
      return;
    }

    group.sort((a, b) => String(a.event_at).localeCompare(String(b.event_at)));
    findings.push(buildFrequencyFinding(
      "csv_abuse_or_malformed_uploads",
      rejectedRows >= 20 || group.length >= 3 ? "high" : "medium",
      "Malformed CSV upload activity detected",
      `${group.length} CSV validation failures were recorded, with ${rejectedRows} rejected rows in total.`,
      group.length,
      group[0].event_at,
      group[group.length - 1].event_at,
      key,
      { rejected_rows: rejectedRows },
    ));
  });

  return findings;
}

function buildDeterministicNarrative(summary) {
  const findings = summary.suspicious_findings || [];
  if (!findings.length) {
    return "Monitoring did not flag any strong suspicious patterns in the analyzed window. Activity was dominated by normal operational events such as uploads, receives, counts, and successful logins.";
  }

  const highest = findings[0];
  return `Monitoring flagged ${findings.length} suspicious pattern${findings.length === 1 ? "" : "s"} in the analyzed window. The most significant issue was "${highest.title.toLowerCase()}", which accounted for ${highest.count} related event${highest.count === 1 ? "" : "s"}.`;
}

function renderMarkdownReport(summary) {
  const lines = [
    "# Stockd Monitoring Analysis",
    "",
    `Generated at: ${summary.generated_at}`,
    `Source: ${summary.source}`,
    "",
    "## Executive Summary",
    "",
    summary.ai_summary || summary.narrative,
    "",
    "## Traffic Overview",
    "",
    `- Total events analyzed: ${summary.totals.total_events}`,
    `- Last hour: ${summary.windows.last_hour.total_events} events`,
    `- Last 24 hours: ${summary.windows.last_24_hours.total_events} events`,
    `- Last 7 days: ${summary.windows.last_7_days.total_events} events`,
    "",
    "## Security-Relevant Counters",
    "",
    `- Login failures: ${summary.security_counters.login_failures}`,
    `- Login successes: ${summary.security_counters.login_successes}`,
    `- Brute-force challenges: ${summary.security_counters.challenge_events}`,
    `- Brute-force lockouts: ${summary.security_counters.lockout_events}`,
    `- Suspicious input events: ${summary.security_counters.suspicious_input_events}`,
    `- CSV validation failures: ${summary.security_counters.csv_validation_failures}`,
    `- Copilot access rejections: ${summary.security_counters.copilot_rejections}`,
    "",
    "## Top Security-Relevant Event Types",
    "",
  ];

  summary.top_event_types.slice(0, 8).forEach((entry) => {
    lines.push(`- ${entry.key}: ${entry.count}`);
  });

  lines.push("", "## Suspicious Findings", "");
  if (!summary.suspicious_findings.length) {
    lines.push("- No suspicious findings crossed the configured thresholds.");
  } else {
    summary.suspicious_findings.forEach((finding) => {
      lines.push(`- [${finding.severity.toUpperCase()}] ${finding.title}: ${finding.summary}`);
    });
  }

  lines.push("", "## Recent Event Preview", "", "| Time | Event | Severity | Source | Flow |", "| --- | --- | --- | --- | --- |");
  summary.recent_events.slice(0, 10).forEach((event) => {
    lines.push(`| ${event.event_at || "—"} | ${event.event_type} | ${event.severity} | ${event.source} | ${event.flow || "—"} |`);
  });

  return lines.join("\n") + "\n";
}

function buildMonitoringSummary(events, options = {}) {
  const normalized = events.map((event) => normalizeEventRecord(event)).filter((event) => event.event_at);
  normalized.sort((a, b) => String(a.event_at).localeCompare(String(b.event_at)));

  const now = options.now instanceof Date
    ? options.now
    : normalized.length
    ? new Date(normalized[normalized.length - 1].event_at)
    : new Date();

  const suspiciousFindings = [
    ...detectRepeatedFailedLogins(normalized),
    ...detectLockoutBursts(normalized),
    ...detectSuspiciousInputFindings(normalized),
    ...detectHighFrequencySources(normalized),
    ...detectCsvAbuse(normalized),
  ].sort((a, b) => {
    const severityRank = { high: 3, medium: 2, low: 1 };
    return (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0) || b.count - a.count;
  });

  const summary = {
    generated_at: now.toISOString(),
    source: options.source || "unknown",
    totals: {
      total_events: normalized.length,
      by_severity: Object.fromEntries(sortCountMap(countBy(normalized, (event) => event.severity)).map((entry) => [entry.key, entry.count])),
      by_event_type: Object.fromEntries(sortCountMap(countBy(normalized, (event) => event.event_type)).map((entry) => [entry.key, entry.count])),
      by_source: Object.fromEntries(sortCountMap(countBy(normalized, (event) => event.source)).map((entry) => [entry.key, entry.count])),
    },
    windows: {
      last_hour: summarizeWindow(normalized, now, 60 * 60 * 1000),
      last_24_hours: summarizeWindow(normalized, now, 24 * 60 * 60 * 1000),
      last_7_days: summarizeWindow(normalized, now, 7 * 24 * 60 * 60 * 1000),
    },
    security_counters: {
      login_failures: normalized.filter((event) => event.event_type === "login_failure").length,
      login_successes: normalized.filter((event) => event.event_type === "login_success").length,
      challenge_events: normalized.filter((event) => event.event_type === "bruteforce_challenge_triggered").length,
      lockout_events: normalized.filter((event) => event.event_type === "bruteforce_lockout_triggered").length,
      suspicious_input_events: normalized.filter((event) => event.event_type === "suspicious_input_detected" || event.event_type === "auth_request_rejected").length,
      csv_validation_failures: normalized.filter((event) => event.event_type === "csv_validation_failure").length,
      copilot_rejections: normalized.filter((event) => event.event_type === "copilot_security_rejection" || event.event_type === "copilot_data_access_denied").length,
    },
    top_event_types: sortCountMap(countBy(normalized, (event) => event.event_type)),
    top_sources: sortCountMap(countBy(normalized, (event) => event.source)),
    suspicious_findings: suspiciousFindings,
    recent_events: normalized.slice(-20).reverse().map((event) => ({
      event_at: event.event_at,
      event_type: event.event_type,
      severity: event.severity,
      source: event.source,
      flow: event.flow,
      route: event.route,
      request_id: event.request_id,
      metadata: event.metadata,
    })),
  };

  summary.narrative = buildDeterministicNarrative(summary);
  return summary;
}

module.exports = {
  buildDeterministicNarrative,
  buildMonitoringSummary,
  normalizeEventRecord,
  parseJsonLines,
  redactSensitiveMetadata,
  renderMarkdownReport,
  serializeJsonLines,
  sortCountMap,
  toSafeString,
};

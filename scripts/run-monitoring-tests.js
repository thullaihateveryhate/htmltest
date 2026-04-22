const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = function transpileTypeScript(module, filename) {
  const sourceText = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(sourceText, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      allowJs: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
  });

  module._compile(result.outputText, filename);
};

const {
  buildMonitoringSummary,
  parseJsonLines,
  redactSensitiveMetadata,
  renderMarkdownReport,
  serializeJsonLines,
} = require("../monitoring/analyze.js");
const { buildPersistedMonitoringEvent } = require("../supabase/functions/_shared/monitoring.ts");

const fixturePath = path.join(__dirname, "..", "monitoring", "fixtures", "security-events.sample.jsonl");

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error && error.stack ? error.stack : error);
    return false;
  }
}

(async () => {
  let passed = 0;
  let failed = 0;

  if (await run("monitoring event formatter redacts secrets and hashes sensitive identifiers", async () => {
    const row = await buildPersistedMonitoringEvent({
      eventType: "csv_validation_failure",
      severity: "warning",
      source: "frontend",
      route: "/pages/upload.html",
      flow: "daily_sales_upload",
      requestId: "req-1",
      actorUserId: "user-1",
      ipAddress: "203.0.113.2",
      identifier: "demo@user.pizza",
      clientToken: "device-token-1234567890",
      metadata: {
        password: "super-secret-password",
        nested: {
          access_token: "token-value",
          safe_label: "CSV Import",
        },
      },
    });

    assert.equal(row.metadata.password, "[REDACTED]");
    assert.equal(row.metadata.nested.access_token, "[REDACTED]");
    assert.equal(row.metadata.nested.safe_label, "CSV Import");
    assert.ok(row.ip_hash && row.ip_hash !== "203.0.113.2");
    assert.ok(row.identifier_hash && row.identifier_hash !== "demo@user.pizza");
    assert.ok(row.client_token_hash && row.client_token_hash !== "device-token-1234567890");
  })) passed += 1; else failed += 1;

  if (await run("monitoring summary detects repeated failed logins, lockout bursts, and CSV abuse", () => {
    const events = parseJsonLines(fs.readFileSync(fixturePath, "utf8"));
    const summary = buildMonitoringSummary(events, {
      source: "fixture",
      now: new Date("2026-04-22T10:00:00.000Z"),
    });

    assert.equal(summary.security_counters.login_failures, 3);
    assert.equal(summary.security_counters.lockout_events, 2);
    assert.equal(summary.security_counters.csv_validation_failures, 2);
    assert.ok(summary.suspicious_findings.some((finding) => finding.type === "repeated_failed_logins"));
    assert.ok(summary.suspicious_findings.some((finding) => finding.type === "lockout_burst"));
    assert.ok(summary.suspicious_findings.some((finding) => finding.type === "csv_abuse_or_malformed_uploads"));
  })) passed += 1; else failed += 1;

  if (await run("monitoring report generation renders readable markdown with findings", () => {
    const events = parseJsonLines(fs.readFileSync(fixturePath, "utf8"));
    const summary = buildMonitoringSummary(events, { source: "fixture" });
    const report = renderMarkdownReport(summary);

    assert.match(report, /# Stockd Monitoring Analysis/);
    assert.match(report, /## Suspicious Findings/);
    assert.match(report, /Repeated failed logins detected/);
    assert.match(report, /CSV validation failures:/);
  })) passed += 1; else failed += 1;

  if (await run("monitoring JSONL serialization and metadata redaction stay secret-safe", () => {
    const safeMetadata = redactSensitiveMetadata({
      password: "hunter2",
      api_key: "abc123",
      safe_note: "keep this",
    });

    assert.deepEqual(safeMetadata, {
      password: "[REDACTED]",
      api_key: "[REDACTED]",
      safe_note: "keep this",
    });

    const text = serializeJsonLines([
      {
        event_at: "2026-04-22T09:18:00.000Z",
        event_type: "login_success",
        severity: "info",
        source: "auth_edge",
        metadata: {
          access_token: "should-not-appear",
          safe_label: "Signed in",
        },
      },
    ]);

    assert.doesNotMatch(text, /should-not-appear/);
    assert.match(text, /\[REDACTED\]/);
  })) passed += 1; else failed += 1;

  console.log(`\nMonitoring tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
})();

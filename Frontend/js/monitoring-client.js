(function initStockdMonitoring(globalScope) {
  const MONITORING_TOKEN_KEY = "stockd.monitoring.clientToken.v1";

  function getSupabaseClient() {
    if (typeof sb === "undefined" || !sb.functions || typeof sb.functions.invoke !== "function") {
      return null;
    }

    return sb;
  }

  function normalizeText(value, maxLength = 160) {
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

  function getClientToken() {
    try {
      const existing = localStorage.getItem(MONITORING_TOKEN_KEY);
      if (existing && existing.length >= 16 && existing.length <= 120) {
        return existing;
      }
    } catch (_error) {
    }

    const randomPart = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now()}${Math.random().toString(36).slice(2)}`;
    const token = `stockd-monitor-${randomPart}`.slice(0, 80);

    try {
      localStorage.setItem(MONITORING_TOKEN_KEY, token);
    } catch (_error) {
    }

    return token;
  }

  function buildRequestId(prefix = "ui") {
    const safePrefix = normalizeText(prefix, 16).toLowerCase() || "ui";
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${safePrefix}-${crypto.randomUUID()}`;
    }

    return `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeMetadata(value, depth = 0) {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "string") {
      return normalizeText(value, 240);
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (depth >= 3) {
      return normalizeText(value, 120);
    }

    if (Array.isArray(value)) {
      return value.slice(0, 20).map((entry) => normalizeMetadata(entry, depth + 1));
    }

    if (Object.prototype.toString.call(value) === "[object Object]") {
      const out = {};
      Object.entries(value).slice(0, 30).forEach(([key, entry]) => {
        out[normalizeText(key, 80)] = normalizeMetadata(entry, depth + 1);
      });
      return out;
    }

    return normalizeText(value, 120);
  }

  async function trackEvent(eventType, options = {}) {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, skipped: true };
    }

    const requestBody = {
      event_type: normalizeText(eventType, 80),
      source: normalizeText(options.source || "frontend", 32) || "frontend",
      route: normalizeText(options.route || window.location.pathname, 120),
      flow: normalizeText(options.flow, 80) || null,
      request_id: normalizeText(options.requestId || buildRequestId("ui"), 120),
      client_token: getClientToken(),
      metadata: normalizeMetadata(options.metadata || {}),
    };

    try {
      const { data, error } = await client.functions.invoke("security-monitor", {
        body: requestBody,
      });

      if (error) {
        throw error;
      }

      return data || { ok: true };
    } catch (error) {
      console.warn("[monitoring-client] event rejected", {
        eventType: requestBody.event_type,
        message: error && error.message ? error.message : "unknown",
      });
      return { ok: false, skipped: false };
    }
  }

  async function trackSuspiciousInput(fieldName, rawValue, options = {}) {
    const security = globalScope.StockdSecurity;
    if (!security || typeof security.inspectTextInput !== "function") {
      return { ok: false, skipped: true };
    }

    const report = security.inspectTextInput(rawValue);
    if (!report || report.suspicious !== true) {
      return { ok: true, skipped: true };
    }

    return trackEvent("suspicious_input_detected", {
      flow: options.flow || "input_validation",
      metadata: {
        field_name: normalizeText(fieldName, 60),
        page: normalizeText(options.page || window.location.pathname, 120),
        signals: {
          contains_markup: Boolean(report.containsMarkup),
          contains_script_tag: Boolean(report.containsScriptTag),
          contains_event_handler: Boolean(report.containsEventHandler),
          contains_javascript_protocol: Boolean(report.containsJavascriptProtocol),
          contains_control_chars: Boolean(report.containsControlChars),
        },
        raw_length: report.rawLength,
        sanitized_length: report.sanitizedLength,
      },
    });
  }

  globalScope.stockdMonitoring = {
    buildRequestId,
    getClientToken,
    trackEvent,
    trackSuspiciousInput,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalScope.stockdMonitoring;
  }
})(typeof window !== "undefined" ? window : globalThis);

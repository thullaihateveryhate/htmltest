(function initStockdSecurity(globalScope) {
  const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]/g;
  const SCRIPT_STYLE_TAG_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
  const GENERIC_TAG_RE = /<\/?[^>]+>/g;
  const WHITESPACE_RE = /\s+/g;
  const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const CONTROL_CHARS_TEST_RE = /[\u0000-\u001F\u007F-\u009F]/;
  const SCRIPT_STYLE_TAG_TEST_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/i;
  const GENERIC_TAG_TEST_RE = /<\/?[^>]+>/i;
  const EVENT_HANDLER_ATTR_RE = /\son[a-z]+\s*=/i;
  const JAVASCRIPT_PROTOCOL_RE = /javascript\s*:/i;

  function toSafeString(value) {
    if (value === null || value === undefined) {
      return "";
    }

    return typeof value === "string" ? value : String(value);
  }

  function normalizeUnicode(value) {
    const text = toSafeString(value);
    return typeof text.normalize === "function" ? text.normalize("NFKC") : text;
  }

  function stripControlChars(value) {
    return normalizeUnicode(value).replace(CONTROL_CHARS_RE, "");
  }

  function stripMarkup(value) {
    return stripControlChars(value)
      .replace(SCRIPT_STYLE_TAG_RE, " ")
      .replace(GENERIC_TAG_RE, " ")
      .replace(/[<>]/g, " ");
  }

  function normalizePlainText(value, options) {
    const settings = options || {};
    const shouldStripHtml = settings.stripHtml === true;
    const shouldCollapseWhitespace = settings.collapseWhitespace !== false;
    const shouldTrim = settings.trim !== false;
    const maxLength = typeof settings.maxLength === "number" ? settings.maxLength : null;

    let normalized = shouldStripHtml ? stripMarkup(value) : stripControlChars(value);

    if (shouldCollapseWhitespace) {
      normalized = normalized.replace(WHITESPACE_RE, " ");
    }

    if (shouldTrim) {
      normalized = normalized.trim();
    }

    if (maxLength !== null && maxLength >= 0 && normalized.length > maxLength) {
      normalized = normalized.slice(0, maxLength);
      if (shouldTrim) {
        normalized = normalized.trim();
      }
    }

    return normalized;
  }

  function sanitizeTextInput(value, options) {
    return normalizePlainText(value, { stripHtml: true, ...(options || {}) });
  }

  function inspectTextInput(value) {
    const raw = toSafeString(value);
    const normalized = normalizeUnicode(raw);
    const sanitized = sanitizeTextInput(raw, { maxLength: 10000 });

    return {
      rawLength: normalized.length,
      sanitizedLength: sanitized.length,
      containsMarkup: GENERIC_TAG_TEST_RE.test(normalized) || /[<>]/.test(normalized),
      containsScriptTag: SCRIPT_STYLE_TAG_TEST_RE.test(normalized),
      containsEventHandler: EVENT_HANDLER_ATTR_RE.test(normalized),
      containsJavascriptProtocol: JAVASCRIPT_PROTOCOL_RE.test(normalized),
      containsControlChars: CONTROL_CHARS_TEST_RE.test(normalized),
      suspicious:
        SCRIPT_STYLE_TAG_TEST_RE.test(normalized) ||
        EVENT_HANDLER_ATTR_RE.test(normalized) ||
        JAVASCRIPT_PROTOCOL_RE.test(normalized) ||
        GENERIC_TAG_TEST_RE.test(normalized) ||
        /[<>]/.test(normalized) ||
        CONTROL_CHARS_TEST_RE.test(normalized),
    };
  }

  function escapeHtml(value) {
    return toSafeString(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeAttribute(value, options) {
    return escapeHtml(sanitizeTextInput(value, options));
  }

  function sanitizeEmailInput(value) {
    const normalized = sanitizeTextInput(value, { maxLength: 320 }).toLowerCase();
    return SIMPLE_EMAIL_RE.test(normalized) ? normalized : null;
  }

  function parseFiniteNumber(value, options) {
    const settings = options || {};

    if (value === null || value === undefined || value === "") {
      return null;
    }

    const parsed = typeof value === "number"
      ? value
      : Number(String(value).trim());

    if (!Number.isFinite(parsed)) {
      return null;
    }

    if (settings.integer && !Number.isInteger(parsed)) {
      return null;
    }

    if (typeof settings.min === "number" && parsed < settings.min) {
      return null;
    }

    if (typeof settings.max === "number" && parsed > settings.max) {
      return null;
    }

    return parsed;
  }

  function safeEnum(value, allowedValues, fallbackValue) {
    const normalized = sanitizeTextInput(value, { maxLength: 80 }).toLowerCase();
    const match = (allowedValues || []).find((entry) => String(entry).toLowerCase() === normalized);
    return match === undefined ? fallbackValue : match;
  }

  const api = {
    escapeHtml,
    normalizePlainText,
    parseFiniteNumber,
    inspectTextInput,
    safeAttribute,
    safeEnum,
    sanitizeEmailInput,
    sanitizeTextInput,
    stripControlChars,
    stripMarkup,
    toSafeString,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.StockdSecurity = api;
})(typeof window !== "undefined" ? window : globalThis);

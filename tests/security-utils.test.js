const security = require("../Frontend/js/security.js");

describe("frontend security utilities", () => {
  test("strips script blocks from plain-text inputs before persistence", () => {
    expect(
      security.sanitizeTextInput("  <script>alert(1)</script> Mozzarella  ", { maxLength: 120 }),
    ).toBe("Mozzarella");
  });

  test("removes HTML event-handler payloads from plain-text inputs", () => {
    expect(
      security.sanitizeTextInput('<img src=x onerror=alert(1)> Fresh Basil', { maxLength: 120 }),
    ).toBe("Fresh Basil");
  });

  test("escapes dangerous markup before DOM rendering", () => {
    expect(security.escapeHtml('<svg onload=alert(1)>')).toBe("&lt;svg onload=alert(1)&gt;");
  });

  test("rejects invalid enum-like filter values with a fallback", () => {
    expect(security.safeEnum("DROP TABLE users", ["all", "shortage", "overage"], "all")).toBe("all");
  });
});

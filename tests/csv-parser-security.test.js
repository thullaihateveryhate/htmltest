global.Papa = {
  parse(_file, options) {
    options.complete({
      data: [
        {
          "Void?": "false",
          "Order Date": "04/20/2026 18:22",
          "Menu Item": "<script>alert(1)</script> Pepperoni Pizza",
          "Sales Category": '<img src=x onerror=alert(1)> Signature',
          "Qty": "2",
          "Net Price": "24.50",
        },
        {
          "Void?": "false",
          "Order Date": "not-a-date",
          "Menu Item": "Broken Row",
          "Sales Category": "Invalid",
          "Qty": "1",
          "Net Price": "10.00",
        },
      ],
    });
  },
};

const { parseToastCSV } = require("../Frontend/js/csv-parser.js");

describe("csv parser security normalization", () => {
  test("sanitizes imported text fields and skips malformed rows", async () => {
    const parsed = await parseToastCSV({ name: "sales.csv" });

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      business_date: "2026-04-20",
      menu_item_name: "Pepperoni Pizza",
      category: "Signature",
      qty: 2,
      net_sales: 24.5,
      source: "toast",
    });

    const serialized = JSON.stringify(parsed.rows[0]);
    expect(serialized).not.toMatch(/<|script|onerror/i);
  });
});

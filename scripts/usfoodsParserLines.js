// Node-friendly parser for US Foods invoice text lines (no PDF dependency)

function cleanDescription(rest) {
  return rest
    .replace(/\$\s*\d+(?:\.\d+)?/g, '')
    .replace(/\b(CS|EA|LB|DZ|PK)\b/g, '')
    .replace(/\b[A-Z]{2}\s+[A-Z]{2}\b/g, '')
    .replace(/\b\d+\/#?\d+\b/g, '')
    .replace(/\b\d+\/\d+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseUsFoodsLines(lines) {
  const itemRegex = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Z]{1,4})\s+(\d{6,})\s+(.+)$/;
  const results = [];

  for (const line of lines) {
    const m = line.match(itemRegex);
    if (!m) continue;

    const qtyOrdered = Number(m[1]);
    const qtyShipped = Number(m[2]);
    const qtyAdj = Number(m[3]);
    const salesUnit = m[4];
    const productNumber = m[5];
    const rest = m[6];

    if (/DELIVERY SUMMARY|STORAGE LOCATION|INVOICE/i.test(line)) continue;

    const itemName = cleanDescription(rest);

    results.push({
      productNumber,
      itemName,
      qtyOrdered,
      qtyShipped,
      qtyAdj,
      salesUnit,
      rawLine: line,
    });
  }

  const seen = new Set();
  return results.filter((r) => {
    const key = `${r.productNumber}|${r.qtyOrdered}|${r.qtyShipped}|${r.itemName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { parseUsFoodsLines };

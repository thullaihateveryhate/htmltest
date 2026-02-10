// Node-specific US Foods PDF parser using local pdfjs-dist
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

function groupIntoLines(textItems, yTolerance = 2) {
  const rows = new Map();
  for (const it of textItems) {
    const x = it.transform?.[4] ?? 0;
    const y = it.transform?.[5] ?? 0;
    const key = [...rows.keys()].find((ky) => Math.abs(ky - y) <= yTolerance) ?? y;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push({ x, str: (it.str || '').trim() });
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) =>
      parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);
}

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
    results.push({ productNumber, itemName, qtyOrdered, qtyShipped, qtyAdj, salesUnit, rawLine: line });
  }
  const seen = new Set();
  return results.filter((r) => {
    const key = `${r.productNumber}|${r.qtyOrdered}|${r.qtyShipped}|${r.itemName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function parseUsFoodsInvoicePdf(buffer) {
  let data;
  if (buffer instanceof Uint8Array && !(buffer instanceof Buffer)) {
    data = buffer;
  } else if (buffer instanceof Buffer) {
    data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } else if (buffer instanceof ArrayBuffer) {
    data = new Uint8Array(buffer);
  } else {
    throw new Error('Unsupported buffer type');
  }
  const pdf = await getDocument({ data }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    lines.push(...groupIntoLines(tc.items));
  }
  return parseUsFoodsLines(lines);
}

export async function extractBlackOlivesFromPdf(buffer) {
  const items = await parseUsFoodsInvoicePdf(buffer);
  return items.find((item) => item.itemName.toLowerCase().includes('black olives'));
}

export async function extractBlackOlivesQty(buffer) {
  const item = await extractBlackOlivesFromPdf(buffer);
  return item ? item.qtyOrdered : null;
}

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function filterItemsByIngredients(items, ingredientNames) {
  if (!Array.isArray(ingredientNames) || ingredientNames.length === 0) return [];
  const wanted = ingredientNames.map(normalizeName).filter(Boolean);
  return items.filter((item) => {
    const itemNorm = normalizeName(item.itemName);
    return wanted.some((w) => itemNorm.includes(w) || w.includes(itemNorm));
  });
}

export async function extractIngredientsQtyFromPdf(buffer, ingredientNames) {
  const items = await parseUsFoodsInvoicePdf(buffer);
  return filterItemsByIngredients(items, ingredientNames).map((item) => ({
    ingredientName: item.itemName,
    qtyOrdered: item.qtyOrdered,
    qtyShipped: item.qtyShipped,
    salesUnit: item.salesUnit,
    productNumber: item.productNumber,
    rawLine: item.rawLine,
  }));
}

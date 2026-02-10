// US Foods PDF parser (browser, ES module)
// Dynamically loads pdfjs-dist from CDN, parses invoice lines, and returns items with qty.

const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624';
let _pdfjs = null;

async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  const mod = await import(`${PDFJS_CDN}/build/pdf.mjs`);
  mod.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/build/pdf.worker.min.mjs`;
  _pdfjs = mod;
  return _pdfjs;
}

// Group text into lines using Y-position, then join by X-order
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

// Extract itemName from the rest of line by stripping label/pack/pricing noise
function cleanDescription(rest) {
  return rest
    .replace(/\$\s*\d+(?:\.\d+)?/g, '') // remove prices like $28.09
    .replace(/\b(CS|EA|LB|DZ|PK)\b/g, '') // common unit tokens
    .replace(/\b[A-Z]{2}\s+[A-Z]{2}\b/g, '') // label-ish tokens like "FI GM"
    .replace(/\b\d+\/#?\d+\b/g, '') // things like 6/#10
    .replace(/\b\d+\/\d+\b/g, '') // things like 200/1
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse already-assembled text lines (helper for tests or fallback)
export function parseUsFoodsLines(lines) {
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

// Main parse: accepts File (browser) or ArrayBuffer
export async function parseUsFoodsInvoicePdf(fileOrArrayBuffer) {
  const buffer =
    fileOrArrayBuffer instanceof ArrayBuffer
      ? fileOrArrayBuffer
      : await fileOrArrayBuffer.arrayBuffer();

  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    lines.push(...groupIntoLines(tc.items));
  }

  return parseUsFoodsLines(lines);
}

// CommonJS fallback for Node-based tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseUsFoodsLines, parseUsFoodsInvoicePdf };
}

// Example usage (in a page with type="module"):
// import { parseUsFoodsInvoicePdf } from './usfoodsPdfParser.js';
// document.querySelector('#pdfInput').addEventListener('change', async (e) => {
//   const file = e.target.files?.[0];
//   if (!file) return;
//   const items = await parseUsFoodsInvoicePdf(file);
//   console.log(items);
// });

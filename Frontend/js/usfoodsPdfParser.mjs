// US Foods PDF parser (browser/Node ESM)
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

export async function parseUsFoodsInvoicePdf(fileOrArrayBuffer) {
  let buffer = null;
  if (fileOrArrayBuffer instanceof ArrayBuffer) {
    buffer = fileOrArrayBuffer;
  } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(fileOrArrayBuffer)) {
    buffer = fileOrArrayBuffer;
  } else if (typeof fileOrArrayBuffer?.arrayBuffer === 'function') {
    buffer = await fileOrArrayBuffer.arrayBuffer();
  } else {
    throw new Error('Unsupported input type for PDF parse');
  }

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

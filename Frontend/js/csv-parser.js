// ═══════════════════════════════════════════════
// js/csv-parser.js — Toast CSV → ingest_daily_sales payload
// Load AFTER PapaParse CDN script
// ═══════════════════════════════════════════════

const stockdCsvSecurity = (typeof window !== 'undefined' && window.StockdSecurity)
  ? window.StockdSecurity
  : {
    sanitizeTextInput(value, options = {}) {
      const maxLength = typeof options.maxLength === 'number' ? options.maxLength : null;
      let text = String(value == null ? '' : value)
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<\/?[^>]+>/g, ' ')
        .replace(/[<>]/g, ' ')
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (maxLength !== null && text.length > maxLength) {
        text = text.slice(0, maxLength).trim();
      }
      return text;
    },
    parseFiniteNumber(value, options = {}) {
      if (value === null || value === undefined || value === '') return null;
      const parsed = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isFinite(parsed)) return null;
      if (typeof options.min === 'number' && parsed < options.min) return null;
      if (typeof options.max === 'number' && parsed > options.max) return null;
      return parsed;
    },
    inspectTextInput(value) {
      const raw = String(value == null ? '' : value);
      const containsMarkup = /<\/?[^>]+>/i.test(raw) || /[<>]/.test(raw);
      const containsScriptTag = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/i.test(raw);
      const containsEventHandler = /\son[a-z]+\s*=/i.test(raw);
      const containsJavascriptProtocol = /javascript\s*:/i.test(raw);
      const containsControlChars = /[\u0000-\u001F\u007F-\u009F]/.test(raw);
      return {
        rawLength: raw.length,
        sanitizedLength: this.sanitizeTextInput(raw, { maxLength: 10000 }).length,
        containsMarkup,
        containsScriptTag,
        containsEventHandler,
        containsJavascriptProtocol,
        containsControlChars,
        suspicious: containsMarkup || containsScriptTag || containsEventHandler || containsJavascriptProtocol || containsControlChars
      };
    }
  };

function normalizeBusinessDate(rawValue) {
  const rawDate = String(rawValue || '').trim().split(' ')[0];
  if (!rawDate) return null;

  const [mm, dd, yyyy] = rawDate.split('/');
  if (!mm || !dd || !yyyy) return null;

  const month = mm.padStart(2, '0');
  const day = dd.padStart(2, '0');
  const businessDate = `${yyyy}-${month}-${day}`;
  const parsedDate = new Date(`${businessDate}T00:00:00Z`);

  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== businessDate) {
    return null;
  }

  return businessDate;
}

/**
 * Parse a Toast ItemSelectionDetails CSV and return
 * rows aggregated by (business_date, menu_item) ready
 * for the ingest_daily_sales RPC.
 *
 * @param {File} file
 * @returns {Promise<{ rows: Array, stats: Object }>}
 */
function parseToastCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const raw = results.data;
        const parseErrors = Array.isArray(results.errors) ? results.errors : [];
        let rejectedRows = 0;
        let invalidDateRows = 0;
        let invalidNumericRows = 0;
        let suspiciousRows = 0;
        let sanitizedFieldCount = 0;

        // Filter voids
        const valid = raw.filter(r => {
          const v = (r['Void?'] || '').toString().trim().toLowerCase();
          return v === 'false' || v === '';
        });

        // Group by (date, menu_item)
        const grouped = {};
        valid.forEach(r => {
          const itemReport = stockdCsvSecurity.inspectTextInput(r['Menu Item']);
          const categoryReport = stockdCsvSecurity.inspectTextInput(r['Sales Category']);
          if (itemReport.suspicious || categoryReport.suspicious) {
            suspiciousRows += 1;
          }
          if (itemReport.suspicious) sanitizedFieldCount += 1;
          if (categoryReport.suspicious) sanitizedFieldCount += 1;

          const bizDate = normalizeBusinessDate(r['Order Date']);
          if (!bizDate) {
            invalidDateRows += 1;
            rejectedRows += 1;
            return;
          }

          const item = stockdCsvSecurity.sanitizeTextInput(r['Menu Item'], { maxLength: 160 });
          if (!item) {
            rejectedRows += 1;
            return;
          }

          const category = stockdCsvSecurity.sanitizeTextInput(r['Sales Category'], { maxLength: 80 });
          const qty = stockdCsvSecurity.parseFiniteNumber(r['Qty'], { min: 0, max: 1000000 });
          const netSales = stockdCsvSecurity.parseFiniteNumber(r['Net Price'], { min: -1000000, max: 1000000 });
          if (qty === null || netSales === null) {
            invalidNumericRows += 1;
            rejectedRows += 1;
            return;
          }

          const key = `${bizDate}|${item}`;
          if (!grouped[key]) {
            grouped[key] = {
              business_date: bizDate,
              menu_item_name: item,
              category,
              qty: 0,
              net_sales: 0,
              source: 'toast'
            };
          }
          grouped[key].qty += qty;
          grouped[key].net_sales += netSales;
        });

        const rows = Object.values(grouped).map(r => ({
          ...r,
          qty: Math.round(r.qty * 100) / 100,
          net_sales: Math.round(r.net_sales * 100) / 100
        }));

        const dates = [...new Set(rows.map(r => r.business_date))].sort();
        const items = [...new Set(rows.map(r => r.menu_item_name))];

        resolve({
          rows,
          stats: {
            rawRows: raw.length,
            voidsFiltered: raw.length - valid.length,
            aggregatedRows: rows.length,
            parseErrors: parseErrors.length,
            rejectedRows,
            invalidDateRows,
            invalidNumericRows,
            suspiciousRows,
            sanitizedFieldCount,
            uniqueItems: items.length,
            uniqueCategories: [...new Set(rows.map(r => r.category))].length,
            startDate: dates[0] || null,
            endDate: dates[dates.length - 1] || null,
            totalDays: dates.length,
            totalQty: rows.reduce((s, r) => s + r.qty, 0),
            totalSales: rows.reduce((s, r) => s + r.net_sales, 0)
          }
        });
      },
      error(err) { reject(new Error('CSV parse error: ' + err.message)); }
    });
  });
}

/** Split array into chunks */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Ingest parsed rows into Supabase in batches.
 * @param {Array} rows - Aggregated rows from parseToastCSV
 * @param {Function} onProgress - callback(processed, total)
 * @returns {Promise<{totalProcessed, totalItemsCreated}>}
 */
async function ingestBatched(rows, onProgress) {
  const BATCH = 500;
  const batches = chunk(rows, BATCH);
  let totalProcessed = 0;
  let totalItemsCreated = 0;

  for (let i = 0; i < batches.length; i++) {
    const { data, error } = await sb.rpc('ingest_daily_sales', { p_rows: batches[i] });
    if (error) throw new Error(`Batch ${i+1} failed: ${error.message}`);

    totalProcessed += data.rows_processed || batches[i].length;
    totalItemsCreated += data.menu_items_created || 0;
    if (onProgress) onProgress(totalProcessed, rows.length);
  }

  return { totalProcessed, totalItemsCreated };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    chunk,
    ingestBatched,
    normalizeBusinessDate,
    parseToastCSV
  };
}

// Helpers to map US Foods invoice lines to known ingredients without mutating DB.
import { extractIngredientsQtyFromPdf } from './usfoodsPdfParserNode.mjs';

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchIngredientsForMatching(supabase) {
  const { data, error } = await supabase
    .from('ingredients')
    .select('id, name, unit')
    .not('name', 'ilike', '__test__%');
  if (error) throw new Error(`fetchIngredientsForMatching: ${error.message}`);
  return data || [];
}

export function matchInvoiceItemsToIngredients(invoiceItems, ingredients) {
  const ingByNorm = new Map();
  for (const ing of ingredients) {
    const norm = normalizeName(ing.name);
    if (!norm) continue;
    ingByNorm.set(norm, ing);
  }

  const matches = [];
  const unmatched = [];

  for (const item of invoiceItems) {
    const normItem = normalizeName(item.ingredientName || item.itemName || '');
    let hit = null;
    for (const [norm, ing] of ingByNorm.entries()) {
      if (normItem.includes(norm) || norm.includes(normItem)) {
        hit = ing;
        break;
      }
    }
    if (hit) {
      matches.push({
        ingredientId: hit.id,
        ingredientName: hit.name,
        ingredientUnit: hit.unit,
        qtyOrdered: item.qtyOrdered,
        qtyShipped: item.qtyShipped,
        salesUnit: item.salesUnit,
        productNumber: item.productNumber,
        rawLine: item.rawLine,
      });
    } else {
      unmatched.push(item);
    }
  }

  return { matches, unmatched };
}

export async function getInvoiceMatches(pdfBuffer, supabase) {
  const ingredients = await fetchIngredientsForMatching(supabase);
  const invoiceItems = await extractIngredientsQtyFromPdf(pdfBuffer, ingredients.map((ing) => ing.name));
  return matchInvoiceItemsToIngredients(invoiceItems, ingredients);
}

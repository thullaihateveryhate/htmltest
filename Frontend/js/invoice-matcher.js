// Frontend/js/invoice-matcher.js
import { parseUsFoodsInvoicePdf } from './usfoodsPdfParser.js';

// Helper to normalize names for fuzzy matching
function normalizeName(name) {
    return (name || '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Fetches all ingredients from Supabase.
 * @param {SupabaseClient} supabase 
 * @returns {Promise<Array>} Array of ingredient objects
 */
async function fetchIngredientsForMatching(supabase) {
    const { data, error } = await supabase
        .from('ingredients')
        .select('id, name, unit')
        .not('name', 'ilike', '__test__%'); // Exclude test ingredients if any

    if (error) {
        console.error('Error fetching ingredients:', error);
        throw new Error(`Failed to fetch ingredients: ${error.message}`);
    }
    return data || [];
}

/**
 * Matches parsed invoice items to known ingredients.
 * @param {Array} invoiceItems - parsed items from PDF
 * @param {Array} ingredients - ingredients from DB
 * @returns {Object} { matches: [], unmatched: [] }
 */
function matchInvoiceItemsToIngredients(invoiceItems, ingredients) {
    const ingByNorm = new Map();

    // Index ingredients by normalized name
    for (const ing of ingredients) {
        const norm = normalizeName(ing.name);
        if (!norm) continue;
        ingByNorm.set(norm, ing);
    }

    const matches = [];
    const unmatched = [];

    for (const item of invoiceItems) {
        // Try to match by productNumber first? 
        // The script logic relied on name matching. Let's stick to name matching for now as per script.
        // Ideally we'd store productNumber in DB too, but requirements say fuzzy name match.

        const normItem = normalizeName(item.itemName || '');
        let hit = null;

        // Direct lookup first (O(1))
        if (ingByNorm.has(normItem)) {
            hit = ingByNorm.get(normItem);
        }
        else {
            // Fuzzy substring match (O(N*M))
            // item name contains ingredient name OR ingredient name contains item name
            for (const [norm, ing] of ingByNorm.entries()) {
                if (normItem.includes(norm) || norm.includes(normItem)) {
                    hit = ing;
                    break;
                }
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
                // Helper flagging if quantity differs
                qtyDiff: item.qtyShipped !== item.qtyOrdered
            });
        } else {
            unmatched.push(item);
        }
    }

    return { matches, unmatched };
}

/**
 * Main function to process a PDF file and return matches.
 * @param {File} file - The uploaded PDF file
 * @param {SupabaseClient} supabase - The supabase client instance
 * @returns {Promise<Object>} { matches, unmatched }
 */
export async function getInvoiceMatches(file, supabase) {
    try {
        // 1. Fetch ingredients
        const ingredients = await fetchIngredientsForMatching(supabase);

        // 2. Parse PDF (client-side)
        const invoiceItems = await parseUsFoodsInvoicePdf(file);

        // 3. Match
        return matchInvoiceItemsToIngredients(invoiceItems, ingredients);
    } catch (err) {
        console.error('getInvoiceMatches error:', err);
        throw err;
    }
}

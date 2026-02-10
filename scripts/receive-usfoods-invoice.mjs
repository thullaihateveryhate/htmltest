import fs from 'fs/promises';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { extractIngredientsQtyFromPdf } from './usfoodsPdfParserNode.mjs';

dotenv.config();

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or service/anon key');
  return createClient(url, key);
}

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchIngredients(client) {
  const { data, error } = await client
    .from('ingredients')
    .select('id, name, unit')
    .not('name', 'ilike', '__test__%');
  if (error) throw new Error(`fetchIngredients: ${error.message}`);
  return data || [];
}

function mapMatchedToIds(matchedItems, ingredients) {
  const ingByNorm = new Map();
  for (const ing of ingredients) {
    const norm = normalizeName(ing.name);
    if (!norm) continue;
    ingByNorm.set(norm, ing);
  }
  const results = [];
  for (const item of matchedItems) {
    const normItem = normalizeName(item.ingredientName);
    let hit = null;
    for (const [norm, ing] of ingByNorm.entries()) {
      if (normItem.includes(norm) || norm.includes(normItem)) {
        hit = ing;
        break;
      }
    }
    if (hit) {
      results.push({ ...item, ingredientId: hit.id, ingredientDbName: hit.name, ingredientUnit: hit.unit });
    }
  }
  return results;
}

async function receiveInventory(client, ingredientId, qty, note) {
  const { data, error } = await client.rpc('receive_inventory', {
    p_ingredient_id: ingredientId,
    p_qty: qty,
    p_note: note,
  });
  if (error) throw new Error(`receive_inventory error: ${error.message}`);
  if (data?.status === 'error') throw new Error(`receive_inventory: ${data.message}`);
  return data;
}

async function main() {
  const pdfPath = process.argv[2] || 'C:/Users/Harry/Downloads/usfoods.pdf';
  const note = process.argv[3] || 'auto receive from US Foods invoice';
  console.log('PDF path:', pdfPath);

  const pdfBuffer = await fs.readFile(pdfPath);
  const supabase = getSupabaseClient();

  const ingredients = await fetchIngredients(supabase);
  console.log('Loaded ingredients:', ingredients.length);

  const ingredientNames = ingredients.map((ing) => ing.name);
  const matched = await extractIngredientsQtyFromPdf(pdfBuffer, ingredientNames);
  console.log('Matched invoice lines:', matched.length);

  const withIds = mapMatchedToIds(matched, ingredients);
  if (withIds.length === 0) {
    console.log('No matches to receive.');
    return;
  }

  for (const item of withIds) {
    const qty = item.qtyShipped ?? item.qtyOrdered ?? 0;
    console.log(`Receiving ${qty} (${item.salesUnit}) for ${item.ingredientDbName} [${item.productNumber}]`);
    const resp = await receiveInventory(supabase, item.ingredientId, qty, note);
    console.log(' -> receive_inventory response:', resp);
  }
}

main().catch((err) => {
  console.error('Failed to receive invoice items:', err.message || err);
  process.exit(1);
});

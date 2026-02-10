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

async function fetchIngredientNames(client) {
  const { data, error } = await client
    .from('ingredients')
    .select('name')
    .not('name', 'ilike', '__test__%');
  if (error) throw new Error(`fetchIngredientNames: ${error.message}`);
  const dedup = new Set();
  for (const row of data || []) {
    const name = (row.name || '').trim();
    if (name) dedup.add(name);
  }
  return [...dedup];
}

async function main() {
  const pdfPath = process.argv[2] || 'C:/Users/Harry/Downloads/usfoods.pdf';
  console.log('PDF path:', pdfPath);
  const pdfBuffer = await fs.readFile(pdfPath);

  const supabase = getSupabaseClient();
  const ingredientNames = await fetchIngredientNames(supabase);
  console.log('Loaded ingredient names:', ingredientNames.length);

  const matched = await extractIngredientsQtyFromPdf(pdfBuffer, ingredientNames);
  console.log('Matched invoice lines (ingredientName, qtyOrdered):');
  for (const item of matched) {
    console.log(`- ${item.ingredientName}: ${item.qtyOrdered} (${item.salesUnit}) [${item.productNumber}]`);
  }
}

main().catch((err) => {
  console.error('Failed to extract:', err.message);
  process.exit(1);
});

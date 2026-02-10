require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  console.log('Generating forecasts...');
  
  // Generate forecast for next 7 days from today
  const today = new Date().toISOString().split('T')[0];
  console.log(`  Reference date: ${today}`);
  const { data, error } = await supabase.rpc('generate_forecast', {
    p_days_ahead: 7,
    p_reference_date: today
  });

  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  console.log('Forecast generated:');
  console.log(`  Item forecasts: ${data.item_forecasts}`);
  console.log(`  Ingredient forecasts: ${data.ingredient_forecasts}`);
  
  console.log('\nDone!');
}

main();

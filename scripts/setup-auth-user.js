/**
 * Creates a demo auth user for the frontend dev.
 * Run once: node scripts/setup-auth-user.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  const email = 'demo@tonys.pizza';
  const password = 'TonysPizza2026!';

  // Check if already exists
  const { data: { users } } = await supabase.auth.admin.listUsers();
  const existing = users.find(u => u.email === email);

  if (existing) {
    console.log('Demo user already exists:', email);
    console.log('  ID:', existing.id);
    return;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true  // Skip email verification
  });

  if (error) {
    console.error('Error creating user:', error.message);
    process.exit(1);
  }

  console.log('Demo user created:');
  console.log('  Email:    ' + email);
  console.log('  Password: ' + password);
  console.log('  ID:       ' + data.user.id);
  console.log('\nFrontend dev can now sign in with supabase.auth.signInWithPassword()');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

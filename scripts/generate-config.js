// generate-config.js
// Reads .env and writes Frontend/js/config.js (gitignored)

const fs = require('fs');
const path = require('path');

// Read .env
const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ No .env file found. Copy .envexample to .env and fill in your keys.');
  process.exit(1);
}

const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const match = line.match(/^\s*([\w]+)\s*=\s*["']?(.+?)["']?\s*$/);
  if (match) env[match[1]] = match[2];
});

const url = env.SUPABASE_URL;
const key = env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('❌ .env must have SUPABASE_URL and SUPABASE_ANON_KEY');
  process.exit(1);
}

// Write config.js
const configContent = `// AUTO-GENERATED — do not edit, do not commit
// Run "npm run config" to regenerate from .env
const SUPABASE_URL  = '${url}';
const SUPABASE_ANON = '${key}';
`;

const outPath = path.join(__dirname, '..', 'Frontend', 'js', 'config.js');
fs.writeFileSync(outPath, configContent);
console.log('✅ Frontend/js/config.js generated from .env');

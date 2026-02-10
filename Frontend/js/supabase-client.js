// ═══════════════════════════════════════════════
// js/supabase-client.js — Shared Supabase init
// Load AFTER the Supabase CDN script
// ═══════════════════════════════════════════════

// ─── PASTE YOUR KEYS HERE ────────────────────
// NOTE: anon key is safe to expose in frontend (RLS enforced). Service key must NEVER be used here.
const SUPABASE_URL  = window.__SUPABASE_URL || '';
const SUPABASE_ANON = window.__SUPABASE_ANON_KEY || '';
// ──────────────────────────────────────────────

if (!SUPABASE_ANON) {
  console.error('⚠️  Set SUPABASE_ANON in js/supabase-client.js');
}

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ─── Auth Helpers ────────────────────────────

/** Get current session or redirect to login */
async function requireAuth(loginPage = '/login.html') {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = loginPage;
    return null;
  }
  return session;
}

/** Sign out and redirect */
async function signOut() {
  await sb.auth.signOut();
  window.location.href = '/login.html';
}

// ─── Router: check onboarding state, redirect appropriately ──

async function routeByOnboarding() {
  const session = await requireAuth();
  if (!session) return;

  const { data, error } = await sb.rpc('get_onboarding_status');
  if (error) {
    console.error('Onboarding check failed:', error);
    return 'dashboard'; // fallback
  }
  return data.setup_complete ? 'dashboard' : 'onboarding';
}

// ─── Toast Notifications ─────────────────────

function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
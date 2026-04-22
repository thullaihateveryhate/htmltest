// ═══════════════════════════════════════════
// Tony's Pizza — Kiosk Logic
// ═══════════════════════════════════════════

const SUPABASE_URL = window.__SUPABASE_URL || '';
const SUPABASE_ANON = window.__SUPABASE_ANON_KEY || '';
const AUTH_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/auth-login`;
const KIOSK_DEVICE_TOKEN_KEY = 'stockd.kiosk.deviceToken.v1';
const MAX_KIOSK_RETRY_MS = 5 * 60 * 1000;
const TAX_RATE = 0.08;

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
const { escapeHtml, parseFiniteNumber, safeAttribute, safeEnum, sanitizeTextInput } = window.StockdSecurity;
const ALLOWED_DINING_OPTIONS = ['Dine In', 'Take Out', 'Delivery'];

// ─── State ───────────────────────────────
let menuItems  = [];   // { id, name, category, sizeLabel }
let categories = [];
let cart = [];         // { id, name, category, qty }
let activeCat = 'all';
let menuLoaded = false;
let kioskRetryCount = 0;
let kioskRetryTimer = null;

// ─── DOM refs ────────────────────────────
const $catSel   = document.getElementById('cat-select');
const $itemSel  = document.getElementById('item-select');
const $addQty   = document.getElementById('add-qty');
const $btnAdd   = document.getElementById('btn-add');
const $cartBody = document.getElementById('cart-body');
const $cartEmpty= document.getElementById('cart-empty');
const $btnOrder = document.getElementById('btn-order');
const $btnClear = document.getElementById('btn-clear');
const $overlay  = document.getElementById('overlay');
const $btnNew   = document.getElementById('btn-new');
const $toastBox = document.getElementById('toast-box');
const $menuStats= document.getElementById('menu-stats');
const $qtyMinus = document.getElementById('qty-minus');
const $qtyPlus  = document.getElementById('qty-plus');
const $clock    = document.getElementById('header-clock');

// ─── Init ────────────────────────────────
(async () => {
  startClock();
  bindEvents();
  await bootstrapKiosk();
})();

function getKioskClientToken() {
  try {
    const existing = localStorage.getItem(KIOSK_DEVICE_TOKEN_KEY);
    if (existing && existing.length >= 16 && existing.length <= 128) {
      return existing;
    }
  } catch (_error) {
  }

  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  const token = `stockd-kiosk-${randomPart}`.slice(0, 80);

  try {
    localStorage.setItem(KIOSK_DEVICE_TOKEN_KEY, token);
  } catch (_error) {
  }

  return token;
}

async function invokeProtectedKioskLogin() {
  const response = await fetch(AUTH_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`
    },
    body: JSON.stringify({
      flow: 'kiosk_login',
      client_token: getKioskClientToken()
    })
  });

  let parsed = null;
  try {
    parsed = await response.json();
  } catch (_error) {
    parsed = null;
  }

  if (!response.ok && (!parsed || typeof parsed !== 'object')) {
    throw new Error('Protected kiosk login failed');
  }

  return parsed || {};
}

async function applyKioskSession(payload) {
  const session = payload && typeof payload === 'object' ? payload.session : null;
  const accessToken = session && typeof session.access_token === 'string' ? session.access_token : '';
  const refreshToken = session && typeof session.refresh_token === 'string' ? session.refresh_token : '';

  if (!accessToken || !refreshToken) {
    throw new Error('Protected kiosk login returned an invalid session');
  }

  const { data, error } = await sb.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  if (error) {
    throw error;
  }

  return data.session;
}

function clearKioskRetry() {
  if (kioskRetryTimer) {
    clearTimeout(kioskRetryTimer);
    kioskRetryTimer = null;
  }
}

function getRetryDelay(retryAfterMs) {
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    return retryAfterMs;
  }

  kioskRetryCount += 1;
  return Math.min(MAX_KIOSK_RETRY_MS, Math.max(5000, 5000 * (2 ** (kioskRetryCount - 1))));
}

function scheduleKioskRetry(delayMs) {
  clearKioskRetry();
  const safeDelayMs = Math.max(1000, delayMs);
  $menuStats.textContent = `Kiosk sign-in unavailable. Retrying in ${Math.ceil(safeDelayMs / 1000)}s...`;
  kioskRetryTimer = setTimeout(() => {
    kioskRetryTimer = null;
    bootstrapKiosk().catch((error) => {
      console.error('Kiosk bootstrap retry failed:', error);
    });
  }, safeDelayMs);
}

function handleKioskAuthFailure(result, error) {
  const retryAfterMs = getRetryDelay(result && typeof result === 'object' ? result.retry_after_ms : 0);
  const message = result && typeof result.message === 'string' && result.message
    ? result.message
    : 'Kiosk sign-in failed.';

  toast(`${message} Retrying in ${Math.ceil(retryAfterMs / 1000)}s.`, 'error');
  if (error) {
    console.error('Kiosk auth error:', error);
  }
  scheduleKioskRetry(retryAfterMs);
}

async function signIn() {
  try {
    const result = await invokeProtectedKioskLogin();
    if (!result.ok || result.code !== 'signed_in') {
      handleKioskAuthFailure(result);
      return null;
    }

    const session = await applyKioskSession(result);
    kioskRetryCount = 0;
    clearKioskRetry();
    return session;
  } catch (error) {
    handleKioskAuthFailure(null, error);
    return null;
  }
}

async function ensureSignedIn() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    kioskRetryCount = 0;
    clearKioskRetry();
    return session;
  }

  return await signIn();
}

async function bootstrapKiosk() {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    toast('Kiosk configuration is missing Supabase public keys.', 'error');
    console.error('Missing kiosk Supabase config');
    return;
  }

  const session = await ensureSignedIn();
  if (!session) {
    return;
  }

  if (!menuLoaded) {
    await loadMenu();
  }
}

// ─── Load Menu ───────────────────────────
async function loadMenu() {
  const { data, error } = await sb.from('menu_items')
    .select('id, name, category, active')
    .eq('active', true)
    .order('category')
    .order('name');

  if (error || !data) {
    toast('Menu load failed', 'error');
    return;
  }

  // Filter out test items
  menuItems = data
    .filter(i => !i.name.startsWith('__'))
    .map(i => {
      const safeName = sanitizeTextInput(i.name, { maxLength: 160 });
      const safeCategory = sanitizeTextInput(i.category, { maxLength: 80 });
      const sizeMatch = safeName.match(/\((S|M|L|XL)\)$/);
      return { ...i, name: safeName, category: safeCategory, sizeLabel: sizeMatch ? sizeMatch[1] : null };
    });

  categories = [...new Set(menuItems.map(i => i.category))].filter(Boolean);
  renderCategoryDropdown();
  renderItemDropdown();
  $menuStats.textContent = `${menuItems.length} items across ${categories.length} categories`;
  menuLoaded = true;
}

// ─── Render Category Dropdown ────────────
function renderCategoryDropdown() {
  $catSel.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = 'all';
  defaultOption.textContent = 'All Categories';
  $catSel.appendChild(defaultOption);

  categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    $catSel.appendChild(option);
  });
}

// ─── Render Item Dropdown ────────────────
function renderItemDropdown() {
  const filtered = menuItems.filter(i => {
    if (activeCat !== 'all' && i.category !== activeCat) return false;
    return true;
  });

  $itemSel.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— pick a menu item —';
  $itemSel.appendChild(placeholder);

  filtered.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.dataset.name = item.name;
    option.dataset.cat = item.category || '';
    option.textContent = item.sizeLabel
      ? `${item.name} (${item.sizeLabel === 'S' ? 'Small' : item.sizeLabel === 'M' ? 'Medium' : item.sizeLabel === 'L' ? 'Large' : item.sizeLabel})`
      : item.name;
    $itemSel.appendChild(option);
  });

  $itemSel.value = '';
  $btnAdd.disabled = true;
}

// ─── Cart Logic ──────────────────────────
function addToCart(id, name, category) {
  const safeName = sanitizeTextInput(name, { maxLength: 160 });
  const safeCategory = sanitizeTextInput(category, { maxLength: 80 });
  const existing = cart.find(c => c.id === id);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ id, name: safeName, category: safeCategory, qty: 1 });
  }
  updateCart();
}

function removeFromCart(id) {
  cart = cart.filter(c => c.id !== id);
  updateCart();
}

function changeQty(id, delta) {
  const item = cart.find(c => c.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    cart = cart.filter(c => c.id !== id);
  }
  updateCart();
}

function clearCart() {
  cart = [];
  updateCart();
}

function updateCart() {
  // Render items
  if (!cart.length) {
    $cartEmpty.style.display = '';
    $cartBody.querySelectorAll('.cart-item').forEach(el => el.remove());
  } else {
    $cartEmpty.style.display = 'none';

    // Rebuild cart items
    const existing = $cartBody.querySelectorAll('.cart-item');
    existing.forEach(el => el.remove());

    cart.forEach(item => {
      const div = document.createElement('div');
      div.className = 'cart-item';
      div.innerHTML = `
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.name)}</div>
          <div class="cart-item-cat">${escapeHtml(item.category)}</div>
        </div>
        <div class="cart-item-qty">
          <button class="qty-btn" data-id="${safeAttribute(item.id, { maxLength: 80 })}" data-d="-1">−</button>
          <span class="qty-val">${item.qty}</span>
          <button class="qty-btn" data-id="${safeAttribute(item.id, { maxLength: 80 })}" data-d="1">+</button>
        </div>
        <button class="cart-item-remove" data-id="${safeAttribute(item.id, { maxLength: 80 })}" title="Remove">×</button>
      `;
      div.querySelectorAll('.qty-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          changeQty(btn.dataset.id, parseInt(btn.dataset.d));
        });
      });
      div.querySelector('.cart-item-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        removeFromCart(item.id);
      });
      $cartBody.appendChild(div);
    });
  }

  // Totals
  const totalQty = cart.reduce((s, c) => s + c.qty, 0);
  // We don't have prices in menu_items, so use a flat $12.99 per item
  // (the register_order RPC accepts price per item)
  const pricePerItem = 12.99;
  const subtotal = cart.reduce((s, c) => s + c.qty * pricePerItem, 0);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;

  document.getElementById('badge-items').textContent = `${totalQty} item${totalQty !== 1 ? 's' : ''}`;
  document.getElementById('badge-total').textContent = fmt(total);
  document.getElementById('s-sub').textContent = fmt(subtotal);
  document.getElementById('s-tax').textContent = fmt(tax);
  document.getElementById('s-total').textContent = fmt(total);
  $btnOrder.disabled = !cart.length;
}

// ─── Place Order ─────────────────────────
async function placeOrder() {
  if (!cart.length) return;
  $btnOrder.disabled = true;
  $btnOrder.textContent = 'Placing…';

  const pricePerItem = 12.99;
  const subtotal = cart.reduce((s, c) => s + c.qty * pricePerItem, 0);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;

  const orderId = 'KIOSK-' + Date.now();
  const diningOption = safeEnum(document.getElementById('dining-opt').value, ALLOWED_DINING_OPTIONS, 'Dine In');
  const numGuests = parseFiniteNumber(document.getElementById('guests').value, {
    integer: true,
    min: 1,
    max: 20
  }) || 1;
  document.getElementById('guests').value = String(numGuests);

  const order = {
    order_id:       orderId,
    business_date:  new Date().toISOString().slice(0, 10),
    opened_at:      new Date().toISOString(),
    closed_at:      new Date().toISOString(),
    num_guests:     numGuests,
    dining_option:  diningOption,
    order_source:   'kiosk',
    subtotal:       +subtotal.toFixed(2),
    tax:            +tax.toFixed(2),
    total:          +total.toFixed(2),
    items: cart.map(c => ({
      menu_item_name: c.name,
      qty:            c.qty,
      price:          +(c.qty * pricePerItem).toFixed(2),
      category:       c.category
    }))
  };

  const { data, error } = await sb.rpc('register_order', {
    p_order_raw: JSON.stringify(order)
  });

  $btnOrder.textContent = 'Place Order';

  if (error) {
    toast('Order failed: ' + error.message, 'error');
    $btnOrder.disabled = false;
    return;
  }

  // Show confirmation
  document.getElementById('modal-msg').textContent =
    `${diningOption} · ${numGuests} guest${numGuests > 1 ? 's' : ''}`;
  const renderedCart = cart.map(c => `${c.qty}× ${escapeHtml(c.name)}`).join('<br>');
  document.getElementById('modal-detail').innerHTML =
    `<strong>Order #${escapeHtml(orderId.slice(-8))}</strong><br>` +
    renderedCart +
    `<br><br>Subtotal: ${fmt(subtotal)}<br>Tax: ${fmt(tax)}<br><strong>Total: ${fmt(total)}</strong>` +
    `<br><br><span style="color:var(--green)">✓ ${data.items_processed} items processed, ${data.ingredients_consumed} ingredients consumed</span>`;
  $overlay.classList.add('open');

  clearCart();
}

// ─── Events ──────────────────────────────
function bindEvents() {
  $catSel.addEventListener('change', () => {
    const selectedCategory = sanitizeTextInput($catSel.value, { maxLength: 80 });
    activeCat = selectedCategory === 'all' || categories.includes(selectedCategory) ? selectedCategory : 'all';
    renderItemDropdown();
  });
  $itemSel.addEventListener('change', () => {
    $btnAdd.disabled = !$itemSel.value;
  });
  $qtyMinus.addEventListener('click', () => {
    const v = parseInt($addQty.value) || 1;
    $addQty.value = Math.max(1, v - 1);
  });
  $qtyPlus.addEventListener('click', () => {
    const v = parseInt($addQty.value) || 1;
    $addQty.value = v + 1;
  });
  $btnAdd.addEventListener('click', () => {
    const opt = $itemSel.selectedOptions[0];
    if (!opt || !opt.value) return;
    const qty = parseFiniteNumber($addQty.value, { integer: true, min: 1, max: 20 }) || 1;
    const safeName = sanitizeTextInput(opt.dataset.name, { maxLength: 160 });
    const safeCategory = sanitizeTextInput(opt.dataset.cat, { maxLength: 80 });
    const existing = cart.find(c => c.id === opt.value);
    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({ id: opt.value, name: safeName, category: safeCategory, qty });
    }
    updateCart();
    $itemSel.value = '';
    $addQty.value = 1;
    $btnAdd.disabled = true;
    toast('Added to order', 'success');
  });
  $btnClear.addEventListener('click', clearCart);
  $btnOrder.addEventListener('click', placeOrder);
  $btnNew.addEventListener('click', () => {
    $overlay.classList.remove('open');
    $btnOrder.disabled = true;
  });
}

// ─── Helpers ─────────────────────────────
function esc(s) {
  return escapeHtml(s);
}

function fmt(n) {
  return '$' + n.toFixed(2);
}

function toast(msg, type = 'error') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $toastBox.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function startClock() {
  function tick() {
    const now = new Date();
    $clock.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  tick();
  setInterval(tick, 30000);
}

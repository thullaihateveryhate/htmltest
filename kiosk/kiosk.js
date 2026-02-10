// ═══════════════════════════════════════════
// Tony's Pizza — Kiosk Logic
// ═══════════════════════════════════════════

const SUPABASE_URL  = 'https://ifycpxtpyysuthnknptl.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlmeWNweHRweXlzdXRobmtucHRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0NzAwMDksImV4cCI6MjA4NjA0NjAwOX0.RO2F6bLvbo34ZGRDpjbv8NrsHtmkX_D9mtXTVb0ErhY';

const KIOSK_EMAIL   = 'demo@tonys.pizza';
const KIOSK_PASS    = 'TonysPizza2026!';
const TAX_RATE      = 0.08;

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ─── State ───────────────────────────────
let menuItems  = [];   // { id, name, category, sizeLabel }
let categories = [];
let cart        = [];   // { id, name, category, qty }
let activeCat   = 'all';

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
  await signIn();
  await loadMenu();
  bindEvents();
})();

async function signIn() {
  const { error } = await sb.auth.signInWithPassword({
    email: KIOSK_EMAIL, password: KIOSK_PASS
  });
  if (error) {
    toast('Auth failed: ' + error.message, 'error');
    console.error('Auth error:', error);
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
      const sizeMatch = i.name.match(/\((S|M|L|XL)\)$/);
      return { ...i, sizeLabel: sizeMatch ? sizeMatch[1] : null };
    });

  categories = [...new Set(menuItems.map(i => i.category))].filter(Boolean);
  renderCategoryDropdown();
  renderItemDropdown();
  $menuStats.textContent = `${menuItems.length} items across ${categories.length} categories`;
}

// ─── Render Category Dropdown ────────────
function renderCategoryDropdown() {
  $catSel.innerHTML = '<option value="all">All Categories</option>' +
    categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

// ─── Render Item Dropdown ────────────────
function renderItemDropdown() {
  const filtered = menuItems.filter(i => {
    if (activeCat !== 'all' && i.category !== activeCat) return false;
    return true;
  });

  $itemSel.innerHTML = '<option value="">— pick a menu item —</option>' +
    filtered.map(i => {
      const label = i.sizeLabel
        ? `${i.name} (${i.sizeLabel === 'S' ? 'Small' : i.sizeLabel === 'M' ? 'Medium' : i.sizeLabel === 'L' ? 'Large' : i.sizeLabel})`
        : i.name;
      return `<option value="${i.id}" data-name="${esc(i.name)}" data-cat="${esc(i.category || '')}">${esc(label)}</option>`;
    }).join('');

  $itemSel.value = '';
  $btnAdd.disabled = true;
}

// ─── Cart Logic ──────────────────────────
function addToCart(id, name, category) {
  const existing = cart.find(c => c.id === id);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ id, name, category, qty: 1 });
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
          <div class="cart-item-name">${esc(item.name)}</div>
          <div class="cart-item-cat">${esc(item.category)}</div>
        </div>
        <div class="cart-item-qty">
          <button class="qty-btn" data-id="${item.id}" data-d="-1">−</button>
          <span class="qty-val">${item.qty}</span>
          <button class="qty-btn" data-id="${item.id}" data-d="1">+</button>
        </div>
        <button class="cart-item-remove" data-id="${item.id}" title="Remove">×</button>
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
  const diningOption = document.getElementById('dining-opt').value;
  const numGuests = parseInt(document.getElementById('guests').value) || 1;

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
  document.getElementById('modal-detail').innerHTML =
    `<strong>Order #${orderId.slice(-8)}</strong><br>` +
    cart.map(c => `${c.qty}× ${c.name}`).join('<br>') +
    `<br><br>Subtotal: ${fmt(subtotal)}<br>Tax: ${fmt(tax)}<br><strong>Total: ${fmt(total)}</strong>` +
    `<br><br><span style="color:var(--green)">✓ ${data.items_processed} items processed, ${data.ingredients_consumed} ingredients consumed</span>`;
  $overlay.classList.add('open');

  clearCart();
}

// ─── Events ──────────────────────────────
function bindEvents() {
  $catSel.addEventListener('change', () => {
    activeCat = $catSel.value;
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
    const qty = Math.max(1, parseInt($addQty.value) || 1);
    const existing = cart.find(c => c.id === opt.value);
    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({ id: opt.value, name: opt.dataset.name, category: opt.dataset.cat, qty });
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
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
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

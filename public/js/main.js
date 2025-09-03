/* Frontend: loads /api/products, handles search, category, cart, PayPal checkout */
let PRODUCTS = [];
let CART = JSON.parse(localStorage.getItem('repz_cart') || '[]');

const grid = document.getElementById('product-grid');
const searchEl = document.getElementById('search');
const catBtns = document.querySelectorAll('.cat-btn');
const cartCountEl = document.getElementById('cart-count');
const cartPanel = document.getElementById('cart');
const itemsDiv = document.getElementById('items');
const cartTotalEl = document.getElementById('cart-total');

async function init() {
  await loadProducts();
  bindUI();
  renderCart();
  initPayPal(); // load config & paypal SDK then render buttons
}

async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    PRODUCTS = await res.json();
  } catch (e) {
    console.error('Failed to load products', e);
    PRODUCTS = [];
  }
  renderProducts(PRODUCTS);
}

function renderProducts(list) {
  grid.innerHTML = '';
  list.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.transitionDelay = `${idx*30}ms`;
    card.dataset.category = (p.category || '').toLowerCase();

    card.innerHTML = `
      <img src="${p.image || 'https://via.placeholder.com/600x400?text=No+Image'}" alt="${escapeHtml(p.name)}" />
      <div class="info">
        <h3>${escapeHtml(p.name)}</h3>
        <div class="price">€${Number(p.price||0).toFixed(2)}</div>
        <div class="actions">
          <a class="btn-outline" href="${p.link}" target="_blank" rel="noopener">Zur Quelle</a>
          <button class="btn-outline add-to-cart" data-name="${escapeHtmlAttr(p.name)}" data-price="${Number(p.price||0)}">In den Warenkorb</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
    // animate in
    requestAnimationFrame(()=>card.classList.add('visible'));
  });

  document.querySelectorAll('.add-to-cart').forEach(btn => btn.addEventListener('click', addToCart));
}

function addToCart(e) {
  const name = e.currentTarget.dataset.name;
  const price = parseFloat(e.currentTarget.dataset.price || '0');
  const existing = CART.find(c => c.name === name);
  if (existing) existing.qty = (existing.qty || 1) + 1;
  else CART.push({ name, price, qty: 1 });
  persistCart(); renderCart(); openCart();
}

function persistCart(){ localStorage.setItem('repz_cart', JSON.stringify(CART)); }

function renderCart() {
  itemsDiv.innerHTML = '';
  let total = 0;
  CART.forEach((it, i) => {
    total += it.price * (it.qty || 1);
    const row = document.createElement('div');
    row.className = 'cart-row';
    row.innerHTML = `
      <div style="flex:1">
        <div style="font-weight:600">${escapeHtml(it.name)}</div>
        <div style="opacity:.8">€${it.price.toFixed(2)} x ${it.qty||1}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700">€${(it.price*(it.qty||1)).toFixed(2)}</div>
        <button class="remove" data-index="${i}">✕</button>
      </div>
    `;
    itemsDiv.appendChild(row);
  });
  document.querySelectorAll('.remove').forEach(b=>b.addEventListener('click', e=>{ const i = Number(e.currentTarget.dataset.index); CART.splice(i,1); persistCart(); renderCart(); }));
  cartTotalEl.textContent = `Gesamt: €${total.toFixed(2)}`;
  cartCountEl.textContent = CART.reduce((s,i)=>s+(i.qty||1),0);
}

function openCart(){ cartPanel.classList.add('active'); }
function closeCart(){ cartPanel.classList.remove('active'); }

document.getElementById('toggle-cart').addEventListener('click', e=>{ e.preventDefault(); openCart(); });
document.getElementById('close-cart').addEventListener('click', closeCart);

// search + category filtering
searchEl.addEventListener('input', applyFilters);
catBtns.forEach(b => b.addEventListener('click', () => {
  catBtns.forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  applyFilters();
}));

function applyFilters(){
  const q = (searchEl.value||'').trim().toLowerCase();
  const active = document.querySelector('.cat-btn.active');
  const cat = (active && active.dataset.cat) ? active.dataset.cat.toLowerCase() : 'all';
  const filtered = PRODUCTS.filter(p => {
    const matchesCat = cat === 'all' || ((p.category||'').toLowerCase() === cat);
    const matchesQuery = !q || (p.name||'').toLowerCase().includes(q);
    return matchesCat && matchesQuery;
  });
  renderProducts(filtered);
}

/* --------------------
   PayPal Buttons
   -------------------- */

async function initPayPal(){
  try {
    const cfg = await (await fetch('/config')).json();
    const clientId = cfg.paypalClientId || '';
    // inject sdk
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=EUR`;
    s.onload = () => {
      renderPayPalButtons();
    };
    document.head.appendChild(s);
  } catch (e) { console.error('Failed to load paypal config', e); }
}

function renderPayPalButtons(){
  if (!window.paypal) return console.warn('PayPal SDK not loaded');
  paypal.Buttons({
    style: { layout:'vertical', color:'blue', shape:'pill', label:'pay' },
    createOrder: function(data, actions) {
      // send cart to server to create order
      return fetch('/api/create-paypal-order', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ items: CART.map(i=>({ name:i.name, price:i.price, qty:i.qty })) })
      }).then(res=>res.json()).then(data=>{
        return data.id;
      });
    },
    onApprove: function(data, actions) {
      return fetch('/api/capture-paypal-order', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ orderID: data.orderID })
      }).then(res=>res.json()).then(result=>{
        // success
        alert('Zahlung erfolgreich — Danke!');
        CART = []; persistCart(); renderCart(); closeCart();
      }).catch(err=>{
        console.error('capture err', err);
        alert('Fehler beim Abschluss der Zahlung');
      });
    },
    onCancel: function() { alert('Zahlung abgebrochen'); },
    onError: function(err) { console.error(err); alert('PayPal Fehler'); }
  }).render('#paypal-button-container');
}

/* helpers */
function escapeHtml(s=''){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeHtmlAttr(s=''){ return escapeHtml(s).replace(/"/g,'&quot;'); }

init();

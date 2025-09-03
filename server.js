/**
 * RepzHeaven - simple Express backend
 * 
 * Run: npm install && node server.js
 */

const express = require('express');
const fetch = require('node-fetch'); // optional for Node<18
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');
const paypalSDK = require('@paypal/checkout-server-sdk');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const PORT = process.env.PORT || 4000; // change if needed
const PRODUCTS_FILE = path.join(__dirname, 'products.json');
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));

// Load products
let PRODUCTS = [];
async function loadProducts() {
  try {
    const exists = await fs.pathExists(PRODUCTS_FILE);
    if (!exists) {
      await fs.writeJson(PRODUCTS_FILE, []);
      PRODUCTS = [];
    } else {
      PRODUCTS = await fs.readJson(PRODUCTS_FILE);
    }
  } catch (e) {
    console.error('Failed to load products.json', e);
    PRODUCTS = [];
  }
}
loadProducts();

// Simple scrape cache
const scrapeCache = new Map();
function cacheSet(key, value) {
  const ttl = 10 * 60 * 1000;
  scrapeCache.set(key, { value, expires: Date.now() + ttl });
}
function cacheGet(key) {
  const rec = scrapeCache.get(key);
  if (!rec) return null;
  if (Date.now() > rec.expires) { scrapeCache.delete(key); return null; }
  return rec.value;
}

// PayPal client helper
function paypalClient() {
  const clientId = process.env.PAYPAL_CLIENT_ID || '';
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET || '';
  const mode = (process.env.PAYPAL_MODE || 'sandbox').toLowerCase();
  const environment = mode === 'live'
    ? new paypalSDK.core.LiveEnvironment(clientId, clientSecret)
    : new paypalSDK.core.SandboxEnvironment(clientId, clientSecret);
  return new paypalSDK.core.PayPalHttpClient(environment);
}

// Scrape product from URL
async function scrapeProductFromUrl(url) {
  const cached = cacheGet(url);
  if (cached) return cached;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (RepzHeaven Scraper)' },
    redirect: 'follow',
    timeout: 15000
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  
  let html = '';
  try { html = await res.text(); } catch (e) { throw new Error('Failed to read HTML'); }

  const $ = cheerio.load(html);

  let title = $('meta[property="og:title"]').attr('content') || $('meta[name="title"]').attr('content') || $('title').text() || '';
  title = title.trim();

  let image = $('meta[property="og:image"]').attr('content') || $('img').first().attr('src') || '';
  if (image && image.startsWith('//')) image = 'https:' + image;

  let price = null;
  const priceMetaProps = [
    'meta[itemprop="price"]',
    'meta[property="product:price:amount"]',
    'meta[name="price"]'
  ];
  for (const sel of priceMetaProps) {
    const v = $(sel).attr('content');
    if (v) { price = v; break; }
  }

  if (!price) {
    const priceElem = $('[class*="price"]').first();
    if (priceElem && priceElem.text()) price = priceElem.text();
  }

  if (!price) {
    const m = html.match(/(?:€|\$)?\s*([0-9]{1,3}(?:[.,][0-9]{2})?)/);
    if (m) price = m[1];
  }

  let priceNum = null;
  if (price) {
    const cleaned = ('' + price).replace(/[^\d,.\-]/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    if (!isNaN(n)) priceNum = n;
  }

  const product = {
    name: title || 'Produkt',
    price: priceNum !== null ? Number(priceNum.toFixed(2)) : 0.0,
    image: image || '',
    link: url,
    scrapedAt: new Date().toISOString()
  };

  cacheSet(url, product);
  return product;
}

/* ----------------------- API ----------------------- */

// GET /api/products
app.get('/api/products', async (req, res) => res.json(PRODUCTS));

// POST /api/import { url }
app.post('/api/import', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    const product = await scrapeProductFromUrl(url);
    return res.json({ success: true, product });
  } catch (e) {
    console.error('Import error', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/save { product } + x-admin-secret header
app.post('/api/save', async (req, res) => {
  const secret = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const product = req.body.product;
  if (!product || !product.name) return res.status(400).json({ error: 'Invalid product' });

  product.id = 'p_' + Date.now();
  product.createdAt = new Date().toISOString();
  PRODUCTS.unshift(product);

  try {
    await fs.writeJson(PRODUCTS_FILE, PRODUCTS, { spaces: 2 });
    return res.json({ success: true, product });
  } catch (e) {
    console.error('Save error', e);
    return res.status(500).json({ error: 'Failed to save product' });
  }
});

// GET /config
app.get('/config', (req, res) => {
  return res.json({
    paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
    paypalMode: process.env.PAYPAL_MODE || 'sandbox'
  });
});

// POST /api/create-paypal-order { items }
app.post('/api/create-paypal-order', async (req, res) => {
  const items = req.body.items || [];
  const currency = (req.body.currency || 'EUR').toUpperCase();
  const total = items.reduce((s, it) => s + (Number(it.price || 0) * (Number(it.qty || 1))), 0);
  const totalStr = Number(total).toFixed(2);

  try {
    const client = paypalClient();
    const request = new paypalSDK.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: currency, value: totalStr },
        items: items.map(it => ({
          name: it.name,
          unit_amount: { currency_code: currency, value: Number(it.price).toFixed(2) },
          quantity: String(it.qty || 1)
        }))
      }]
    });

    const order = await client.execute(request);
    return res.json({ id: order.result.id, result: order.result });
  } catch (e) {
    console.error('create-paypal-order error', e);
    return res.status(500).json({ error: e.message || 'paypal error' });
  }
});

// POST /api/capture-paypal-order { orderID }
app.post('/api/capture-paypal-order', async (req, res) => {
  const orderID = req.body.orderID;
  if (!orderID) return res.status(400).json({ error: 'Missing orderID' });

  try {
    const client = paypalClient();
    const request = new paypalSDK.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});
    const capture = await client.execute(request);
    return res.json({ result: capture.result });
  } catch (e) {
    console.error('capture error', e);
    return res.status(500).json({ error: e.message || 'capture error' });
  }
});

// SPA fallback (non-API routes)
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => console.log(`RepzHeaven server listening on port ${PORT}`));

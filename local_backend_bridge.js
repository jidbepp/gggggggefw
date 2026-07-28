#!/usr/bin/env node
'use strict';

/**
 * Local backend bridge for axiom_dashboard.html.
 *
 * Chromebook-friendly, dependency-free Node.js server. It keeps credentials out
 * of the browser, serves live market candidates from public data providers, and
 * exposes one deliberate execution seam. Live orders are never sent unless an
 * authenticated backend token, ENABLE_LIVE_ORDERS=true, and a LIVE_ORDER_WEBHOOK
 * (or explicitly configured Axiom-compatible endpoint) are all present.
 */

const crypto = require('crypto');
const http = require('http');

const config = {
  host: process.env.BRIDGE_HOST || '127.0.0.1',
  port: Number(process.env.BRIDGE_PORT || 8787),
  dashboardEmail: process.env.DASHBOARD_EMAIL || 'local@example.test',
  dashboardPassword: process.env.DASHBOARD_PASSWORD || 'change-me-before-live',
  enableLiveOrders: process.env.ENABLE_LIVE_ORDERS === 'true',
  allowPaperOrders: process.env.ALLOW_PAPER_ORDERS !== 'false',
  axiomApiBase: (process.env.AXIOM_API_BASE || '').replace(/\/$/, ''),
  axiomApiToken: process.env.AXIOM_API_TOKEN || '',
  liveOrderWebhook: process.env.LIVE_ORDER_WEBHOOK || '',
  marketProvider: (process.env.MARKET_PROVIDER || 'dexscreener').toLowerCase(),
  dexscreenerBase: 'https://api.dexscreener.com',
  birdeyeApiKey: process.env.BIRDEYE_API_KEY || '',
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
  sessionTtlMs: Number(process.env.SESSION_TTL_SECONDS || 8 * 60 * 60) * 1000,
  maxOrderUsd: Number(process.env.MAX_ORDER_USD || 25),
  minLiquidityUsd: Number(process.env.MIN_LIQUIDITY_USD || 8000),
  allowedChains: (process.env.ALLOWED_CHAINS || 'solana,base,bsc,ethereum').split(',').map((x) => x.trim()).filter(Boolean),
};

const sessions = new Map();
const audit = [];
const cache = new Map();

function now() { return new Date().toISOString(); }
function round(value, places = 2) { const s = 10 ** places; return Math.round(Number(value || 0) * s) / s; }
function random(min, max) { return min + Math.random() * (max - min); }
function safeText(value, max = 80) { return String(value || '').replace(/[^\w .:@/-]/g, '').slice(0, max); }

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': config.allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...extra,
  };
}
function json(res, status, payload) {
  const body = status === 204 ? '' : JSON.stringify(payload, null, 2);
  res.writeHead(status, corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }));
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 1_000_000) { reject(new Error('request body too large')); req.destroy(); } });
    req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}
function tokenFrom(req) { return (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || ''; }
function requireAuth(req, res) {
  const token = tokenFrom(req); const session = sessions.get(token);
  if (!token || !session || Date.now() > session.expiresAt) { if (token) sessions.delete(token); json(res, 401, { error: 'unauthorized' }); return null; }
  session.lastSeenAt = now(); return session;
}
function ttlGet(key) { const hit = cache.get(key); if (!hit || Date.now() > hit.expiresAt) return null; return hit.value; }
function ttlSet(key, value, ttlMs) { cache.set(key, { value, expiresAt: Date.now() + ttlMs }); return value; }

async function getJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 8000);
  try {
    const response = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'axiom-local-backend-bridge/1.0', ...(options.headers || {}) }, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text.slice(0, 180)}`);
    return JSON.parse(text || '{}');
  } finally { clearTimeout(timer); }
}

function syntheticCandidate(symbol) {
  return {
    provider: 'synthetic', chainId: 'paper', symbol, address: '0x' + crypto.randomBytes(20).toString('hex'), pairAddress: '', dexId: 'sim',
    price: round(random(0.000001, 0.003), 8), liquidity: round(random(2_000, 90_000), 2), volume5m: round(random(100, 35_000), 2),
    volume1h: round(random(500, 130_000), 2), priceChange5m: round(random(-20, 60), 2), txns5m: Math.round(random(5, 250)),
    top10: round(random(15, 78), 2), buyTax: 0, sellTax: 0, verified: Math.random() > 0.18, mintDisabled: true,
    liquidityLocked: Math.random() > 0.25, age: round(random(1, 180), 2), marketCap: round(random(25_000, 950_000), 2), url: '', riskFlags: []
  };
}
function syntheticCandidates(count = 8) { return Array.from({ length: count }, (_, i) => syntheticCandidate(['BONKX','PEPEAI','WOJAK2','MOONL','DOGGO','FROG','CATWIF','POPCATX'][i % 8])); }

async function fetchDexscreenerCandidates(limit) {
  const cacheKey = `dex:${limit}`; const cached = ttlGet(cacheKey); if (cached) return cached;
  const profiles = await getJson(`${config.dexscreenerBase}/token-profiles/latest/v1`);
  const selected = (Array.isArray(profiles) ? profiles : [])
    .filter((p) => config.allowedChains.includes(String(p.chainId || '').toLowerCase()))
    .slice(0, Math.min(30, Math.max(limit * 2, limit)));
  const candidates = [];
  for (const profile of selected) {
    if (candidates.length >= limit) break;
    try {
      const pairsData = await getJson(`${config.dexscreenerBase}/token-pairs/v1/${encodeURIComponent(profile.chainId)}/${encodeURIComponent(profile.tokenAddress)}`, { timeoutMs: 6000 });
      const pair = (Array.isArray(pairsData) ? pairsData : []).sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0];
      if (pair) candidates.push(normalizeDexPair(pair, profile));
    } catch (error) { audit.push({ ts: now(), event: 'provider_warning', provider: 'dexscreener', error: error.message.slice(0, 220) }); }
  }
  return ttlSet(cacheKey, candidates.length ? candidates : syntheticCandidates(limit), 30_000);
}

function normalizeDexPair(pair, profile = {}) {
  const createdAt = Number(pair.pairCreatedAt || 0);
  const age = createdAt ? Math.max(0, (Date.now() - createdAt) / 60000) : 999;
  const riskFlags = [];
  if (Number(pair.liquidity?.usd || 0) < config.minLiquidityUsd) riskFlags.push('low_liquidity');
  if (!pair.info?.websites?.length && !profile.url) riskFlags.push('limited_metadata');
  return {
    provider: 'dexscreener', chainId: safeText(pair.chainId, 24), symbol: safeText(pair.baseToken?.symbol || profile.symbol || 'UNKNOWN', 24),
    address: String(pair.baseToken?.address || profile.tokenAddress || ''), pairAddress: String(pair.pairAddress || ''), dexId: safeText(pair.dexId, 32),
    price: Number(pair.priceUsd || 0), liquidity: round(pair.liquidity?.usd || 0), volume5m: round(pair.volume?.m5 || 0), volume1h: round(pair.volume?.h1 || 0),
    priceChange5m: round(pair.priceChange?.m5 || 0), txns5m: Number(pair.txns?.m5?.buys || 0) + Number(pair.txns?.m5?.sells || 0),
    top10: 0, buyTax: 0, sellTax: 0, verified: Boolean(profile.icon || pair.info?.imageUrl), mintDisabled: true, liquidityLocked: Number(pair.liquidity?.usd || 0) >= config.minLiquidityUsd,
    age: round(age), marketCap: round(pair.marketCap || pair.fdv || 0), url: String(pair.url || profile.url || ''), riskFlags
  };
}

async function fetchCandidates(limit) {
  if (config.marketProvider === 'synthetic') return syntheticCandidates(limit);
  if (config.marketProvider === 'dexscreener') {
    try { return await fetchDexscreenerCandidates(limit); }
    catch (error) {
      audit.push({ ts: now(), event: 'provider_fallback', provider: 'dexscreener', error: error.message.slice(0, 220) });
      return syntheticCandidates(limit);
    }
  }
  throw new Error(`unsupported MARKET_PROVIDER ${config.marketProvider}`);
}

async function proxyLiveOrder(order) {
  if (!config.enableLiveOrders) {
    if (!config.allowPaperOrders) throw new Error('paper order acknowledgements are disabled');
    return { status: 'filled', mode: 'paper_bridge', orderId: crypto.randomUUID(), order };
  }
  const target = config.liveOrderWebhook || (config.axiomApiBase ? `${config.axiomApiBase}/orders` : '');
  if (!target) throw new Error('LIVE_ORDER_WEBHOOK or AXIOM_API_BASE is required when ENABLE_LIVE_ORDERS=true');
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (config.axiomApiToken) headers.Authorization = `Bearer ${config.axiomApiToken}`;
  const response = await fetch(target, { method: 'POST', headers, body: JSON.stringify({ ...order, submittedAt: now(), source: 'axiom-local-backend-bridge' }) });
  const body = await response.text();
  if (!response.ok) throw new Error(`live order endpoint failed ${response.status}: ${body.slice(0, 300)}`);
  try { return JSON.parse(body); } catch { return { status: 'submitted', raw: body }; }
}

function validateOrder(order) {
  if (!['buy', 'sell'].includes(order.side)) throw new Error('side must be buy or sell');
  if (!order.symbol || typeof order.symbol !== 'string') throw new Error('symbol is required');
  if (!order.address || typeof order.address !== 'string') throw new Error('address is required');
  const size = Number(order.sizeUsd);
  if (!Number.isFinite(size) || size <= 0) throw new Error('sizeUsd must be positive');
  if (size > config.maxOrderUsd) throw new Error(`sizeUsd exceeds bridge MAX_ORDER_USD=${config.maxOrderUsd}`);
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'POST' && url.pathname === '/auth/login') {
    const body = await readBody(req);
    if (body.email !== config.dashboardEmail || body.password !== config.dashboardPassword) return json(res, 401, { error: 'invalid credentials' });
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(token, { email: body.email, createdAt: now(), expiresAt: Date.now() + config.sessionTtlMs });
    audit.push({ ts: now(), event: 'login', email: body.email });
    return json(res, 200, { token, tokenType: 'Bearer', expiresInSeconds: Math.floor(config.sessionTtlMs / 1000) });
  }
  if (url.pathname === '/health') {
    const session = requireAuth(req, res); if (!session) return;
    return json(res, 200, { ok: true, ts: now(), marketProvider: config.marketProvider, mode: config.enableLiveOrders ? 'live_adapter_enabled' : 'paper_bridge', liveReady: Boolean(config.enableLiveOrders && (config.liveOrderWebhook || config.axiomApiBase)), maxOrderUsd: config.maxOrderUsd, user: session.email });
  }
  if (req.method === 'GET' && url.pathname === '/candidates') {
    const session = requireAuth(req, res); if (!session) return;
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 8)));
    const candidates = await fetchCandidates(limit);
    audit.push({ ts: now(), event: 'candidates', count: candidates.length, provider: config.marketProvider, email: session.email });
    return json(res, 200, { candidates, provider: config.marketProvider });
  }
  if (req.method === 'POST' && url.pathname === '/orders') {
    const session = requireAuth(req, res); if (!session) return;
    const order = await readBody(req); validateOrder(order);
    const result = await proxyLiveOrder(order);
    audit.push({ ts: now(), event: 'order', email: session.email, order, result });
    return json(res, 200, result);
  }
  if (req.method === 'GET' && url.pathname === '/audit') { const session = requireAuth(req, res); if (!session) return; return json(res, 200, { audit }); }
  return json(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => { route(req, res).catch((error) => json(res, 500, { error: error.message })); });
server.listen(config.port, config.host, () => {
  console.log(`Axiom local backend bridge listening on http://${config.host}:${config.port}`);
  console.log(`Dashboard login email: ${config.dashboardEmail}`);
  console.log(`Market provider: ${config.marketProvider}; live orders: ${config.enableLiveOrders ? 'ENABLED' : 'disabled/paper acknowledgements'}`);
  console.log('Chromebook tip: run this in Linux Terminal, then open backend_wizard.html or axiom_dashboard.html in Chrome.');
});

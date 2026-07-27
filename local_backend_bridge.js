#!/usr/bin/env node
'use strict';

/**
 * Local backend bridge for axiom_dashboard.html.
 *
 * This server is the safe place to keep credentials and signing logic. The HTML
 * dashboard talks to this bridge instead of storing Axiom passwords, wallet
 * secrets, or API keys in the browser. By default it runs in paper mode with
 * synthetic candidates and simulated order fills.
 */

const crypto = require('crypto');
const http = require('http');

const config = {
  host: process.env.BRIDGE_HOST || '127.0.0.1',
  port: Number(process.env.BRIDGE_PORT || 8787),
  dashboardEmail: process.env.DASHBOARD_EMAIL || 'local@example.test',
  dashboardPassword: process.env.DASHBOARD_PASSWORD || 'change-me-before-live',
  enableLiveOrders: process.env.ENABLE_LIVE_ORDERS === 'true',
  axiomApiBase: (process.env.AXIOM_API_BASE || '').replace(/\/$/, ''),
  axiomApiToken: process.env.AXIOM_API_TOKEN || '',
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
};

const sessions = new Map();
const audit = [];

function now() {
  return new Date().toISOString();
}

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': config.allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function tokenFrom(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function requireAuth(req, res) {
  const token = tokenFrom(req);
  if (!token || !sessions.has(token)) {
    json(res, 401, { error: 'unauthorized' });
    return null;
  }
  return sessions.get(token);
}

function candidate(symbol) {
  return {
    symbol,
    address: '0x' + crypto.randomBytes(20).toString('hex'),
    price: round(random(0.000001, 0.003), 8),
    liquidity: round(random(2_000, 90_000), 2),
    volume5m: round(random(100, 35_000), 2),
    volume1h: round(random(500, 130_000), 2),
    priceChange5m: round(random(-20, 60), 2),
    top10: round(random(15, 78), 2),
    buyTax: round(random(0, 12), 2),
    sellTax: round(random(0, 14), 2),
    verified: Math.random() > 0.18,
    mintDisabled: Math.random() > 0.2,
    liquidityLocked: Math.random() > 0.25,
    age: round(random(1, 180), 2),
    marketCap: round(random(25_000, 950_000), 2),
  };
}

function random(min, max) {
  return min + Math.random() * (max - min);
}

function round(value, places = 2) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function syntheticCandidates(count = 8) {
  const symbols = ['BONKX', 'PEPEAI', 'WOJAK2', 'MOONL', 'DOGGO', 'FROG', 'CATWIF', 'POPCATX'];
  return Array.from({ length: count }, (_, index) => candidate(symbols[index % symbols.length]));
}

async function proxyLiveOrder(order) {
  if (!config.enableLiveOrders) {
    return { status: 'filled', mode: 'paper_bridge', orderId: crypto.randomUUID(), order };
  }
  if (!config.axiomApiBase || !config.axiomApiToken) {
    throw new Error('AXIOM_API_BASE and AXIOM_API_TOKEN are required when ENABLE_LIVE_ORDERS=true');
  }

  // Use an authorized official API endpoint here. This generic path is a safe
  // adapter seam; confirm the real endpoint and payload in Axiom documentation
  // before enabling live funds.
  const response = await fetch(`${config.axiomApiBase}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.axiomApiToken}`,
    },
    body: JSON.stringify(order),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`live order failed ${response.status}: ${body.slice(0, 300)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    return { status: 'submitted', raw: body };
  }
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') {
    return json(res, 204, {});
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    const session = requireAuth(req, res);
    if (!session) return;
    return json(res, 200, {
      ok: true,
      ts: now(),
      mode: config.enableLiveOrders ? 'live_adapter_enabled' : 'paper_bridge',
      liveReady: Boolean(config.enableLiveOrders && config.axiomApiBase && config.axiomApiToken),
      user: session.email,
    });
  }

  if (req.method === 'POST' && url.pathname === '/auth/login') {
    const body = await readBody(req);
    if (body.email !== config.dashboardEmail || body.password !== config.dashboardPassword) {
      return json(res, 401, { error: 'invalid credentials' });
    }
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(token, { email: body.email, createdAt: now() });
    audit.push({ ts: now(), event: 'login', email: body.email });
    return json(res, 200, { token, tokenType: 'Bearer', expiresInSeconds: 8 * 60 * 60 });
  }

  if (req.method === 'GET' && url.pathname === '/candidates') {
    const session = requireAuth(req, res);
    if (!session) return;
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 8)));
    const candidates = syntheticCandidates(limit);
    audit.push({ ts: now(), event: 'candidates', count: candidates.length, email: session.email });
    return json(res, 200, { candidates });
  }

  if (req.method === 'GET' && url.pathname === '/stream') {
    const session = requireAuth(req, res);
    if (!session) return;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': config.allowedOrigin,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    const send = () => res.write(`event: candidates\ndata: ${JSON.stringify({ ts: now(), candidates: syntheticCandidates(16) })}\n\n`);
    send();
    const timer = setInterval(send, 1000);
    req.on('close', () => clearInterval(timer));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/orders') {
    const session = requireAuth(req, res);
    if (!session) return;
    const order = await readBody(req);
    validateOrder(order);
    const result = await proxyLiveOrder(order);
    audit.push({ ts: now(), event: 'order', email: session.email, order, result });
    return json(res, 200, result);
  }

  if (req.method === 'GET' && url.pathname === '/audit') {
    const session = requireAuth(req, res);
    if (!session) return;
    return json(res, 200, { audit });
  }

  return json(res, 404, { error: 'not found' });
}

function validateOrder(order) {
  if (!['buy', 'sell'].includes(order.side)) throw new Error('side must be buy or sell');
  if (!order.symbol || typeof order.symbol !== 'string') throw new Error('symbol is required');
  if (!order.address || typeof order.address !== 'string') throw new Error('address is required');
  if (!Number.isFinite(Number(order.sizeUsd)) || Number(order.sizeUsd) <= 0) throw new Error('sizeUsd must be positive');
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => json(res, 500, { error: error.message }));
});

server.listen(config.port, config.host, () => {
  console.log(`Axiom local backend bridge listening on http://${config.host}:${config.port}`);
  console.log(`Dashboard login email: ${config.dashboardEmail}`);
  console.log('Set DASHBOARD_PASSWORD, AXIOM_API_BASE, AXIOM_API_TOKEN, and ENABLE_LIVE_ORDERS=true before any live integration.');
});

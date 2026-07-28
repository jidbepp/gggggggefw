'use strict';
const $ = (id) => document.getElementById(id);
const settingsKey = 'axiom-dashboard-settings-v2';
const tokenKey = 'axiom-dashboard-backend-token';
let token = sessionStorage.getItem(tokenKey) || '';
function log(message) {
  const row = document.createElement('div');
  row.className = 'log-line';
  row.textContent = `[${new Date().toISOString()}] ${message}`;
  $('wizardLog').prepend(row);
}
function backendUrl() { return normalizeBackendUrl($('wizardBackendUrl').value); }
function normalizeBackendUrl(raw) {
  const value = String(raw || '').trim().replace(/\/$/, '');
  if (!value && location.protocol.startsWith('http')) return location.origin;
  try {
    const url = new URL(value);
    if ((url.pathname && url.pathname !== '/') || /\.html/i.test(value)) return '';
    return url.origin;
  } catch {
    return '';
  }
}
function headers(base = {}) { return token ? { ...base, Authorization: `Bearer ${token}` } : base; }
function setStatus(message, connected = false) {
  $('wizardStatus').textContent = message;
  document.querySelector('.dot').classList.toggle('running', connected);
}
function saveUrl() {
  const current = JSON.parse(localStorage.getItem(settingsKey) || '{}');
  current.backendUrl = backendUrl();
  if (!current.backendUrl) { log('Backend URL must be the bridge origin only, for example http://127.0.0.1:8787.'); return; }
  current.tradingMode = 'live_bridge';
  localStorage.setItem(settingsKey, JSON.stringify(current));
  log(`Saved backend URL ${current.backendUrl} for the dashboard.`);
}
async function login() {
  saveUrl();
  const response = await fetch(`${backendUrl()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ email: $('wizardEmail').value.trim(), password: $('wizardPassword').value })
  });
  if (!response.ok) throw new Error(`login failed ${response.status}`);
  const data = await response.json();
  if (!data.token) throw new Error('login response missing token');
  token = data.token;
  sessionStorage.setItem(tokenKey, token);
  $('wizardPassword').value = '';
  setStatus('Bridge connected', true);
  log('Bridge login succeeded. Token stored for this tab only.');
}
async function health() {
  const response = await fetch(`${backendUrl()}/health`, { headers: headers({ Accept: 'application/json' }) });
  if (!response.ok) throw new Error(`health failed ${response.status}`);
  log(`Health OK: ${JSON.stringify(await response.json())}`);
}
async function candidates() {
  const response = await fetch(`${backendUrl()}/candidates?limit=5`, { headers: headers({ Accept: 'application/json' }) });
  if (!response.ok) throw new Error(`candidates failed ${response.status}`);
  const data = await response.json();
  log(`Fetched ${data.candidates.length} candidates.`);
}
function wrap(fn) { return () => fn().catch((error) => log(`ERROR: ${error.message}`)); }
$('wizardSaveUrl').addEventListener('click', saveUrl);
$('wizardLogin').addEventListener('click', wrap(login));
$('wizardHealth').addEventListener('click', wrap(health));
$('wizardCandidates').addEventListener('click', wrap(candidates));
$('wizardOpenDashboard').addEventListener('click', () => { saveUrl(); location.href = 'axiom_dashboard.html'; });
if (!$('wizardBackendUrl').value && location.protocol.startsWith('http')) $('wizardBackendUrl').value = location.origin;
setStatus(token ? 'Bridge token found' : 'Not connected', Boolean(token));
log('Wizard ready. Complete steps 1-3, then open the dashboard.');

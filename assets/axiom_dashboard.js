    const $ = (id) => document.getElementById(id);
    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    const state = {
      running: false,
      timer: null,
      startingBalance: 1000,
      balance: 1000,
      pnl: 0,
      scanned: 0,
      positions: new Map(),
      cooldowns: new Map(),
      audit: [],
      backendHealthy: false,
      authToken: sessionStorage.getItem('axiom-dashboard-backend-token') || ''
    };

    const storageKey = 'axiom-dashboard-settings-v2';

    const symbols = ['BONKX', 'PEPEAI', 'WOJAK2', 'MOONL', 'DOGGO', 'FROG', 'CATWIF', 'POPCATX', 'BODEN2', 'SNEKAI'];

    function config() {
      return {
        startingBalance: number('startingBalance'),
        pollSeconds: number('pollSeconds'),
        minimumScore: number('minimumScore'),
        maxPosition: number('maxPosition'),
        maxOpen: number('maxOpen'),
        stopLoss: number('stopLoss'),
        takeProfit: number('takeProfit'),
        dailyLoss: number('dailyLoss'),
        cooldown: number('cooldown'),
        minAge: number('minAge'),
        maxAge: number('maxAge'),
        maxMarketCap: number('maxMarketCap'),
        minLiquidity: number('minLiquidity'),
        maxTop10: number('maxTop10'),
        maxBuyTax: number('maxBuyTax'),
        maxSellTax: number('maxSellTax'),
        minVolumeAcceleration: number('minVolumeAcceleration'),
        tradingMode: $('tradingMode').value,
        backendUrl: $('backendUrl').value.trim().replace(/\/$/, ''),
        enableLiveFunds: $('enableLiveFunds').checked
      };
    }

    function number(id) { return Number($(id).value); }
    function random(min, max) { return min + Math.random() * (max - min); }
    function choice(list) { return list[Math.floor(Math.random() * list.length)]; }
    function address() { return '0x' + Array.from({ length: 40 }, () => choice('abcdef0123456789')).join(''); }
    function now() { return new Date().toISOString(); }

    async function fetchCandidates(cfg) {
      if (cfg.tradingMode !== 'live_bridge') return generateCandidates();
      if (!cfg.backendUrl) throw new Error('Backend bridge URL is required for live bridge mode.');
      const response = await fetch(`${cfg.backendUrl}/candidates`, { headers: authHeaders({ 'Accept': 'application/json' }) });
      if (!response.ok) throw new Error(`Backend candidate fetch failed: ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.candidates)) throw new Error('Backend response must include a candidates array.');
      return data.candidates.map(normalizeBackendCandidate);
    }

    function normalizeBackendCandidate(token) {
      return {
        symbol: String(token.symbol || 'UNKNOWN'),
        address: String(token.address || address()),
        price: Number(token.price ?? token.price_usd ?? 0),
        liquidity: Number(token.liquidity ?? token.liquidity_usd ?? 0),
        volume5m: Number(token.volume5m ?? token.volume_5m_usd ?? 0),
        volume1h: Number(token.volume1h ?? token.volume_1h_usd ?? 1),
        priceChange5m: Number(token.priceChange5m ?? token.price_change_5m_pct ?? 0),
        top10: Number(token.top10 ?? token.top10_holder_pct ?? 100),
        buyTax: Number(token.buyTax ?? token.buy_tax_pct ?? 100),
        sellTax: Number(token.sellTax ?? token.sell_tax_pct ?? 100),
        verified: Boolean(token.verified ?? token.contract_verified),
        mintDisabled: Boolean(token.mintDisabled ?? token.mint_disabled),
        liquidityLocked: Boolean(token.liquidityLocked ?? token.liquidity_locked),
        age: Number(token.age ?? token.age_minutes ?? 999),
        marketCap: Number(token.marketCap ?? token.market_cap_usd ?? Number.MAX_SAFE_INTEGER)
      };
    }

    function generateCandidates(count = 8) {
      return Array.from({ length: count }, () => ({
        symbol: choice(symbols),
        address: address(),
        price: random(0.000001, 0.003),
        liquidity: random(2000, 90000),
        volume5m: random(100, 35000),
        volume1h: random(500, 130000),
        priceChange5m: random(-20, 60),
        top10: random(15, 78),
        buyTax: random(0, 12),
        sellTax: random(0, 14),
        verified: Math.random() > 0.18,
        mintDisabled: Math.random() > 0.2,
        liquidityLocked: Math.random() > 0.25,
        age: random(1, 180),
        marketCap: random(25000, 950000)
      }));
    }

    function scoreToken(token, cfg) {
      let score = 0;
      const reasons = [];
      if (token.verified) score += 15; else reasons.push('unverified contract');
      if (token.mintDisabled) score += 15; else reasons.push('mint active risk');
      if (token.liquidityLocked) score += 15; else reasons.push('liquidity unlocked');
      if (token.liquidity >= cfg.minLiquidity) score += 15; else reasons.push('low liquidity');
      if (token.top10 <= cfg.maxTop10) score += 15; else reasons.push('holder concentration');
      if (token.buyTax <= cfg.maxBuyTax && token.sellTax <= cfg.maxSellTax) score += 10; else reasons.push('high tax');
      if (token.age >= cfg.minAge && token.age <= cfg.maxAge) score += 5; else reasons.push('age outside window');
      if (token.marketCap <= cfg.maxMarketCap) score += 5; else reasons.push('market cap high');
      const volumeAcceleration = token.volume5m / Math.max(token.volume1h / 12, 1);
      if (volumeAcceleration >= cfg.minVolumeAcceleration && volumeAcceleration <= 8 && token.priceChange5m >= 3 && token.priceChange5m <= 35) score += 15;
      else reasons.push('weak/overheated momentum');
      return { score: Math.min(score, 100), reasons, volumeAcceleration };
    }

    function canEnter(token, scored, cfg) {
      const cooldownUntil = state.cooldowns.get(token.address) || 0;
      return scored.score >= cfg.minimumScore &&
        state.positions.size < cfg.maxOpen &&
        !state.positions.has(token.address) &&
        Date.now() >= cooldownUntil &&
        state.pnl > -cfg.dailyLoss &&
        state.balance >= cfg.maxPosition;
    }

    async function enter(token, scored, cfg) {
      await placeOrder('buy', token, cfg.maxPosition, cfg);
      state.balance -= cfg.maxPosition;
      state.positions.set(token.address, {
        ...token,
        entry: token.price,
        size: cfg.maxPosition,
        openedAt: now(),
        score: scored.score
      });
      const eventName = cfg.tradingMode === 'paper' ? 'paper_buy' : 'live_bridge_buy';
      audit(eventName, { symbol: token.symbol, address: token.address, score: scored.score, sizeUsd: cfg.maxPosition });
      log(`${cfg.tradingMode === 'paper' ? 'PAPER BUY' : 'LIVE BRIDGE BUY'} ${token.symbol} size=${fmt.format(cfg.maxPosition)} score=${scored.score}`);
    }

    async function placeOrder(side, tokenOrPosition, sizeUsd, cfg, reason = '') {
      if (cfg.tradingMode === 'paper') {
        return { status: 'filled', mode: 'paper', side, sizeUsd };
      }
      if (!cfg.enableLiveFunds) throw new Error('Live funds checkbox must be enabled before sending live bridge orders.');
      if (!state.authToken) throw new Error('Connect to your backend bridge before sending live orders.');
      if (!state.backendHealthy) throw new Error('Backend bridge must pass health check before live orders.');
      if (!cfg.backendUrl) throw new Error('Backend bridge URL is required.');
      const response = await fetch(`${cfg.backendUrl}/orders`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json', 'Accept': 'application/json' }),
        body: JSON.stringify({ side, symbol: tokenOrPosition.symbol, address: tokenOrPosition.address, sizeUsd, reason })
      });
      if (!response.ok) throw new Error(`Backend order failed: ${response.status}`);
      return response.json();
    }

    async function managePositions(cfg) {
      for (const [addr, pos] of [...state.positions.entries()]) {
        const movePct = random(-18, 45);
        if (movePct <= -cfg.stopLoss || movePct >= cfg.takeProfit) {
          const pnl = pos.size * movePct / 100;
          const reason = pnl < 0 ? 'STOP' : 'TAKE PROFIT';
          state.balance += pos.size + pnl;
          state.pnl += pnl;
          state.positions.delete(addr);
          state.cooldowns.set(addr, Date.now() + cfg.cooldown * 1000);
          await placeOrder('sell', pos, pos.size, cfg, reason);
          audit(cfg.tradingMode === 'paper' ? 'paper_sell' : 'live_bridge_sell', { symbol: pos.symbol, address: addr, reason, pnlUsd: round(pnl), movePct: round(movePct) });
          log(`${reason} ${pos.symbol} pnl=${fmt.format(pnl)} move=${round(movePct)}%`);
        }
      }
    }

    function applyStartingBalance() {
      if (state.running) {
        log('Stop the auto-trader before changing starting balance.');
        return;
      }
      const amount = Math.max(1, config().startingBalance);
      state.startingBalance = amount;
      state.balance = amount;
      state.pnl = 0;
      state.scanned = 0;
      state.positions.clear();
      state.cooldowns.clear();
      state.audit = [];
      renderCandidates([]);
      renderPositions();
      renderMetrics();
      audit('paper_account_reset', { startingBalanceUsd: amount });
      log(`Paper account reset with starting balance ${fmt.format(amount)}`);
    }

    async function scan() {
      const cfg = config();
      try {
        updateModeUi(cfg);
        const candidates = await fetchCandidates(cfg);
        state.scanned += candidates.length;
        const rows = [];
        for (const token of candidates) {
          const scored = scoreToken(token, cfg);
          audit('signal', { token, score: scored.score, reasons: scored.reasons, mode: cfg.tradingMode });
          if (canEnter(token, scored, cfg)) await enter(token, scored, cfg);
          rows.push({ token, scored, decision: scored.score >= cfg.minimumScore ? 'Qualified' : scored.reasons.slice(0, 2).join(', ') });
        }
        rows.sort((a, b) => b.scored.score - a.scored.score);
        await managePositions(cfg);
        renderCandidates(rows);
        renderPositions();
        renderMetrics();
      } catch (error) {
        log(`ERROR: ${error.message}`);
        stop();
      }
    }

    function renderCandidates(rows) {
      if (!rows.length) {
        $('candidateRows').innerHTML = '<tr><td colspan="8" style="color:var(--muted)">No candidates scanned yet</td></tr>';
        return;
      }
      $('candidateRows').innerHTML = rows.map(({ token, scored, decision }) => `
        <tr>
          <td><strong>${token.symbol}</strong><br><span class="pill">${token.address.slice(0, 8)}…</span></td>
          <td class="score ${scored.score >= 72 ? 'good' : scored.score >= 55 ? 'warn' : 'bad'}">${scored.score}</td>
          <td>${fmt.format(token.price)}</td>
          <td>${fmt.format(token.liquidity)}</td>
          <td>${fmt.format(token.marketCap)}</td>
          <td>${round(token.age)}m</td>
          <td>${round(scored.volumeAcceleration)}x / ${round(token.priceChange5m)}%</td>
          <td>${decision === 'Qualified' ? '<span class="pill buy">Qualified</span>' : `<span class="pill">${decision}</span>`}</td>
        </tr>`).join('');
    }

    function renderPositions() {
      const rows = [...state.positions.values()].map((pos) => `
        <tr>
          <td><strong>${pos.symbol}</strong><br><span class="pill">score ${pos.score}</span></td>
          <td>${fmt.format(pos.entry)}</td>
          <td>${fmt.format(pos.size)}</td>
          <td>${pos.openedAt.slice(11, 19)} UTC</td>
          <td><span class="pill buy">Open</span></td>
        </tr>`).join('');
      $('positionRows').innerHTML = rows || '<tr><td colspan="5" style="color:var(--muted)">No open paper positions</td></tr>';
    }

    function renderMetrics() {
      $('balance').textContent = fmt.format(state.balance);
      $('pnl').textContent = fmt.format(state.pnl);
      $('pnl').style.color = state.pnl >= 0 ? 'var(--green)' : 'var(--red)';
      $('positionsCount').textContent = String(state.positions.size);
      $('signalsCount').textContent = String(state.scanned);
    }

    function start() {
      if (state.running) return;
      state.startingBalance = Math.max(1, config().startingBalance);
      if (state.balance <= 0) state.balance = state.startingBalance;
      state.running = true;
      $('statusDot').classList.add('running');
      const cfg = config();
      $('statusText').textContent = `Running · ${cfg.tradingMode === 'live_bridge' ? 'Live bridge' : 'Paper mode'}`;
      log(`Auto-trader started in ${cfg.tradingMode === 'live_bridge' ? 'LIVE BRIDGE' : 'PAPER MODE'}`);
      scan();
      state.timer = setInterval(() => scan(), Math.max(1, config().pollSeconds) * 1000);
    }

    function stop() {
      state.running = false;
      $('statusDot').classList.remove('running');
      updateModeUi();
      if (state.timer) clearInterval(state.timer);
      state.timer = null;
      log('Auto-trader stopped');
    }

    function audit(event, payload) {
      state.audit.push({ ts: now(), event, ...payload });
    }

    function log(message) {
      const line = document.createElement('div');
      line.className = 'log-line';
      line.textContent = `[${now()}] ${message}`;
      $('log').prepend(line);
    }

    function authHeaders(base = {}) {
      return state.authToken ? { ...base, Authorization: `Bearer ${state.authToken}` } : base;
    }

    async function loginBackend() {
      const cfg = config();
      const email = $('backendEmail').value.trim();
      const password = $('backendPassword').value;
      if (!cfg.backendUrl) { log('Backend URL is required before connecting.'); return; }
      if (!email || !password) { log('Backend email and password are required.'); return; }
      try {
        const response = await fetch(`${cfg.backendUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        if (!response.ok) throw new Error(`login returned ${response.status}`);
        const data = await response.json();
        if (!data.token) throw new Error('login response must include a token');
        state.authToken = String(data.token);
        sessionStorage.setItem('axiom-dashboard-backend-token', state.authToken);
        $('backendPassword').value = '';
        updateAuthUi();
        log('Backend connected. Token stored for this browser tab only.');
      } catch (error) {
        state.authToken = '';
        sessionStorage.removeItem('axiom-dashboard-backend-token');
        updateAuthUi();
        log(`Backend login failed: ${error.message}`);
      }
    }

    function logoutBackend() {
      state.authToken = '';
      state.backendHealthy = false;
      sessionStorage.removeItem('axiom-dashboard-backend-token');
      updateAuthUi();
      updateModeUi();
      log('Backend disconnected.');
    }

    function updateAuthUi() {
      $('authStatus').textContent = state.authToken ? 'Backend connected for this tab' : 'Backend not connected';
      $('authStatus').className = state.authToken ? 'pill buy' : 'pill';
    }

    async function testBackend() {
      const cfg = config();
      if (!cfg.backendUrl) { log('Backend URL is required for health check.'); return; }
      try {
        const response = await fetch(`${cfg.backendUrl}/health`, { headers: authHeaders({ 'Accept': 'application/json' }) });
        if (!response.ok) throw new Error(`health returned ${response.status}`);
        state.backendHealthy = true;
        log('Backend bridge health check passed. Live bridge can be armed if you enable live funds.');
      } catch (error) {
        state.backendHealthy = false;
        log(`Backend bridge health check failed: ${error.message}`);
      }
      updateModeUi(cfg);
    }

    function saveSettings() {
      localStorage.setItem(storageKey, JSON.stringify(config()));
      log('Settings saved in this browser.');
    }

    function loadSettings() {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        for (const [key, value] of Object.entries(saved)) {
          const el = $(key);
          if (!el) continue;
          if (el.type === 'checkbox') el.checked = Boolean(value);
          else el.value = value;
        }
        log('Saved settings loaded from this browser.');
      } catch {
        log('Saved settings could not be loaded; using defaults.');
      }
    }

    function updateModeUi(cfg = config()) {
      const live = cfg.tradingMode === 'live_bridge';
      $('modePill').textContent = live ? (cfg.enableLiveFunds && state.authToken ? 'LIVE BACKEND BRIDGE ARMED' : 'LIVE BRIDGE DISARMED') : 'PAPER / SANDBOX';
      $('modePill').className = live && cfg.enableLiveFunds && state.authToken ? 'pill sell' : 'pill buy';
      $('providerLabel').textContent = live ? 'Backend bridge provider' : 'Synthetic/offline provider';
      if (!state.running) $('statusText').textContent = `Stopped · ${live ? 'Live bridge' : 'Paper mode'} · Chromebook ready`;
    }

    function exportAudit() {
      const blob = new Blob([JSON.stringify(state.audit, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `axiom-paper-audit-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }

    function round(value) { return Math.round(value * 100) / 100; }

    $('startBtn').addEventListener('click', start);
    $('stopBtn').addEventListener('click', stop);
    $('scanBtn').addEventListener('click', () => scan());
    $('exportBtn').addEventListener('click', exportAudit);
    $('applyBalanceBtn').addEventListener('click', applyStartingBalance);
    $('testBackendBtn').addEventListener('click', testBackend);
    $('loginBackendBtn').addEventListener('click', loginBackend);
    $('logoutBackendBtn').addEventListener('click', logoutBackend);
    $('saveSettingsBtn').addEventListener('click', saveSettings);
    $('tradingMode').addEventListener('change', () => updateModeUi());
    $('enableLiveFunds').addEventListener('change', () => updateModeUi());
    loadSettings();
    updateAuthUi();
    updateModeUi();
    renderMetrics();
    renderCandidates([]);
    renderPositions();
    log('Dashboard ready. Press Start auto-trader to begin paper-mode scanning.');

# Axiom Professional Meme-Coin Auto-Trader

A professional, safety-first automation scaffold for discovering early meme-coin opportunities, scoring them, and routing qualified entries through a controlled auto-trader from a start/stop desktop GUI.

This repository intentionally does **not** include pump-and-dump tooling, market manipulation, front-running, bypasses for axiom.trade controls, or any "guaranteed no-loss" claim. No script can accurately guarantee that cheap tokens will pump or that a trade cannot lose money. The default mode is paper trading so the full workflow can be tested without risking funds.

## What is included

- Start/stop/quit Tkinter control panel for the Python trading loop.
- Multi-file HTML dashboard (`axiom_dashboard.html` plus `assets/axiom_dashboard.css` and `assets/axiom_dashboard.js`) for Chromebook/browser-based paper-mode scanning, scoring, risk controls, positions, saved settings, secure backend login, optional live backend bridge, and audit export.
- Autonomous strategy loop that scans candidates, scores risk/reward, enters qualified trades, and manages exits.
- Auto-trader execution boundary (`OrderExecutor`) that supports paper fills now and blocks live orders until an authorized API adapter is implemented.
- Early-token filters for launch age, market cap, liquidity, volume acceleration, price momentum, taxes, holder concentration, contract verification, mint authority, and liquidity lock status.
- Starting-balance controls so you can set the paper capital you want to test before the bot starts.
- Risk management: max position size, max open positions, stop loss, take profit, cooldowns, and daily loss limit.
- JSONL audit log of every signal, paper buy, and paper sell.
- Configurable settings for strategy, watchlist, and execution behavior.

## Quick start

```bash
python3 axiom_memecoin_watcher.py --config settings.example.json
```

Or open the Chromebook/browser dashboard from a downloaded GitHub ZIP/repository checkout:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000/axiom_dashboard.html
```

The dashboard intentionally relies on `assets/axiom_dashboard.css` and `assets/axiom_dashboard.js`, so download/extract the full repository ZIP instead of copying only the HTML file. Use `backend_wizard.html` for a multi-step browser setup helper that saves the bridge URL, logs in to the bridge, verifies health, and opens the dashboard.

Optional local backend bridge for Chromebook Linux / desktop Node.js. A browser page cannot securely start a server by itself, so start this local bridge once and then use `backend_wizard.html` or the dashboard to connect to it:

```bash
DASHBOARD_EMAIL=you@example.com DASHBOARD_PASSWORD='use-a-strong-password' node local_backend_bridge.js
# dashboard Backend bridge URL: http://127.0.0.1:8787
```

The browser dashboard is fully functional in offline paper mode on a Chromebook. It can also authenticate to the included local backend bridge with `POST /auth/login`, `GET /health`, `GET /candidates`, and `POST /orders` endpoints, but Axiom passwords, private keys, exchange secrets, wallet signing, and API credentials must stay on that backend instead of in the static HTML.

## Making it live safely

1. Keep `mode` set to `paper` while testing.
2. Replace `MarketDataProvider.fetch_candidates()` with an official market-data API or stream you are authorized to use.
3. For the HTML dashboard, use `local_backend_bridge.js` or expose an equivalent bridge with `POST /auth/login`, `GET /health`, `GET /candidates`, and `POST /orders`; keep all Axiom credentials, secrets, wallets, signing, authentication, and rate limiting on that server.
4. For the Python app, implement a dedicated live subclass/adapter for `OrderExecutor.buy()` and `OrderExecutor.sell()` using a broker or exchange API you are authorized to use.
5. Backtest and forward-test with logs before enabling live orders.
6. Only enable live bridge/live order settings after you understand the failure modes, fees, slippage, and legal/compliance obligations.

## Why no "no-loss sniper" claim?

Meme-coin markets are volatile, adversarial, and often illiquid. Rug pulls, honeypots, failed transactions, MEV, stale data, slippage, and exchange/API outages can cause losses. This project focuses on professional controls and auditable automation rather than impossible guarantees.

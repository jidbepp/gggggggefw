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

The bridge is dependency-free and uses Node 18+ built-in `fetch`. By default it pulls real token candidates from the DEX Screener public API (`MARKET_PROVIDER=dexscreener`) and returns paper order acknowledgements. You can force offline demo data with `MARKET_PROVIDER=synthetic`.

The browser dashboard is fully functional in offline paper mode on a Chromebook. It can also authenticate to the included local backend bridge with `POST /auth/login`, `GET /health`, `GET /candidates`, `POST /orders`, and `GET /audit` endpoints, but Axiom passwords, private keys, exchange secrets, wallet signing, and API credentials must stay on that backend instead of in the static HTML.

## Chromebook setup

1. On the Chromebook, enable **Linux development environment** in ChromeOS settings.
2. Open the Linux Terminal and install runtime packages if needed:

   ```bash
   sudo apt update
   sudo apt install -y nodejs npm python3
   ```

3. Download/extract this repository, then run the local bridge:

   ```bash
   cd ~/Downloads/gggggggefw   # or the folder where you extracted the repo
   DASHBOARD_EMAIL=you@example.com DASHBOARD_PASSWORD='make-this-long' node local_backend_bridge.js
   ```

4. In Chrome, open `backend_wizard.html`, use bridge URL `http://127.0.0.1:8787`, log in with the email/password from step 3, test health, fetch candidates, then open the dashboard.
5. Keep `Enable live funds` unchecked until you have a real, authorized execution webhook/API and have tested with tiny limits.

## Useful backend environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DASHBOARD_EMAIL` / `DASHBOARD_PASSWORD` | `local@example.test` / unsafe default | Login for the browser dashboard. Always set both. |
| `MARKET_PROVIDER` | `dexscreener` | `dexscreener` for live market candidates or `synthetic` for offline demo data. |
| `ALLOWED_CHAINS` | `solana,base,bsc,ethereum` | Comma-separated chains accepted from the market provider. |
| `MAX_ORDER_USD` | `25` | Backend-side per-order hard cap. |
| `ENABLE_LIVE_ORDERS` | `false` | Must be `true` before the bridge will forward orders. |
| `LIVE_ORDER_WEBHOOK` | empty | Your own authenticated order service endpoint. Recommended execution seam. |
| `AXIOM_API_BASE` / `AXIOM_API_TOKEN` | empty | Optional Axiom-compatible endpoint/token if you have official authorized API access. |
| `ALLOWED_ORIGIN` | `*` | Set to your dashboard origin for stricter browser CORS. |

## Making it live safely

1. Keep Python `mode` set to `paper` and dashboard `Trading mode` set to `Paper / sandbox` while testing.
2. The included bridge can fetch real market candidates from DEX Screener's public API, whose docs list endpoints such as latest token profiles and token pairs. Axiom.trade public API availability is not clearly documented; do not scrape or bypass platform controls.
3. For live orders, point `LIVE_ORDER_WEBHOOK` (recommended) or `AXIOM_API_BASE` at an order service you control and are authorized to use, then set `ENABLE_LIVE_ORDERS=true`.
4. Keep all Axiom credentials, API tokens, private keys, wallets, signing, rate limiting, and compliance checks on the backend service. Never put them in the browser dashboard.
5. Backtest and forward-test with audit logs, tiny `MAX_ORDER_USD`, stop-losses, and daily loss limits before enabling meaningful live funds.
6. Only enable live bridge/live order settings after you understand failure modes, fees, taxes, slippage, MEV, RPC outages, and legal/compliance obligations.

## Why no "no-loss sniper" claim?

Meme-coin markets are volatile, adversarial, and often illiquid. Rug pulls, honeypots, failed transactions, MEV, stale data, slippage, and exchange/API outages can cause losses. This project focuses on professional controls and auditable automation rather than impossible guarantees.

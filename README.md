# Axiom Professional Meme-Coin Auto-Trader

Safety-first paper-trading and backend-bridge scaffold for scanning meme-coin candidates, scoring risk, simulating orders, and optionally forwarding live orders through a backend you control.

> No bot can guarantee profit or guarantee no losses. This project does not bypass axiom.trade controls, scrape private APIs, front-run markets, or store wallet secrets in the browser. Paper mode is the default.

## Fastest Chromebook setup: one command, one URL

Use this first. It serves both the dashboard and the backend API from the same Node server, so you do **not** need `python3 -m http.server`.

### 1. Enable Linux on the Chromebook

ChromeOS Settings → Advanced → Developers → Linux development environment → Turn on.

### 2. Install tools

```bash
sudo apt update
sudo apt install -y git nodejs npm python3 curl
node --version
python3 --version
```

Node must be version 18 or newer because the bridge uses built-in `fetch`.

### 3. Open the project folder

If you downloaded a ZIP, adjust the path to wherever you extracted it:

```bash
cd ~/Downloads/gggggggefw
```

If you use git:

```bash
git clone <your-repo-url> gggggggefw
cd gggggggefw
```

### 4. Create your local secrets file

Copy the example environment file. This is where API keys and live-account secrets go. Do **not** put secrets in the HTML files.

```bash
cp .env.example .env.local
nano .env.local
```

For first setup, keep these values in `.env.local`:

```bash
DASHBOARD_EMAIL=you@example.com
DASHBOARD_PASSWORD=change-this-long-random-password
MARKET_PROVIDER=synthetic
ENABLE_LIVE_ORDERS=false
MAX_ORDER_USD=25
```

### 5. Start the all-in-one local server

The bridge automatically loads `.env.local`. Start with synthetic data first so you can prove everything works without network/API issues:

```bash
node local_backend_bridge.js
```

You should see:

```text
Axiom local backend bridge listening on http://127.0.0.1:8787
Open dashboard: http://127.0.0.1:8787/axiom_dashboard.html
Open setup wizard: http://127.0.0.1:8787/backend_wizard.html
```

### 6. Open the dashboard

Open this exact URL in Chrome:

```text
http://127.0.0.1:8787/axiom_dashboard.html
```

For paper trading:

1. Click **Reset saved settings**.
2. Keep **Trading mode** as **Paper / sandbox**.
3. Keep **Enable live funds** unchecked.
4. Click **Start auto-trader**.

For backend candidate mode:

1. Set **Trading mode** to **Live backend bridge**.
2. Set **Backend bridge URL** to exactly:

   ```text
   http://127.0.0.1:8787
   ```

3. Login email: the value you used for `DASHBOARD_EMAIL`.
4. Login password: the value you used for `DASHBOARD_PASSWORD`.
5. Click **Connect backend**.
6. Click **Test backend bridge**.
7. Keep **Enable live funds** unchecked unless you have configured a real live order endpoint.

## Do not mix up these URLs

Recommended all-in-one mode uses only Node:

| Purpose | Correct URL |
| --- | --- |
| Dashboard page | `http://127.0.0.1:8787/axiom_dashboard.html` |
| Backend bridge URL field | `http://127.0.0.1:8787` |
| Wizard page | `http://127.0.0.1:8787/backend_wizard.html` |

Do **not** put this in the backend field:

```text
http://127.0.0.1:8000/axiom_dashboard.html
```

If you see errors like `/axiom_dashboard.html/candidates` or `/axiom_dashboard.html/auth/login`, your backend URL is wrong. Click **Reset saved settings**, then use `http://127.0.0.1:8787`.

## Optional two-terminal mode

Only use this if you specifically want Python to serve static files.

Terminal 1:

```bash
cd ~/Downloads/gggggggefw
python3 -m http.server 8000
```

Terminal 2:

```bash
cd ~/Downloads/gggggggefw
DASHBOARD_EMAIL=you@example.com \
DASHBOARD_PASSWORD='change-this-password' \
MARKET_PROVIDER=synthetic \
node local_backend_bridge.js
```

Open:

```text
http://127.0.0.1:8000/axiom_dashboard.html
```

But the **Backend bridge URL** field must still be:

```text
http://127.0.0.1:8787
```

## API setup, keys, and live funds

### Where keys go

Put keys in `.env.local`, which is loaded automatically by `local_backend_bridge.js`. Keep `.env.local` on your Chromebook/backend only. Never paste API keys, wallet private keys, seed phrases, Axiom passwords, or webhook secrets into `axiom_dashboard.html`, browser devtools, screenshots, GitHub issues, or commits.

Safe file flow:

```bash
cp .env.example .env.local
nano .env.local
node local_backend_bridge.js
```

After editing `.env.local`, stop the bridge with `Ctrl+C` and restart it so the new values load.

### Synthetic/offline paper data, no API key

Best for first setup:

```bash
# .env.local
DASHBOARD_EMAIL=you@example.com
DASHBOARD_PASSWORD=change-this-long-random-password
MARKET_PROVIDER=synthetic
ENABLE_LIVE_ORDERS=false
MAX_ORDER_USD=25
```

Then run:

```bash
node local_backend_bridge.js
```

### DEX Screener market data, no API key for current endpoints

DEX Screener publishes public API endpoints for token profiles and token pairs. The bridge uses those endpoints when `MARKET_PROVIDER=dexscreener`.

```bash
# .env.local
DASHBOARD_EMAIL=you@example.com
DASHBOARD_PASSWORD=change-this-long-random-password
MARKET_PROVIDER=dexscreener
ALLOWED_CHAINS=solana,base,bsc,ethereum
PROVIDER_CONCURRENCY=6
ENABLE_LIVE_ORDERS=false
```

Then run:

```bash
node local_backend_bridge.js
```

If DEX Screener or your network fails, the bridge logs a provider fallback and returns synthetic candidates so the dashboard still works. Increase `PROVIDER_CONCURRENCY` up to `10` for faster scans, or lower it if your network is unstable.

### Birdeye API

Birdeye typically requires an account and API key from Birdeye's developer/API portal. Do not paste Birdeye keys into the HTML dashboard.

The bridge currently exposes `BIRDEYE_API_KEY` as a placeholder environment variable, but the included code does not yet implement a Birdeye provider. Add a dedicated provider on the backend if you want Birdeye data.

### Axiom API and live funds

Axiom.trade's public docs describe the trading terminal, but this repository does not include an official Axiom Trade order API schema. Search results also contain similarly named non-trading Axiom APIs and unofficial/third-party SDKs; do not assume those are official live-trading endpoints. To get a real Axiom Trade API:

1. Sign in to your Axiom Trade account.
2. Look for an official developer/API section in Axiom Trade account settings or official docs.
3. If you do not see it, contact Axiom support and ask for: base URL, authentication format, order endpoint path, buy/sell payload schema, testnet/sandbox mode, rate limits, slippage fields, token address format, quote asset format, error codes, and terms of use.
4. Do not scrape Axiom pages, automate private login flows, reuse browser cookies, bypass protections, or put your Axiom password in this dashboard.

If Axiom gives you an official REST order API compatible with `POST {base}/orders`, put the values in `.env.local` like this:

```bash
# .env.local
DASHBOARD_EMAIL=you@example.com
DASHBOARD_PASSWORD=change-this-long-random-password
MARKET_PROVIDER=dexscreener
ENABLE_LIVE_ORDERS=true
AXIOM_API_BASE=https://official-api-url-from-axiom
AXIOM_API_TOKEN=your-official-token
MAX_ORDER_USD=5
PROVIDER_CONCURRENCY=6
```

Restart the bridge:

```bash
node local_backend_bridge.js
```

Recommended professional live path: create your own order service that handles wallet signing, Axiom-specific payloads, retries, idempotency, slippage, and compliance checks. Then point the bridge at your service:

```bash
# .env.local
DASHBOARD_EMAIL=you@example.com
DASHBOARD_PASSWORD=change-this-long-random-password
MARKET_PROVIDER=dexscreener
ENABLE_LIVE_ORDERS=true
LIVE_ORDER_WEBHOOK=https://your-own-order-service.example/orders
LIVE_ORDER_AUTH_HEADER=Authorization: Bearer replace-with-your-webhook-secret
MAX_ORDER_USD=5
PROVIDER_CONCURRENCY=6
```

Restart the bridge, log in from the dashboard, run **Test backend bridge**, set a tiny max position, then enable **Enable live funds** only for a tiny test trade.

## Backend environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `BRIDGE_HOST` | `127.0.0.1` | Local bind address. Keep this local for Chromebook use. |
| `BRIDGE_PORT` | `8787` | Dashboard/API server port. |
| `DASHBOARD_EMAIL` / `DASHBOARD_PASSWORD` | unsafe defaults | Browser login. Always set both. |
| `MARKET_PROVIDER` | `synthetic` | `synthetic` or `dexscreener`. |
| `PROVIDER_CONCURRENCY` | `6` | Parallel DEX Screener pair requests; use `1`-`10`. |
| `ALLOWED_CHAINS` | `solana,base,bsc,ethereum` | DEX Screener chains to accept. |
| `MAX_ORDER_USD` | `25` | Hard per-order backend cap. Use tiny values for live tests. |
| `ENABLE_LIVE_ORDERS` | `false` | Must be `true` before orders are forwarded. |
| `ALLOW_PAPER_ORDERS` | `true` | Allows paper acknowledgements when live orders are off. |
| `LIVE_ORDER_WEBHOOK` | empty | Your own live order service endpoint. |
| `LIVE_ORDER_AUTH_HEADER` | empty | Optional extra header for `LIVE_ORDER_WEBHOOK`, e.g. `Authorization: Bearer ...`. |
| `AXIOM_API_BASE` / `AXIOM_API_TOKEN` | empty | Official Axiom-compatible API settings if Axiom grants access. |
| `ALLOWED_ORIGIN` | `*` | Optional stricter CORS origin. |
| `SESSION_TTL_SECONDS` | `28800` | Dashboard session lifetime. |

## Troubleshooting

### `Failed to fetch` in the wizard

The backend bridge is not running, the URL is wrong, or you are using the Python server URL in the backend field.

Fix:

```bash
cd ~/Downloads/gggggggefw
DASHBOARD_EMAIL=you@example.com DASHBOARD_PASSWORD='change-this-password' MARKET_PROVIDER=synthetic node local_backend_bridge.js
```

Then open:

```text
http://127.0.0.1:8787/backend_wizard.html
```

### `/axiom_dashboard.html/candidates` 404

Your backend URL was saved incorrectly. In the dashboard, click **Reset saved settings** and use:

```text
http://127.0.0.1:8787
```

### `health returned 401`

You clicked health before logging in. Enter the same email/password used when starting Node, then click **Connect backend**.

### `sizeUsd exceeds bridge MAX_ORDER_USD`

Your dashboard max position is larger than the backend cap. Lower the dashboard max position or start the bridge with a higher `MAX_ORDER_USD`.

## Python GUI

Desktop Python GUI paper mode still works separately:

```bash
python3 axiom_memecoin_watcher.py --config settings.example.json
```

This requires a desktop environment with Tkinter. On many Chromebooks, the browser dashboard is easier.

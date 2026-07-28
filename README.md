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

### 4. Start the all-in-one local server

Start with synthetic data first so you can prove everything works without network/API issues:

```bash
DASHBOARD_EMAIL=you@example.com \
DASHBOARD_PASSWORD='change-this-password' \
MARKET_PROVIDER=synthetic \
node local_backend_bridge.js
```

You should see:

```text
Axiom local backend bridge listening on http://127.0.0.1:8787
Open dashboard: http://127.0.0.1:8787/axiom_dashboard.html
Open setup wizard: http://127.0.0.1:8787/backend_wizard.html
```

### 5. Open the dashboard

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

## API setup

### Synthetic/offline paper data, no API key

Best for first setup:

```bash
DASHBOARD_EMAIL=you@example.com \
DASHBOARD_PASSWORD='change-this-password' \
MARKET_PROVIDER=synthetic \
node local_backend_bridge.js
```

### DEX Screener market data, no API key for current endpoints

DEX Screener publishes public API endpoints for token profiles and token pairs. The bridge uses those endpoints when `MARKET_PROVIDER=dexscreener`.

```bash
DASHBOARD_EMAIL=you@example.com \
DASHBOARD_PASSWORD='change-this-password' \
MARKET_PROVIDER=dexscreener \
ALLOWED_CHAINS=solana,base,bsc,ethereum \
node local_backend_bridge.js
```

If DEX Screener or your network fails, the bridge logs a provider fallback and returns synthetic candidates so the dashboard still works.

### Birdeye API

Birdeye typically requires an account and API key from Birdeye's developer/API portal. Do not paste Birdeye keys into the HTML dashboard.

The bridge currently exposes `BIRDEYE_API_KEY` as a placeholder environment variable, but the included code does not yet implement a Birdeye provider. Add a dedicated provider on the backend if you want Birdeye data.

### Axiom API

Axiom.trade does not appear to provide a broadly documented public trading API inside this repository. To get an Axiom API:

1. Sign in to your Axiom account.
2. Check official Axiom account settings/docs for API access.
3. If no API section exists, contact Axiom support and ask for official API documentation, base URL, authentication method, order endpoint, rate limits, and terms of use.
4. Do not scrape Axiom pages, automate private login flows, bypass protections, or put your Axiom password in this dashboard.

If Axiom gives you official API access, run the bridge like this:

```bash
ENABLE_LIVE_ORDERS=true \
AXIOM_API_BASE='https://official-api-url-from-axiom' \
AXIOM_API_TOKEN='your-official-token' \
MAX_ORDER_USD=5 \
DASHBOARD_EMAIL=you@example.com \
DASHBOARD_PASSWORD='change-this-password' \
MARKET_PROVIDER=synthetic \
node local_backend_bridge.js
```

Recommended professional live path: create your own order service and point the bridge at it:

```bash
ENABLE_LIVE_ORDERS=true \
LIVE_ORDER_WEBHOOK='https://your-own-order-service.example/orders' \
MAX_ORDER_USD=5 \
DASHBOARD_EMAIL=you@example.com \
DASHBOARD_PASSWORD='change-this-password' \
MARKET_PROVIDER=dexscreener \
node local_backend_bridge.js
```

## Backend environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `BRIDGE_HOST` | `127.0.0.1` | Local bind address. Keep this local for Chromebook use. |
| `BRIDGE_PORT` | `8787` | Dashboard/API server port. |
| `DASHBOARD_EMAIL` / `DASHBOARD_PASSWORD` | unsafe defaults | Browser login. Always set both. |
| `MARKET_PROVIDER` | `synthetic` | `synthetic` or `dexscreener`. |
| `ALLOWED_CHAINS` | `solana,base,bsc,ethereum` | DEX Screener chains to accept. |
| `MAX_ORDER_USD` | `25` | Hard per-order backend cap. Use tiny values for live tests. |
| `ENABLE_LIVE_ORDERS` | `false` | Must be `true` before orders are forwarded. |
| `ALLOW_PAPER_ORDERS` | `true` | Allows paper acknowledgements when live orders are off. |
| `LIVE_ORDER_WEBHOOK` | empty | Your own live order service endpoint. |
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

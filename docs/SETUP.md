# Installation & deployment

The system runs as **one Node.js server** (API + kiosk + admin pages) and **one PostgreSQL database**,
normally on a small server or PC inside the institution's network. The kiosk touchscreen is just a
browser in kiosk mode pointing at that server. The kiosk PC and the server can be the same machine.

```
 Touchscreen kiosk (Chrome --kiosk) ──LAN──►  Canteen server: Node.js + PostgreSQL ──Internet──► Razorpay
 Admin PC / phone (browser)        ──LAN──►        │
                                                   └──LAN/USB──► 80 mm ESC/POS thermal printer
```

## 1. Requirements

- Node.js 20 LTS or newer, PostgreSQL 14 or newer (`pg_dump` on the PATH for backups)
- Internet access from the server (only needed for the payment gateway)
- A public HTTPS URL for gateway webhooks (see [PAYMENTS.md](PAYMENTS.md)); not needed for simulated mode

## 2. Install

```bash
git clone <your repo> crtl-kiosk && cd crtl-kiosk
npm install
npm run build                      # builds the React app and compiles the server
cp server/.env.example server/.env
```

Edit `server/.env`:

| Variable | What to set |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgres://USER:PASSWORD@localhost:5432/crtl_kiosk` |
| `SESSION_SECRET` | 64 random hex characters: `openssl rand -hex 32` |
| `COOKIE_SECURE` | `true` if the admin pages are served over HTTPS |
| `ADMIN_ALLOWED_IPS` | Optional: comma-separated IPs allowed to open `/admin` (e.g. the manager's PC) |
| `PUBLIC_URL` | URL the server is reachable at (used for webhook URL display, simulated QR) |
| `PAYMENT_PROVIDER` | `simulated` until the gateway has been tested; then `razorpay` |
| `RAZORPAY_*` | Keys from the Razorpay dashboard (Test keys first) |
| `BACKUP_DIR`, `BACKUP_KEEP_DAYS`, `BACKUP_CRON` | Backup location (ideally another disk), retention, time |

Then:

```bash
npm run migrate                    # creates all tables (safe to re-run)
npm run seed                       # OPTIONAL: sample menu for testing; skip for a real menu
npm start                          # starts on PORT (default 8080)
```

On first start the console prints a **one-time setup token**. Open `http://SERVER:8080/admin/setup`,
enter the token and create the first (superadmin) account. Alternatively run `npm run create-admin`
on the server console.

## 3. Keep it running

**Linux (systemd)** – `/etc/systemd/system/crtl-kiosk.service`:

```ini
[Unit]
Description=CRTL Canteen Kiosk
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/crtl-kiosk/server
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
User=crtl
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now crtl-kiosk`

**Windows** – install as a service with [NSSM](https://nssm.cc): `nssm install CRTLKiosk "C:\Program Files\nodejs\node.exe" dist\index.js`,
set the start directory to `...\crtl-kiosk\server`, and set the service to restart on failure.
Alternatively use `pm2` with `pm2-windows-startup`.

## 4. HTTPS and webhooks

Razorpay must be able to reach `https://YOUR-DOMAIN/api/webhooks/razorpay`. Options:

1. Institution reverse proxy (nginx/IIS) with a certificate, forwarding to `http://SERVER:8080`. Forward
   only `/api/webhooks/` to the internet; keep `/admin` reachable from the LAN only.
2. A secure tunnel (e.g. Cloudflare Tunnel) exposing only the webhook path.

Even if webhooks cannot arrive, the server also verifies payments by calling the gateway API while the
customer waits, so payments are never missed – but webhooks are recommended.

## 5. Kiosk PC (touchscreen)

1. Set the display to the native resolution of the 21.5"/24" screen (1920×1080). Disable sleep/screensaver.
2. Create a shortcut / autostart entry:
   - Windows: `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --noerrdialogs --disable-pinch --overscroll-history-navigation=0 --disable-features=TranslateUI --kiosk-printing http://SERVER:8080/kiosk`
   - Linux: `chromium --kiosk --noerrdialogs --disable-pinch --overscroll-history-navigation=0 http://SERVER:8080/kiosk`
3. Use a separate, non-admin Windows/Linux user for the kiosk with auto-login. Do not save admin passwords
   in that browser profile.
4. Optional: to identify multiple kiosks in reports, open the browser console once on each kiosk and run
   `localStorage.setItem('crtl.kioskId','KIOSK-1')`.

## 6. Updating

```bash
git pull && npm install && npm run build && npm run migrate
sudo systemctl restart crtl-kiosk
```

Migrations only add; they never drop sales data.

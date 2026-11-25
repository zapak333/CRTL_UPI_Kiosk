# CRTL Canteen Kiosk

Self-ordering touchscreen kiosk with UPI payment, automatic 80 mm thermal ticket printing and a
password-protected admin dashboard for the CRTL institutional canteen.

| | |
|---|---|
| Customer screen | `/kiosk` – full-screen touch ordering, cart, UPI QR, token screen |
| Admin | `/admin/login`, `/admin/dashboard`, `/admin/orders`, `/admin/payments`, `/admin/menu`, `/admin/categories`, `/admin/reports`, `/admin/settings`, `/admin/users`, `/admin/audit` |
| Stack | React 18 + TypeScript + Tailwind (Vite) · Node.js 20+/Express 5 · PostgreSQL 14+ |
| Payments | Provider abstraction: `simulated` (built-in, for testing) and `razorpay` (UPI QR Codes API) |
| Printing | ESC/POS: network printer (TCP 9100), USB/shared printer (device path), or test mode (files) |

## Current status (phase 1)

| Area | Status |
|---|---|
| Complete ordering workflow with sample menu + simulated UPI payments | ✅ Built and tested |
| Server-side verification, signed webhooks, duplicate protection, audit trail | ✅ Built and tested (simulated provider) |
| Admin: menu, categories, orders, refunds, reports (Excel/PDF/CSV), EOD report, settings, users, backups | ✅ Built and tested |
| Receipt generation (ESC/POS bytes + text) and printer-failure handling | ✅ Built and tested with the file/test printer |
| **Razorpay UPI integration** | ⚠️ **Written, NOT yet tested** – needs a Razorpay account (Test Mode first). See [docs/PAYMENTS.md](docs/PAYMENTS.md) |
| **Physical thermal printer** | ⚠️ **Written, NOT yet tested** – needs the actual printer. See [docs/PRINTER.md](docs/PRINTER.md) |

Per the project brief, payment integration and automatic printing must not be considered complete until
they are tested with the real gateway account and the real printer.

## Quick start (development)

```bash
# 1. PostgreSQL: create a database and user
sudo -u postgres psql -c "CREATE USER crtl WITH PASSWORD 'crtl_dev' CREATEDB;"
sudo -u postgres createdb -O crtl crtl_kiosk

# 2. Install and configure
npm install
cp server/.env.example server/.env        # edit SESSION_SECRET etc.

# 3. Create tables and load the SAMPLE menu
npm run migrate
npm run seed

# 4. Run (API on :8080, Vite dev server on :5173)
npm run dev
```

Open `http://localhost:5173/kiosk` for the kiosk and `http://localhost:5173/admin/setup` to create the first
administrator. The one-time setup token is printed in the server console (or set `ADMIN_SETUP_TOKEN`).
No default admin password exists anywhere in the code.

In simulated mode the payment screen shows a yellow **Test mode simulator** panel (Pay / Decline / Lost
webhook). The QR code also opens a simulated UPI page if scanned with a phone on the same network.

## Documentation

- [docs/SETUP.md](docs/SETUP.md) – installation and deployment on the canteen server and kiosk PC
- [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) – day-to-day operating instructions for canteen staff
- [docs/PAYMENTS.md](docs/PAYMENTS.md) – payment security design and Razorpay go-live checklist
- [docs/PRINTER.md](docs/PRINTER.md) – thermal printer connection and testing
- [docs/DATABASE.md](docs/DATABASE.md) – schema overview, backups and restore
- [docs/TESTING.md](docs/TESTING.md) – the 20 required test cases and their results

## Tests

```bash
npm test     # 30 backend integration tests against a real PostgreSQL test database (crtl_kiosk_test)
```

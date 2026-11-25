# Test results

Automated: `npm test` runs 30 integration tests (`server/test/kiosk.test.ts`) against a real PostgreSQL
database through the HTTP API. Browser end-to-end: a Playwright run on a 1920×1080 screen exercised the
kiosk (order → QR → pay → token; decline → retry → cancel) and the admin (setup, login, orders, reprint,
add item, reports with Excel/PDF download, printer test page, payments). All passed on 25-11-2026 with the
**simulated** payment provider and the **file (test) printer**.

| # | Required test | Result | How |
|---|---|---|---|
| 1 | Adding and deleting menu items | ✅ | API test + browser (add item) |
| 2 | Editing food prices | ✅ | API test (price change audited, invalid price rejected) |
| 3 | Adding food to the cart | ✅ | Browser |
| 4 | Changing quantities | ✅ | Browser + API (duplicate lines merged, max qty enforced) |
| 5 | Calculating order totals | ✅ | Server-side from DB prices; ₹170 sample receipt reproduced; optional tax |
| 6 | Generating unique orders | ✅ | Idempotency key test (double submit → one order) |
| 7 | Generating dynamic UPI QR codes | ✅ simulated / ⚠️ Razorpay untested | QR for exact amount; reused on retry |
| 8 | Successful payment verification | ✅ simulated / ⚠️ Razorpay untested | Signed webhook + API polling fallback; invalid signature rejected |
| 9 | Failed payment handling | ✅ | Retry creates new QR for the same order |
| 10 | Duplicate webhook handling | ✅ | Same event ×2, re-sent event, 4 concurrent events → one confirmation, one ticket |
| 11 | Automatic thermal receipt printing | ✅ file printer / ⚠️ hardware untested | Receipt text + ESC/POS bytes generated automatically |
| 12 | Printer disconnection | ✅ simulated fault / ⚠️ hardware untested | Order stays paid, error shown, admin print later, then duplicate copy |
| 13 | Daily token numbering | ✅ | Sequential per IST day, independent of other days |
| 14 | Daily sales calculations | ✅ | Failed/pending excluded; refunds subtracted; net = 190.00 in test |
| 15 | Item-wise sales calculations | ✅ | Matches line totals |
| 16 | Excel and PDF report generation | ✅ | Valid .xlsx and .pdf produced; CSV checked |
| 17 | Admin authentication | ✅ | Setup token, one-time setup, bcrypt, lockout, logout |
| 18 | Unauthorized access prevention | ✅ | 401 without login, 403 by role, CSRF header required |
| 19 | Historical transaction preservation | ✅ | Name/price snapshot survives price change + delete; DB blocks deletes/edits |
| 20 | End-of-day report generation | ✅ | Stored report matches live report; scheduler at configured IST time |

**Still required before go-live:** the Razorpay checklist in PAYMENTS.md and the printer checklist in
PRINTER.md, run on the real account and hardware.

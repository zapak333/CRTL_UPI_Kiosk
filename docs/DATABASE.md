# Database

PostgreSQL schema: `server/src/db/migrations/001_initial.sql` (applied by `npm run migrate`).

| Table | Purpose |
|---|---|
| `admin_users` | Staff accounts (bcrypt hashes, role, lockout) |
| `food_categories`, `food_items` | Menu. Deletion is a soft delete (`deleted_at`) so history stays intact |
| `orders` | One per checkout: order number, daily token, totals, status, print status |
| `order_items` | Snapshot of name, category, unit price, quantity at the time of purchase (immutable) |
| `payments` | One row per UPI payment attempt, with gateway references and verification details |
| `payment_events` | Every webhook received (signature validity, processing result) |
| `refunds` | Refunds as separate transactions |
| `print_jobs` | Original / reprint / test print jobs and errors |
| `token_counters` | Daily token counter (row-locked when issuing) |
| `daily_reports` | Stored end-of-day reports |
| `printer_settings`, `system_settings` | Configuration |
| `audit_logs` | Who did what and when |
| `admin_sessions` | Admin login sessions |

Money is `NUMERIC(12,2)`; the application calculates in integer paise. Business dates are IST.
Triggers block `DELETE` on orders, order items, payments, payment events, refunds and audit logs, block any
edit of order items, and block changing a successful payment's amount or references.

## Backups

- Automatic: daily `pg_dump` (custom format) at `BACKUP_CRON` (default 23:30 IST) into `BACKUP_DIR`,
  keeping `BACKUP_KEEP_DAYS` days. Admin → Settings → Database backups shows them and has **Back up now**.
- Manual: `npm run backup -w server`.
- Put `BACKUP_DIR` on a different disk or a network share, and copy it off-site weekly.

Restore (stop the app first):

```bash
createdb -O crtl crtl_kiosk_restored
pg_restore --no-owner -d crtl_kiosk_restored data/backups/crtl_kiosk_YYYYMMDD_HHMM.dump
# point DATABASE_URL at the restored DB (or rename databases), then start the app
```

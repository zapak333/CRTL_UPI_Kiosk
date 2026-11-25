# Administrator operating guide

Open `http://SERVER:8080/admin/login` from the office PC (never from the customer kiosk).
Sessions sign out automatically after the configured idle time (default 15 minutes).

## Roles

| Role | Can |
|---|---|
| Superadmin | Everything, including users, settings and backups |
| Admin | Menu, categories, orders, refunds, reprints, reports, printer settings |
| Staff | View orders and reprint receipts |

## Daily routine

**Opening**
1. Turn on the server, printer and kiosk. The kiosk opens the menu by itself.
2. Admin → Settings → Printer → **Print test page** (checks paper).
3. Admin → Food Menu: mark anything not available today as **Temporarily unavailable**.

**During the day**
- The **Dashboard** shows today's sales, orders, pending/failed payments and the best seller, and warns
  about orders that need attention (red) or receipts that did not print (orange). Click a warning to open the order.
- Customer says they paid but got no ticket → Orders → search their token or UPI transaction ID.
  If it shows **Paid**, open it and press **Print receipt**. If it shows **Awaiting payment / Failed**, the
  payment was not received by the gateway: never accept a phone screenshot as proof.
- Item runs out → Food Menu → set **Temporarily unavailable** (kiosk updates within a minute).

**Closing**
- The End-of-Day report is generated automatically at the report time (default 23:59 IST) and kept in
  Reports → Stored end-of-day reports. Open Reports → **Today** to review and **Print Report** or export.

## Menu

- **Add item**: name, optional description, category, price, image (JPEG/PNG/WebP up to 3 MB).
- **Change a price**: Edit → Price. Only new orders use the new price; reports keep old orders at their old price.
- **Delete**: removes the item from the menu; its past sales remain in every report.
- **Display order**: ▲ ▼ arrows. Categories have their own order on the Categories page.
- Categories can be deactivated (hidden) any time; they can be deleted only when they contain no items.

## Orders, refunds and corrections

- Filters: Today, Yesterday, Successful / Failed / Pending payments, Cancelled, Print failed, Needs attention, Custom date range.
- Completed payments cannot be edited. To correct a sale, open the order → **Record refund…**, enter the
  amount and reason. Refunds go to the customer's account through the gateway and are listed separately in reports.
- "Needs attention" orders (late payment after cancel, wrong amount) must be refunded, then **Mark resolved** with a note.

## Reports

Reports → choose Today / Yesterday / This week / Last week / This month / Last month or a custom range.
Shows the financial summary (net collection = captured UPI payments − completed refunds; pending and failed
payments are never counted), item-wise, category-wise, day/week/month-wise, payment failures and refunds.
Export: **Excel** (all sheets), **PDF**, **CSV** (choose which table) or **Print Report**.

## Settings (superadmin)

Canteen/institution name, logo, address, contact, welcome message, opening/closing hours (optional
blocking), token prefix/digits (tokens restart at 1 daily), report time, optional tax (exclusive or inclusive),
kiosk idle timeout, max quantity per item, admin session timeout, receipt footer. Payment gateway keys are
in the server `.env` file (see PAYMENTS.md) and are shown here only as configured/missing.

## Users

Users page: add staff accounts with the least role they need, disable leavers, unlock locked accounts
(accounts lock for 15 minutes after 5 wrong passwords). Every action is in the **Audit Log**.

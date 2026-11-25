# Payments: design and go-live checklist

## How a payment is confirmed

1. The kiosk sends only **item IDs and quantities**. The server reads prices from the database, computes the
   total and creates the order in a single database transaction (an idempotency key stops double-taps
   creating two orders).
2. The server asks the provider for a **single-use, fixed-amount UPI QR** for that exact amount, tagged
   with our unique transaction reference (`attempt_ref`). Retrying reuses a still-valid QR; a new QR is only
   created after the old one failed or expired, and always for the **same order**.
3. The order becomes **PAID only** when the server receives a provider event that is:
   - HMAC-SHA256 **signature-verified** over the raw request body (webhook), or fetched by the server
     directly from the provider API (status check while the customer waits);
   - for the **exact amount** and currency (INR) of the order; otherwise it is flagged for refund and never
     marked paid;
   - not already processed (unique provider event ID + unique gateway payment ID + row locks).
4. Only then is the daily token issued and exactly one original ticket queued for printing (a unique
   database index makes a second "original" print impossible).
5. Nothing the customer's phone or the kiosk screen says can mark an order paid; there is no such endpoint.

Every webhook (valid or not) is stored in `payment_events`, every state change in `audit_logs`.
Payments, refunds, orders and audit logs cannot be deleted (database triggers), and a successful
payment's amount/references cannot be edited. Refunds are separate records.

No UPI PIN, OTP or bank credential ever reaches this system: the customer pays inside their own UPI app.
Gateway secret keys exist only in `server/.env` and are never sent to the browser or stored in the database.

If the server cannot reach the gateway (internet down), the kiosk shows "Payment service is unavailable"
and no QR is shown; no unverified payment is accepted.

## Edge cases handled

| Situation | What happens |
|---|---|
| Payment fails | Customer sees "Payment failed"; **Try Again** creates a new QR for the same order |
| QR expires (default 5 min) | Kiosk hides the old QR; **New QR code** re-checks the provider first, then issues a new one |
| Webhook lost / delayed | Server polls the provider API (throttled) while the kiosk is waiting, and every minute in the background |
| Same webhook delivered 2-3 times | Processed once; later copies acknowledged as duplicates |
| Customer cancels but pays a moment later | Server checks the provider before cancelling; if already paid, shows the token instead |
| Payment arrives after cancel/expiry | Recorded as captured, order flagged **Needs attention – refund required** on the dashboard |
| Wrong amount received | Never marked paid; flagged for refund |

## Razorpay go-live checklist (NOT YET DONE)

The Razorpay integration (`server/src/services/payments/razorpay.ts`) uses the QR Codes API
(`type=upi_qr, usage=single_use, fixed_amount=true`), the QR payments list for status checks, the refund
API and webhooks `qr_code.credited`, `payment.captured`, `payment.failed`. It has **not** been run against a
real Razorpay account yet. Before accepting real money:

1. Razorpay account activated, with **QR Codes** enabled for the account (ask Razorpay support if the
   QR Codes API returns "feature not enabled").
2. In **Test Mode**, create API keys → put `rzp_test_…` key ID and secret in `server/.env`, set
   `PAYMENT_PROVIDER=razorpay`, restart. The kiosk banner should say test mode.
3. Dashboard → Webhooks → add `https://YOUR-DOMAIN/api/webhooks/razorpay`, choose a strong secret →
   `RAZORPAY_WEBHOOK_SECRET`, enable events `qr_code.credited`, `payment.captured`, `payment.failed`.
4. Run these with Razorpay's test-mode payment simulation and confirm each result in Admin → Payments:
   - [ ] QR shows on kiosk with the right amount
   - [ ] Successful payment → token + ticket within ~3 s
   - [ ] Failed payment → kiosk shows failure, retry works
   - [ ] Webhook log shows `valid` signatures; a tampered request is rejected
   - [ ] Redelivering a webhook from the Razorpay dashboard does not create a second ticket
   - [ ] Temporarily blocking webhooks: payment is still detected via API status check
   - [ ] Refund from Admin → order → Record refund appears in Razorpay dashboard
   - [ ] Cancel on kiosk closes the QR in Razorpay
5. Switch to **Live** keys, do 3–5 real ₹1–₹10 payments, refund them, reconcile with the Razorpay settlement
   report, then start operations.

To use a different RBI-authorised gateway, implement the `PaymentProvider` interface
(`server/src/services/payments/types.ts`) and register it in `payments/index.ts`.

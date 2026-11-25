# Thermal printer (80 mm, ESC/POS)

Configure in **Admin → Settings → Thermal receipt printer**, then press **Print test page**.

| Connection | Use when | Setting |
|---|---|---|
| Test mode (files) | Development / no printer yet | Receipts are written to `server/data/receipts/*.txt` and `*.bin` (raw ESC/POS) |
| Network / LAN | Printer has an Ethernet/Wi-Fi port (most Epson TM, TVS RP, Everycom, Posiflex models) | Printer IP + port 9100. Give the printer a fixed IP. Paper-out is detected before printing |
| USB / shared | Printer on USB of the server | Linux: `/dev/usb/lp0` (add the service user to the `lp` group). Windows: install the printer driver, share it (e.g. `POS80`), use `\\localhost\POS80` |

Receipts follow the brief's layout (canteen name, institution, token, date/time, items, total, payment mode,
status, transaction ID, footer). Thermal printers cannot print `₹` in standard code pages, so receipts use `Rs.`.
Width: 48 characters per line for 80 mm Font A (default); change if your printer differs.

**Rules built in**

- A ticket is generated only for an order whose payment was verified by the server.
- Exactly one automatic ("original") ticket per order, even if the gateway sends duplicate events.
- If the printer is offline/out of paper, the order stays PAID, the customer sees a clear message with their
  token, and the dashboard lists "Receipt not printed". Admin → Orders → open → **Print receipt** prints it
  later (as the original). Further prints are marked **DUPLICATE COPY** and audited.
- Failed tickets are not retried automatically, to avoid surprise tickets after staff have already served the customer.

**Hardware test checklist (NOT YET DONE – needs the real printer)**

- [ ] Test page prints, text fits 80 mm, paper cuts
- [ ] Paid order prints automatically within ~3 s
- [ ] Unplug printer / open cover → kiosk shows printer message, dashboard shows it, reprint works after reconnecting
- [ ] Out of paper (network printers) → detected and reported
- [ ] 50 consecutive orders without a missed or doubled ticket

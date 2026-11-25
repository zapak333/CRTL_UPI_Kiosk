CRTL Canteen Kiosk - Windows installer
======================================

This installs everything the kiosk needs on this PC. Nothing else has to be installed first.

  - The kiosk web server (runs in the background as the Windows service "CRTL Kiosk Server")
  - Its own PostgreSQL database (service "CRTLKioskDB", port 5433, reachable only from this PC)
  - Start-menu shortcuts: kiosk screen (full screen), admin panel, settings, restart, backups

Before you continue
  - Windows 10 or 11, 64-bit. Google Chrome or Microsoft Edge (Edge is built into Windows).
  - Have your Razorpay Key ID and Key secret ready if you want real payments now.
    You can also start with simulated payments and add the keys later.

After installing
  1. The browser opens "First-time setup". Create the first administrator account there.
  2. In the admin panel: add your menu, then Settings > Printer for the receipt printer.
  3. Start the kiosk screen from the Start menu (CRTL Kiosk > Open kiosk screen).
     Press Alt+F4 to leave the full-screen kiosk.

Your data (orders, menu, backups, logs, settings) lives in C:\ProgramData\CRTLKiosk
and is kept when you upgrade or uninstall.

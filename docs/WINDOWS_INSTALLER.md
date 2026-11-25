# Windows installer

`CRTL-Kiosk-Setup-<version>.exe` installs the whole system on a Windows 10/11 (64-bit) PC with no other
software needed first: the kiosk server, its own PostgreSQL database, and Start-menu shortcuts.

## Download

From the repository's **Releases** page: the `installer-preview` pre-release (latest build of a branch) or a
`v*` release. Every build is also attached to its GitHub Actions run as an artifact.

## Install (on each PC)

1. Run the `.exe` as an administrator. Windows SmartScreen may say "Windows protected your PC" because the
   installer is not code-signed: click **More info > Run anyway**.
2. Choose the options:
   - **Open the kiosk screen automatically when Windows starts**: tick this on the touchscreen PC.
   - **Allow other PCs/phones on the local network**: tick this if the admin panel will be opened from
     another PC, or if other touchscreens will use this PC as their server.
   - **Keep this PC awake**: recommended on the kiosk PC.
3. Port: keep `8080` unless something else uses it.
4. Payments: start with **Simulated**, or choose **Razorpay** and paste the Key ID and Key secret
   (TEST keys first). The keys are never part of the installer; they are written only to the settings file
   on that PC, which only administrators can read.
5. When it finishes, the browser opens **First-time setup** with the one-time token already filled in.
   Create the first administrator account.
6. In the admin panel add the menu and set up the receipt printer (Settings > Printer, see [PRINTER.md](PRINTER.md)).
7. Start menu > **CRTL Kiosk > Open kiosk screen** opens the kiosk full screen (Chrome if installed,
   otherwise Edge). **Alt+F4** leaves it.

## What gets installed where

| What | Where |
|---|---|
| Program files (Node.js, PostgreSQL 17, app) | `C:\Program Files\CRTL Kiosk` |
| Settings file (`.env`: port, Razorpay keys, backups) | `C:\ProgramData\CRTLKiosk\.env` |
| Database | `C:\ProgramData\CRTLKiosk\pgdata` (service **CRTLKioskDB**, port 5433, localhost only) |
| Uploaded images, receipts | `C:\ProgramData\CRTLKiosk\data` |
| Daily backups (23:30) | `C:\ProgramData\CRTLKiosk\backups` |
| Logs (server + installer) | `C:\ProgramData\CRTLKiosk\logs` |

The server runs as the Windows service **CRTL Kiosk Server** (`CRTLKioskServer`), starts with Windows and
restarts itself if it crashes. The database superuser password is in `C:\ProgramData\CRTLKiosk\postgres-superuser.txt`
(administrators only), for maintenance.

## Changing settings later

Start menu > CRTL Kiosk > **Edit settings** opens the settings file (as administrator). For example, to
switch to real payments set `PAYMENT_PROVIDER=razorpay` and fill in `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Then run **Restart kiosk server**.
Webhooks need a public HTTPS URL: see [SETUP.md](SETUP.md#4-https-and-webhooks) and [PAYMENTS.md](PAYMENTS.md).

## Several touchscreens, one server

Install on the server PC with the firewall option ticked. On each extra touchscreen you can either install
the full package too (each then has its own separate database), or, to share one menu and one set of orders,
install it and point the kiosk screen at the server: edit `C:\Program Files\CRTL Kiosk\config\kiosk-url.txt`
to `http://SERVER-PC-NAME:8080/kiosk`. Then stop and disable the two CRTL services on that touchscreen
(`services.msc`).

## Upgrading

Run the newer installer. It stops the services, replaces the program files, keeps the settings and the
database, runs any new database migrations and starts everything again.

## Uninstalling

Settings > Apps > CRTL Canteen Kiosk > Uninstall. The services are removed; **your data in
`C:\ProgramData\CRTLKiosk` is kept**. Delete that folder by hand only if you are sure you no longer need
the sales records and backups.

## Building the installer

GitHub Actions builds it on every push (`.github/workflows/windows-installer.yml`), installs it on a clean
Windows VM, checks the server answers, re-installs over it (upgrade) and uninstalls it. To build on a
Windows PC instead: install Node.js 22 and [Inno Setup 6](https://jrsoftware.org/isinfo.php), then run
`powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1`. Output: `build\installer\`.

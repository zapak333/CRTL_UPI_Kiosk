import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { receiptsDir } from '../../config.js';

export interface PrinterSettings {
  driver: 'mock' | 'network' | 'device';
  network_host: string | null;
  network_port: number;
  device_path: string | null;
  chars_per_line: number;
  auto_print: boolean;
  cut_paper: boolean;
  open_drawer: boolean;
  check_status: boolean;
  mock_fail: boolean;
  timeout_ms: number;
}

export class PrinterError extends Error {}

/**
 * Send raw ESC/POS bytes to the configured printer.
 *  - mock:    writes .txt (human readable) and .bin (raw ESC/POS) files to data/receipts. Can simulate a fault.
 *  - network: TCP raw socket (port 9100) to a LAN/Wi-Fi ESC/POS printer. Checks paper status first.
 *  - device:  writes to an OS printer device/share, e.g. /dev/usb/lp0 (Linux USB) or \\localhost\POS80 (Windows shared printer).
 */
export async function sendToPrinter(ps: PrinterSettings, bytes: Buffer, text: string, name: string) {
  if (ps.driver === 'mock') {
    if (ps.mock_fail) throw new PrinterError('Printer not connected (simulated fault)');
    await fs.mkdir(receiptsDir, { recursive: true });
    await fs.writeFile(path.join(receiptsDir, `${name}.txt`), text, 'utf8');
    await fs.writeFile(path.join(receiptsDir, `${name}.bin`), bytes);
    return;
  }
  if (ps.driver === 'network') {
    if (!ps.network_host) throw new PrinterError('Printer IP address is not configured');
    if (ps.check_status) await checkNetworkStatus(ps);
    await sendTcp(ps.network_host, ps.network_port, bytes, ps.timeout_ms);
    return;
  }
  if (ps.driver === 'device') {
    if (!ps.device_path) throw new PrinterError('Printer device path is not configured');
    try {
      await withTimeout(fs.writeFile(ps.device_path, bytes), ps.timeout_ms, 'Printer did not respond');
    } catch (e) {
      throw new PrinterError(`Cannot write to printer ${ps.device_path}: ${(e as Error).message}`);
    }
    return;
  }
  throw new PrinterError('Unknown printer driver');
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string) {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new PrinterError(msg)), ms))]);
}

function sendTcp(host: string, port: number, data: Buffer, timeout: number) {
  return new Promise<void>((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    sock.setTimeout(timeout);
    sock.on('connect', () => sock.end(data, () => resolve()));
    sock.on('timeout', () => {
      sock.destroy();
      reject(new PrinterError(`Printer at ${host}:${port} did not respond`));
    });
    sock.on('error', (e) => reject(new PrinterError(`Printer at ${host}:${port} unreachable: ${e.message}`)));
  });
}

/** DLE EOT 4 = paper roll sensor status. Bits 5/6 set -> paper end. No reply -> assume OK (some printers don't answer). */
function checkNetworkStatus(ps: PrinterSettings) {
  return new Promise<void>((resolve, reject) => {
    const sock = net.createConnection({ host: ps.network_host!, port: ps.network_port });
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      sock.destroy();
      if (err) {
        reject(err);
      } else resolve();
    };
    sock.setTimeout(Math.min(ps.timeout_ms, 3000));
    sock.on('connect', () => sock.write(Buffer.from([0x10, 0x04, 0x04])));
    sock.on('data', (d: Buffer) => {
      const b = d[0] as number;
      if ((b & 0x60) === 0x60) finish(new PrinterError('Printer is out of paper'));
      else finish();
    });
    sock.on('timeout', () => finish());
    sock.on('error', (e) => finish(new PrinterError(`Printer at ${ps.network_host}:${ps.network_port} unreachable: ${e.message}`)));
  });
}

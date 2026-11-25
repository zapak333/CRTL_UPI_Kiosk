// Minimal ESC/POS encoder for 80mm thermal printers (Epson TM-T82/T88, TVS RP3200, Everycom, Posiflex, etc.)
const ESC = 0x1b;
const GS = 0x1d;

export type Align = 'left' | 'center' | 'right';

export class EscPos {
  private chunks: Buffer[] = [];
  constructor() {
    this.raw([ESC, 0x40]); // initialise
    this.raw([ESC, 0x74, 0x00]); // code page 437 (we only send ASCII)
  }
  raw(bytes: number[]) {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }
  align(a: Align) {
    return this.raw([ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2]);
  }
  bold(on: boolean) {
    return this.raw([ESC, 0x45, on ? 1 : 0]);
  }
  size(w: 1 | 2, h: 1 | 2) {
    return this.raw([GS, 0x21, ((w - 1) << 4) | (h - 1)]);
  }
  text(s: string) {
    this.chunks.push(Buffer.from(toAscii(s), 'ascii'));
    return this;
  }
  line(s = '') {
    return this.text(s + '\n');
  }
  feed(n = 1) {
    return this.raw([ESC, 0x64, n]);
  }
  cut() {
    return this.raw([GS, 0x56, 0x42, 0x03]); // feed 3 and partial cut
  }
  drawer() {
    return this.raw([ESC, 0x70, 0x00, 0x19, 0xfa]);
  }
  build() {
    return Buffer.concat(this.chunks);
  }
}

/** Thermal printers can't render ₹ in standard code pages; use "Rs." and strip other non-ASCII. */
export function toAscii(s: string) {
  return s.replace(/₹\s?/g, 'Rs.').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x0a\x20-\x7e]/g, '?');
}

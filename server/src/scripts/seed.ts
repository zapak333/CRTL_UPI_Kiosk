import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../db/migrate.js';
import { pool } from '../db/pool.js';

/**
 * Loads SAMPLE menu data (categories + items with illustrative images) for development and testing.
 * Safe to run only on an empty menu; it refuses if food items already exist (use --force to add anyway).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const sampleDir = path.join(here, '../../assets/sample');

type Item = [name: string, price: number, emoji: string, desc?: string, status?: string];
export const SAMPLE: { name: string; emoji: string; colors: [string, string]; items: Item[] }[] = [
  { name: 'Breakfast', emoji: '🍳', colors: ['#fde68a', '#f59e0b'], items: [
    ['Idli (2 pcs)', 30, '🍚', 'Steamed rice cakes with sambar & chutney'],
    ['Masala Dosa', 50, '🌯', 'Crispy dosa with potato masala'],
    ['Poha', 25, '🍛', 'Flattened rice with peanuts & curry leaves'],
    ['Upma', 25, '🥣', 'Semolina cooked with vegetables'],
    ['Aloo Paratha', 40, '🫓', 'With curd & pickle'],
    ['Bread Omelette', 35, '🍳', 'Two-egg omelette with toasted bread'],
  ] },
  { name: 'Lunch', emoji: '🍛', colors: ['#fecaca', '#ef4444'], items: [
    ['Veg Thali', 80, '🍱', 'Rice, 2 rotis, dal, sabzi, salad'],
    ['Rajma Chawal', 60, '🍛', 'Kidney bean curry with steamed rice'],
    ['Chole Bhature', 60, '🫓', 'Chickpea curry with 2 bhature'],
    ['Veg Biryani', 70, '🍚', 'With raita'],
    ['Curd Rice', 40, '🍚', 'Tempered curd rice'],
  ] },
  { name: 'Snacks', emoji: '🥪', colors: ['#bbf7d0', '#22c55e'], items: [
    ['Samosa', 20, '🥟', 'Crispy potato samosa with chutney'],
    ['Veg Sandwich', 80, '🥪', 'Grilled vegetable sandwich'],
    ['Vada Pav', 20, '🍔', 'Mumbai style'],
    ['Pav Bhaji', 50, '🍲', 'With 2 buttered pav'],
    ['Veg Puff', 25, '🥐', 'Flaky pastry with spiced vegetables'],
  ] },
  { name: 'Beverages', emoji: '🥤', colors: ['#bfdbfe', '#3b82f6'], items: [
    ['Sweet Lassi', 30, '🥛', 'Chilled yoghurt drink'],
    ['Fresh Lime Soda', 30, '🍋', 'Sweet or salted'],
    ['Mango Shake', 50, '🥭', 'Seasonal', 'temporarily_unavailable'],
    ['Buttermilk', 15, '🥛', 'Spiced chaas'],
    ['Mineral Water (1L)', 20, '💧', ''],
  ] },
  { name: 'Tea & Coffee', emoji: '☕', colors: ['#e7d3c1', '#92400e'], items: [
    ['Tea', 10, '🍵', 'Regular milk tea'],
    ['Masala Chai', 15, '🫖', 'With ginger & cardamom'],
    ['Coffee', 30, '☕', 'Filter coffee'],
    ['Cold Coffee', 40, '🧋', 'With ice cream'],
    ['Green Tea', 20, '🍵', ''],
  ] },
  { name: 'Bakery', emoji: '🧁', colors: ['#fbcfe8', '#db2777'], items: [
    ['Chocolate Muffin', 30, '🧁', ''],
    ['Butter Cookies (4)', 20, '🍪', ''],
    ['Brownie', 40, '🍫', ''],
    ['Cake Slice', 35, '🍰', 'Flavour of the day'],
  ] },
  { name: 'Other Items', emoji: '🛍️', colors: ['#e5e7eb', '#6b7280'], items: [
    ['Potato Chips', 20, '🥔', 'Packet'],
    ['Chocolate Bar', 20, '🍫', ''],
  ] },
];

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function svg(emoji: string, [a, b]: [string, string]) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
<radialGradient id="h" cx=".5" cy=".55" r=".45"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="400" height="300" fill="url(#g)"/><circle cx="200" cy="160" r="120" fill="url(#h)"/>
<text x="200" y="195" font-size="130" text-anchor="middle" font-family="'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif">${emoji}</text></svg>`;
}

/** Write the illustrative SVGs (idempotent). Exported so tests can reuse. */
export function writeSampleImages() {
  fs.mkdirSync(sampleDir, { recursive: true });
  for (const c of SAMPLE) {
    fs.writeFileSync(path.join(sampleDir, `cat-${slug(c.name)}.svg`), svg(c.emoji, c.colors));
    for (const it of c.items) fs.writeFileSync(path.join(sampleDir, `${slug(it[0])}.svg`), svg(it[2], c.colors));
  }
}

export async function seedMenu(db = pool) {
  let order = 10;
  for (const c of SAMPLE) {
    const { rows } = await db.query(
      `INSERT INTO food_categories (name, image_url, display_order) VALUES ($1,$2,$3) RETURNING id`,
      [c.name, `/sample/cat-${slug(c.name)}.svg`, order],
    );
    order += 10;
    let io = 10;
    for (const [name, price, , desc = '', status = 'available'] of c.items) {
      await db.query(
        `INSERT INTO food_items (name, description, category_id, image_url, price, availability_status, display_order) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [name, desc, rows[0].id, `/sample/${slug(name)}.svg`, price.toFixed(2), status, io],
      );
      io += 10;
    }
  }
}

if (process.argv[1] && process.argv[1].includes('seed')) {
  (async () => {
    await runMigrations(false);
    writeSampleImages();
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM food_items');
    if (rows[0].n > 0 && !process.argv.includes('--force')) {
      console.log('Menu already has items; not seeding. Use --force to add the sample menu anyway.');
    } else {
      await seedMenu();
      console.log('Sample menu loaded.');
    }
    await pool.end();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

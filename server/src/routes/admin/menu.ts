import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { uploadsDir } from '../../config.js';
import { pool, withTransaction } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { fromPaise, toPaise } from '../../lib/money.js';
import { ah, idParam, parse } from '../../lib/validate.js';
import { actorOf, requirePerm } from '../../middleware/auth.js';

export const menuRouter = Router();
const perm = requirePerm('menu.manage');

// ---------------- image upload ----------------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } });

function sniff(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return '.webp';
  return null;
}

menuRouter.post('/uploads', perm, upload.single('image'), ah(async (req, res) => {
  if (!req.file) throw badRequest('No image uploaded');
  const ext = sniff(req.file.buffer);
  if (!ext) throw badRequest('Only JPEG, PNG or WebP images are allowed');
  await fs.mkdir(uploadsDir, { recursive: true });
  const name = crypto.randomBytes(12).toString('hex') + ext;
  await fs.writeFile(path.join(uploadsDir, name), req.file.buffer);
  await audit(actorOf(req), 'upload.image', 'upload', name, { bytes: req.file.size });
  res.status(201).json({ url: `/uploads/${name}` });
}));

const imageUrl = z.string().max(500).regex(/^\/(uploads|sample)\/[A-Za-z0-9_-]+\.(jpg|png|webp|svg)$/, 'Upload the image first').nullable().optional();

// ---------------- categories ----------------
const catSchema = z.object({
  name: z.string().trim().min(1).max(80),
  image_url: imageUrl,
  is_active: z.boolean().default(true),
  display_order: z.number().int().min(0).max(10000).optional(),
});

menuRouter.get('/categories', ah(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, (SELECT count(*)::int FROM food_items i WHERE i.category_id=c.id AND i.deleted_at IS NULL) AS item_count
       FROM food_categories c WHERE c.deleted_at IS NULL ORDER BY c.display_order, c.name`,
  );
  res.json(rows);
}));

menuRouter.post('/categories', perm, ah(async (req, res) => {
  const b = parse(catSchema, req.body);
  const { rows: mx } = await pool.query('SELECT coalesce(max(display_order),0)+10 AS n FROM food_categories WHERE deleted_at IS NULL');
  try {
    const { rows } = await pool.query(
      `INSERT INTO food_categories (name, image_url, is_active, display_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      [b.name, b.image_url ?? null, b.is_active, b.display_order ?? mx[0].n],
    );
    await audit(actorOf(req), 'category.created', 'category', rows[0].id, b);
    res.status(201).json(rows[0]);
  } catch (e: any) {
    if (e.code === '23505') throw conflict('A category with this name already exists');
    throw e;
  }
}));

menuRouter.put('/categories/:id', perm, ah(async (req, res) => {
  const id = idParam(req);
  const b = parse(catSchema.partial(), req.body);
  const { rows: old } = await pool.query('SELECT * FROM food_categories WHERE id=$1 AND deleted_at IS NULL', [id]);
  if (!old[0]) throw notFound();
  const n = { ...old[0], ...b };
  try {
    const { rows } = await pool.query(
      `UPDATE food_categories SET name=$2, image_url=$3, is_active=$4, display_order=$5, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, n.name, n.image_url, n.is_active, n.display_order],
    );
    await audit(actorOf(req), 'category.updated', 'category', id, { before: pick(old[0], b), after: b });
    res.json(rows[0]);
  } catch (e: any) {
    if (e.code === '23505') throw conflict('A category with this name already exists');
    throw e;
  }
}));

/** Only categories with no (non-deleted) items can be deleted. Soft delete keeps history intact. */
menuRouter.delete('/categories/:id', perm, ah(async (req, res) => {
  const id = idParam(req);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM food_items WHERE category_id=$1 AND deleted_at IS NULL', [id]);
  if (rows[0].n > 0) throw conflict('This category still has food items. Move or delete them first.');
  const r = await pool.query('UPDATE food_categories SET deleted_at=now(), is_active=false, updated_at=now() WHERE id=$1 AND deleted_at IS NULL', [id]);
  if (!r.rowCount) throw notFound();
  await audit(actorOf(req), 'category.deleted', 'category', id);
  res.json({ ok: true });
}));

// ---------------- food items ----------------
const price = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const s = String(v).trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s) || toPaise(s) <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid price greater than 0 (max 2 decimals)' });
    return z.NEVER;
  }
  return fromPaise(toPaise(s));
});
const itemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  category_id: z.number().int().positive(),
  image_url: imageUrl,
  price,
  availability_status: z.enum(['available', 'temporarily_unavailable', 'disabled']).default('available'),
  display_order: z.number().int().min(0).max(100000).optional(),
});

menuRouter.get('/items', ah(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT i.*, i.price::text AS price, c.name AS category_name FROM food_items i JOIN food_categories c ON c.id=i.category_id
      WHERE i.deleted_at IS NULL ORDER BY c.display_order, i.display_order, i.name`,
  );
  res.json(rows);
}));

async function assertCategory(id: number) {
  const { rows } = await pool.query('SELECT id FROM food_categories WHERE id=$1 AND deleted_at IS NULL', [id]);
  if (!rows[0]) throw badRequest('Category not found');
}

menuRouter.post('/items', perm, ah(async (req, res) => {
  const b = parse(itemSchema, req.body);
  await assertCategory(b.category_id);
  const { rows: mx } = await pool.query('SELECT coalesce(max(display_order),0)+10 AS n FROM food_items WHERE category_id=$1', [b.category_id]);
  const { rows } = await pool.query(
    `INSERT INTO food_items (name, description, category_id, image_url, price, availability_status, display_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *, price::text AS price`,
    [b.name, b.description, b.category_id, b.image_url ?? null, b.price, b.availability_status, b.display_order ?? mx[0].n],
  );
  await audit(actorOf(req), 'item.created', 'food_item', rows[0].id, b);
  res.status(201).json(rows[0]);
}));

menuRouter.put('/items/:id', perm, ah(async (req, res) => {
  const id = idParam(req);
  const b = parse(itemSchema.partial(), req.body);
  if (b.category_id) await assertCategory(b.category_id);
  const { rows: old } = await pool.query('SELECT *, price::text AS price FROM food_items WHERE id=$1 AND deleted_at IS NULL', [id]);
  if (!old[0]) throw notFound();
  const n = { ...old[0], ...b };
  const { rows } = await pool.query(
    `UPDATE food_items SET name=$2, description=$3, category_id=$4, image_url=$5, price=$6, availability_status=$7, display_order=$8, updated_at=now()
      WHERE id=$1 RETURNING *, price::text AS price`,
    [id, n.name, n.description, n.category_id, n.image_url, n.price, n.availability_status, n.display_order],
  );
  // Price changes are audited; past orders keep their own snapshot price.
  await audit(actorOf(req), b.price && b.price !== old[0].price ? 'item.price_changed' : 'item.updated', 'food_item', id, { before: pick(old[0], b), after: b });
  res.json(rows[0]);
}));

/** Soft delete: the item disappears from the menu and admin lists, but sales history keeps referencing it. */
menuRouter.delete('/items/:id', perm, ah(async (req, res) => {
  const id = idParam(req);
  const r = await pool.query(`UPDATE food_items SET deleted_at=now(), availability_status='disabled', updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, [id]);
  if (!r.rowCount) throw notFound();
  await audit(actorOf(req), 'item.deleted', 'food_item', id);
  res.json({ ok: true });
}));

/** Reorder: body { ids: number[] } in desired display order. Works for items or categories. */
for (const kind of ['items', 'categories'] as const) {
  menuRouter.post(`/${kind}/reorder`, perm, ah(async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000) }), req.body);
    const table = kind === 'items' ? 'food_items' : 'food_categories';
    await withTransaction(async (c) => {
      for (let i = 0; i < ids.length; i++) await c.query(`UPDATE ${table} SET display_order=$2, updated_at=now() WHERE id=$1`, [ids[i], (i + 1) * 10]);
    });
    await audit(actorOf(req), `${kind}.reordered`, kind, null, { ids });
    res.json({ ok: true });
  }));
}

function pick(o: Record<string, unknown>, keys: Record<string, unknown>) {
  const r: Record<string, unknown> = {};
  for (const k of Object.keys(keys)) r[k] = o[k];
  return r;
}

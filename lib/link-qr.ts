import { z } from 'zod';
import { getDb } from './db';
import { shortUrl } from './utils';
import { DEFAULT_QR_STYLE, QR_DOTS, QR_FRAMES, QR_LABEL_MAX, type QrStyle } from './link-qr-render';

export { renderQrSvg, DEFAULT_QR_STYLE, QR_DOTS, QR_FRAMES, hasEnoughContrast, type QrStyle } from './link-qr-render';

/**
 * QR con marca por link: colores, forma de los módulos y logo al centro.
 * Con logo se usa corrección de errores H (30%): el logo tapa módulos.
 * El SVG se arma a mano sobre la matriz de `qrcode`; el PNG lo rasteriza el
 * navegador desde este SVG (el endpoint ?format=png queda para la API: QR
 * plano con los colores).
 */

/** Logo como data URL (PNG, JPEG o WebP), máx. ~200 KB. Nada de SVG: sería script en nuestro origen. */
export const MAX_LOGO_CHARS = 280_000;
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const qrStyleSchema = z.object({
  fg: hex.default('#000000'),
  bg: hex.default('#ffffff'),
  dots: z.enum(QR_DOTS).default('square'),
  logo: z.string().max(MAX_LOGO_CHARS).regex(LOGO_RE).nullable().default(null),
  frame: z.enum(QR_FRAMES).default('none'),
  label: z.string().trim().max(QR_LABEL_MAX).nullable().default(null),
});

/** Lo que codifica el QR: la URL corta con ?qr=1 para contar escaneos aparte. */
export function qrTarget(link: { slug: string; domain_hostname?: string | null }): string {
  return `${shortUrl(link.slug, link.domain_hostname ?? null)}?qr=1`;
}

export async function getQrStyle(userId: string, linkId: string): Promise<QrStyle> {
  const row = (await getDb()
    .prepare('SELECT fg, bg, dots, logo, frame, label FROM link_qr_styles WHERE link_id = ? AND user_id = ?')
    .get(linkId, userId)) as QrStyle | undefined;
  if (!row) return { ...DEFAULT_QR_STYLE };
  return {
    fg: row.fg,
    bg: row.bg,
    dots: (QR_DOTS as readonly string[]).includes(row.dots) ? row.dots : 'square',
    logo: row.logo ?? null,
    frame: (QR_FRAMES as readonly string[]).includes(row.frame ?? '') ? row.frame : 'none',
    label: row.label ?? null,
  };
}

/** Guarda el estilo de un link del usuario (el caller ya verificó que el link es suyo). */
export async function saveQrStyle(userId: string, linkId: string, style: QrStyle): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO link_qr_styles (link_id, user_id, fg, bg, dots, logo, frame, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(link_id) DO UPDATE SET fg = excluded.fg, bg = excluded.bg, dots = excluded.dots,
         logo = excluded.logo, frame = excluded.frame, label = excluded.label, updated_at = datetime('now')
       WHERE link_qr_styles.user_id = excluded.user_id`,
    )
    .run(linkId, userId, style.fg, style.bg, style.dots, style.logo, style.frame ?? 'none', style.label?.trim() || null);
}

// ---------- Plantillas del workspace ----------

export const MAX_QR_TEMPLATES = 50;

export interface QrTemplate {
  id: string;
  name: string;
  style: QrStyle;
  createdAt: string;
}

export const qrTemplateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  style: qrStyleSchema,
});

export async function listQrTemplates(userId: string): Promise<QrTemplate[]> {
  const rows = (await getDb()
    .prepare('SELECT id, name, style, created_at FROM link_qr_templates WHERE user_id = ? ORDER BY created_at ASC, id')
    .all(userId)) as Array<{ id: string; name: string; style: string; created_at: string }>;
  const out: QrTemplate[] = [];
  for (const r of rows) {
    const parsed = qrStyleSchema.safeParse((() => {
      try {
        return JSON.parse(r.style);
      } catch {
        return null;
      }
    })());
    if (parsed.success) out.push({ id: r.id, name: r.name, style: parsed.data, createdAt: r.created_at });
  }
  return out;
}

export async function createQrTemplate(
  userId: string,
  input: z.infer<typeof qrTemplateSchema>,
  createdBy: string | null,
): Promise<QrTemplate | 'limit'> {
  const count = (
    (await getDb().prepare('SELECT COUNT(*) AS c FROM link_qr_templates WHERE user_id = ?').get(userId)) as { c: number }
  ).c;
  if (count >= MAX_QR_TEMPLATES) return 'limit';
  const id = crypto.randomUUID();
  await getDb()
    .prepare('INSERT INTO link_qr_templates (id, user_id, name, style, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, input.name, JSON.stringify(input.style), createdBy);
  return { id, name: input.name, style: input.style, createdAt: new Date().toISOString() };
}

export async function renameQrTemplate(userId: string, id: string, name: string): Promise<boolean> {
  const res = await getDb().prepare('UPDATE link_qr_templates SET name = ? WHERE id = ? AND user_id = ?').run(name, id, userId);
  return res.changes > 0;
}

export async function deleteQrTemplate(userId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM link_qr_templates WHERE id = ? AND user_id = ?').run(id, userId);
  return res.changes > 0;
}

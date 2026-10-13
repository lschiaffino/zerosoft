import { z } from 'zod';
import { getDb } from './db';
import { shortUrl } from './utils';
import { DEFAULT_QR_STYLE, QR_DOTS, type QrStyle } from './link-qr-render';

export { renderQrSvg, DEFAULT_QR_STYLE, QR_DOTS, hasEnoughContrast, type QrStyle } from './link-qr-render';

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
});

/** Lo que codifica el QR: la URL corta con ?qr=1 para contar escaneos aparte. */
export function qrTarget(link: { slug: string; domain_hostname?: string | null }): string {
  return `${shortUrl(link.slug, link.domain_hostname ?? null)}?qr=1`;
}

export async function getQrStyle(userId: string, linkId: string): Promise<QrStyle> {
  const row = (await getDb()
    .prepare('SELECT fg, bg, dots, logo FROM link_qr_styles WHERE link_id = ? AND user_id = ?')
    .get(linkId, userId)) as QrStyle | undefined;
  if (!row) return { ...DEFAULT_QR_STYLE };
  return {
    fg: row.fg,
    bg: row.bg,
    dots: (QR_DOTS as readonly string[]).includes(row.dots) ? row.dots : 'square',
    logo: row.logo ?? null,
  };
}

/** Guarda el estilo de un link del usuario (el caller ya verificó que el link es suyo). */
export async function saveQrStyle(userId: string, linkId: string, style: QrStyle): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO link_qr_styles (link_id, user_id, fg, bg, dots, logo) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(link_id) DO UPDATE SET fg = excluded.fg, bg = excluded.bg, dots = excluded.dots,
         logo = excluded.logo, updated_at = datetime('now')
       WHERE link_qr_styles.user_id = excluded.user_id`,
    )
    .run(linkId, userId, style.fg, style.bg, style.dots, style.logo);
}

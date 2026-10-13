import { z } from 'zod';
import { getDb } from './db';
import { sendEmail } from './email';
import {
  FEEDBACK_KINDS,
  FEEDBACK_MAX,
  FEEDBACK_PRODUCTS,
  type FeedbackKind,
  type FeedbackProduct,
  type FeedbackStatus,
} from './feedback-constants';

/**
 * Feedback de usuarios (app) y visitantes (sitio). Se guarda en la tabla
 * feedback (migración 013); si FEEDBACK_EMAIL está seteado, además avisa por
 * email. El listado solo lo ven los emails de ADMIN_EMAILS.
 */

export * from './feedback-constants';

export const feedbackSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  product: z.enum(FEEDBACK_PRODUCTS).default('other'),
  message: z.string().trim().min(3).max(FEEDBACK_MAX),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(z.string().email().optional()),
  pageUrl: z.string().trim().max(500).optional(),
  // Honeypot: input oculto que una persona nunca completa.
  website: z.string().optional(),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;

export type ParsedFeedback =
  | { ok: true; data: FeedbackInput }
  | { ok: false; error: 'invalid_input' | 'spam' };

export function parseFeedback(raw: unknown): ParsedFeedback {
  const parsed = feedbackSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  if (parsed.data.website && parsed.data.website.trim() !== '') return { ok: false, error: 'spam' };
  return { ok: true, data: parsed.data };
}

export interface FeedbackRow {
  id: string;
  user_id: string | null;
  email: string | null;
  kind: FeedbackKind;
  product: FeedbackProduct;
  message: string;
  page_url: string | null;
  user_agent: string | null;
  status: FeedbackStatus;
  created_at: string;
}

// Solo http(s): el listado del owner lo muestra como link.
function safePageUrl(url: string | null | undefined): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return url.slice(0, 500);
}

export async function createFeedback(input: {
  kind: FeedbackKind;
  product: FeedbackProduct;
  message: string;
  email?: string | null;
  userId?: string | null;
  pageUrl?: string | null;
  userAgent?: string | null;
}): Promise<FeedbackRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO feedback (id, user_id, email, kind, product, message, page_url, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.userId ?? null,
      input.email ?? null,
      input.kind,
      input.product,
      input.message,
      safePageUrl(input.pageUrl),
      input.userAgent?.slice(0, 300) ?? null,
    );
  return (await db.prepare('SELECT * FROM feedback WHERE id = ?').get(id)) as FeedbackRow;
}

export async function listFeedback(filter: { status?: FeedbackStatus } = {}, limit = 200): Promise<FeedbackRow[]> {
  const db = getDb();
  if (filter.status) {
    return (await db
      .prepare('SELECT * FROM feedback WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(filter.status, limit)) as FeedbackRow[];
  }
  return (await db
    .prepare('SELECT * FROM feedback ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(limit)) as FeedbackRow[];
}

export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<boolean> {
  const res = await getDb().prepare('UPDATE feedback SET status = ? WHERE id = ?').run(status, id);
  return res.changes > 0;
}

/** Emails con acceso al listado (ADMIN_EMAILS, separados por coma). Vacío = nadie. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

/** Aviso por email si FEEDBACK_EMAIL está seteado. Nunca tira: el feedback ya quedó guardado. */
export async function notifyFeedback(row: FeedbackRow): Promise<void> {
  const to = process.env.FEEDBACK_EMAIL?.trim();
  if (!to) return;
  try {
    const preview = row.message.length > 60 ? `${row.message.slice(0, 60)}…` : row.message;
    await sendEmail({
      to,
      subject: `[feedback] ${row.kind} · ${row.product} — ${preview.replace(/\s+/g, ' ')}`,
      text: [
        `Tipo: ${row.kind}`,
        `Producto: ${row.product}`,
        `De: ${row.email ?? 'anónimo'}`,
        row.page_url ? `Página: ${row.page_url}` : null,
        '',
        row.message,
      ]
        .filter((l) => l !== null)
        .join('\n'),
    });
  } catch {
    // ignorado a propósito
  }
}

import { z } from 'zod';
import { getDb } from './db';
import type { UtmField, UtmValues } from './link-url';

/**
 * Plantillas de UTM del workspace ("Newsletter", "Meta Ads"): un nombre y los
 * cinco utm_*. En el editor de un link se aplican de un click; cualquiera del
 * workspace las crea, las borra quien la creó o un admin.
 */

export const MAX_UTM_TEMPLATES = 100;

const utmValue = z.string().trim().max(100).optional();

export const utmTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    source: utmValue,
    medium: utmValue,
    campaign: utmValue,
    term: utmValue,
    content: utmValue,
  })
  .refine((v) => [v.source, v.medium, v.campaign, v.term, v.content].some((x) => x && x.trim()), {
    message: 'empty_template',
  });

export interface UtmTemplateDto {
  id: string;
  name: string;
  utm: UtmValues;
  createdBy: string | null;
}

interface TemplateRow {
  id: string;
  name: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  created_by: string | null;
}

function toDto(r: TemplateRow): UtmTemplateDto {
  return {
    id: r.id,
    name: r.name,
    utm: { source: r.utm_source, medium: r.utm_medium, campaign: r.utm_campaign, term: r.utm_term, content: r.utm_content },
    createdBy: r.created_by,
  };
}

export async function listUtmTemplates(userId: string): Promise<UtmTemplateDto[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM link_utm_templates WHERE user_id = ? ORDER BY name COLLATE NOCASE LIMIT ?')
    .all(userId, MAX_UTM_TEMPLATES)) as TemplateRow[];
  return rows.map(toDto);
}

export type CreateTemplateResult =
  | { ok: true; template: UtmTemplateDto }
  | { ok: false; code: 'name_taken' | 'too_many' };

export async function createUtmTemplate(
  userId: string,
  input: z.infer<typeof utmTemplateSchema>,
  createdBy: string | null,
): Promise<CreateTemplateResult> {
  const db = getDb();
  const count = ((await db.prepare('SELECT COUNT(*) AS c FROM link_utm_templates WHERE user_id = ?').get(userId)) as { c: number }).c;
  if (count >= MAX_UTM_TEMPLATES) return { ok: false, code: 'too_many' };
  const id = crypto.randomUUID();
  const v = (f: UtmField) => input[f]?.trim() || null;
  try {
    await db
      .prepare(
        `INSERT INTO link_utm_templates (id, user_id, name, utm_source, utm_medium, utm_campaign, utm_term, utm_content, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, input.name.trim(), v('source'), v('medium'), v('campaign'), v('term'), v('content'), createdBy);
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(String(e))) return { ok: false, code: 'name_taken' };
    throw e;
  }
  const row = (await db.prepare('SELECT * FROM link_utm_templates WHERE id = ?').get(id)) as TemplateRow;
  return { ok: true, template: toDto(row) };
}

export async function deleteUtmTemplate(
  userId: string,
  id: string,
  actorId: string,
  isAdmin: boolean,
): Promise<'ok' | 'not_found' | 'forbidden'> {
  const row = (await getDb()
    .prepare('SELECT created_by FROM link_utm_templates WHERE id = ? AND user_id = ?')
    .get(id, userId)) as { created_by: string | null } | undefined;
  if (!row) return 'not_found';
  if (row.created_by !== actorId && !isAdmin) return 'forbidden';
  await getDb().prepare('DELETE FROM link_utm_templates WHERE id = ? AND user_id = ?').run(id, userId);
  return 'ok';
}

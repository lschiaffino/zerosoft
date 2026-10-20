import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { createWebhook, listWebhooks, WEBHOOK_EVENTS } from '@/lib/webhooks';
import { MAX_FILTER_VALUES, normalizeLinkFilter } from '@/lib/webhooks-events';
import { getDb } from '@/lib/db';
import { UnsafeUrlError } from '@/lib/safe-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  url: z.string().trim().url().max(2000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  /** Solo para los eventos link.*: links (slug o id), tags y dominios ('' = el dominio por defecto). */
  linkFilter: z
    .object({
      links: z.array(z.string().trim().min(1).max(64)).max(MAX_FILTER_VALUES).optional(),
      tags: z.array(z.string().trim().max(40)).max(MAX_FILTER_VALUES).optional(),
      domains: z.array(z.string().trim().max(253)).max(MAX_FILTER_VALUES).optional(),
    })
    .nullish(),
});

/** Resuelve slugs o ids a ids de links del workspace; null si alguno no existe. */
async function resolveLinkIds(userId: string, refs: string[]): Promise<string[] | null> {
  const ids: string[] = [];
  for (const ref of refs) {
    const rows = (await getDb()
      .prepare('SELECT id FROM links WHERE user_id = ? AND (id = ? OR slug = ?)')
      .all(userId, ref, ref)) as Array<{ id: string }>;
    if (rows.length === 0) return null;
    // Un slug repetido en varios dominios suma todos esos links.
    for (const r of rows) if (!ids.includes(r.id)) ids.push(r.id);
  }
  return ids;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ rows: await listWebhooks(user.id) });
}

/** Crea un webhook; la respuesta incluye el secret una sola vez. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const raw = parsed.data.linkFilter;
  let linkIds: string[] = [];
  if (raw?.links?.length) {
    const resolved = await resolveLinkIds(user.id, raw.links);
    if (!resolved) return NextResponse.json({ error: 'unknown_link' }, { status: 400 });
    linkIds = resolved;
  }
  const linkFilter = normalizeLinkFilter({ linkIds, tags: raw?.tags ?? [], domains: raw?.domains ?? [] });
  try {
    const created = await createWebhook(user.id, {
      url: parsed.data.url,
      events: parsed.data.events,
      createdBy: realUserId(user),
      linkFilter,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof UnsafeUrlError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

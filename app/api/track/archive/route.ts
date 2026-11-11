import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { scopeWhere } from '@/lib/track-plans';
import { archiveIssues, restoreIssues } from '@/lib/track-housekeeping';
import { archiveRestoreSchema } from '@/lib/track-planning-schema';
import { getDb } from '@/lib/db';
import { invalidBody, unauthorized } from '@/lib/track-http';
import { trackVisibleSql } from '@/lib/track-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Restaura issues archivados del workspace: { issueIds }. Con { archive: true } los archiva. */
export async function POST(req: NextRequest) {
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const parsed = archiveRestoreSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  // Solo los equipos que la persona ve (privados e invitados).
  const s = scopeWhere(ctx.scope, 'p');
  const v = trackVisibleSql('p', ctx.actorId);
  const projects = (await getDb().prepare(`SELECT p.id FROM track_projects p WHERE ${s.where} AND ${v.sql}`).all(s.arg, ...v.args)) as Array<{ id: string }>;
  const ids = projects.map((p) => p.id);
  if (parsed.data.archive) return NextResponse.json({ archived: await archiveIssues(ids, parsed.data.issueIds) });
  const restored = await restoreIssues(ids, parsed.data.issueIds);
  return NextResponse.json({ restored });
}

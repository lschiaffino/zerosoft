import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { scopeWhere } from '@/lib/track-plans';
import { restoreIssues } from '@/lib/track-housekeeping';
import { archiveRestoreSchema } from '@/lib/track-planning-schema';
import { getDb } from '@/lib/db';
import { invalidBody, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Restaura issues archivados del workspace: { issueIds }. */
export async function POST(req: NextRequest) {
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const parsed = archiveRestoreSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  const s = scopeWhere(ctx.scope);
  const projects = (await getDb().prepare(`SELECT id FROM track_projects WHERE ${s.where}`).all(s.arg)) as Array<{ id: string }>;
  const restored = await restoreIssues(projects.map((p) => p.id), parsed.data.issueIds);
  return NextResponse.json({ restored });
}

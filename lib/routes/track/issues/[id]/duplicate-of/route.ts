import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { issueAccess } from '@/lib/track-triage-http';
import { findWorkspaceIssueByIdentifier } from '@/lib/track-bulk';
import { getDuplicateMark, hasDuplicateMark, markIssueDuplicate, unmarkIssueDuplicate } from '@/lib/track-duplicates';
import { invalidBody, trackError } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const markSchema = z
  .object({
    /** UUID o identificador (WEB-12) del original, de cualquier team del workspace que la persona vea. */
    originalId: z.string().trim().min(1).max(80),
  })
  .strict();

/** La marca de duplicado del issue: el original (si quien mira lo ve) y desde cuándo. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await issueAccess((await props.params).id);
  if (!a.ok) return a.res;
  return NextResponse.json({ mark: await getDuplicateMark(a.issue.id) });
}

/** Marca el issue como duplicado del original (estado Duplicate, relación, suscriptos y pedidos al original). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await issueAccess((await props.params).id);
  if (!a.ok) return a.res;
  const parsed = markSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  let originalId = parsed.data.originalId;
  if (!UUID_RE.test(originalId)) {
    const found = await findWorkspaceIssueByIdentifier(a.issue.project_id, originalId);
    if (!found) return trackError(400, 'invalid_duplicate');
    originalId = found.id;
  }
  const res = await markIssueDuplicate(a.issue.id, originalId, a.actorId);
  if (!res.ok) return trackError(res.reason === 'not_found' ? 404 : res.reason === 'invalid_duplicate' ? 400 : 409, res.reason);
  // previousOriginalId: la marca cambió de original; ⌘Z vuelve a ese.
  return NextResponse.json({ issue: res.issue, mark: await getDuplicateMark(a.issue.id), moved: res.moved, previousOriginalId: res.previousOriginalId });
}

/** Quita la marca (deshacer): vuelve el estado, la relación y lo que se movió al original. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await issueAccess((await props.params).id);
  if (!a.ok) return a.res;
  if (!(await unmarkIssueDuplicate(a.issue.id, a.actorId))) return trackError(409, (await hasDuplicateMark(a.issue.id)) ? 'busy' : 'not_duplicate');
  const { getIssue } = await import('@/lib/track-data');
  return NextResponse.json({ issue: await getIssue(a.issue.id), mark: null });
}

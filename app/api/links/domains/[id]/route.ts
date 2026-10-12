import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteDomain, setDomainRootUrl } from '@/lib/link-domains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH { rootUrl } — a dónde redirige la raíz del dominio (go.empresa.com/). */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = z
    .object({ rootUrl: z.string().trim().url().max(2000).regex(/^https?:\/\//).nullable() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
  if (!(await setDomainRootUrl(user.id, id, parsed.data.rootUrl))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const res = await deleteDomain(user.id, id);
  if (!res.ok) return NextResponse.json({ error: res.code }, { status: res.code === 'has_links' ? 409 : 404 });
  return new NextResponse(null, { status: 204 });
}

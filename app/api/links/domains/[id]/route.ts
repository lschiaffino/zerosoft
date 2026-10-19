import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteDomain, setDomainUrls } from '@/lib/link-domains';
import { isShortLinkUrl } from '@/lib/links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const optionalUrl = z.string().trim().url().max(2000).regex(/^https?:\/\//).nullable().optional();

/**
 * PATCH { rootUrl?, notFoundUrl?, expiredUrl? }: a dónde redirige la raíz del
 * dominio (go.empresa.com/), un slug que no existe y un link vencido sin
 * fallback propio. null borra; lo que no viene no se toca.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = z
    .object({ rootUrl: optionalUrl, notFoundUrl: optionalUrl, expiredUrl: optionalUrl })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
  const { rootUrl, notFoundUrl, expiredUrl } = parsed.data;
  // Ninguno puede apuntar a un link corto ni a la raíz de un dominio propio (loop).
  for (const url of [rootUrl, notFoundUrl, expiredUrl]) {
    if (url && (await isShortLinkUrl(url))) return NextResponse.json({ error: 'self_link' }, { status: 400 });
  }
  const ok = await setDomainUrls(user.id, id, {
    root_url: rootUrl,
    not_found_url: notFoundUrl,
    expired_url: expiredUrl,
  });
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
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

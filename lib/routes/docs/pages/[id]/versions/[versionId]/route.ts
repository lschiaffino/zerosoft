import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { DOC_INTERNAL_READ, resolveDocAccess } from '@/lib/docs';
import { getDocVersion } from '@/lib/docs-versions';
import { stripFileUrls } from '@/lib/docs-files';
import { visibleBlocks } from '@/lib/docs-visible';
import { notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const res = await resolveDocAccess(user, id, DOC_INTERNAL_READ);
  if (!res) return notFound();
  const version = await getDocVersion(res.row.user_id, id, versionId);
  if (!version) return notFound();
  // Sincronizados: solo lo que esta persona puede ver hoy (la versión guarda la referencia).
  version.content = await visibleBlocks(res.row, version.content, { actor: user });
  // Solo lectura: la URL del storage de imágenes/archivos no viaja.
  if (res.access === 'view') return NextResponse.json({ ...version, content: stripFileUrls(version.content) });
  return NextResponse.json(version);
}

import { NextRequest } from 'next/server';
import { userCanUseApp } from '@/lib/workspace';
import { docsActorFor } from '@/lib/docs-platform-access';
import { searchPages } from '@/lib/docs-platform';
import { signActor, sJson } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?q=: páginas de Docs que la persona puede leer, para mandar una a firmar. */
export async function GET(req: NextRequest) {
  const a = await signActor();
  if ('res' in a) return a.res;
  if (!userCanUseApp(a.user, 'docs')) return sJson({ error: 'docs_unavailable' }, 403);
  const docs = await docsActorFor(a.actor.ws, a.actor.person);
  if (!docs) return sJson({ error: 'docs_unavailable' }, 403);
  const hits = await searchPages(docs, (req.nextUrl.searchParams.get('q') ?? '').slice(0, 100), 10).catch(() => []);
  return sJson({ pages: hits.map((h) => ({ id: h.page.id, title: h.page.title })) });
}

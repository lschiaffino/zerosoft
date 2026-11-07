/** Send: una página de Docs como PDF, con los permisos de Docs de la persona. Server-only. */
import { blocksToPdf, needsUnicodeFont } from '../docs-pdf';
import { docsActorFor } from '../docs-platform-access';
import { getPage } from '../docs-platform';
import type { DocsBlock } from '../docs-types';
import type { SessionUser } from '../session';
import { userCanUseApp } from '../workspace';
import { SendError, type SendActor } from './types';

export async function docsPageVersion(user: SessionUser, actor: SendActor, pageId: string): Promise<{ bytes: Buffer; name: string; title: string }> {
  if (!userCanUseApp(user, 'docs')) throw new SendError('docs_unavailable', 403);
  const docs = await docsActorFor(actor.ws, actor.person);
  if (!docs) throw new SendError('docs_unavailable', 403);
  let page;
  try {
    page = await getPage(docs, pageId.slice(0, 80), { blocks: true });
  } catch {
    throw new SendError('not_found', 404);
  }
  const blocks = (page.blocks ?? []) as DocsBlock[];
  if (needsUnicodeFont(page.title, blocks)) throw new SendError('docs_unicode', 422);
  const title = page.title || 'Untitled';
  return { bytes: await blocksToPdf(blocks, title), name: `${title.slice(0, 100)}.pdf`, title };
}

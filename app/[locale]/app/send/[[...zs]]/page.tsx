import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { userCanUseApp } from '@/lib/workspace';
import { sendActorOf } from '@/lib/send/http';
import { canEditDocument, getBranding, getDocument, listDocuments, listLinks, listVersions, versionDto } from '@/lib/send/core';
import { canEditSpace, getSpace, listSpaceAccess, listSpaces, spaceAnalytics, spaceItems } from '@/lib/send/spaces';
import { sendTemplates } from '@/lib/send/templates';
import { MAX_DOCUMENT_BYTES, MAX_VIDEO_BYTES, SendError } from '@/lib/send/types';
import SendHome from '@/components/send/SendHome';
import NewDocument from '@/components/send/NewDocument';
import DocumentDetail from '@/components/send/DocumentDetail';
import SpacesList from '@/components/send/SpacesList';
import SpaceDetail from '@/components/send/SpaceDetail';
import SendSettings from '@/components/send/SendSettings';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; zs?: string[] }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, zs = [] } = await props.params;
  const t = await getTranslations({ locale, namespace: 'send' });
  const key = zs[0] === 'spaces' ? 'nav.spaces' : zs[0] === 'new' ? 'nav.new' : 'nav.documents';
  return { title: `${t(key)} · Send` };
}

/** Borrado desde otra pestaña, o justo antes de refrescar: un 404, no un error. */
async function orNotFound<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SendError) notFound();
    throw err;
  }
}

/**
 * Send en una sola ruta (presupuesto de rutas): /app/send (?q), /app/send/new,
 * /app/send/documents/<id> (?tab), /app/send/spaces (?q), /app/send/spaces/<id> y
 * /app/send/settings.
 */
export default async function SendPage(props: Props) {
  const { locale, zs = [] } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  if (!userCanUseApp(user, 'send') || user.role === 'guest') notFound();
  const actor = sendActorOf(user);
  const [section, id] = zs;
  const templates = () => (userCanUseApp(user, 'sign') ? sendTemplates(actor) : Promise.resolve([]));

  if (!section) return <SendHome items={await listDocuments(actor, { q: sp.q ?? '' })} q={sp.q ?? ''} />;
  switch (section) {
    case 'new':
      return <NewDocument docsAvailable={userCanUseApp(user, 'docs')} maxDocMb={MAX_DOCUMENT_BYTES / 1024 / 1024} maxVideoMb={MAX_VIDEO_BYTES / 1024 / 1024} />;
    case 'documents': {
      if (!id) notFound();
      const d = await orNotFound(() => getDocument(actor, id));
      const versions = await listVersions(d.id);
      return (
        <DocumentDetail
          document={{ id: d.id, title: d.title, sharing: d.sharing, canEdit: canEditDocument(actor, d), currentVersionId: d.current_version_id }}
          versions={versions.map((v) => versionDto(v, d.current_version_id))}
          links={await listLinks(actor, { documentId: d.id })}
          templates={await templates()}
          admin={actor.admin}
          initialTab={sp.tab}
        />
      );
    }
    case 'spaces': {
      if (!id) return <SpacesList items={await listSpaces(actor, sp.q ?? '')} q={sp.q ?? ''} />;
      const s = await orNotFound(() => getSpace(actor, id));
      return (
        <SpaceDetail
          space={{ id: s.id, title: s.title, description: s.description, sharing: s.sharing, canEdit: canEditSpace(actor, s) }}
          initialItems={await spaceItems(s.id)}
          initialAccess={await listSpaceAccess(s.id)}
          links={await listLinks(actor, { spaceId: s.id })}
          documents={(await listDocuments(actor)).filter((x) => x.status === 'ready').map((x) => ({ id: x.id, title: x.title }))}
          templates={await templates()}
          analytics={await spaceAnalytics(s.id)}
          admin={actor.admin}
        />
      );
    }
    case 'settings':
      return <SendSettings initial={await getBranding(actor.ws)} admin={actor.admin} />;
    default:
      notFound();
  }
}

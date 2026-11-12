import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { realUserId, requireUser } from '@/lib/session';
import { accountDto, inboxCounts, listAccounts, listFolders, listSnippets, listThreadsPage } from '@/lib/inbox/core';
import { gmailAvailable } from '@/lib/inbox/gmail';
import { isInboxView, type InboxView } from '@/lib/inbox/types';
import { whatsappAvailable } from '@/lib/inbox/whatsapp';
import InboxApp from '@/components/inbox/InboxApp';
import InboxSettings from '@/components/inbox/InboxSettings';
import InboxAnalytics from '@/components/inbox/InboxAnalytics';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; zs?: string[] }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, zs = [] } = await props.params;
  const t = await getTranslations({ locale, namespace: 'inbox' });
  const title = zs[0] === 'settings' ? t('settings.title') : zs[0] === 'analytics' ? t('analytics.title') : zs[0] === 'v' && isInboxView(zs[1]) ? t(`views.${zs[1]}`) : t('views.inbox');
  return { title: `${title} · Inbox` };
}

/**
 * Inbox en una sola ruta: /app/inbox (?t=<chat>&new=1), /app/inbox/v/<vista>,
 * /app/inbox/f/<carpeta>, /app/inbox/analytics y /app/inbox/settings. Todo es de la persona de la
 * sesión (su id real), sin importar el workspace activo.
 *
 * Esta página arma la primera pantalla. Después, pasar de una vista o carpeta
 * a otra no vuelve acá: InboxApp lee la vista de la URL y solo cambia la
 * lista (components/inbox/nav.ts), por eso no lleva `key`.
 */
export default async function InboxPage(props: Props) {
  const { locale, zs = [] } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const owner = realUserId(await requireUser(locale));
  const [section, id] = zs;
  // Analítica: solo las filas de la persona (su id real); no carga la bandeja.
  if (section === 'analytics') return <InboxAnalytics locale={locale} owner={owner} search={{ days: sp.days, from: sp.from, to: sp.to }} />;
  const [accounts, folders, counts, snippets] = await Promise.all([listAccounts(owner), listFolders(owner), inboxCounts(owner), listSnippets(owner)]);
  const state = { accounts: accounts.map(accountDto), folders, counts, snippets, available: { whatsapp: whatsappAvailable(), gmail: gmailAvailable() } };

  let view: InboxView = 'inbox';
  let folder: (typeof folders)[number] | null = null;
  switch (section) {
    case undefined:
      break;
    case 'settings':
      return <InboxSettings initial={state} gmailResult={sp.gmail ?? null} />;
    case 'v':
      if (!isInboxView(id)) notFound();
      view = id;
      break;
    case 'f':
      folder = folders.find((f) => f.id === id) ?? null;
      if (!folder) notFound();
      break;
    default:
      notFound();
  }
  // La primera página; el resto se pide al bajar en la lista.
  const first = await listThreadsPage(owner, { view, folderId: folder?.id, limit: 60, cursor: '' });
  const openId = typeof sp.t === 'string' && /^ibt_[a-f0-9]{20}$/.test(sp.t) ? sp.t : null;
  return (
    <InboxApp
      view={view}
      folder={folder}
      initialThreads={first.threads}
      initialNext={first.next}
      initialPinned={first.pinned}
      initialState={state}
      initialOpenId={openId}
      initialFocusId={openId && typeof sp.m === 'string' && /^ibm_[a-f0-9]{8,40}$/.test(sp.m) ? sp.m : null}
      composeOnLoad={sp.new === '1'}
    />
  );
}

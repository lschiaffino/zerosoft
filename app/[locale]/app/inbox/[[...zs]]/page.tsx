import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { realUserId, requireUser } from '@/lib/session';
import { accountDto, inboxCounts, listAccounts, listFolders, listSnippets, listThreads } from '@/lib/inbox/core';
import { gmailAvailable } from '@/lib/inbox/gmail';
import { isInboxView, type InboxView } from '@/lib/inbox/types';
import { whatsappAvailable } from '@/lib/inbox/whatsapp';
import InboxApp from '@/components/inbox/InboxApp';
import InboxSettings from '@/components/inbox/InboxSettings';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; zs?: string[] }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, zs = [] } = await props.params;
  const t = await getTranslations({ locale, namespace: 'inbox' });
  const title = zs[0] === 'settings' ? t('settings.title') : zs[0] === 'v' && isInboxView(zs[1]) ? t(`views.${zs[1]}`) : t('views.inbox');
  return { title: `${title} · Inbox` };
}

/**
 * Inbox en una sola ruta: /app/inbox (?t=<chat>&new=1), /app/inbox/v/<vista>,
 * /app/inbox/f/<carpeta> y /app/inbox/settings. Todo es de la persona de la
 * sesión (su id real), sin importar el workspace activo.
 */
export default async function InboxPage(props: Props) {
  const { locale, zs = [] } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const owner = realUserId(await requireUser(locale));
  const [section, id] = zs;
  const [accounts, folders, counts, snippets] = await Promise.all([listAccounts(owner), listFolders(owner), inboxCounts(owner), listSnippets(owner)]);
  const state = { accounts: accounts.map(accountDto), folders, counts, snippets, available: { whatsapp: whatsappAvailable(), gmail: gmailAvailable() } };

  if (section === 'settings') return <InboxSettings initial={state} gmailResult={sp.gmail ?? null} />;

  const view: InboxView = section === 'v' && isInboxView(id) ? id : 'inbox';
  const folder = section === 'f' ? (folders.find((f) => f.id === id) ?? null) : null;
  if (section === 'f' && !folder) notFound();
  const threads = await listThreads(owner, { view, folderId: folder?.id });
  const openId = typeof sp.t === 'string' && /^ibt_[a-f0-9]{20}$/.test(sp.t) ? sp.t : null;
  return (
    <InboxApp
      key={`${view}:${folder?.id ?? ''}`}
      view={view}
      folder={folder}
      initialThreads={threads}
      initialState={state}
      initialOpenId={openId}
      composeOnLoad={sp.new === '1'}
    />
  );
}

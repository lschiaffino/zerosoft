import { setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { pathWithQuery } from '@/lib/return-path';
import { redirect } from 'next/navigation';
import { openDm, talkActor, TalkError } from '@/lib/talk';
import { loadTalkBootstrap } from '@/lib/talk-boot';
import TalkApp from '@/components/talk/TalkApp';
import type { TalkView } from '@/components/talk/talk-context';

const VIEWS: TalkView[] = ['threads', 'activity', 'later', 'drafts', 'files', 'search', 'browse'];

/** Página de Talk (con o sin canal en la ruta). Todo lo demás pasa en el cliente. */
export async function renderTalk(locale: string, channelId: string | null, sp: Record<string, string | string[] | undefined>) {
  setRequestLocale(locale);
  const path = channelId ? `/${locale}/app/talk/${channelId}` : `/${locale}/app/talk`;
  const user = await requireUser(locale, pathWithQuery(path, sp as Record<string, string>));
  const actor = talkActor(user);
  const one0 = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  // ⌘K "escribirle a alguien": ?dm=<id> abre el DM (o el propio) y entra ahí.
  const dmWith = one0(sp.dm);
  if (!channelId && dmWith) {
    let target: string | null = null;
    try {
      target = (await openDm(actor, dmWith === actor.personId ? [] : [dmWith])).id;
    } catch (err) {
      if (!(err instanceof TalkError)) throw err;
    }
    if (target) redirect(`/${locale}/app/talk/${target}`);
  }
  const boot = await loadTalkBootstrap(actor, { locale, heartbeat: true });
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const view = one(sp.view) as TalkView | null;
  return (
    <TalkApp
      locale={locale}
      initial={boot}
      initialChannelId={channelId}
      initialView={!channelId && view && VIEWS.includes(view) ? view : null}
      initialMessageId={one(sp.m)}
      initialThreadId={one(sp.thread)}
      initialQuery={one(sp.q) ?? ''}
      realtimeMode={process.env.TALK_REALTIME === 'poll' ? 'poll' : 'sse'}
    />
  );
}

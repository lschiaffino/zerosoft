'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import AssistantChat from './AssistantChat';
import { ASSISTANT_CHATS_EVENT, type ConversationSummary } from './client';
import { useAssistantStatus, useSuggestions } from './useAssistantStatus';

/**
 * Página del asistente: historial de charlas (nueva, renombrar, borrar,
 * buscar) y la charla abierta a la derecha. La charla va en ?c=<id>; una
 * pregunta que llega del inicio en ?q= se manda sola.
 */
export default function AssistantPage({ initialId, initialPrompt }: { initialId: string | null; initialPrompt: string | null }) {
  const t = useTranslations('assistant');
  const router = useRouter();
  const pathname = usePathname();
  const { status, error: statusError } = useAssistantStatus(true);
  const suggestions = useSuggestions('/app');
  const [current, setCurrent] = useState<string | null>(initialId);
  const [chatKey, setChatKey] = useState(0);
  const [prompt, setPrompt] = useState<string | null>(initialPrompt);
  const [list, setList] = useState<ConversationSummary[] | null>(null);
  const [listError, setListError] = useState(false);
  const [q, setQ] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setListError(false);
    const res = await fetch('/api/assistant/conversations').catch(() => null);
    const data = (await res?.json().catch(() => null)) as { conversations?: ConversationSummary[] } | null;
    if (!res?.ok || !data?.conversations) {
      setListError(true);
      return;
    }
    setList(data.conversations);
  }, []);

  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener(ASSISTANT_CHATS_EVENT, on);
    return () => window.removeEventListener(ASSISTANT_CHATS_EVENT, on);
  }, [load]);

  // La pregunta del inicio ya se mandó: se saca ?q= de la URL (recargar no la repite).
  useEffect(() => {
    if (initialPrompt) router.replace(initialId ? `/app/assistant?c=${initialId}` : '/app/assistant');
  }, [initialPrompt, initialId, router]);

  function open(id: string | null) {
    setCurrent(id);
    setPrompt(null);
    setChatKey((k) => k + 1);
    router.replace(id ? `/app/assistant?c=${id}` : '/app/assistant', { scroll: false });
    if (!id) window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  const onConversation = useCallback(
    (id: string, title: string) => {
      setCurrent(id);
      setList((prev) => (prev && !prev.some((c) => c.id === id) ? [{ id, title, updated_at: new Date().toISOString() }, ...prev] : prev));
      window.history.replaceState(null, '', `${window.location.pathname}?c=${id}`);
    },
    [],
  );

  async function saveRename() {
    if (!renaming || !renaming.title.trim() || busy) return;
    setBusy(true);
    const res = await fetch(`/api/assistant/conversations/${renaming.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: renaming.title }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setListError(true);
      return;
    }
    const row = (await res.json()) as ConversationSummary;
    setList((prev) => prev?.map((c) => (c.id === row.id ? { ...c, title: row.title } : c)) ?? prev);
    setRenaming(null);
  }

  async function confirmDelete() {
    if (!deleting || busy) return;
    setBusy(true);
    const res = await fetch(`/api/assistant/conversations/${deleting.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setListError(true);
      setDeleting(null);
      return;
    }
    const id = deleting.id;
    setDeleting(null);
    setList((prev) => prev?.filter((c) => c.id !== id) ?? prev);
    if (current === id) open(null);
  }

  const shown = (list ?? []).filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="asst-page" data-testid="assistant-page">
      <aside className="asst-page-side" aria-label={t('page.chats')}>
        <div className="asst-page-side-head">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => open(null)}>
            {t('newChat')}
          </button>
          <label className="sr-only" htmlFor="asst-search">
            {t('page.searchChats')}
          </label>
          <input id="asst-search" className="input" type="search" placeholder={t('page.searchChats')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {listError && (
          <p className="asst-page-note form-error" role="alert">
            {t('page.loadError')}{' '}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
              {t('page.retry')}
            </button>
          </p>
        )}
        {list === null && !listError ? (
          <p className="asst-page-note muted" role="status">
            {t('loading')}
          </p>
        ) : list && list.length === 0 ? (
          <p className="asst-page-note muted">{t('page.emptyChats')}</p>
        ) : list && shown.length === 0 ? (
          <p className="asst-page-note muted">{t('page.noMatches')}</p>
        ) : (
          <ul className="asst-page-list" data-testid="assistant-history">
            {shown.map((c) => (
              <li key={c.id} className={`asst-page-item${c.id === current ? ' is-current' : ''}`}>
                {renaming?.id === c.id ? (
                  <form
                    className="asst-page-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveRename();
                    }}
                  >
                    <label className="sr-only" htmlFor={`asst-rename-${c.id}`}>
                      {t('page.renameLabel')}
                    </label>
                    <input
                      id={`asst-rename-${c.id}`}
                      className="input"
                      value={renaming.title}
                      maxLength={80}
                      autoFocus
                      onChange={(e) => setRenaming({ id: c.id, title: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setRenaming(null);
                        }
                      }}
                    />
                    <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !renaming.title.trim()}>
                      {t('page.save')}
                    </button>
                  </form>
                ) : (
                  <>
                    <Link
                      href={`${pathname}?c=${c.id}`}
                      className="asst-page-link"
                      aria-current={c.id === current ? 'page' : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        open(c.id);
                      }}
                    >
                      {c.title || t('page.untitled')}
                    </Link>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming({ id: c.id, title: c.title })} aria-label={`${t('page.rename')}: ${c.title}`}>
                      {t('page.rename')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(c)} aria-label={`${t('page.delete')}: ${c.title}`}>
                      {t('page.delete')}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="asst-page-main" aria-label={t('title')}>
        <AssistantChat
          key={chatKey}
          conversationId={current}
          onConversation={onConversation}
          status={status}
          statusError={statusError}
          page={{ path: '/app/assistant' }}
          suggestions={suggestions}
          initialPrompt={prompt}
          inputRef={inputRef}
        />
      </section>
      <ConfirmDialog
        open={deleting !== null}
        title={t('page.deleteTitle')}
        body={t('page.deleteBody')}
        confirmLabel={t('page.delete')}
        cancelLabel={t('page.cancel')}
        danger
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

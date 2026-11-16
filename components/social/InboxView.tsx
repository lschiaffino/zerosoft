'use client';

import { useMounted } from '@/components/ui/useMounted';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import type { InboxItemDto } from '@/lib/social-inbox';
import type { AccountDto } from '@/lib/social';
import { fillSavedReply } from '@/lib/social-saved-replies';
import { api, fmtDateTime, NetworkTag, useErrorText, useToast } from './shared';

export interface SavedReply {
  id: string;
  name: string;
  body: string;
}

/**
 * Bandeja unificada: comentarios, menciones y mensajes directos de las
 * cuentas que la persona ve. Contestar (a mano o con una respuesta guardada
 * de la biblioteca), asignar y marcar hecho. La lista se arma en el servidor;
 * los filtros van en la URL.
 */
export default function InboxView({
  items,
  accounts,
  people,
  me,
  filters,
  savedReplies,
}: {
  items: InboxItemDto[];
  accounts: AccountDto[];
  people: Array<{ id: string; name: string }>;
  me: string;
  filters: { status: string; kind: string; account: string; assigned: string };
  savedReplies: SavedReply[];
}) {
  const t = useTranslations('social.inbox');
  const locale = useLocale();
  const mounted = useMounted();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const errorText = useErrorText();
  const [toast, showToast] = useToast();
  const [list, setList] = useState(items);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [replies, setReplies] = useState(savedReplies);
  const [saveName, setSaveName] = useState<string | null>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const saveNameRef = useRef<HTMLInputElement>(null);
  const selectedId = sp.get('item') ?? list[0]?.id ?? null;
  const selected = useMemo(() => list.find((i) => i.id === selectedId) ?? null, [list, selectedId]);

  useEffect(() => setList(items), [items]);
  useEffect(() => setReplies(savedReplies), [savedReplies]);
  useEffect(() => {
    if (saveName !== null) saveNameRef.current?.focus();
  }, [saveName !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pone la respuesta guardada en el cuadro (con {name} y {account} completos) y deja el cursor al final. */
  function insertSaved(id: string) {
    const saved = replies.find((r) => r.id === id);
    if (!saved || !selected) return;
    const text = fillSavedReply(saved.body, { authorName: selected.authorName, accountName: selected.account.name });
    setReply((cur) => (cur.trim() ? `${cur.replace(/\s+$/, '')}\n\n${text}` : text));
    setTimeout(() => {
      const el = replyRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
  }

  async function saveAsReply() {
    const name = saveName?.trim();
    if (!name || !reply.trim()) return;
    setBusy('save-reply');
    try {
      const item = await api<SavedReply>('/library', { method: 'POST', json: { kind: 'reply', name, body: reply } });
      setReplies((all) => [{ id: item.id, name: item.name, body: item.body }, ...all]);
      setSaveName(null);
      showToast(t('savedReplyCreated'));
    } catch (err) {
      showToast(errorText(err), true);
    } finally {
      setBusy(null);
    }
  }

  function setParam(key: string, value: string) {
    const q = new URLSearchParams(sp.toString());
    if (value) q.set(key, value);
    else q.delete(key);
    if (key !== 'item') q.delete('item');
    router.replace(`${pathname}?${q.toString()}`);
  }

  function update(item: InboxItemDto) {
    setList((all) => all.map((i) => (i.id === item.id ? item : i)));
  }

  async function send() {
    if (!selected || !reply.trim()) return;
    setBusy('reply');
    try {
      const item = await api<InboxItemDto>(`/inbox/${selected.id}`, { method: 'POST', json: { text: reply } });
      update(item);
      const last = item.replies[item.replies.length - 1];
      if (last?.status === 'failed') showToast(t('replyFailed', { error: last.error ?? '' }), true);
      else {
        setReply('');
        showToast(t('replied'));
      }
      // La lista del servidor trae la respuesta (una navegación pendiente no la pisa con datos viejos).
      router.refresh();
    } catch (err) {
      showToast(errorText(err), true);
    } finally {
      setBusy(null);
    }
  }

  async function patch(body: Record<string, unknown>) {
    if (!selected) return;
    setBusy('patch');
    try {
      const item = await api<InboxItemDto>(`/inbox/${selected.id}`, { method: 'PATCH', json: body });
      update(item);
      if (body.status) showToast(body.status === 'done' ? t('markedDone') : t('reopened'));
      router.refresh();
    } catch (err) {
      showToast(errorText(err), true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sc-page">
      <div className="sc-inbox-filters">
        <nav className="ui-tabs" aria-label={t('status')}>
          {(['open', 'done', 'all'] as const).map((s) => (
            <button key={s} type="button" className="ui-tab" aria-current={filters.status === s ? 'page' : undefined} onClick={() => setParam('status', s === 'open' ? '' : s)}>
              {t(`status_${s}`)}
            </button>
          ))}
        </nav>
        <select className="select" aria-label={t('kind')} value={filters.kind} onChange={(e) => setParam('kind', e.target.value)}>
          <option value="">{t('allKinds')}</option>
          <option value="comment">{t('kind_comment')}</option>
          <option value="mention">{t('kind_mention')}</option>
          <option value="dm">{t('kind_dm')}</option>
        </select>
        <select className="select" aria-label={t('account')} value={filters.account} onChange={(e) => setParam('account', e.target.value)}>
          <option value="">{t('allAccounts')}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.networkName} · {a.name}
            </option>
          ))}
        </select>
        <select className="select" aria-label={t('assigned')} value={filters.assigned} onChange={(e) => setParam('assigned', e.target.value)}>
          <option value="">{t('anyone')}</option>
          <option value="me">{t('mine')}</option>
          <option value="none">{t('unassigned')}</option>
        </select>
        <button type="button" className="btn btn-sm" onClick={() => router.refresh()}>
          {t('refresh')}
        </button>
      </div>

      {list.length === 0 ? (
        <div className="ui-empty" data-testid="inbox-empty">
          <p className="ui-empty-title">{t('emptyTitle')}</p>
          <p className="ui-empty-body">{accounts.length ? t('emptyBody') : t('emptyNoAccounts')}</p>
        </div>
      ) : (
        <div className="sc-inbox">
          <div className="sc-list" role="list" aria-label={t('title')}>
            {list.map((i) => (
              <button
                key={i.id}
                type="button"
                role="listitem"
                className="sc-item sc-item-btn"
                aria-current={i.id === selected?.id ? 'true' : undefined}
                onClick={() => setParam('item', i.id)}
                data-testid="inbox-item"
              >
                <div className="sc-item-main">
                  <div className="sc-row">
                    <NetworkTag network={i.account.network} name={i.account.networkName} />
                    <span className="sc-muted sc-small">{t(`kind_${i.kind}`)}</span>
                  </div>
                  <strong>{i.authorName}</strong>
                  <span className="sc-item-text">{i.text || t('noText')}</span>
                </div>
                <div className="sc-item-side">
                  <span className="sc-muted sc-small">{(mounted ? fmtDateTime(i.receivedAt, locale) : '')}</span>
                  {i.status === 'done' && <span className="sc-status" data-s="published">{t('done')}</span>}
                </div>
              </button>
            ))}
          </div>

          {selected && (
            <section className="sc-panel sc-thread" aria-label={t('conversation')} data-testid="inbox-detail">
              <div className="sc-row">
                <NetworkTag network={selected.account.network} name={`${selected.account.networkName} · ${selected.account.name}`} />
                <span className="sc-grow" />
                {selected.postUrl && (
                  <a href={selected.postUrl} target="_blank" rel="noopener noreferrer" className="sc-small">
                    {t('viewPost')}
                  </a>
                )}
              </div>
              <div>
                <strong>{selected.authorName}</strong>
                {selected.authorHandle && <span className="sc-muted"> @{selected.authorHandle}</span>}
              </div>
              <div className="sc-bubble">{selected.text || t('noText')}</div>
              {selected.replies.map((r) => (
                <div key={r.id} className="sc-bubble" data-us="true" data-testid="inbox-reply">
                  <div className="sc-muted sc-small">
                    {r.personName} · {(mounted ? fmtDateTime(r.createdAt, locale) : '')}
                  </div>
                  {r.text}
                  {r.status === 'failed' && <div className="sc-error">{t('replyFailed', { error: r.error ?? '' })}</div>}
                </div>
              ))}
              {selected.canReply ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                  className="sc-thread"
                >
                  <div className="sc-row sc-reply-tools">
                    <label className="label sc-grow" htmlFor="sc-inbox-reply">
                      {t('reply')}
                    </label>
                    {replies.length > 0 ? (
                      <select className="select" aria-label={t('insertSavedReply')} value="" onChange={(e) => insertSaved(e.target.value)} data-testid="inbox-saved-replies">
                        <option value="">{t('insertSavedReply')}</option>
                        {replies.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Link className="sc-small" href="/app/social/library?kind=reply">
                        {t('noSavedReplies')}
                      </Link>
                    )}
                  </div>
                  <div className="ui-field">
                    <textarea
                      ref={replyRef}
                      id="sc-inbox-reply"
                      className="textarea"
                      rows={3}
                      value={reply}
                      data-testid="inbox-reply-text"
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                    />
                  </div>
                  {saveName !== null ? (
                    <div className="sc-row" data-testid="inbox-save-reply-form">
                      <input
                        ref={saveNameRef}
                        className="input sc-grow"
                        value={saveName}
                        maxLength={120}
                        placeholder={t('savedReplyNameShort')}
                        aria-label={t('savedReplyName')}
                        data-testid="inbox-save-reply-name"
                        onChange={(e) => setSaveName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void saveAsReply();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setSaveName(null);
                            replyRef.current?.focus();
                          }
                        }}
                      />
                      <button type="button" className="btn btn-sm" onClick={() => setSaveName(null)}>
                        {t('cancel')}
                      </button>
                      <button type="button" className="btn btn-sm btn-primary" disabled={!saveName.trim() || busy === 'save-reply'} aria-busy={busy === 'save-reply'} onClick={() => void saveAsReply()} data-testid="inbox-save-reply-confirm">
                        {t('savedReplySave')}
                      </button>
                    </div>
                  ) : null}
                  <div className="sc-actions">
                    {saveName === null && (
                      <button type="button" className="btn" disabled={!reply.trim()} onClick={() => setSaveName('')} data-testid="inbox-save-reply">
                        {t('saveAsReply')}
                      </button>
                    )}
                    <button type="submit" className="btn btn-primary" disabled={!reply.trim() || busy === 'reply'} aria-busy={busy === 'reply'}>
                      {t('send')}
                    </button>
                  </div>
                </form>
              ) : (
                <p className="sc-muted">{t('cannotReply')}</p>
              )}
              <hr className="sc-sep" />
              <div className="sc-row">
                <label className="ui-field sc-grow">
                  <span className="label">{t('assignTo')}</span>
                  <select className="select" value={selected.assignedTo ?? ''} onChange={(e) => void patch({ assignedTo: e.target.value || null })} data-testid="inbox-assign">
                    <option value="">{t('nobody')}</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id === me ? t('me', { name: p.name }) : p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="btn" disabled={busy === 'patch'} onClick={() => void patch({ status: selected.status === 'done' ? 'open' : 'done' })} data-testid="inbox-done">
                  {selected.status === 'done' ? t('reopen') : t('markDone')}
                </button>
              </div>
            </section>
          )}
        </div>
      )}
      {toast}
    </div>
  );
}

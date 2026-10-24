'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import type { AssistantProposal, AssistantRecordRef, AssistantReply } from '@/lib/crm-ai-assistant';
import { aiErrorKey } from './aiShared';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  records?: AssistantRecordRef[];
  proposals?: AssistantProposal[];
  error?: boolean;
}

type ProposalState = { status: 'idle' | 'busy' | 'done' | 'dismissed' | 'error'; message?: string };

const STORE_KEY = 'zs:crm-assistant';
const RECORD_PATH = /^\/app\/crm\/(contacts|companies|deals)\/([^/?#]+)/;
const PAGE_ENTITY: Record<string, 'contact' | 'company' | 'deal'> = { contacts: 'contact', companies: 'company', deals: 'deal' };

function loadStored(): ChatMessage[] {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ChatMessage[]).slice(-30) : [];
  } catch {
    return [];
  }
}

function store(messages: ChatMessage[]) {
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-30)));
  } catch {
    // Sin storage (modo privado): la conversación vive mientras dure la pestaña.
  }
}

/**
 * Asistente del CRM: panel lateral de chat que busca y resume datos del CRM
 * y prepara cambios (crear tarea, mover etapa, actualizar un campo) que se
 * aplican recién al confirmar, con la misma API y permisos que la UI.
 * Se abre con el botón flotante, desde ⌘K o con el evento 'zs:crm-assistant'.
 */
export default function CrmAssistant() {
  const t = useTranslations('crm.ai');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [proposalState, setProposalState] = useState<Record<string, ProposalState>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Quién abrió el panel (botón de la banda, ⌘K…): recupera el foco al cerrar. */
  const returnFocus = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const match = RECORD_PATH.exec(pathname);
  const page = match && match[2] !== 'new' && match[2] !== 'duplicates' ? { entity: PAGE_ENTITY[match[1]], id: match[2] } : null;

  useEffect(() => {
    setMessages(loadStored());
  }, []);

  useEffect(() => {
    const onOpen = () => {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
    window.addEventListener('zs:crm-assistant', onOpen);
    // ?assistant=1 (acción de ⌘K desde otra app) abre el panel.
    if (new URLSearchParams(window.location.search).get('assistant') === '1') setOpen(true);
    return () => window.removeEventListener('zs:crm-assistant', onOpen);
  }, []);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy, open]);

  const close = useCallback(() => {
    setOpen(false);
    const back = returnFocus.current?.isConnected ? returnFocus.current : document.querySelector<HTMLElement>('[data-crm-assistant-trigger]');
    window.setTimeout(() => back?.focus(), 0);
  }, []);

  // Esc cierra el panel desde cualquier lado (salvo que otro diálogo, como ⌘K, lo use antes).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  function update(next: ChatMessage[]) {
    setMessages(next);
    store(next);
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const history = [...messages, { role: 'user' as const, content }];
    update(history);
    setDraft('');
    setBusy(true);
    const res = await fetch('/api/crm/ai/assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: history
          .filter((m) => !m.error)
          .slice(-20)
          .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })),
        page,
        locale,
      }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (AssistantReply & { error?: string }) | null;
    setBusy(false);
    if (!res?.ok || !data || data.error) {
      update([...history, { role: 'assistant', content: t(aiErrorKey(data?.error)), error: true }]);
      return;
    }
    update([...history, { role: 'assistant', content: data.text, records: data.records, proposals: data.proposals }]);
  }

  async function confirm(p: AssistantProposal) {
    if (!p.request.url.startsWith('/api/crm/')) return;
    setProposalState((s) => ({ ...s, [p.id]: { status: 'busy' } }));
    const res = await fetch(p.request.url, {
      method: p.request.method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p.request.body),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { error?: string } | null;
    if (!res?.ok) {
      setProposalState((s) => ({ ...s, [p.id]: { status: 'error', message: t(aiErrorKey(data?.error)) } }));
      return;
    }
    setProposalState((s) => ({ ...s, [p.id]: { status: 'done' } }));
    inputRef.current?.focus();
    router.refresh();
  }


  const suggestions = page
    ? [t('assistant.suggest.summarize'), t('assistant.suggest.task')]
    : [t('assistant.suggest.pipeline'), t('assistant.suggest.overdue'), t('assistant.suggest.find')];

  return (
    <>
      {open && (
        <div className="ai-panel" role="dialog" aria-label={t('assistant.title')}>
          <div className="ai-panel-head">
            <h2 className="ai-panel-title">{t('assistant.title')}</h2>
            {messages.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => update([])}>
                {t('assistant.clear')}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={close} aria-label={t('assistant.close')}>
              {t('assistant.close')}
            </button>
          </div>
          <div className="ai-panel-body" ref={listRef} aria-live="polite">
            {messages.length === 0 ? (
              <div className="ai-panel-empty">
                <p>{t('assistant.intro')}</p>
                <ul className="ai-suggestions">
                  {suggestions.map((s) => (
                    <li key={s}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => send(s)}>
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`ai-msg ai-msg-${m.role}${m.error ? ' ai-msg-error' : ''}`} {...(m.error ? { role: 'alert' } : {})}>
                  <p className="ai-msg-text">{m.content}</p>
                  {m.records && m.records.length > 0 && (
                    <ul className="ai-records">
                      {m.records.map((r) => (
                        <li key={`${r.type}:${r.id}`}>
                          <Link href={r.href} className="ai-record-link">
                            {r.name}
                          </Link>
                          <span className="muted">{t(`assistant.types.${r.type}`)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.proposals?.map((p) => {
                    const st = proposalState[p.id] ?? { status: 'idle' };
                    return (
                      <div key={p.id} className="ai-proposal" data-testid="ai-proposal">
                        <p className="ai-proposal-title">{t(`assistant.kinds.${p.kind}`)}</p>
                        <p className="ai-proposal-summary">{p.summary}</p>
                        {st.status === 'done' ? (
                          <p className="ai-proposal-done" role="status">
                            {t('assistant.applied')}
                          </p>
                        ) : st.status === 'dismissed' ? (
                          <p className="muted">{t('assistant.dismissed')}</p>
                        ) : (
                          <div className="ai-actions">
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => confirm(p)} disabled={st.status === 'busy'}>
                              {st.status === 'busy' ? t('working') : t('assistant.confirm')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setProposalState((s) => ({ ...s, [p.id]: { status: 'dismissed' } }))}
                              disabled={st.status === 'busy'}
                            >
                              {t('assistant.dismiss')}
                            </button>
                          </div>
                        )}
                        {st.status === 'error' && (
                          <p className="form-error" role="alert">
                            {st.message}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
            {busy && (
              <p className="ai-msg ai-msg-assistant muted" role="status">
                {t('assistant.thinking')}
              </p>
            )}
          </div>
          <form
            className="ai-panel-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <label className="sr-only" htmlFor="ai-assistant-input">
              {t('assistant.placeholder')}
            </label>
            <textarea
              id="ai-assistant-input"
              ref={inputRef}
              className="textarea"
              rows={2}
              value={draft}
              maxLength={4000}
              placeholder={t('assistant.placeholder')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !draft.trim()}>
              {t('assistant.send')}
            </button>
          </form>
          <p className="ai-panel-foot muted">{t('assistant.foot')}</p>
        </div>
      )}
    </>
  );
}

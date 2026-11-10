'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { VOICE_ATTACHMENT_MAX_CHARS, type VoiceChatMessage, type VoiceChatModel, type VoiceFollowup } from '@/lib/voice-types';
import { chatThreads, newThreadId } from '@/lib/voice-threads';
import { voiceErrorKey } from './voice-ui';
import RecipeInput, { type RecipeOption } from './RecipeInput';
import RecipeLibrary from './RecipeLibrary';
import { CitedText, streamVoice } from './chat-ui';
import { FollowupComposer } from './MeetingPrep';
import { copyText } from './insert';
import { useDictation } from './useDictation';
import Pop from './Pop';

/** Recipes de fábrica que se ofrecen primero (como los de Granola). */
const QUICK_RECIPES = ['todos', 'longer', 'tldr'] as const;
const MODEL_KEY = 'zs.voice.chatModel';

export interface ChatModelOption {
  id: VoiceChatModel;
  name: string;
}

/**
 * Barra de abajo de la reunión (como Granola): a la izquierda el audio en
 * vivo, en el medio "Preguntá lo que quieras" y el email de seguimiento. Al
 * enfocarla se abre el panel del chat sobre las notas: historial, recipes,
 * modelo, archivo adjunto, dictado, pantalla completa y chat nuevo. Funciona
 * durante la reunión (con la transcripción hasta ahí) y después.
 */
export default function MeetingAsk({
  sessionId,
  initial,
  ai,
  live,
  open,
  onOpenChange,
  onSeek,
  left,
  above,
  models,
  followup,
  defaultTo,
  mailbox,
  onFollowupSaved,
}: {
  sessionId: string;
  initial: VoiceChatMessage[];
  ai: boolean;
  live: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSeek: (ms: number) => void;
  /** Botón del audio en vivo (y cortar). */
  left: ReactNode;
  /** Lo que va arriba de la barra con el panel cerrado (transcripción, "Escribir notas"). */
  above?: ReactNode;
  models: ChatModelOption[];
  followup: VoiceFollowup | null;
  defaultTo: string[];
  mailbox: { email: string; provider: 'gmail' | 'outlook' } | null;
  onFollowupSaved: (f: VoiceFollowup) => void;
}) {
  const t = useTranslations('voice.ask');
  const tChat = useTranslations('voice.chat');
  const tErr = useTranslations('voice.errors');
  const tPrompts = useTranslations('voice.prompts');
  const locale = useLocale();
  const [messages, setMessages] = useState(initial);
  // La conversación abierta: la última que se usó.
  const [thread, setThread] = useState<string>(() => initial[initial.length - 1]?.thread ?? '');
  const [mode, setMode] = useState<'chat' | 'email'>('chat');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [library, setLibrary] = useState(false);
  const [recipesVersion, setRecipesVersion] = useState(0);
  const [attachment, setAttachment] = useState<{ name: string; text: string; cut: boolean } | null>(null);
  const [model, setModel] = useState<VoiceChatModel | ''>('');
  const [flash, setFlash] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dict = useDictation();

  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODEL_KEY);
      if (saved === 'fast' || saved === 'deep') setModel(saved);
    } catch {
      /* sin almacenamiento: el modelo por defecto */
    }
  }, []);

  const shown = useMemo(() => messages.filter((m) => (m.thread ?? '') === thread), [messages, thread]);
  const threads = useMemo(() => chatThreads(messages), [messages]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, streaming, pending, open, mode]);

  // ⌘J o "/" (fuera de un campo) van a la pregunta; ⌘J le gana al asistente global en esta página.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      const cmdJ = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j';
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing;
      if (!cmdJ && !slash) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      onOpenChange(true);
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onOpenChange]);

  // Clic afuera (en las notas) cierra el panel, como en Granola.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dockRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('dialog, .vc-pop')) return;
      onOpenChange(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onOpenChange]);

  function pickModel(v: VoiceChatModel) {
    setModel(v);
    try {
      localStorage.setItem(MODEL_KEY, v);
    } catch {
      /* sin almacenamiento */
    }
  }

  async function send(question: string, recipe?: RecipeOption) {
    if ((!question && !recipe) || busy) return;
    setMode('chat');
    onOpenChange(true);
    setBusy(true);
    setError(null);
    setStreaming('');
    const label = recipe ? `/${recipe.name}` : question;
    setPending(label);
    setQ('');
    const extra = {
      thread: thread || undefined,
      model: model || undefined,
      attachment: attachment ? { name: attachment.name, text: attachment.text } : undefined,
    };
    const fail = (code: string) => {
      setPending(null);
      setStreaming('');
      setQ(recipe ? '' : question);
      if (code !== 'aborted') setError(code);
    };
    if (recipe) {
      const res = await fetch(`/api/voice/sessions/${sessionId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipeId: recipe.id, locale, ...extra }),
      }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { chat?: VoiceChatMessage[]; error?: string } | null;
      setBusy(false);
      if (!res?.ok || !data?.chat) return fail(data?.error ?? 'network');
      setPending(null);
      setAttachment(null);
      setMessages(data.chat);
      return;
    }
    ctrl.current = new AbortController();
    let text = '';
    let saved: VoiceChatMessage[] | null = null;
    const code = await streamVoice(
      `/api/voice/sessions/${sessionId}/chat`,
      { question, locale, ...extra },
      (e) => {
        if (e.type === 'text') {
          text += e.delta;
          setStreaming(text);
        } else if (e.type === 'done' && Array.isArray(e.chat)) saved = e.chat as VoiceChatMessage[];
      },
      ctrl.current.signal,
    );
    ctrl.current = null;
    setBusy(false);
    if (code || !saved) return fail(code ?? 'generic');
    setPending(null);
    setStreaming('');
    setAttachment(null);
    setMessages(saved);
  }

  function newChat() {
    ctrl.current?.abort();
    setThread(newThreadId());
    setMode('chat');
    setError(null);
    setQ('');
    inputRef.current?.focus();
  }

  async function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setError(null);
    const textLike = file.type.startsWith('text/') || /\.(md|markdown|txt|csv|tsv|json|vtt|srt|log|html?)$/i.test(file.name);
    if (!textLike) return setError('attachment_type');
    if (file.size > 2_000_000) return setError('attachment_too_large');
    const text = await file.text().catch(() => '');
    if (!text.trim()) return setError('attachment_type');
    setAttachment({ name: file.name, text: text.slice(0, VOICE_ATTACHMENT_MAX_CHARS), cut: text.length > VOICE_ATTACHMENT_MAX_CHARS });
    inputRef.current?.focus();
  }

  async function toggleDictation() {
    if (dict.state === 'recording') {
      const res = await dict.stop({ context: 'chat', sourceApp: '/app/voice/meetings' });
      if (res?.text) setQ((cur) => (cur.trim() ? `${cur.trim()} ${res.text}` : res.text));
      inputRef.current?.focus();
      return;
    }
    if (dict.state === 'idle') await dict.start();
  }

  const recipes = tPrompts.raw('recipes') as Record<string, { name: string }>;
  const quick = QUICK_RECIPES.filter((k) => recipes[k]).map((k) => ({ id: `builtin:${k}`, name: recipes[k].name, origin: 'builtin' as const }));
  const suggestions = (tChat.raw(live ? 'suggestLive' : 'suggestAfter') as string[]) ?? [];
  const last = shown[shown.length - 1];
  const title = mode === 'email' ? t('followupTitle') : threads.find((x) => x.id === thread)?.title || t('newChat');
  const dictating = dict.state === 'recording' || dict.state === 'starting';

  const close = () => {
    onOpenChange(false);
    inputRef.current?.blur();
  };

  return (
    <div
      ref={dockRef}
      className={`vc-dock${open ? ' is-open' : ''}${open && expanded ? ' is-expanded' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open && !e.defaultPrevented) {
          e.preventDefault();
          close();
        }
      }}
    >
      {open ? (
        <section className="vc-askpanel" aria-label={t('panel')} data-testid="voice-ask-panel">
          <header className="vc-askpanel-head">
            <Pop
              menu
              buttonClass="btn btn-ghost btn-sm btn-icon"
              ariaLabel={t('history')}
              label={<HistoryIcon />}
              panelClass="vc-menu vc-history"
            >
              {(closeMenu) =>
                threads.length === 0 ? (
                  <p className="vc-muted vc-menu-empty">{t('historyEmpty')}</p>
                ) : (
                  threads.map((x) => (
                    <button
                      key={x.id || 'first'}
                      type="button"
                      role="menuitemradio"
                      aria-checked={x.id === thread && mode === 'chat'}
                      className="vc-menu-item"
                      onClick={() => {
                        setThread(x.id);
                        setMode('chat');
                        closeMenu();
                      }}
                    >
                      <span className="vc-menu-text">{x.title}</span>
                      <span className="vc-muted vc-menu-meta">{t('turns', { count: x.turns })}</span>
                    </button>
                  ))
                )
              }
            </Pop>
            <h2 className="vc-askpanel-title">{title}</h2>
            {models.length > 1 && mode === 'chat' && (
              <select className="select select-sm vc-model" aria-label={t('model')} value={model || models[0].id} onChange={(e) => pickModel(e.target.value as VoiceChatModel)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id} title={m.name}>
                    {t(`models.${m.id}`)}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={expanded ? t('collapse') : t('expand')} title={expanded ? t('collapse') : t('expand')} onClick={() => setExpanded((v) => !v)}>
              {expanded ? <CollapseIcon /> : <ExpandIcon />}
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('newChat')} title={t('newChat')} onClick={newChat}>
              <PlusIcon />
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('close')} title={`${t('close')} (Esc)`} onClick={close}>
              <ChevronDown />
            </button>
          </header>

          <div className="vc-askpanel-body" ref={bodyRef}>
            {!ai && <p className="vc-notice">{tErr('ai_disabled')}</p>}
            {mode === 'email' ? (
              <FollowupComposer sessionId={sessionId} initial={followup} defaultTo={defaultTo} mailbox={mailbox} onSaved={onFollowupSaved} />
            ) : shown.length === 0 && !pending ? (
              <div className="vc-ask-empty">
                <p className="vc-muted">{live ? tChat('emptyLive') : tChat('empty')}</p>
                {ai && (
                  <>
                    <ul className="vc-recipe-list" aria-label={t('recipes')}>
                      <li>
                        <button type="button" className="vc-recipe-row" onClick={() => setMode('email')}>
                          <MailIcon />
                          <span>{t('followup')}</span>
                        </button>
                      </li>
                      {quick.map((r) => (
                        <li key={r.id}>
                          <button type="button" className="vc-recipe-row" disabled={busy} onClick={() => void send('', r)}>
                            <SparkIcon />
                            <span>{r.name}</span>
                          </button>
                        </li>
                      ))}
                      <li>
                        <button type="button" className="vc-recipe-row is-more" onClick={() => setLibrary(true)}>
                          <GridIcon />
                          <span>{t('allRecipes')}</span>
                        </button>
                      </li>
                    </ul>
                    <p className="vc-pop-title vc-ask-try">{tChat('suggestionsLabel')}</p>
                    <ul className="vc-recipe-list">
                      {suggestions.map((s) => (
                        <li key={s}>
                          <button type="button" className="vc-recipe-row is-question" disabled={busy} onClick={() => void send(s)}>
                            <span>{s}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ) : (
              <ol className="vc-chat-list" aria-label={title}>
                {shown.map((m, i) => (
                  <li key={i} className={`vc-msg is-${m.role}`}>
                    <span className="sr-only">{m.role === 'user' ? tChat('you') : tChat('assistant')}: </span>
                    {m.role === 'assistant' ? <CitedText text={m.text} onSeek={onSeek} /> : m.text}
                  </li>
                ))}
                {pending && (
                  <li className="vc-msg is-user">
                    <span className="sr-only">{tChat('you')}: </span>
                    {pending}
                  </li>
                )}
                {busy && streaming && (
                  <li className="vc-msg is-assistant is-streaming" aria-busy="true">
                    <span className="sr-only">{tChat('assistant')}: </span>
                    <CitedText text={streaming} onSeek={onSeek} />
                  </li>
                )}
              </ol>
            )}
            {mode === 'chat' && !busy && last?.role === 'assistant' && (
              <div className="vc-msg-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void send(t('sayMoreQuestion'))}>
                  {t('sayMore')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={async () => setFlash((await copyText(last.text)) ? t('copied') : t('copyFailed'))}>
                  {t('copy')}
                </button>
                {flash && (
                  <span className="vc-muted" role="status">
                    {flash}
                  </span>
                )}
              </div>
            )}
            <div aria-live="polite" className="sr-only">
              {!busy && last?.role === 'assistant' ? last.text : ''}
            </div>
            {busy && (
              <p className="vc-muted vc-chat-status" role="status">
                {streaming ? tChat('writing') : tChat('thinking')}
                {ctrl.current && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => ctrl.current?.abort()}>
                    {t('stopAnswer')}
                  </button>
                )}
              </p>
            )}
            {(error || dict.error) && (
              <p className="ui-error" role="alert">
                {tErr(voiceErrorKey(error ?? dict.error))}
              </p>
            )}
          </div>
        </section>
      ) : (
        above
      )}

      <div className="vc-dock-bar">
        {left}
        <RecipeInput
          className="vc-dock-input"
          inputRef={inputRef}
          value={q}
          onChange={setQ}
          onFocus={() => onOpenChange(true)}
          onAsk={(question) => void send(question)}
          onRecipe={(r) => void send('', r)}
          placeholder={live ? t('placeholderLive') : t('placeholder')}
          label={tChat('placeholder')}
          busy={busy}
          submitLabel={tChat('send')}
          recipesVersion={recipesVersion}
          submitIcon={open ? <ArrowUp /> : undefined}
          before={
            attachment && open ? (
              <span className="vc-attach-chip" title={attachment.cut ? t('attachCut') : undefined}>
                <ClipIcon />
                <span className="vc-attach-name">{attachment.name}</span>
                <button type="button" className="vc-attach-x" aria-label={t('attachRemove', { name: attachment.name })} onClick={() => setAttachment(null)}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </span>
            ) : undefined
          }
          after={
            open ? (
              <>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('attach')} title={t('attach')} onClick={() => fileRef.current?.click()}>
                  <ClipIcon />
                </button>
                <button
                  type="button"
                  className={`btn btn-ghost btn-sm btn-icon vc-dictate${dictating ? ' is-on' : ''}`}
                  aria-label={dictating ? t('dictateStop') : t('dictate')}
                  aria-pressed={dictating}
                  data-state={dict.state}
                  title={dictating ? t('dictateStop') : t('dictate')}
                  disabled={dict.state === 'transcribing'}
                  aria-busy={dict.state === 'transcribing' || undefined}
                  onClick={() => void toggleDictation()}
                >
                  <MicSmall />
                </button>
                <input ref={fileRef} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept=".txt,.md,.markdown,.csv,.tsv,.json,.vtt,.srt,.log,.html,text/*" onChange={(e) => void onFile(e.target.files?.[0])} />
              </>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm vc-dock-quick"
                onClick={() => {
                  setMode('email');
                  onOpenChange(true);
                }}
              >
                <MailIcon />
                <span className="vc-dock-quick-text">{t('followup')}</span>
              </button>
            )
          }
        />
      </div>
      {open && <p className="vc-dock-foot">{t('mistakes')}</p>}
      {library && (
        <RecipeLibrary
          onClose={() => {
            setLibrary(false);
            inputRef.current?.focus();
          }}
          onRun={(r) => void send('', r)}
          onChanged={() => setRecipesVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}

const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true } as const;
function HistoryIcon() {
  return (
    <svg {...icon}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </svg>
  );
}
function ExpandIcon() {
  return (
    <svg {...icon}>
      <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
    </svg>
  );
}
function CollapseIcon() {
  return (
    <svg {...icon}>
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg {...icon}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function ChevronDown() {
  return (
    <svg {...icon}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function ArrowUp() {
  return (
    <svg {...icon} strokeWidth={2}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg {...icon}>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
    </svg>
  );
}
function SparkIcon() {
  return (
    <svg {...icon}>
      <path d="M12 3.5l1.9 5 5 1.9-5 1.9-1.9 5-1.9-5-5-1.9 5-1.9z" />
      <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg {...icon}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
    </svg>
  );
}
function ClipIcon() {
  return (
    <svg {...icon}>
      <path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />
    </svg>
  );
}
function MicSmall() {
  return (
    <svg {...icon}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

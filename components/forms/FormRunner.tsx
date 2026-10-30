'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { checkAnswer, computePath, isEmptyAnswer, pipe, type AnswerError } from '@/lib/forms/engine';
import type { AnswerValue, Answers, FileAnswer, FormDefinition, FormSettings, Question } from '@/lib/forms/types';
import { QuestionInput } from './QuestionInputs';

export interface RunnerProps {
  slug: string;
  definition: FormDefinition;
  settings: Pick<FormSettings, 'mode' | 'theme' | 'progressBar' | 'resume' | 'partials' | 'closedMessage'>;
  closedReason: '' | 'draft' | 'closed' | 'date' | 'limit';
  hidden: Record<string, string>;
  lang: string;
  languages: string[];
  embed: boolean;
  /** Vista previa del builder: no guarda ni cuenta visitas. */
  preview?: boolean;
  /** Marca de render firmada por el servidor (tiempo mínimo anti-spam). */
  renderToken?: string;
  /** Abierto como popup del embed: Esc avisa a la página para cerrarlo. */
  popup?: boolean;
}

type Screen = 'resume' | 'welcome' | 'question' | 'consent' | 'ending' | 'closed';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const storeKey = (slug: string) => `zs-form:${slug}`;

function newVisitId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function readSaved(slug: string): { answers: Answers; at: string | null; partialToken?: string } | null {
  try {
    const raw = window.localStorage.getItem(storeKey(slug));
    if (!raw) return null;
    const v = JSON.parse(raw) as { answers?: Answers; at?: string; partialToken?: string };
    return v.answers && Object.keys(v.answers).length ? { answers: v.answers, at: v.at ?? null, partialToken: v.partialToken } : null;
  } catch {
    return null;
  }
}

/**
 * Quien responde: una pregunta por pantalla (Enter avanza, letras eligen
 * opciones, flechas para volver) o todo en una página. La lógica, el piping y
 * la validación son los del motor (lib/forms/engine.ts), los mismos que usa
 * el servidor. Todo el texto se muestra como texto (nunca HTML).
 */
export default function FormRunner(props: RunnerProps) {
  const { slug, definition: def, settings, embed, preview } = props;
  const t = useTranslations('forms.public');
  const labels = useMemo(() => ({ yes: t('yes'), no: t('no'), file: t('file'), signed: t('signed') }), [t]);
  const [answers, setAnswers] = useState<Answers>({});
  const [current, setCurrent] = useState<string | null>(def.questions[0]?.id ?? null);
  const [screen, setScreen] = useState<Screen>(() => (props.closedReason ? 'closed' : def.welcome.enabled ? 'welcome' : 'question'));
  const [errors, setErrors] = useState<Record<string, AnswerError | 'upload'>>({});
  const [consent, setConsent] = useState(false);
  const [partialOk, setPartialOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [ending, setEnding] = useState<{ id: string; vars: Record<string, number> } | null>(null);
  const [honeypot, setHoneypot] = useState('');
  const [announce, setAnnounce] = useState('');
  const renderToken = useRef(props.renderToken ?? '');
  const lastDigit = useRef<{ key: string; at: number } | null>(null);
  const visitId = useRef('');
  const partialToken = useRef<string | undefined>(undefined);
  const seen = useRef(new Set<string>());
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const state = useMemo(() => computePath(def, answers, props.hidden), [def, answers, props.hidden]);
  const qById = useMemo(() => new Map(def.questions.map((q) => [q.id, q])), [def]);
  const pos = current ? state.path.indexOf(current) : -1;
  const conversational = settings.mode === 'conversational';

  // Al montar: visita, tiempo y si hay progreso guardado en este navegador.
  useEffect(() => {
    visitId.current = newVisitId();
    if (props.closedReason || preview) return;
    if (settings.resume) {
      const saved = readSaved(slug);
      if (saved) setScreen('resume');
    }
  }, [slug, settings.resume, props.closedReason, preview]);

  // Visitas por pregunta (abandono). Sin respuestas.
  useEffect(() => {
    if (preview || props.closedReason || screen !== 'question') return;
    const qid = conversational ? current : (state.path[0] ?? null);
    const key = qid ?? '__start';
    if (seen.current.has(key)) return;
    seen.current.add(key);
    void fetch('/api/forms/public/visit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, visit: visitId.current, question: qid }), keepalive: true }).catch(() => null);
  }, [screen, current, conversational, state.path, slug, preview, props.closedReason]);

  // Guardar el progreso en el navegador (y parcial en el servidor si quien responde aceptó).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (preview || screen === 'ending' || screen === 'closed' || screen === 'resume' || !Object.keys(answers).length) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (settings.resume) {
        try {
          window.localStorage.setItem(storeKey(slug), JSON.stringify({ answers, at: new Date().toISOString(), partialToken: partialToken.current }));
        } catch {
          /* sin storage: no se retoma */
        }
      }
      if (settings.partials && partialOk) {
        void fetch('/api/forms/public/partial', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug, token: partialToken.current, answers, hidden: props.hidden, lang: props.lang, consent: true }),
        })
          .then((r) => r.json())
          .then((d: { token?: string | null }) => {
            if (d.token) partialToken.current = d.token;
          })
          .catch(() => null);
      }
    }, 600);
  }, [answers, screen, slug, settings.resume, settings.partials, partialOk, preview, props.hidden, props.lang]);

  // Popup del embed: Esc (también con el foco dentro del iframe) le pide a la página que lo cierre.
  useEffect(() => {
    if (!props.popup || window.parent === window) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.parent.postMessage({ type: 'zs-form:close', form: slug }, '*');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.popup, slug]);

  // Alto en embed (el script del embed ajusta el iframe).
  useEffect(() => {
    if (!embed || window.parent === window) return;
    const post = () => window.parent.postMessage({ type: 'zs-form:height', height: Math.ceil(document.documentElement.scrollHeight) + 4 }, '*');
    post();
    const ro = new ResizeObserver(post);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, [embed, screen]);

  // El foco va al título de cada pantalla nueva (lectores de pantalla y teclado).
  useEffect(() => {
    if (screen === 'question' && conversational) {
      const el = rootRef.current?.querySelector<HTMLElement>('[data-autofocus]');
      (el ?? headingRef.current)?.focus({ preventScroll: false });
    } else headingRef.current?.focus();
  }, [screen, current, conversational]);

  const setAnswer = useCallback((qid: string, v: AnswerValue | undefined) => {
    setAnswers((prev) => {
      const next = { ...prev };
      if (v === undefined || isEmptyAnswer(v)) delete next[qid];
      else next[qid] = v;
      return next;
    });
    setErrors((e) => {
      if (!e[qid]) return e;
      const n = { ...e };
      delete n[qid];
      return n;
    });
  }, []);

  const validateOne = (q: Question): AnswerError | null => {
    const r = checkAnswer(q, answers[q.id]);
    return r.error ?? null;
  };

  /**
   * Envía. Si el servidor dice too_fast (el tiempo mínimo desde el render no
   * pasó, o la marca venció), espera lo que falta y reintenta una vez con la
   * marca que devolvió. El progreso guardado en el navegador solo se borra
   * cuando la respuesta quedó guardada.
   */
  async function submit(override?: Answers) {
    if (busy) return;
    const sending = override ?? answers;
    if (preview) {
      const p = computePath(def, sending, props.hidden);
      setEnding({ id: p.endingId, vars: p.vars });
      setScreen('ending');
      return;
    }
    setBusy(true);
    setSubmitError('');
    type Reply = { ok?: boolean; error?: string; reason?: string; errors?: Record<string, AnswerError>; endingId?: string; vars?: Record<string, number>; waitMs?: number; renderToken?: string };
    const post = async () => {
      const res = await fetch('/api/forms/public/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug,
          answers: sending,
          hidden: props.hidden,
          lang: props.lang,
          consent,
          website_url: honeypot,
          renderToken: renderToken.current,
          resumeToken: partialToken.current,
          visitId: visitId.current,
        }),
      }).catch(() => null);
      const data = res ? ((await res.json().catch(() => null)) as Reply | null) : null;
      return { res, data };
    };
    let { res, data } = await post();
    if (data?.error === 'too_fast') {
      if (data.renderToken) renderToken.current = data.renderToken;
      await new Promise((r) => setTimeout(r, Math.min(Math.max(data?.waitMs ?? 2000, 0), 10_000) + 100));
      ({ res, data } = await post());
    }
    setBusy(false);
    if (res?.ok && data?.ok) {
      try {
        window.localStorage.removeItem(storeKey(slug));
      } catch {
        /* nada */
      }
      const end = def.endings.find((e) => e.id === data?.endingId) ?? def.endings[0];
      setEnding({ id: end?.id ?? '', vars: data.vars ?? {} });
      setScreen('ending');
      if (embed && window.parent !== window) window.parent.postMessage({ type: 'zs-form:submitted', form: slug, redirectUrl: end?.redirectUrl ?? '' }, '*');
      else if (end?.redirectUrl && /^https:\/\//i.test(end.redirectUrl)) setTimeout(() => window.location.assign(end.redirectUrl!), 1500);
      return;
    }
    if (data?.error === 'invalid' && data.errors && Object.keys(data.errors).length) {
      setErrors(data.errors);
      const first = state.path.find((id) => data?.errors?.[id]);
      if (first && conversational) {
        setCurrent(first);
        setScreen('question');
      }
      setSubmitError(t('fixErrors'));
      return;
    }
    if (data?.error === 'closed') {
      setScreen('closed');
      return;
    }
    setSubmitError(data?.error === 'consent' ? t('consentRequired') : data?.error === 'ip_limit' ? t('ipLimit') : res?.status === 429 ? t('tooMany') : t('submitError'));
  }

  /** Avanza desde la pregunta actual (valida, sigue la lógica). */
  function next() {
    if (!current) {
      void finish();
      return;
    }
    const q = qById.get(current);
    if (!q) return;
    // Ranking sin tocar: el orden que se ve es la respuesta (también si es la última pregunta).
    let effective = answers;
    if (q.type === 'ranking' && answers[q.id] === undefined && q.required) {
      effective = { ...answers, [q.id]: (q.choices ?? []).map((c) => c.id) };
      setAnswer(q.id, effective[q.id]);
    }
    const err = checkAnswer(q, effective[q.id]).error ?? null;
    if (err) {
      setErrors((e) => ({ ...e, [q.id]: err }));
      setAnnounce(t(`errors.${err}`));
      return;
    }
    const path = effective === answers ? state.path : computePath(def, effective, props.hidden).path;
    const nextId = path[path.indexOf(q.id) + 1];
    if (nextId) {
      setCurrent(nextId);
      setAnnounce('');
    } else void finish(effective);
  }

  function back() {
    if (pos > 0) setCurrent(state.path[pos - 1]);
    else if (def.welcome.enabled) setScreen('welcome');
  }

  async function finish(override?: Answers) {
    if (def.consent.enabled && screen !== 'consent') {
      setScreen('consent');
      return;
    }
    if (def.consent.enabled && def.consent.required && !consent) {
      setSubmitError(t('consentRequired'));
      return;
    }
    await submit(override);
  }

  function onClassicSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, AnswerError> = {};
    for (const id of state.path) {
      const q = qById.get(id)!;
      const err = validateOne(q);
      if (err) errs[id] = err;
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      setSubmitError(t('fixErrors'));
      rootRef.current?.querySelector<HTMLElement>(`[data-q="${Object.keys(errs)[0]}"] [data-autofocus], [data-q="${Object.keys(errs)[0]}"] input, [data-q="${Object.keys(errs)[0]}"] button`)?.focus();
      return;
    }
    if (def.consent.enabled && def.consent.required && !consent) {
      setSubmitError(t('consentRequired'));
      return;
    }
    void submit();
  }

  /** Teclado de la pantalla de a una: Enter avanza; letras, S/N y números eligen. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (screen !== 'question' || !conversational || !current) return;
    const q = qById.get(current);
    if (!q) return;
    const target = e.target as HTMLElement;
    const typing = target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && !['radio', 'checkbox', 'button', 'file'].includes((target as HTMLInputElement).type)) || target.tagName === 'SELECT' || target.isContentEditable;
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (target.tagName === 'BUTTON' || target.tagName === 'A' || (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'file')) return;
      if (target.tagName === 'TEXTAREA' && q.type === 'long_text' && e.shiftKey) return;
      e.preventDefault();
      next();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
    const k = e.key.toUpperCase();
    if (q.type === 'yes_no' && (k === 'Y' || k === 'N' || k === 'S')) {
      e.preventDefault();
      setAnswer(q.id, k !== 'N');
      return;
    }
    if ((q.type === 'choice' || q.type === 'multi_choice') && q.choices) {
      const i = LETTERS.indexOf(k);
      const c = q.choices[i];
      if (!c) return;
      e.preventDefault();
      if (q.type === 'choice') setAnswer(q.id, c.id);
      else {
        const cur = (answers[q.id] as string[] | undefined) ?? [];
        setAnswer(q.id, cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id]);
      }
      return;
    }
    if ((q.type === 'rating' || q.type === 'opinion_scale') && /^[0-9]$/.test(k)) {
      e.preventDefault();
      const lo = q.type === 'rating' ? 1 : q.nps ? 0 : (q.start ?? 1);
      const steps = q.type === 'opinion_scale' && q.nps ? 11 : (q.steps ?? 5);
      const hi = lo + steps - 1;
      // 10 en escalas que llegan a 10: "1" y "0" seguidos (antes de 800 ms).
      const prev = lastDigit.current;
      lastDigit.current = { key: k, at: Date.now() };
      let n = Number(k);
      if (prev && prev.key === '1' && k === '0' && Date.now() - prev.at < 800 && hi >= 10) n = 10;
      else if (k === '0' && lo > 0 && hi >= 10) n = 10;
      if (n >= lo && n <= hi) setAnswer(q.id, n);
    }
  }

  const theme = settings.theme;
  const style = {
    '--fr-bg': theme.background,
    '--fr-fg': theme.text,
    '--fr-accent': theme.accent,
    '--fr-on-accent': theme.onAccent,
  } as CSSProperties;
  const piped = (s: string) => pipe(s, def, { answers, vars: ending?.vars ?? state.vars, hidden: props.hidden, labels });
  const progress = state.path.length ? Math.round(((screen === 'ending' ? state.path.length : Math.max(0, pos)) / state.path.length) * 100) : 0;

  const langSwitch = props.languages.length > 1 && (
    <nav className="fr-langs" aria-label={t('language')}>
      {props.languages.map((l) => (
        <a key={l} href={`/${l}/f/${slug}${typeof window === 'undefined' ? '' : window.location.search}`} aria-current={l === props.lang ? 'true' : undefined} lang={l}>
          {l.toUpperCase()}
        </a>
      ))}
    </nav>
  );

  const honey = (
    <div className="fr-hp" aria-hidden="true">
      <label>
        Website
        <input type="text" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} name="website_url" />
      </label>
    </div>
  );

  const partialConsent = settings.partials && !preview && (
    <label className="fr-check fr-partial">
      <input type="checkbox" checked={partialOk} onChange={(e) => setPartialOk(e.target.checked)} />
      <span>{t('partialConsent')}</span>
    </label>
  );

  const renderQuestion = (q: Question, num: number, inClassic: boolean) => {
    const err = errors[q.id];
    const hid = `fr-q-${q.id}`;
    return (
      <section key={q.id} className="fr-question" data-q={q.id} aria-labelledby={`${hid}-t`}>
        <h2 id={`${hid}-t`} className="fr-q-title" ref={!inClassic ? headingRef : undefined} tabIndex={-1}>
          {q.type !== 'statement' && <span className="fr-q-num" aria-hidden="true">{num}→</span>}
          <span>{piped(q.title) || t('untitled')}</span>
          {q.required && q.type !== 'statement' && <span className="fr-req" aria-label={t('required')}>*</span>}
        </h2>
        {q.description && <p className="fr-q-desc" id={`${hid}-d`}>{piped(q.description)}</p>}
        <QuestionInput
          q={q}
          value={answers[q.id]}
          onChange={(v) => setAnswer(q.id, v)}
          slug={slug}
          preview={Boolean(preview)}
          describedBy={[q.description ? `${hid}-d` : '', err ? `${hid}-e` : ''].filter(Boolean).join(' ') || undefined}
          invalid={Boolean(err)}
          autoFocus={!inClassic}
          onUploadError={(code) => setErrors((e) => ({ ...e, [q.id]: code === 'file_type' ? 'invalid' : 'upload' }))}
          onEnter={() => (!inClassic ? next() : undefined)}
        />
        {err && (
          <p className="fr-error" id={`${hid}-e`} role="alert">
            {err === 'upload' ? t('uploadError') : t(`errors.${err}`)}
          </p>
        )}
        {!inClassic && (
          <div className="fr-actions">
            <button type="button" className="fr-btn" onClick={next} disabled={busy}>
              {q.type === 'statement' ? q.button || t('continue') : pos === state.path.length - 1 && !def.consent.enabled ? t('submit') : t('ok')}
            </button>
            <span className="fr-hint" aria-hidden="true">
              {q.type === 'long_text' ? t('hintShiftEnter') : q.type === 'opinion_scale' && (q.nps || (q.start ?? 1) + (q.steps ?? 5) - 1 >= 10) ? t('hintTen') : t('hintEnter')}
            </span>
          </div>
        )}
      </section>
    );
  };

  let body: React.ReactNode;
  if (screen === 'closed') {
    body = (
      <div className="fr-screen">
        <h1 className="fr-title" tabIndex={-1} ref={headingRef}>
          {settings.closedMessage || t(props.closedReason === 'limit' ? 'closedLimit' : 'closed')}
        </h1>
      </div>
    );
  } else if (screen === 'resume') {
    body = (
      <div className="fr-screen">
        <h1 className="fr-title" tabIndex={-1} ref={headingRef}>
          {t('resumeTitle')}
        </h1>
        <p className="fr-desc">{t('resumeBody')}</p>
        <div className="fr-actions">
          <button
            type="button"
            className="fr-btn"
            onClick={() => {
              const saved = readSaved(slug);
              if (saved) {
                setAnswers(saved.answers);
                partialToken.current = saved.partialToken;
                const p = computePath(def, saved.answers, props.hidden).path;
                setCurrent(p.find((id) => isEmptyAnswer(saved.answers[id])) ?? p[p.length - 1] ?? null);
              }
              setScreen('question');
            }}
          >
            {t('resumeContinue')}
          </button>
          <button
            type="button"
            className="fr-btn fr-btn-ghost"
            onClick={() => {
              try {
                window.localStorage.removeItem(storeKey(slug));
              } catch {
                /* nada */
              }
              setScreen(def.welcome.enabled ? 'welcome' : 'question');
            }}
          >
            {t('resumeRestart')}
          </button>
        </div>
      </div>
    );
  } else if (screen === 'welcome') {
    body = (
      <div className="fr-screen">
        <h1 className="fr-title" tabIndex={-1} ref={headingRef}>
          {piped(def.welcome.title)}
        </h1>
        {def.welcome.description && <p className="fr-desc">{piped(def.welcome.description)}</p>}
        {partialConsent}
        <div className="fr-actions">
          <button type="button" className="fr-btn" onClick={() => setScreen('question')} data-autofocus>
            {def.welcome.button || t('start')}
          </button>
          <span className="fr-hint" aria-hidden="true">
            {t('hintEnter')}
          </span>
        </div>
      </div>
    );
  } else if (screen === 'ending') {
    const end = def.endings.find((e) => e.id === ending?.id) ?? def.endings[0];
    body = (
      <div className="fr-screen" role="status">
        <h1 className="fr-title" tabIndex={-1} ref={headingRef}>
          {piped(end?.title ?? '') || t('thanks')}
        </h1>
        {end?.description && <p className="fr-desc">{piped(end.description)}</p>}
        {end?.redirectUrl && !embed && (
          <p className="fr-desc">
            <a href={end.redirectUrl} rel="noopener noreferrer">
              {end.button || t('continue')}
            </a>
          </p>
        )}
      </div>
    );
  } else if (screen === 'consent') {
    body = (
      <div className="fr-screen">
        <h1 className="fr-title" tabIndex={-1} ref={headingRef}>
          {t('almostDone')}
        </h1>
        <label className="fr-check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-autofocus />
          <span>{def.consent.text}</span>
        </label>
        {honey}
        <div className="fr-actions">
          <button type="button" className="fr-btn" onClick={() => void finish()} disabled={busy}>
            {busy ? t('sending') : t('submit')}
          </button>
          <button type="button" className="fr-btn fr-btn-ghost" onClick={() => setScreen('question')}>
            {t('back')}
          </button>
        </div>
        {submitError && (
          <p className="fr-error" role="alert">
            {submitError}
          </p>
        )}
      </div>
    );
  } else if (!def.questions.length) {
    body = (
      <div className="fr-screen">
        <h1 className="fr-title" tabIndex={-1} ref={headingRef}>
          {t('empty')}
        </h1>
      </div>
    );
  } else if (conversational) {
    const q = current ? qById.get(current) : undefined;
    body = (
      <div className="fr-screen" key={current ?? 'none'}>
        {pos === 0 && !def.welcome.enabled && partialConsent}
        {q && renderQuestion(q, pos + 1, false)}
        {honey}
        {submitError && (
          <p className="fr-error" role="alert">
            {submitError}
          </p>
        )}
        <div className="fr-nav">
          <button type="button" className="fr-nav-btn" onClick={back} disabled={pos <= 0 && !def.welcome.enabled} aria-label={t('previous')}>
            ↑
          </button>
          <button type="button" className="fr-nav-btn" onClick={next} aria-label={t('nextQuestion')}>
            ↓
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <form className="fr-classic" onSubmit={onClassicSubmit} noValidate>
        {partialConsent}
        {state.path.map((id, i) => renderQuestion(qById.get(id)!, i + 1, true))}
        {def.consent.enabled && (
          <label className="fr-check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{def.consent.text}</span>
          </label>
        )}
        {honey}
        <div className="fr-actions">
          <button type="submit" className="fr-btn" disabled={busy}>
            {busy ? t('sending') : t('submit')}
          </button>
        </div>
        {submitError && (
          <p className="fr-error" role="alert">
            {submitError}
          </p>
        )}
      </form>
    );
  }

  return (
    <div ref={rootRef} className={`fr fr-font-${theme.font}${embed ? ' fr-embed' : ''}${conversational ? ' fr-conv' : ' fr-flat'}`} style={style} onKeyDown={onKeyDown} lang={props.lang}>
      {settings.progressBar && screen === 'question' && conversational && (
        <div className="fr-progress" role="progressbar" aria-label={t('progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
      {preview && <p className="fr-preview-tag">{t('previewTag')}</p>}
      {langSwitch}
      <main className="fr-main">{body}</main>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

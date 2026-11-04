'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ViewerDoc, ViewerState } from '@/lib/send/viewer';

const PING_EVERY_MS = 5000;
const IDLE_MS = 120_000;

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, status: 0, data: { error: 'network' } };
  }
}

/** Blanco o tinta, lo que se lea sobre el color de la marca. */
function onColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff';
}

/** La página pública de un link: pasos de acceso, visor y tiempo por página. */
export default function SendViewer({ token, initial }: { token: string; initial: ViewerState }) {
  const [state, setState] = useState<ViewerState>(initial);
  const api = `/api/send/public/${token}`;
  const refresh = useCallback(async () => {
    const res = await fetch(api).catch(() => null);
    if (res?.status === 404) return setState((s) => ({ state: 'closed', reason: 'disabled', brand: s.brand }));
    if (res?.ok) setState((await res.json()) as ViewerState);
  }, [api]);

  // Un link sin pasos abre la sesión con un POST del navegador: el GET no crea nada.
  useEffect(() => {
    if (state.state !== 'start') return;
    void postJson(api, {}).then((r) => {
      if (r.ok) setState(r.data as unknown as ViewerState);
    });
  }, [api, state.state]);

  // Un link cortado cierra también una pestaña oculta o quieta: se vuelve a mirar cada 20 s y al volver a la pestaña.
  useEffect(() => {
    if (state.state !== 'open') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const h = window.setInterval(() => void refresh(), 20_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(h);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, state.state]);

  const brandStyle = useMemo<CSSProperties>(() => (state.brand.color ? ({ '--accent': state.brand.color, '--sv-on': onColor(state.brand.color) } as CSSProperties) : {}), [state.brand.color]);

  return (
    <div className="sv-root" style={brandStyle}>
      {state.state === 'start' ? (
        <main className="sv-gate" aria-busy="true" data-testid="sv-start">
          <span className="ui-skeleton ui-skeleton-row sv-start" />
        </main>
      ) : state.state === 'closed' ? <Closed reason={state.reason} state={state} /> : state.state === 'gate' ? <Gate api={api} state={state} onState={setState} /> : <Reader api={api} state={state} refresh={refresh} />}
    </div>
  );
}

function Brand({ state }: { state: ViewerState }) {
  const b = state.brand;
  const inner = b.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="sv-logo" src={b.logoUrl} alt={b.name || ''} referrerPolicy="no-referrer" />
  ) : b.name ? (
    <strong className="sv-brandname">{b.name}</strong>
  ) : null;
  if (!inner) return null;
  return b.siteUrl ? (
    <a href={b.siteUrl} target="_blank" rel="noreferrer noopener" className="sv-brand">
      {inner}
    </a>
  ) : (
    <span className="sv-brand">{inner}</span>
  );
}

function Closed({ reason, state }: { reason: 'disabled' | 'expired' | 'unavailable'; state: ViewerState }) {
  const t = useTranslations('send.viewer');
  return (
    <main className="sv-gate" data-testid="sv-closed" data-reason={reason}>
      <div className="sv-card">
        <Brand state={state} />
        <h1>{reason === 'expired' ? t('expiredTitle') : reason === 'unavailable' ? t('unavailableTitle') : t('disabledTitle')}</h1>
        <p>{t('closedBody')}</p>
      </div>
    </main>
  );
}

function Gate({ api, state, onState }: { api: string; state: Extract<ViewerState, { state: 'gate' }>; onState: (s: ViewerState) => void }) {
  const t = useTranslations('send.viewer');
  const te = useTranslations('send.errors');
  const locale = useLocale();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const errorOf = (code: unknown) => {
    const k = typeof code === 'string' ? code : 'generic';
    return te.has(k) ? te(k) : te('generic');
  };

  const sendCode = useCallback(async () => {
    setBusy(true);
    setError('');
    const r = await postJson(`${api}/code`, { action: 'send', locale });
    setBusy(false);
    if (r.ok) setSent(true);
    else setError(errorOf(r.data.error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, locale]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    const body = state.step === 'passcode' ? { passcode: value } : state.step === 'email' ? { email: value } : null;
    const r = state.step === 'verify' ? await postJson(`${api}/code`, { action: 'verify', code: value }) : await postJson(api, body);
    setBusy(false);
    if (!r.ok) return setError(errorOf(r.data.error));
    setValue('');
    onState(r.data as unknown as ViewerState);
  };

  const back = async () => {
    const r = await postJson(api, { resetEmail: true });
    if (r.ok) {
      setValue('');
      setError('');
      setSent(false);
      onState(r.data as unknown as ViewerState);
    }
  };

  // Al llegar al paso de código, se manda solo una vez.
  useEffect(() => {
    if (state.step === 'verify' && !sent) void sendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step]);

  if (state.step === 'denied') {
    return (
      <main className="sv-gate" data-testid="sv-denied">
        <div className="sv-card">
          <Brand state={state} />
          <h1>{t('deniedTitle')}</h1>
          <p>{t('deniedBody', { email: state.email ?? '' })}</p>
          <button type="button" className="btn btn-secondary" onClick={back} data-testid="sv-other-email">
            {t('otherEmail')}
          </button>
        </div>
      </main>
    );
  }

  if (state.step === 'nda') {
    return <NdaGate api={api} state={state} onState={onState} back={back} />;
  }

  const copy = {
    passcode: { title: t('passcodeTitle'), body: t('passcodeBody'), label: t('passcodeLabel'), type: 'password', auto: 'off', cta: t('continue') },
    email: { title: t('emailTitle'), body: state.needsVerify ? t('emailBodyVerify') : t('emailBody'), label: t('emailLabel'), type: 'email', auto: 'email', cta: t('continue') },
    verify: { title: t('verifyTitle'), body: sent ? t('verifyBody', { email: state.email ?? '' }) : t('verifySending'), label: t('codeLabel'), type: 'text', auto: 'one-time-code', cta: t('verifyCta') },
  }[state.step];

  return (
    <main className="sv-gate" data-testid={`sv-gate-${state.step}`}>
      <form className="sv-card" onSubmit={submit}>
        <Brand state={state} />
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        <label className="sv-field">
          <span>{copy.label}</span>
          <input
            className="input"
            type={copy.type}
            inputMode={state.step === 'verify' ? 'numeric' : undefined}
            autoComplete={copy.auto}
            value={value}
            maxLength={state.step === 'email' ? 254 : 100}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            required
            data-testid="sv-input"
          />
        </label>
        {error && (
          <p className="sd-error" role="alert" data-testid="sv-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary sv-submit" disabled={busy} data-testid="sv-submit">
          {copy.cta}
        </button>
        {state.step === 'verify' && (
          <div className="sv-links">
            <button type="button" className="sv-link" onClick={sendCode} disabled={busy} data-testid="sv-resend">
              {t('resend')}
            </button>
            <button type="button" className="sv-link" onClick={back}>
              {t('otherEmail')}
            </button>
          </div>
        )}
        <p className="sv-fine">{t('trackingNotice')}</p>
      </form>
    </main>
  );
}

function NdaGate({ api, state, onState, back }: { api: string; state: Extract<ViewerState, { state: 'gate' }>; onState: (s: ViewerState) => void; back: () => void }) {
  const t = useTranslations('send.viewer');
  const te = useTranslations('send.errors');
  const locale = useLocale();
  const [signUrl, setSignUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    const r = await postJson(`${api}/nda`, { action: 'check' });
    if (r.ok && (r.data as { state?: string }).state) onState(r.data as unknown as ViewerState);
  }, [api, onState]);

  useEffect(() => {
    if (!signUrl) return;
    const h = window.setInterval(check, 4000);
    return () => window.clearInterval(h);
  }, [signUrl, check]);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await postJson(`${api}/nda`, { action: 'start', name, locale });
    setBusy(false);
    if (!r.ok) {
      const k = String(r.data.error ?? 'generic');
      return setError(te.has(k) ? te(k) : te('generic'));
    }
    const url = String(r.data.signUrl ?? '');
    setSignUrl(url);
    window.open(url, '_blank', 'noopener');
  };

  return (
    <main className="sv-gate" data-testid="sv-gate-nda">
      <form className="sv-card" onSubmit={start}>
        <Brand state={state} />
        <h1>{t('ndaTitle')}</h1>
        <p>{signUrl ? t('ndaWaiting') : t('ndaBody')}</p>
        {signUrl ? (
          <>
            <a className="btn btn-primary sv-submit" href={signUrl} target="_blank" rel="noopener noreferrer" data-testid="sv-nda-open">
              {t('ndaOpen')}
            </a>
            <button type="button" className="sv-link" onClick={check} data-testid="sv-nda-check">
              {t('ndaCheck')}
            </button>
          </>
        ) : (
          <>
            <label className="sv-field">
              <span>{t('ndaName')}</span>
              <input className="input" value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} data-testid="sv-nda-name" autoFocus />
            </label>
            {error && (
              <p className="sd-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary sv-submit" disabled={busy} data-testid="sv-nda-start">
              {t('ndaStart')}
            </button>
            <button type="button" className="sv-link" onClick={back}>
              {t('otherEmail')}
            </button>
          </>
        )}
      </form>
    </main>
  );
}

// ---------- Visor ----------

function Reader({ api, state, refresh }: { api: string; state: Extract<ViewerState, { state: 'open' }>; refresh: () => Promise<void> }) {
  const t = useTranslations('send.viewer');
  const [activeId, setActiveId] = useState<string | null>(state.space ? null : (state.documents[0]?.id ?? null));
  const doc = state.documents.find((d) => d.id === activeId) ?? null;

  if (!state.documents.length) {
    return (
      <main className="sv-gate" data-testid="sv-empty">
        <div className="sv-card">
          <Brand state={state} />
          <h1>{t('emptyTitle')}</h1>
          <p>{t('emptyBody')}</p>
        </div>
      </main>
    );
  }

  if (!doc) {
    const folders = [...new Set(state.documents.map((d) => d.folder))];
    return (
      <main className="sv-space" data-testid="sv-space">
        <header className="sv-space-head">
          <Brand state={state} />
          <h1>{state.space?.title}</h1>
          {state.space?.description && <p>{state.space.description}</p>}
          {state.message && <p className="sv-message">{state.message}</p>}
        </header>
        {folders.map((f) => (
          <section key={f} className="sv-space-group">
            {f && <h2>{f}</h2>}
            <ul>
              {state.documents
                .filter((d) => d.folder === f)
                .map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => setActiveId(d.id)} data-testid="sv-space-doc">
                      <strong>{d.title}</strong>
                      <span>{d.kind === 'video' ? t('videoLabel') : t('pagesLabel', { count: d.pageCount })}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
        <p className="sv-fine sv-foot">{t('trackingNotice')}</p>
      </main>
    );
  }

  return <DocView key={`${doc.id}:${doc.versionId}`} api={api} doc={doc} state={state} onBack={state.space ? () => setActiveId(null) : null} refresh={refresh} />;
}

function DocView({ api, doc, state, onBack, refresh }: { api: string; doc: ViewerDoc; state: Extract<ViewerState, { state: 'open' }>; onBack: (() => void) | null; refresh: () => Promise<void> }) {
  const t = useTranslations('send.viewer');
  const te = useTranslations('send.errors');
  const [page, setPage] = useState(1);
  const pageRef = useRef(1);
  const pending = useRef(new Map<number, number>());
  const lastInput = useRef(Date.now());
  const sending = useRef(false);
  const counted = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [downloading, setDownloading] = useState('');
  const [fatal, setFatal] = useState('');

  const isVideo = doc.kind === 'video';

  const payload = useCallback(() => {
    const deltas = [...pending.current.entries()].map(([p, seconds]) => ({ page: p, seconds: Math.round(seconds * 10) / 10 }));
    return { documentId: doc.id, versionId: doc.versionId, webdriver: navigator.webdriver === true, deltas };
  }, [doc.id, doc.versionId]);

  const flush = useCallback(async () => {
    if (sending.current) return;
    const body = payload();
    const total = body.deltas.reduce((n, d) => n + d.seconds, 0);
    // Antes de 3 s visibles no hay visita: lo primero que manda el navegador ya pasó ese umbral.
    if (total <= 0 || (!counted.current && total < 3)) return;
    sending.current = true;
    const r = await postJson(`${api}/ping`, body);
    sending.current = false;
    // Sin contar todavía (por ejemplo, la imagen no terminó de pedirse): se guarda para el próximo aviso.
    if (r.ok && (r.data.counted || counted.current)) {
      // Se saca lo que se mandó, no lo que se sumó mientras tanto.
      for (const d of body.deltas) {
        const left = (pending.current.get(d.page) ?? 0) - d.seconds;
        if (left > 0.01) pending.current.set(d.page, left);
        else pending.current.delete(d.page);
      }
      if (r.data.counted) counted.current = true;
    } else if (r.ok) {
      // Nada.
    } else if (r.status === 410 || r.status === 401 || r.status === 409 || r.status === 404) {
      await refresh();
    }
  }, [api, payload, refresh]);

  // Cuenta segundos en la página que se ve, solo con la pestaña visible y alguien presente.
  useEffect(() => {
    let last = performance.now();
    const tick = window.setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastInput.current > IDLE_MS && !(isVideo && videoRef.current && !videoRef.current.paused)) return;
      if (isVideo) {
        const v = videoRef.current;
        if (!v || v.paused || v.ended) return;
        const bucket = doc.bucketSec ?? 10;
        const p = Math.min(doc.pageCount || 1, Math.floor(v.currentTime / bucket) + 1);
        pending.current.set(p, (pending.current.get(p) ?? 0) + dt);
        return;
      }
      const p = pageRef.current;
      pending.current.set(p, (pending.current.get(p) ?? 0) + dt);
    }, 500);
    const ping = window.setInterval(() => void flush(), PING_EVERY_MS);
    // Primer aviso a los 3,5 s, para que "leyendo ahora" no tarde.
    const first = window.setTimeout(() => void flush(), 3500);
    const beacon = () => {
      const body = payload();
      const total = body.deltas.reduce((n, d) => n + d.seconds, 0);
      if (total <= 0 || (!counted.current && total < 3)) return;
      if (navigator.sendBeacon?.(`${api}/ping`, JSON.stringify(body))) pending.current.clear();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') beacon();
    };
    const onInput = () => {
      lastInput.current = Date.now();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', beacon);
    for (const ev of ['scroll', 'keydown', 'pointermove', 'pointerdown', 'touchstart', 'wheel']) window.addEventListener(ev, onInput, { passive: true, capture: true });
    return () => {
      window.clearInterval(tick);
      window.clearInterval(ping);
      window.clearTimeout(first);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', beacon);
      for (const ev of ['scroll', 'keydown', 'pointermove', 'pointerdown', 'touchstart', 'wheel']) window.removeEventListener(ev, onInput, { capture: true });
      beacon();
    };
  }, [api, doc.bucketSec, doc.pageCount, flush, isVideo, payload]);

  // La página actual es la que ocupa más lugar en la pantalla.
  useEffect(() => {
    if (isVideo) return;
    const ratios = new Map<number, number>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(Number((e.target as HTMLElement).dataset.page), e.intersectionRect.height);
        let best = pageRef.current;
        let bestH = -1;
        for (const [p, h] of ratios) {
          if (h > bestH) {
            best = p;
            bestH = h;
          }
        }
        if (bestH > 0 && best !== pageRef.current) {
          pageRef.current = best;
          setPage(best);
        }
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    rootRef.current?.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [isVideo, doc.versionId]);

  const goTo = (p: number) => {
    const next = Math.max(1, Math.min(doc.pages.length, p));
    rootRef.current?.querySelector(`[data-page="${next}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Teclado: flechas y página arriba/abajo.
  useEffect(() => {
    if (isVideo) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        goTo(pageRef.current + 1);
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goTo(pageRef.current - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideo, doc.pages.length]);

  const download = async () => {
    setDownloading(t('downloading'));
    try {
      const blobs: Blob[] = [];
      let piece = 0;
      let pieces = 1;
      let name = doc.title;
      let mime = 'application/octet-stream';
      while (piece < pieces) {
        const res = await fetch(`${api}/download?document=${encodeURIComponent(doc.id)}&piece=${piece}`);
        if (!res.ok) {
          if (res.status === 410 || res.status === 401) await refresh();
          const code = String(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'generic');
          throw new Error(te.has(code) ? te(code) : te('generic'));
        }
        pieces = Number(res.headers.get('x-send-pieces')) || 1;
        name = decodeURIComponent(res.headers.get('x-send-name') ?? name);
        mime = res.headers.get('x-send-mime') ?? mime;
        blobs.push(await res.blob());
        piece++;
      }
      const url = URL.createObjectURL(new Blob(blobs, { type: mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setDownloading('');
    } catch (err) {
      setDownloading(err instanceof Error ? err.message : te('generic'));
    }
  };

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <div className="sv-reader" data-testid="sv-reader" data-kind={doc.kind}>
      <header className="sv-bar">
        <div className="sv-bar-left">
          {onBack && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} data-testid="sv-back">
              {t('back')}
            </button>
          )}
          <Brand state={state} />
          <span className="sv-title" title={doc.title}>
            {doc.title}
          </span>
        </div>
        <div className="sv-bar-right">
          {!isVideo && (
            <div className="sv-pager">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => goTo(page - 1)} disabled={page <= 1} aria-label={t('prevPage')} data-testid="sv-prev">
                ‹
              </button>
              <span className="num" data-testid="sv-page">
                {page} / {doc.pages.length}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => goTo(page + 1)} disabled={page >= doc.pages.length} aria-label={t('nextPage')} data-testid="sv-next">
                ›
              </button>
            </div>
          )}
          {doc.downloadable && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={download} data-testid="sv-download">
              {t('download')}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm sv-hide-sm" onClick={fullscreen}>
            {t('fullscreen')}
          </button>
        </div>
      </header>
      {downloading && (
        <p className="sv-status" role="status" data-testid="sv-download-status">
          {downloading}
        </p>
      )}
      {fatal && (
        <p className="sv-status" role="alert">
          {fatal}
        </p>
      )}
      <main className="sv-pages" ref={rootRef}>
        {state.message && !onBack && <p className="sv-message sv-message-top">{state.message}</p>}
        {isVideo ? (
          <div className="sv-video-wrap">
            <video
              ref={videoRef}
              className="sv-video"
              controls
              controlsList={doc.downloadable ? undefined : 'nodownload'}
              disablePictureInPicture={!doc.downloadable}
              preload="metadata"
              playsInline
              src={`${api}/video/${doc.versionId}`}
              onPause={() => void flush()}
              onError={() => setFatal(t('videoError'))}
              data-testid="sv-video"
            />
            {state.watermark && state.email && (
              <div className="sv-video-mark" aria-hidden="true">
                {state.email}
              </div>
            )}
          </div>
        ) : (
          doc.pages.map((p) => <PageImage key={p.page} api={api} documentId={doc.id} versionId={doc.versionId} page={p} refresh={refresh} onJump={goTo} />)
        )}
        <p className="sv-fine sv-foot">
          {t('trackingNotice')} {state.watermark ? t('watermarkNotice') : ''}
        </p>
      </main>
    </div>
  );
}

function PageImage({
  api,
  documentId,
  versionId,
  page,
  refresh,
  onJump,
}: {
  api: string;
  documentId: string;
  versionId: string;
  page: { page: number; width: number; height: number; links?: Array<{ x: number; y: number; w: number; h: number; url?: string; page?: number }> };
  refresh: () => Promise<void>;
  onJump: (page: number) => void;
}) {
  const t = useTranslations('send.viewer');
  // El clic se avisa sin esperar: la pestaña nueva se abre igual.
  const report = (index: number) => {
    const body = JSON.stringify({ documentId, versionId, page: page.page, index });
    if (!navigator.sendBeacon?.(`${api}/click`, body)) void fetch(`${api}/click`, { method: 'POST', body, keepalive: true }).catch(() => undefined);
  };
  const [nonce, setNonce] = useState(0);
  const [failed, setFailed] = useState(false);
  const src = `${api}/pages/${versionId}/${page.page}${nonce ? `?r=${nonce}` : ''}`;
  return (
    <figure className="sv-page" data-page={page.page} style={{ aspectRatio: `${page.width} / ${page.height}`, maxWidth: page.height > page.width ? 920 : 1280 }}>
      {failed ? (
        <div className="sv-page-error" role="alert">
          <p>{t('pageError')}</p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setFailed(false);
              setNonce(Date.now());
            }}
          >
            {t('retry')}
          </button>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={t('pageAlt', { page: page.page })}
          loading={page.page <= 2 ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
          onError={() => {
            setFailed(true);
            // El link pudo cortarse: el visor se cierra sin esperar el próximo aviso.
            void refresh();
          }}
        />
      )}
      {!failed &&
        (page.links ?? []).map((l, i) => {
          const style = { left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%` };
          return l.url ? (
            <a key={i} className="sv-plink" style={style} href={l.url} target="_blank" rel="noopener noreferrer nofollow" aria-label={t('linkTo', { url: l.url })} title={l.url} onClick={() => report(i)} data-testid="sv-page-link" />
          ) : (
            <button
              key={i}
              type="button"
              className="sv-plink"
              style={style}
              aria-label={t('linkToPage', { page: l.page ?? 1 })}
              onClick={() => {
                report(i);
                onJump(l.page ?? 1);
              }}
              data-testid="sv-page-jump"
            />
          );
        })}
    </figure>
  );
}

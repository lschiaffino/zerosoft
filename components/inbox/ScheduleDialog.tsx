'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { presetDate, SNOOZE_PRESETS, type ScheduledDto, type SnoozePreset } from '@/lib/inbox/types';
import { visiblePresets } from '@/lib/when-presets';
import { api, localInputValue, longWhen, typingIn } from './api';
import { Modal } from './InboxDialogs';

export interface PartMedia {
  url: string;
  name: string;
  type: string;
  /** Nota de voz grabada (sale como nota de voz), con sus segundos. */
  voice?: boolean;
  duration?: number;
}

interface Part {
  key: string;
  body: string;
  delaySec: number;
  media: PartMedia | null;
  uploading: boolean;
}

export interface ScheduleTarget {
  threadId: string;
  channel: 'whatsapp' | 'gmail';
  /** Texto del campo (primer mensaje) al programar uno nuevo. */
  text?: string;
  /** Editar lo que falta de una secuencia programada. */
  edit?: ScheduledDto[];
}

/** Esperas que se ofrecen entre un mensaje y el siguiente, en segundos. */
export const DELAYS = [0, 5, 30, 60, 300, 1800, 3600, 86_400] as const;

let uploadMode: Promise<{ mode: 'blob' | 'server'; maxMedia: number }> | null = null;

/**
 * Sube el archivo de un mensaje programado: directo a Vercel Blob si está
 * (el archivo no pasa por la función) o por /api/inbox/upload.
 */
export async function uploadInboxFile(file: File): Promise<PartMedia> {
  uploadMode ??= fetch('/api/inbox/upload')
    .then((r) => (r.ok ? r.json() : { mode: 'server', maxMedia: 16 * 1024 * 1024 }))
    .catch(() => ({ mode: 'server', maxMedia: 16 * 1024 * 1024 }));
  const cfg = await uploadMode;
  if (file.size > cfg.maxMedia) throw new Error('too_large');
  const type = file.type || 'application/octet-stream';
  if (cfg.mode === 'blob') {
    // Directo al storage, privado (lib/files/direct-upload-client.ts).
    const { directUpload } = await import('@/lib/files/direct-upload-client');
    try {
      const up = await directUpload(file, { purpose: 'inbox-schedule', contentType: type });
      return { url: up.url, name: file.name.slice(0, 200), type };
    } catch {
      throw new Error('upload_failed');
    }
  }
  const form = new FormData();
  form.append('file', file);
  const r = await api<PartMedia>('/api/inbox/upload', { method: 'POST', body: form });
  if (!r.ok) throw new Error(r.data.error ?? 'upload_failed');
  return { url: r.data.url, name: r.data.name, type: r.data.type };
}

const newKey = () => Math.random().toString(36).slice(2, 10);
const blank = (body = '', delaySec = 0): Part => ({ key: newKey(), body, delaySec, media: null, uploading: false });

/**
 * "Enviar más tarde" con varios mensajes: cada uno sale como su propia
 * burbuja, con una espera opcional después del anterior y un archivo
 * (WhatsApp). Abajo, cuándo sale el primero (atajos 1 a 6 o una fecha). Sirve
 * también para editar lo que falta de una secuencia ya programada.
 */
export default function ScheduleDialog({ target, onClose, onDone }: { target: ScheduleTarget | null; onClose: () => void; onDone: (scheduled: ScheduledDto[], sendAt: string) => void }) {
  const t = useTranslations('inbox.schedule');
  const tw = useTranslations('inbox.when');
  const te = useTranslations('inbox.errors');
  const locale = useLocale();
  const [parts, setParts] = useState<Part[]>([blank()]);
  const [custom, setCustom] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey() + newKey());
  const files = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!target) return;
    const n = new Date();
    setNow(n);
    setErr('');
    setBusy(false);
    key.current = newKey() + newKey();
    const open = target.edit?.filter((s) => s.status !== 'sent' && s.status !== 'cancelled') ?? [];
    if (open.length) {
      setParts(open.map((s, i) => ({ key: newKey(), body: s.body, delaySec: i === 0 ? 0 : s.delaySec, media: s.mediaUrl ? { url: s.mediaUrl, name: s.mediaName, type: s.mediaType, ...(s.mediaVoice ? { voice: true, duration: s.mediaDuration } : {}) } : null, uploading: false })));
      const at = new Date(open[0].sendAt);
      setCustom(localInputValue(at.getTime() > n.getTime() + 60_000 ? at : new Date(n.getTime() + 3600_000)));
    } else {
      setParts([blank(target.text ?? '')]);
      setCustom(localInputValue(new Date(n.getTime() + 24 * 3600_000)));
    }
  }, [target]);

  const editing = !!target?.edit?.length;
  const whatsapp = target?.channel === 'whatsapp';
  const set = (k: string, patch: Partial<Part>) => setParts((ps) => ps.map((p) => (p.key === k ? { ...p, ...patch } : p)));
  const ready = parts.every((p) => !p.uploading) && parts.some((p) => p.body.trim() || p.media) && parts.every((p) => p.body.trim() || p.media);

  const submit = async (at: Date) => {
    if (!target || busy) return;
    if (!ready) {
      setErr(t('emptyPart'));
      return;
    }
    if (at.getTime() <= Date.now() + 30_000) {
      setErr(tw('pastError'));
      return;
    }
    setBusy(true);
    setErr('');
    const payload = parts.map((p, i) => ({
      body: p.body.trim(),
      delaySec: i === 0 ? 0 : p.delaySec,
      media: p.media,
    }));
    const sendAt = at.toISOString();
    const r = editing
      ? await api<{ scheduled: ScheduledDto[] }>(`/api/inbox/scheduled/${target.edit![0].id}`, { method: 'PUT', json: { sendAt, parts: payload } })
      : await api<{ scheduled: ScheduledDto[] }>('/api/inbox/scheduled', { method: 'POST', json: { threadId: target.threadId, sendAt, parts: payload, key: key.current } });
    setBusy(false);
    if (!r.ok) {
      setErr(te.has(r.data.error ?? '') ? te(r.data.error as string) : te('generic'));
      return;
    }
    onDone(r.data.scheduled, sendAt);
  };

  const pick = (p: SnoozePreset) => void submit(presetDate(p, new Date()));

  const attach = async (k: string, file: File | undefined) => {
    if (!file) return;
    set(k, { uploading: true });
    setErr('');
    try {
      const media = await uploadInboxFile(file);
      set(k, { media, uploading: false });
    } catch (e) {
      const code = e instanceof Error ? e.message : 'upload_failed';
      set(k, { uploading: false });
      setErr(te.has(code) ? te(code) : t('uploadFailed'));
    }
  };

  return (
    <Modal open={!!target} title={editing ? t('editTitle') : t('title')} onClose={onClose} wide>
      <div
        className="ui-modal-body ib-when-body ib-plan"
        onKeyDown={(e) => {
          const n = Number(e.key);
          if (!typingIn(e.target as Element) && n >= 1 && n <= SNOOZE_PRESETS.length && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            pick(SNOOZE_PRESETS[n - 1]);
            return;
          }
          // Flechas arriba y abajo entre los horarios (Enter elige el que tiene el foco).
          const opt = (e.target as Element).closest?.('.ib-when-opt');
          if (opt && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.metaKey && !e.ctrlKey && !e.altKey) {
            const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.ib-when-opt:not(:disabled)'));
            const at = items.indexOf(opt as HTMLButtonElement);
            e.preventDefault();
            items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
          }
        }}
      >
        <ol className="ib-plan-parts" aria-label={t('messages')}>
          {parts.map((p, i) => (
            <li key={p.key} className="ib-plan-part">
              {i > 0 && (
                <div className="ib-plan-delay">
                  <label className="label" htmlFor={`ib-delay-${p.key}`}>
                    {t('waitLabel')}
                  </label>
                  <select id={`ib-delay-${p.key}`} className="select" value={p.delaySec} onChange={(e) => set(p.key, { delaySec: Number(e.target.value) })}>
                    {(DELAYS as readonly number[]).includes(p.delaySec) ? null : <option value={p.delaySec}>{t('delayCustom', { s: p.delaySec })}</option>}
                    {DELAYS.map((d) => (
                      <option key={d} value={d}>
                        {t(`delay.${d}`)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="ib-plan-row">
                <label className="sr-only" htmlFor={`ib-part-${p.key}`}>
                  {t('messageN', { n: i + 1 })}
                </label>
                <textarea
                  id={`ib-part-${p.key}`}
                  className="textarea ib-plan-text"
                  rows={2}
                  maxLength={4000}
                  autoFocus={i === parts.length - 1 && (i > 0 || !p.body)}
                  placeholder={p.media ? t('captionPlaceholder') : t('messagePlaceholder', { n: i + 1 })}
                  value={p.body}
                  onChange={(e) => set(p.key, { body: e.target.value })}
                />
                {parts.length > 1 && (
                  <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('removeN', { n: i + 1 })} onClick={() => setParts((ps) => ps.filter((x) => x.key !== p.key))}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                )}
              </div>
              {whatsapp && (
                <div className="ib-plan-file">
                  {p.media ? (
                    <>
                      <span className="ib-media-tag" title={p.media.name}>
                        {t('file', { name: p.media.name })}
                      </span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => set(p.key, { media: null })}>
                        {t('removeFile')}
                      </button>
                    </>
                  ) : (
                    <>
                      <input ref={(el) => void (files.current[p.key] = el)} type="file" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void attach(p.key, e.target.files?.[0])} />
                      <button type="button" className="btn btn-ghost btn-sm" disabled={p.uploading} onClick={() => files.current[p.key]?.click()}>
                        {p.uploading ? t('uploading') : t('attach')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
        {parts.length < 10 && (
          <button type="button" className="btn btn-secondary btn-sm ib-plan-add" onClick={() => setParts((ps) => [...ps, blank('', 5)])}>
            + {t('addMessage')}
          </button>
        )}
        <h3 className="label ib-plan-h">{t('whenFirst')}</h3>
        <ul className="ib-when-list">
          {visiblePresets(now).map((p) => (
            <li key={p}>
              <button type="button" className="ib-when-opt" onClick={() => pick(p)} disabled={busy || !ready}>
                <span className="kbd" aria-hidden>
                  {SNOOZE_PRESETS.indexOf(p) + 1}
                </span>
                <span className="ib-when-label">{tw(`preset.${p}`)}</span>
                <span className="ib-when-at">{longWhen(presetDate(p, now).toISOString(), locale)}</span>
              </button>
            </li>
          ))}
        </ul>
        <form
          className="ib-when-custom"
          onSubmit={(e) => {
            e.preventDefault();
            const at = new Date(custom);
            if (!custom || Number.isNaN(at.getTime())) setErr(tw('pastError'));
            else void submit(at);
          }}
        >
          <label className="label" htmlFor="ib-plan-at">
            {tw('custom')}
          </label>
          <div className="ib-row">
            <input id="ib-plan-at" className="input" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !ready}>
              {editing ? t('save') : t('schedule')}
            </button>
          </div>
        </form>
        {err && (
          <p className="ib-error" role="alert">
            {err}
          </p>
        )}
      </div>
      <div className="ui-modal-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          {tw('cancel')}
        </button>
      </div>
    </Modal>
  );
}

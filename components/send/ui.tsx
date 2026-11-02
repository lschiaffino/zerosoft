'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
export { api, useDate, useToast } from '@/components/sign/ui';

/** Texto del error de la API en el idioma de la UI (send.errors.<code>). */
export function useErrorText() {
  const t = useTranslations('send.errors');
  return useCallback(
    (code: string | undefined | null) => {
      const key = code || 'generic';
      return t.has(key) ? t(key) : t('generic');
    },
    [t],
  );
}

/** Modal (<dialog>): Esc cierra, el foco queda adentro, Enter envía el form de adentro. */
export function SendDialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="ui-modal sd-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <>
          <div className="ui-modal-head">
            <h2 className="ui-modal-title">{title}</h2>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}

/** 72 → "1:12"; 8 → "8s". */
export function formatSeconds(s: number): string {
  const total = Math.round(s);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const rest = total % 60;
  if (m < 60) return `${m}:${String(rest).padStart(2, '0')}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Duración de un video, leída en el navegador antes de subirlo. */
export function videoDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    const done = (d?: number) => {
      URL.revokeObjectURL(url);
      resolve(d && Number.isFinite(d) ? d : undefined);
    };
    v.onloadedmetadata = () => done(v.duration);
    v.onerror = () => done();
    v.src = url;
  });
}

const PART = 4 * 1024 * 1024;

export interface UploadedVersion {
  id: string;
  status: string;
  error: string | null;
  pageCount: number;
  renderedCount: number;
  note: string | null;
}

async function jsonOf(res: Response) {
  return (await res.json().catch(() => ({}))) as { error?: string; version?: UploadedVersion };
}

/**
 * Sube un archivo en partes de 4 MB (hasta 3 a la vez, con reintento) y después
 * pide el render hasta que termina. Si se cierra la pestaña, sigue el cron.
 */
export async function uploadFile(
  versionId: string,
  file: File,
  onProgress: (p: { phase: 'upload' | 'process'; done: number; total: number }) => void,
): Promise<UploadedVersion> {
  const count = Math.max(1, Math.ceil(file.size / PART));
  let sent = 0;
  let next = 0;
  const sendOne = async (n: number) => {
    let lastError = 'network';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`/api/send/versions/${versionId}/parts/${n}`, { method: 'PUT', body: file.slice(n * PART, (n + 1) * PART) });
        if (res.ok) return;
        lastError = (await jsonOf(res)).error ?? 'generic';
        if (res.status < 500 && res.status !== 429) break;
      } catch {
        lastError = 'network';
      }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
    throw new Error(lastError);
  };
  await Promise.all(
    Array.from({ length: Math.min(3, count) }, async () => {
      while (next < count) {
        const n = next++;
        await sendOne(n);
        sent++;
        onProgress({ phase: 'upload', done: sent, total: count });
      }
    }),
  );
  const durationSec = file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name) ? await videoDuration(file) : undefined;
  const res = await fetch(`/api/send/versions/${versionId}/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(durationSec ? { durationSec } : {}) });
  const data = await jsonOf(res);
  if (!res.ok || !data.version) throw new Error(data.error ?? 'generic');
  return pumpVersion(versionId, data.version, onProgress);
}

/** Pide render hasta que la versión termina. */
export async function pumpVersion(
  versionId: string,
  initial: UploadedVersion,
  onProgress: (p: { phase: 'upload' | 'process'; done: number; total: number }) => void,
): Promise<UploadedVersion> {
  let v = initial;
  let waits = 0;
  let errors = 0;
  while (v.status === 'processing' && waits < 200) {
    const before = v.renderedCount;
    const res = await fetch(`/api/send/versions/${versionId}/process`, { method: 'POST' }).catch(() => null);
    const data = res ? await jsonOf(res) : {};
    if (data.version) {
      v = data.version;
      errors = 0;
    } else if (++errors >= 5) {
      // El cron sigue con el render: el detalle muestra cómo va.
      return v;
    }
    onProgress({ phase: 'process', done: v.renderedCount, total: v.pageCount });
    // Otro proceso lo tiene reclamado: esperar en lugar de insistir.
    if (v.status === 'processing' && v.renderedCount === before) {
      waits++;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return v;
}

'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/** Campo de formulario: etiqueta + control (+ ayuda opcional). */
export function Field({
  label,
  hint,
  children,
  wide = false,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`tl-field${wide ? ' tl-field-wide' : ''}`}>
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="tl-hint">{hint}</span> : null}
    </label>
  );
}

/** Copia texto y muestra "Copiado" por 1,8 s. */
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const flash = useCallback((key: string) => {
    setCopied(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1800);
  }, []);
  const copy = useCallback(
    async (text: string, key = 'default') => {
      try {
        await navigator.clipboard.writeText(text);
        flash(key);
        return true;
      } catch {
        // Fallback para navegadores sin Clipboard API (o sin permiso).
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (ok) flash(key);
        return ok;
      }
    },
    [flash],
  );
  return { copied, copy, flash };
}

/** Descarga un archivo generado en el navegador. */
export function downloadFile(name: string, content: string | Blob, type = 'text/plain;charset=utf-8') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** localStorage que nunca rompe (modo privado, previews, bloqueado). */
export function readLocal<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin storage: el borrador solo vive en memoria */
  }
}

export function removeLocal(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

export type AiReason = 'rate_limited' | 'ai_disabled' | 'quota_exceeded' | 'ai_error';

export type AiResponse<T> =
  | { status: 'ok'; source: 'ai'; data: T }
  | { status: 'ok'; source: 'fallback'; reason: AiReason; data: T }
  | { status: 'unavailable'; reason: AiReason }
  | { status: 'invalid' };

/** Llama a /api/tools/ai y guarda el estado de la última respuesta. */
export function useAiTool<T>(kind: string) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiResponse<T> | null>(null);
  const [failed, setFailed] = useState(false);
  const run = useCallback(
    async (input: Record<string, unknown>) => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch('/api/tools/ai', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, input }),
        });
        const json = (await res.json()) as AiResponse<T>;
        setResult(json);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [kind],
  );
  return { loading, result, failed, run };
}

/** Aviso cuando la respuesta no vino de la AI (o no hubo respuesta). */
export function AiNotice({ result, failed }: { result: AiResponse<unknown> | null; failed: boolean }) {
  const t = useTranslations('tools.common');
  if (failed) return <p className="tl-notice">{t('networkError')}</p>;
  if (!result) return null;
  if (result.status === 'invalid') return <p className="tl-notice">{t('invalid')}</p>;
  if (result.status === 'unavailable') return <p className="tl-notice">{t(`aiReason.${result.reason}`)}</p>;
  if (result.source === 'fallback') {
    return (
      <p className="tl-notice">
        {t(`aiReason.${result.reason}`)} {t('fallbackUsed')}
      </p>
    );
  }
  return null;
}

export const LANG_OPTIONS = ['en', 'es', 'pt'] as const;

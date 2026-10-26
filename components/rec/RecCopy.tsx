'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* sigue con el respaldo */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Botón de copiar con "Copiado" por 2 s (anuncia el cambio a lectores de pantalla). */
export default function RecCopy({ text, label, className = 'btn btn-secondary btn-sm', testId }: { text: string; label: string; className?: string; testId?: string }) {
  const t = useTranslations('rec.common');
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  return (
    <button
      type="button"
      className={className}
      data-testid={testId}
      onClick={async () => {
        if (!(await copyToClipboard(text))) return;
        setCopied(true);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 2000);
      }}
    >
      <span aria-live="polite">{copied ? t('copied') : label}</span>
    </button>
  );
}

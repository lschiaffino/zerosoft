'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import CalIcon from './cal-icons';

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Sin Clipboard API (http, iframes): textarea temporal.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/** Botón "Copiar" de Cal: confirma en el propio botón y lo anuncia a lectores de pantalla. */
export default function CalCopyButton({
  text,
  label,
  className = 'btn btn-sm',
  iconOnly = false,
}: {
  text: string;
  label?: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const t = useTranslations('calendar');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const name = label ?? t('list.copyLink');
  return (
    <button
      type="button"
      className={className}
      aria-label={iconOnly ? name : undefined}
      title={iconOnly ? name : undefined}
      onClick={async () => {
        await copyText(text);
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1600);
      }}
    >
      <CalIcon name={copied ? 'check' : 'copy'} />
      {!iconOnly && <span aria-live="polite">{copied ? t('list.copied') : name}</span>}
      {iconOnly && copied && <span className="sr-only" aria-live="polite">{t('list.copied')}</span>}
    </button>
  );
}

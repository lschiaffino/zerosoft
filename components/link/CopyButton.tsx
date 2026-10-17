'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import LinkIcon from './LinkIcon';

interface CopyButtonProps {
  text: string;
  /** Clases del botón (por defecto secundario chico). */
  className?: string;
  /** Solo el ícono; el texto queda para lectores de pantalla. */
  iconOnly?: boolean;
  /** Texto visible en lugar de "Copiar" (p. ej. "Copiar link"). */
  label?: string;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback para contextos no seguros.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

export default function CopyButton({ text, className = 'btn btn-sm', iconOnly = false, label }: CopyButtonProps) {
  const t = useTranslations('link');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = async () => {
    try {
      await copyText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Sin portapapeles no hay nada razonable para hacer.
    }
  };

  const text_ = copied ? t('common.copied') : (label ?? t('common.copy'));

  return (
    <button
      type="button"
      onClick={onCopy}
      className={`${className} lk-copy${iconOnly ? ' btn-icon' : ''}`}
      data-copied={copied || undefined}
      title={iconOnly ? text_ : undefined}
    >
      <LinkIcon name={copied ? 'check' : 'copy'} size={iconOnly ? 14 : 15} />
      {iconOnly ? <span className="sr-only">{text_}</span> : text_}
      <span className="sr-only" aria-live="polite">
        {copied ? t('common.copied') : ''}
      </span>
    </button>
  );
}

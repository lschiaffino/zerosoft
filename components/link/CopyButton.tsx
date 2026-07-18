'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

interface CopyButtonProps {
  text: string;
  className?: string;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for non-secure contexts.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

export default function CopyButton({ text, className = '' }: CopyButtonProps) {
  const t = useTranslations('link');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onCopy = async () => {
    try {
      await copyText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable; nothing sensible to do.
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      className={`copy-btn${copied ? ' copied' : ''} ${className}`.trim()}
      aria-live="polite"
    >
      {copied ? t('common.copied') : t('common.copy')}
    </button>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ChatIcon from './icons';

/** Un valor para copiar (la dirección de email del widget), con Copiar al lado. */
export default function CopyField({ value, label }: { value: string; label: string }) {
  const t = useTranslations('chat');
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('error');
    }
    setTimeout(() => setState('idle'), 2000);
  }

  return (
    <div className="chat-copy-field">
      <input className="input data" readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>
        <ChatIcon name="copy" size={14} />
        {state === 'copied' ? t('emailChannel.copied') : t('emailChannel.copy')}
      </button>
      <span className="sr-only" role="status">
        {state === 'copied' ? t('emailChannel.copied') : state === 'error' ? t('errors.generic') : ''}
      </span>
    </div>
  );
}

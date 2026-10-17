'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

const PREFIX = 'zs-advanced:';

function readOpen(key: string): boolean | null {
  try {
    const v = window.localStorage.getItem(PREFIX + key);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

function writeOpen(key: string, open: boolean) {
  try {
    window.localStorage.setItem(PREFIX + key, open ? '1' : '0');
  } catch {
    // Sin storage (modo privado, bloqueado): se recuerda solo mientras dure la página.
  }
}

/**
 * "Avanzado": las opciones que el camino básico no necesita, detrás de un
 * disclosure accesible (botón con aria-expanded + región). Recuerda si quedó
 * abierto por `storageKey` (p. ej. "link.new"), así cada formulario guarda lo suyo.
 *
 *   <AdvancedSection storageKey="link.new" hint="UTM, expiración, contraseña">…</AdvancedSection>
 */
export default function AdvancedSection({
  storageKey,
  children,
  label,
  hint,
  defaultOpen = false,
  className = '',
}: {
  storageKey: string;
  children: ReactNode;
  /** Texto del botón. Por defecto "Avanzado". */
  label?: string;
  /** Qué hay adentro, en gris a la derecha (opcional). */
  hint?: string;
  defaultOpen?: boolean;
  className?: string;
}) {
  const t = useTranslations('common.ui');
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const saved = readOpen(storageKey);
    if (saved !== null) setOpen(saved);
  }, [storageKey]);

  function toggle() {
    setOpen((v) => {
      writeOpen(storageKey, !v);
      return !v;
    });
  }

  return (
    <div className={`ui-disclosure ${className}`.trim()}>
      <button type="button" className="ui-disclosure-toggle" aria-expanded={open} aria-controls={id} onClick={toggle}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="ui-disclosure-label">{label ?? t('advanced')}</span>
        {hint && <span className="ui-disclosure-hint">{hint}</span>}
      </button>
      <div id={id} className="ui-disclosure-body" role="region" aria-label={label ?? t('advanced')} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

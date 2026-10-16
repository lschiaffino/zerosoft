'use client';

import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

type SaveResult = void | string | { error: string };

/**
 * Una sección de ajustes con su propio Guardar (patrón Vercel): título y ayuda
 * arriba, los campos, y un pie de esmalte con una nota a la izquierda y el
 * botón a la derecha. Cada sección se guarda sola; no hay un Guardar global.
 *
 * Con `onSubmit` es un <form>: maneja "Guardando…", "Cambios guardados" y el
 * error (devolvé un string o { error } para mostrarlo). Sin `onSubmit` es una
 * <section> y el pie lo ponés vos con `footer`.
 *
 *   <FormSection title="Dominio" description="…" onSubmit={async (fd) => save(fd)}>
 *     <div className="ui-field"><label className="label" htmlFor="d">Dominio</label><input id="d" name="domain" className="input" /></div>
 *   </FormSection>
 */
export default function FormSection({
  title,
  description,
  children,
  onSubmit,
  submitLabel,
  note,
  footer,
  disabled = false,
  tone = 'default',
  id,
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  onSubmit?: (data: FormData) => Promise<SaveResult> | SaveResult;
  /** Texto del botón. Por defecto "Guardar". */
  submitLabel?: string;
  /** Nota del pie (límites, quién puede cambiarlo). Se reemplaza por el estado al guardar. */
  note?: ReactNode;
  /** Pie propio (cuando no hay onSubmit o necesitás más de un botón). */
  footer?: ReactNode;
  disabled?: boolean;
  /** "danger": borde y pie rojos, para borrar o transferir. */
  tone?: 'default' | 'danger';
  id?: string;
  className?: string;
}) {
  const t = useTranslations('common.ui');
  const titleId = useId();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (state !== 'saved') return;
    const timer = window.setTimeout(() => setState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!onSubmit || state === 'saving') return;
    setState('saving');
    try {
      const res = await onSubmit(new FormData(e.currentTarget));
      const msg = typeof res === 'string' ? res : res && typeof res === 'object' ? res.error : '';
      if (msg) {
        setError(msg);
        setState('error');
      } else {
        setState('saved');
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('saveError'));
      setState('error');
    }
  }

  const cls = `ui-section${tone === 'danger' ? ' ui-section-danger' : ''} ${className}`.trim();
  const head = (
    <div className="ui-section-head">
      <h2 className="ui-section-title" id={titleId}>
        {title}
      </h2>
      {description && <p className="ui-section-desc">{description}</p>}
    </div>
  );

  if (!onSubmit) {
    return (
      <section className={cls} aria-labelledby={titleId} id={id}>
        <div className="ui-section-body">
          {head}
          {children}
        </div>
        {footer && <div className="ui-section-foot">{footer}</div>}
      </section>
    );
  }

  const status =
    state === 'saving' ? t('saving') : state === 'saved' ? t('saved') : state === 'error' ? error || t('saveError') : null;

  return (
    <form className={cls} aria-labelledby={titleId} id={id} onSubmit={handle}>
      <div className="ui-section-body">
        {head}
        {children}
      </div>
      <div className="ui-section-foot">
        <p
          className="ui-section-note"
          role="status"
          aria-live="polite"
          data-tone={state === 'saved' ? 'ok' : state === 'error' ? 'error' : undefined}
        >
          {status ?? note}
        </p>
        {footer ?? (
          <button
            type="submit"
            className={`btn ${tone === 'danger' ? 'btn-primary btn-danger' : 'btn-primary'}`}
            disabled={disabled}
            aria-busy={state === 'saving' || undefined}
          >
            {submitLabel ?? t('save')}
          </button>
        )}
      </div>
    </form>
  );
}

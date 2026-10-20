'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { RobotRunDto, RobotUsage } from '@/lib/robots';

type T = ReturnType<typeof useTranslations<'robots'>>;

/** Texto de un código de error de la API (robots.errors.*). */
export function errorText(t: T, code: string | undefined, values: Record<string, string | number> = {}): string {
  if (code && t.has(`errors.${code}`)) return t(`errors.${code}` as 'errors.generic', values);
  return t('errors.generic');
}

const BADGE: Record<RobotRunDto['status'], string> = {
  success: 'badge badge-ok',
  failed: 'badge badge-bad',
  queued: 'badge badge-warn',
  running: 'badge badge-ink',
};

/**
 * Estado de una corrida como badge recto, con texto. Una corrida exitosa con
 * pasos que fallaron y siguieron (continueOnError) se muestra "Con advertencias".
 */
export function StatusBadge({ status, warnings = 0 }: { status: RobotRunDto['status']; warnings?: number }) {
  const t = useTranslations('robots.runs.status');
  if (status === 'success' && warnings > 0) return <span className="badge badge-warn">{t('warnings')}</span>;
  return <span className={BADGE[status] ?? 'badge'}>{t(status)}</span>;
}

/** Minutos del mes: cifra, barra recta y límites. */
export function UsageMeter({ usage }: { usage: RobotUsage }) {
  const t = useTranslations('robots');
  const pct = usage.minutesLimit ? Math.min(100, (usage.minutesUsed / usage.minutesLimit) * 100) : 0;
  return (
    <div className="robots-usage">
      <div className="robots-usage-head">
        <span className="robots-usage-label">{t('usage.title')}</span>
        <span className="num">
          {usage.minutesLimit !== null
            ? t('usage.minutes', { used: usage.minutesUsed, limit: usage.minutesLimit })
            : t('usage.minutesUnlimited', { used: usage.minutesUsed })}
          <span className="robots-muted"> · {t('usage.runs', { count: usage.runs })}</span>
        </span>
      </div>
      {usage.minutesLimit !== null && (
        <div
          className={`robots-usage-bar${pct >= 90 ? ' is-high' : ''}`}
          role="progressbar"
          aria-label={t('usage.title')}
          aria-valuemin={0}
          aria-valuemax={usage.minutesLimit}
          aria-valuenow={usage.minutesUsed}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="robots-muted robots-small">{t('usage.perHour', { count: usage.runsPerHour })}</p>
    </div>
  );
}

/** Dónde corren los robots. Sin runner es un aviso: explica por qué Correr está apagado. */
export function RunnerNote({ backend }: { backend: RobotUsage['backend'] }) {
  const t = useTranslations('robots');
  if (backend === 'none') {
    return (
      <div className="robots-runner is-none" role="note">
        <strong>{t('runner.none')}</strong>
        <p className="robots-small">{t('runner.noneHint')}</p>
      </div>
    );
  }
  return (
    <div className="robots-runner" role="note">
      <span className="robots-runner-label">{t('runner.title')}</span>
      <span>{t(`runner.${backend}`)}</span>
      {backend === 'local' && <span className="robots-muted robots-small">{t('runner.localHint')}</span>}
    </div>
  );
}

/**
 * Diálogo nativo (<dialog class="ui-modal">): trampa de foco y Esc gratis.
 * `onClose` se llama al cerrar por Esc, por el fondo o por los botones.
 */
export function RobotDialog({
  open,
  onClose,
  title,
  children,
  foot,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  foot: ReactNode;
  /** Mientras corre algo no se puede cerrar. */
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="ui-modal"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      {open && (
        <>
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id={titleId}>
              {title}
            </h2>
          </div>
          <div className="ui-modal-body robots-dialog-body">{children}</div>
          <div className="ui-modal-foot">{foot}</div>
        </>
      )}
    </dialog>
  );
}

'use client';

/** Fleet: piezas chicas que comparten el tablero, los chats, PRs y deploys. */
import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import LocalText from '@/components/ui/LocalText';
import { formatTimeAgo } from '@/lib/datetime';
import type { ChecksState, DeployState, SessionStatus } from '@/lib/fleet/types';

export function Ago({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const locale = useLocale();
  if (!iso) return null;
  return (
    <time dateTime={iso} className={className}>
      <LocalText>{formatTimeAgo(iso, locale)}</LocalText>
    </time>
  );
}

/** Estado de una sesión: un punto (cuadrado, como el resto de la app) y la palabra. */
export function StatusLabel({ status, compact = false }: { status: SessionStatus; compact?: boolean }) {
  const t = useTranslations('fleet.status');
  return (
    <span className="flt-status" data-status={status} data-testid="fleet-status">
      <span className="flt-dot" aria-hidden="true" />
      {compact ? <span className="sr-only">{t(status)}</span> : t(status)}
    </span>
  );
}

/** CI de un PR: tilde, cruz o en curso. */
export function ChecksMark({ state }: { state: ChecksState }) {
  const t = useTranslations('fleet.checks');
  if (!state) return null;
  return (
    <span className="flt-checks" data-checks={state} title={t(state)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {state === 'success' ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : state === 'failure' ? <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /> : <circle cx="12" cy="12" r="5" />}
      </svg>
      <span className="sr-only">{t(state)}</span>
    </span>
  );
}

export function DeployMark({ state, showLabel = true }: { state: DeployState; showLabel?: boolean }) {
  const t = useTranslations('fleet.deployState');
  return (
    <span className="flt-deploy" data-state={state}>
      <span className="flt-dot" aria-hidden="true" />
      {showLabel ? t(state) : <span className="sr-only">{t(state)}</span>}
    </span>
  );
}

/** Link externo (GitHub, Vercel): pestaña nueva, sin referrer. */
export function Ext({ href, children, className, label }: { href: string; children: ReactNode; className?: string; label?: string }) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} aria-label={label}>
      {children}
    </a>
  );
}

/** Iniciales para el avatar de una sesión (proyecto o título). */
export function initials(text: string): string {
  const words = text
    .replace(/[^A-Za-z0-9À-ÿ ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '·';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

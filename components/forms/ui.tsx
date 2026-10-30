'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { FormStatus } from '@/lib/forms/types';

export function StatusBadge({ status, open }: { status: FormStatus; open: boolean }) {
  const t = useTranslations('forms');
  const cls = status === 'published' ? (open ? 'badge-ok' : 'badge-warn') : status === 'closed' ? 'badge-outline' : '';
  return <span className={`badge ${cls}`.trim()}>{status === 'published' && !open ? t('status.full') : t(`status.${status}`)}</span>;
}

/** Pestañas del formulario: armar, respuestas, resumen y compartir. */
export function FormTabs({ id, active }: { id: string; active: 'build' | 'responses' | 'summary' | 'share' }) {
  const t = useTranslations('forms');
  const tabs = [
    { key: 'build', href: `/app/forms/${id}` },
    { key: 'responses', href: `/app/forms/${id}/responses` },
    { key: 'summary', href: `/app/forms/${id}/summary` },
    { key: 'share', href: `/app/forms/${id}/share` },
  ] as const;
  return (
    <nav className="ui-tabs fm-tabs" aria-label={t('tabs.label')}>
      {tabs.map((x) => (
        <Link key={x.key} href={x.href} className="ui-tab" aria-current={active === x.key ? 'page' : undefined}>
          {t(`tabs.${x.key}`)}
        </Link>
      ))}
    </nav>
  );
}

/** Errores de la API → texto. */
export function useErrorText() {
  const t = useTranslations('forms.errors');
  return (code: string | undefined) => {
    const known = ['duplicate_ref', 'missing_choices', 'invalid_jump', 'invalid_logic', 'invalid_definition', 'slug_taken', 'invalid_slug', 'no_questions', 'crm_forbidden', 'forbidden', 'invalid_date', 'name_required', 'duplicate_question', 'duplicate_choice', 'duplicate_ending', 'invalid_steps'];
    return known.includes(code ?? '') ? t(code as 'forbidden') : t('generic');
  };
}

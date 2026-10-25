'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import QuickModal from '@/components/app/QuickModal';
import { teamPath } from '@/lib/track-routes';
import { normalizeTeamKey, teamKeyCandidates } from '@/lib/track-team-key';

const KNOWN_ERRORS = new Set(['invalid_slug', 'slug_taken', 'missing_name', 'invalid_input']);

/**
 * "Nuevo proyecto" en un modal (nombre y descripción) sin salir de la lista;
 * al crear navega al proyecto. El identificador lo deriva el servidor del
 * nombre; el form con opciones avanzadas está en /app/track/teams/new.
 */
export default function QuickProjectButton({
  className = 'btn btn-primary',
  testId = 'track-new-project',
  listenParam = false,
}: {
  className?: string;
  testId?: string;
  /** Abre el modal con ?newProject=1 (lo usa el menú ⌘K). */
  listenParam?: boolean;
}) {
  const t = useTranslations('track');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!listenParam || searchParams.get('newProject') !== '1') return;
    setOpen(true);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('newProject');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [listenParam, searchParams, pathname, router]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // Identificador (MOB): se propone del nombre y se puede cambiar, como en Linear.
  const [key, setKey] = useState('');
  const derivedKey = name.trim() ? teamKeyCandidates(name)[0] : '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/track/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), description: description.trim(), slug: normalizeTeamKey(key) ?? undefined }),
    }).catch(() => null);
    const data = res ? ((await res.json().catch(() => null)) as { id?: string; slug?: string; error?: string } | null) : null;
    if (res?.ok && data?.id) {
      router.push(teamPath({ id: data.id, slug: data.slug }));
      return;
    }
    setBusy(false);
    const code = data?.error ?? 'generic';
    setError(t(KNOWN_ERRORS.has(code) ? `errors.${code}` : 'errors.generic'));
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} data-testid={testId}>
        {t('projects.newCta')}
      </button>
      <QuickModal
        open={open}
        onClose={() => setOpen(false)}
        crumb={`Track › ${t('projects.newTitle')}`}
        onSubmit={submit}
        submitLabel={busy ? t('common.saving') : t('projects.create')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!name.trim()}
        busy={busy}
        error={error}
      >
        <input
          data-autofocus
          className="qm-title"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('projects.form.namePlaceholder')}
          aria-label={t('projects.form.name')}
          maxLength={200}
        />
        <label className="qm-field">
          <span>{t('projects.form.identifier')}</span>
          <input
            className="data track-key-input"
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 5))}
            placeholder={derivedKey.toUpperCase() || 'MOB'}
            aria-describedby="qp-key-help"
            maxLength={5}
            data-testid="track-team-key"
          />
          <small id="qp-key-help" className="ui-help">
            {t('projects.form.identifierHelp', { example: `${(key || derivedKey || 'mob').toUpperCase()}-12` })}
          </small>
        </label>
        <label className="qm-field">
          <span>{t('projects.form.description')}</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={5000} />
        </label>
      </QuickModal>
    </>
  );
}

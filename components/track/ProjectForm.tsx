'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';
import { normalizeTeamKey, teamKeyCandidates } from '@/lib/track-team-key';
import { teamPath } from '@/lib/track-routes';

const KNOWN_ERRORS = new Set(['invalid_slug', 'slug_taken', 'missing_name', 'invalid_input']);

/**
 * Proyecto nuevo: nombre y descripción. El identificador (slug, prefijo de
 * los issues) se deriva del nombre; cambiarlo y el ícono quedan en Avanzado.
 */
export default function ProjectForm() {
  const t = useTranslations('track');
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  // Tres letras del nombre (MOB), como Linear; el servidor elige otra si ya existe.
  const derived = name.trim() ? teamKeyCandidates(name)[0] : '';
  const effective = normalizeTeamKey(slug) ?? derived;

  async function submit(fd: FormData): Promise<string | void> {
    const res = await fetch('/api/track/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        // Sin slug propio, el servidor lo deriva del nombre y lo hace único.
        slug: normalizeTeamKey(slug) ?? undefined,
        description: String(fd.get('description') ?? '').trim(),
        icon: String(fd.get('icon') ?? '').trim() || undefined,
      }),
    }).catch(() => null);
    const data = res ? ((await res.json().catch(() => null)) as { id?: string; slug?: string; error?: string } | null) : null;
    if (res?.ok && data?.id) {
      router.push(teamPath({ id: data.id, slug: data.slug }));
      return;
    }
    const code = data?.error ?? 'generic';
    return t(KNOWN_ERRORS.has(code) ? `errors.${code}` : 'errors.generic');
  }

  return (
    <FormSection
      title={t('projects.formTitle')}
      description={t('projects.newSub')}
      onSubmit={submit}
      submitLabel={t('projects.create')}
      disabled={!name.trim()}
    >
      <div className="ui-field">
        <label className="label" htmlFor="project-name">
          {t('projects.form.name')}
        </label>
        <input
          id="project-name"
          name="name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('projects.form.namePlaceholder')}
          maxLength={200}
          required
          autoFocus
        />
      </div>
      <div className="ui-field">
        <label className="label" htmlFor="project-slug">
          {t('projects.form.identifier')}
        </label>
        <input
          id="project-slug"
          className="input data track-key-input"
          value={slug.toUpperCase()}
          onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 5))}
          placeholder={derived.toUpperCase() || 'MOB'}
          aria-describedby="project-slug-help"
          maxLength={5}
          data-testid="track-project-slug"
        />
        <p className="ui-help" id="project-slug-help">
          {t('projects.form.identifierHelp', { example: `${(effective || 'mob').toUpperCase()}-12` })}
        </p>
      </div>
      <div className="ui-field">
        <label className="label" htmlFor="project-description">
          {t('projects.form.description')} <span className="ui-optional">{t('common.optional')}</span>
        </label>
        <textarea id="project-description" name="description" className="textarea" rows={3} maxLength={5000} />
      </div>
      <AdvancedSection storageKey="track.project.new" hint={t('projects.form.advancedHint')}>
        <div className="ui-field">
          <label className="label" htmlFor="project-icon">
            {t('projects.form.icon')} <span className="ui-optional">{t('common.optional')}</span>
          </label>
          <input id="project-icon" name="icon" className="input track-icon-input" maxLength={8} aria-describedby="project-icon-help" />
          <p className="ui-help" id="project-icon-help">
            {t('projects.form.iconHelp')}
          </p>
        </div>
      </AdvancedSection>
    </FormSection>
  );
}

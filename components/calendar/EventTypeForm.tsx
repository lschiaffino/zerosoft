'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { EventTypeWithRules } from '@/lib/calendar';

interface CustomFieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'boolean';
  required: boolean;
}

interface TeamMemberOption {
  user_id: string;
  email: string;
  name: string | null;
}

interface EventTypeFormProps {
  initial?: EventTypeWithRules | null;
  /** Members del team activo (para el pool de hosts). Vacío/undefined = sin team. */
  teamMembers?: TeamMemberOption[];
  /** Team al que se asocia el event type cuando hay hosts. */
  teamId?: string | null;
  /** Hosts actualmente en el pool (edicón). */
  initialHostIds?: string[];
}

const ERROR_CODES = ['invalid_slug', 'slug_taken', 'invalid_input', 'generic'] as const;

function emptyField(): CustomFieldDef {
  return { name: '', label: '', type: 'text', required: false };
}

function parseFields(initial: EventTypeWithRules | null | undefined): CustomFieldDef[] {
  if (!initial) return [];
  const list = initial.fieldsParsed;
  if (!Array.isArray(list)) return [];
  return list
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f) => ({
      name: typeof f.name === 'string' ? f.name : '',
      label: typeof f.label === 'string' ? f.label : '',
      type: ['text', 'number', 'boolean'].includes(typeof f.type === 'string' ? f.type : '')
        ? (f.type as 'text' | 'number' | 'boolean')
        : 'text',
      required: f.required === true,
    }));
}

export default function EventTypeForm({ initial, teamMembers, teamId, initialHostIds }: EventTypeFormProps) {
  const t = useTranslations('calendar');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [values, setValues] = useState({
    slug: initial?.slug ?? '',
    title: initial?.title ?? '',
    durationMin: initial?.duration_min ?? 30,
    location: initial?.location ?? '',
    description: initial?.description ?? '',
    color: initial?.color ?? '#000000',
    // Un event type nuevo arranca activo (antes quedaba apagado y el link no reservaba).
    active: initial ? initial.active === 1 : true,
    bufferBeforeMin: (initial?.bookingRulesParsed?.bufferBeforeMin as number) ?? 0,
    bufferAfterMin: (initial?.bookingRulesParsed?.bufferAfterMin as number) ?? 0,
    minNoticeHours: (initial?.bookingRulesParsed?.minNoticeHours as number) ?? 0,
    maxFutureDays: (initial?.bookingRulesParsed?.maxFutureDays as number) ?? 30,
    allowGuests: (initial?.bookingRulesParsed?.allowGuests as boolean) ?? false,
    brandColor: initial?.brand_color ?? '#000000',
    welcomeMessage: initial?.welcome_message ?? '',
    logoUrl: initial?.logo_url ?? '',
    singleUse: initial?.single_use === 1,
  });
  const [fields, setFields] = useState<CustomFieldDef[]>(parseFields(initial));
  const [hostIds, setHostIds] = useState<string[]>(initialHostIds ?? []);

  function set<K extends keyof typeof values>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const target = e.target as HTMLInputElement;
      const raw = target.type === 'checkbox' ? target.checked : target.value;
      setSaved(false);
      setValues((prev) => ({
        ...prev,
        [key]: target.type === 'number' ? (raw === '' ? 0 : Number(raw)) : raw,
      }));
    };
  }

  function updateField(index: number, patch: Partial<CustomFieldDef>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  function addField() {
    setFields((prev) => [...prev, emptyField()]);
  }

  function toggleHost(userId: string) {
    setHostIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    // Orden del pool = orden de la lista de members (estable para round-robin).
    const orderedHostIds = teamMembers
      ? teamMembers.filter((m) => hostIds.includes(m.user_id)).map((m) => m.user_id)
      : undefined;

    const payload = {
      slug: values.slug,
      title: values.title,
      durationMin: values.durationMin,
      location: values.location || undefined,
      description: values.description || undefined,
      color: values.color,
      active: values.active,
      bookingRules: {
        bufferBeforeMin: values.bufferBeforeMin,
        bufferAfterMin: values.bufferAfterMin,
        minNoticeHours: values.minNoticeHours,
        maxFutureDays: values.maxFutureDays,
        allowGuests: values.allowGuests,
      },
      fields: fields
        .filter((f) => f.name.trim() && f.label.trim())
        .map((f) => ({
          name: f.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_'),
          label: f.label.trim(),
          type: f.type,
          required: f.required,
        })),
      brandColor: values.brandColor || undefined,
      welcomeMessage: values.welcomeMessage.trim() || undefined,
      logoUrl: values.logoUrl.trim() || undefined,
      singleUse: values.singleUse,
      hostIds: orderedHostIds,
      teamId: orderedHostIds && orderedHostIds.length > 0 ? (teamId ?? undefined) : undefined,
    };

    const url = initial ? `/api/calendar/event-types/${initial.id}` : '/api/calendar/event-types';
    const method = initial ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);

    if (res && (res.status === 201 || res.status === 200)) {
      const data = (await res.json()) as { id: string };
      if (initial) {
        // Edición: se queda en la página y confirma en el botón.
        setBusy(false);
        setSaved(true);
        router.refresh();
        return;
      }
      router.push(`/app/calendar/event-types/${data.id}`);
      return;
    }

    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    setError(
      (ERROR_CODES as readonly string[]).includes(code) ? t(`errors.${code}`) : t('errors.generic'),
    );
    setBusy(false);
  }

  return (
    <form className="calendar-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="field">
          <span className="prop-label">{t('form.title')}</span>
          <input className="input" value={values.title} onChange={set('title')} required />
        </label>
        <label className="field">
          <span className="prop-label">{t('form.slug')}</span>
          <input
            className="input mono"
            value={values.slug}
            onChange={set('slug')}
            pattern="[a-z0-9\-]+"
            required
            placeholder="30-min-meeting"
          />
        </label>
      </div>

      <div className="form-grid form-grid-3">
        <label className="field">
          <span className="prop-label">{t('form.durationMin')}</span>
          <input className="input" type="number" min={1} value={values.durationMin} onChange={set('durationMin')} required />
        </label>
        <label className="field">
          <span className="prop-label">{t('form.color')}</span>
          <input className="input" type="color" value={values.color} onChange={set('color')} />
        </label>
        <label className="field checkbox-field">
          <input type="checkbox" checked={values.active} onChange={set('active')} />
          <span className="prop-label">{t('form.active')}</span>
        </label>
      </div>

      <label className="field">
        <span className="prop-label">{t('form.location')}</span>
        <input
          className="input"
          value={values.location}
          onChange={set('location')}
          placeholder={t('form.locationPlaceholder')}
        />
      </label>

      <label className="field">
        <span className="prop-label">{t('form.description')}</span>
        <textarea
          className="input textarea"
          rows={3}
          value={values.description}
          onChange={set('description')}
        />
      </label>

      <section className="panel rules-panel">
        <p className="section-label">{t('form.branding')}</p>
        <div className="form-grid form-grid-3">
          <label className="field">
            <span className="prop-label">{t('form.brandColor')}</span>
            <input className="input" type="color" value={values.brandColor} onChange={set('brandColor')} />
          </label>
          <label className="field">
            <span className="prop-label">{t('form.logoUrl')}</span>
            <input
              className="input mono"
              value={values.logoUrl}
              onChange={set('logoUrl')}
              placeholder="https://…"
            />
          </label>
        </div>
        <label className="field">
          <span className="prop-label">{t('form.welcomeMessage')}</span>
          <textarea
            className="input textarea"
            rows={2}
            value={values.welcomeMessage}
            onChange={set('welcomeMessage')}
            placeholder={t('form.welcomeMessagePlaceholder')}
          />
        </label>
      </section>

      {teamMembers && teamMembers.length > 0 && (
        <section className="panel rules-panel">
          <p className="section-label">{t('form.hosts')}</p>
          <p className="muted hosts-help">{t('form.hostsHelp')}</p>
          <div className="hosts-list">
            {teamMembers.map((m) => (
              <label key={m.user_id} className="checkbox-field">
                <input
                  type="checkbox"
                  checked={hostIds.includes(m.user_id)}
                  onChange={() => toggleHost(m.user_id)}
                />
                <span>
                  {m.name ?? m.email}
                  {m.name && <span className="muted"> · {m.email}</span>}
                </span>
              </label>
            ))}
          </div>
        </section>
      )}

      <section className="panel rules-panel">
        <p className="section-label">{t('form.bookingRules')}</p>
        <div className="form-grid form-grid-3">
          <label className="field">
            <span className="prop-label">{t('form.bufferBefore')}</span>
            <input
              className="input"
              type="number"
              min={0}
              value={values.bufferBeforeMin}
              onChange={set('bufferBeforeMin')}
            />
          </label>
          <label className="field">
            <span className="prop-label">{t('form.bufferAfter')}</span>
            <input
              className="input"
              type="number"
              min={0}
              value={values.bufferAfterMin}
              onChange={set('bufferAfterMin')}
            />
          </label>
          <label className="field">
            <span className="prop-label">{t('form.minNotice')}</span>
            <input
              className="input"
              type="number"
              min={0}
              value={values.minNoticeHours}
              onChange={set('minNoticeHours')}
            />
          </label>
          <label className="field">
            <span className="prop-label">{t('form.maxFuture')}</span>
            <input
              className="input"
              type="number"
              min={1}
              value={values.maxFutureDays}
              onChange={set('maxFutureDays')}
            />
          </label>
          <label className="field checkbox-field">
            <input type="checkbox" checked={values.allowGuests} onChange={set('allowGuests')} />
            <span className="prop-label">{t('form.allowGuests')}</span>
          </label>
          <label className="field checkbox-field">
            <input type="checkbox" checked={values.singleUse} onChange={set('singleUse')} />
            <span className="prop-label">{t('form.singleUse')}</span>
          </label>
        </div>
        {values.singleUse && initial?.used_at && (
          <p className="muted hosts-help">{t('form.singleUseUsed')}</p>
        )}
      </section>

      <section className="panel fields-panel">
        <div className="panel-head">
          <p className="section-label">{t('form.customFields')}</p>
          <button type="button" className="btn btn-small" onClick={addField}>
            {t('form.addField')}
          </button>
        </div>
        {fields.length === 0 ? (
          <p className="muted">{t('form.noFields')}</p>
        ) : (
          <div className="custom-fields">
            {fields.map((f, i) => (
              <div key={i} className="custom-field-row">
                <input
                  className="input"
                  placeholder={t('form.fieldLabel')}
                  value={f.label}
                  onChange={(e) => updateField(i, { label: e.target.value })}
                />
                <input
                  className="input mono"
                  placeholder={t('form.fieldName')}
                  value={f.name}
                  onChange={(e) => updateField(i, { name: e.target.value })}
                />
                <select
                  className="select"
                  value={f.type}
                  onChange={(e) => updateField(i, { type: e.target.value as CustomFieldDef['type'] })}
                >
                  <option value="text">{t('form.fieldTypeText')}</option>
                  <option value="number">{t('form.fieldTypeNumber')}</option>
                  <option value="boolean">{t('form.fieldTypeBoolean')}</option>
                </select>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => updateField(i, { required: e.target.checked })}
                  />
                  <span>{t('form.fieldRequired')}</span>
                </label>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => removeField(i)}>
                  {t('common.remove')}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions cal-form-actions">
        <button type="submit" className="btn btn-solid" disabled={busy}>
          {busy
            ? t('common.saving')
            : saved
              ? t('common.saved')
              : initial
                ? t('common.save')
                : t('common.create')}
        </button>
      </div>
    </form>
  );
}

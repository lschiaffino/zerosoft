'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RemoveIcon } from './RowTools';
import DealCardFields, { type CardCustomDef } from './DealCardFields';
import LeadCardFields from './LeadCardFields';
import {
  CARD_PROPERTIES,
  LEAD_CARD_PROPERTIES,
  cardLabelKey,
  customLayoutName,
  LAYOUT_ENTITIES,
  MAX_CARD_PROPERTIES,
  MAX_PREVIEW_PROPERTIES,
  PREVIEW_PROPERTIES,
  PREVIEW_SECTIONS,
  previewLabelKey,
  sectionLabelKey,
  type CardLayout,
  type LayoutEntity,
  type PreviewLayout,
} from '@/lib/crm-layouts-shared';

export interface LayoutCustomField {
  entity: string;
  name: string;
  label: string;
  type: string;
  options?: string | null;
}

type Status = { kind: 'saved' | 'error'; text: string } | null;

/** Lista ordenada de propiedades con subir, bajar, quitar y agregar (como el formulario de alta). */
function KeyList({
  id,
  keys,
  available,
  labelOf,
  max,
  canEdit,
  busy,
  onChange,
}: {
  id: string;
  keys: string[];
  available: string[];
  labelOf: (key: string) => string;
  max: number;
  canEdit: boolean;
  busy: boolean;
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations('crm');
  const [adding, setAdding] = useState('');
  const move = (i: number, delta: number) => {
    const next = [...keys];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const full = keys.length >= max;
  return (
    <>
      {keys.length === 0 ? (
        <p className="muted layout-empty">{t('layouts.noProps')}</p>
      ) : (
        <ol className="create-form-list" data-testid={`${id}-list`}>
          {keys.map((k, i) => (
            <li key={k} className="create-form-row layout-row" data-testid={`${id}-row-${k}`}>
              <span className="create-form-name">
                {labelOf(k)}
                {customLayoutName(k) && <span className="muted create-form-note">{t('createForm.custom')}</span>}
              </span>
              <span className="create-form-tools">
                {canEdit && (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => move(i, -1)}
                      disabled={busy || i === 0}
                      aria-label={`${t('settings.moveUp')}: ${labelOf(k)}`}
                      title={t('settings.moveUp')}
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => move(i, 1)}
                      disabled={busy || i === keys.length - 1}
                      aria-label={`${t('settings.moveDown')}: ${labelOf(k)}`}
                      title={t('settings.moveDown')}
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-danger btn-sm btn-icon"
                      onClick={() => onChange(keys.filter((x) => x !== k))}
                      disabled={busy}
                      aria-label={`${t('layouts.remove')}: ${labelOf(k)}`}
                      title={t('layouts.remove')}
                      data-testid={`${id}-remove-${k}`}
                    >
                      <RemoveIcon />
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      {canEdit && (
        <form
          className="create-form-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!adding || keys.includes(adding) || full) return;
            onChange([...keys, adding]);
            setAdding('');
          }}
        >
          <select
            className="select"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            aria-label={t('layouts.addLabel')}
            disabled={busy || !available.length || full}
            data-testid={`${id}-add-select`}
          >
            <option value="">{full ? t('layouts.full', { max }) : available.length ? t('createForm.pick') : t('layouts.allAdded')}</option>
            {available.map((k) => (
              <option key={k} value={k}>
                {labelOf(k)}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !adding || full} data-testid={`${id}-add`}>
            {t('createForm.add')}
          </button>
        </form>
      )}
    </>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p className={status.kind === 'error' ? 'ui-error' : 'ui-help'} role={status.kind === 'error' ? 'alert' : 'status'}>
      {status.text}
    </p>
  );
}

/**
 * Ajustes › Datos › Vista previa de registros, como "Customize the preview
 * sidebar" de HubSpot: por objeto, qué propiedades muestra "Acerca de" y qué
 * tarjetas siguen debajo, en qué orden. Se guarda con cada cambio. Solo
 * owner y admins lo cambian; a los demás se les muestra tal cual.
 */
export function PreviewLayoutPanel({
  initial,
  customFields,
  canEdit,
  initialEntity = 'contacts',
}: {
  initial: Record<LayoutEntity, PreviewLayout>;
  customFields: LayoutCustomField[];
  canEdit: boolean;
  initialEntity?: LayoutEntity;
}) {
  const t = useTranslations('crm');
  const [entity, setEntity] = useState<LayoutEntity>(initialEntity);
  const [layouts, setLayouts] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const layout = layouts[entity];
  const customs = customFields.filter((f) => f.entity === entity);
  const customLabel = new Map(customs.map((f) => [`custom.${f.name}`, f.label]));
  const labelOf = (k: string) => customLabel.get(k) ?? (t.has(previewLabelKey(entity, k)) ? t(previewLabelKey(entity, k)) : k);
  const available = [...PREVIEW_PROPERTIES[entity], ...customs.map((f) => `custom.${f.name}`)].filter((k) => !layout.properties.includes(k));
  const hiddenSections = PREVIEW_SECTIONS[entity].filter((s) => !layout.sections.includes(s));

  async function save(next: PreviewLayout) {
    const prev = layouts[entity];
    setLayouts((l) => ({ ...l, [entity]: next }));
    setBusy(true);
    setStatus(null);
    const res = await fetch('/api/crm/layouts', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'preview', entity, ...next }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setLayouts((l) => ({ ...l, [entity]: prev }));
      setStatus({ kind: 'error', text: t('errors.generic') });
      return;
    }
    const saved = (await res.json().catch(() => null)) as { layout?: PreviewLayout } | null;
    if (saved?.layout) setLayouts((l) => ({ ...l, [entity]: saved.layout! }));
    setStatus({ kind: 'saved', text: t('createForm.saved') });
  }

  async function reset() {
    setBusy(true);
    setStatus(null);
    const res = await fetch(`/api/crm/layouts?kind=preview&entity=${entity}`, { method: 'DELETE' }).catch(() => null);
    const fresh = res?.ok
      ? await fetch(`/api/crm/layouts?kind=preview&entity=${entity}`)
          .then((r) => (r.ok ? (r.json() as Promise<{ layout: PreviewLayout }>) : null))
          .catch(() => null)
      : null;
    setBusy(false);
    if (!fresh) {
      setStatus({ kind: 'error', text: t('errors.generic') });
      return;
    }
    setLayouts((l) => ({ ...l, [entity]: fresh.layout }));
    setStatus({ kind: 'saved', text: t('createForm.saved') });
  }

  const moveSection = (i: number, delta: number) => {
    const next = [...layout.sections];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    void save({ ...layout, sections: next });
  };

  return (
    <div className="create-form layout-panel" data-testid="preview-layout-panel">
      <div className="ui-field create-form-object">
        <label className="label" htmlFor="preview-layout-entity">
          {t('createForm.object')}
        </label>
        <select
          id="preview-layout-entity"
          className="select"
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value as LayoutEntity);
            setStatus(null);
          }}
        >
          {LAYOUT_ENTITIES.map((en) => (
            <option key={en} value={en}>
              {t(`settings.entities.${en}`)}
            </option>
          ))}
        </select>
      </div>

      <h3 className="layout-sub">{t(`layouts.about.${entity}`)}</h3>
      <p className="ui-help layout-sub-help">{t('layouts.aboutHelp')}</p>
      <KeyList
        key={`props-${entity}`}
        id="preview-layout-props"
        keys={layout.properties}
        available={available}
        labelOf={labelOf}
        max={MAX_PREVIEW_PROPERTIES}
        canEdit={canEdit}
        busy={busy}
        onChange={(properties) => void save({ ...layout, properties })}
      />

      <h3 className="layout-sub">{t('layouts.cardsTitle')}</h3>
      <p className="ui-help layout-sub-help">{t('layouts.cardsHelp')}</p>
      <ol className="create-form-list" data-testid="preview-layout-sections">
        {layout.sections.map((s, i) => (
          <li key={s} className="create-form-row layout-row" data-testid={`preview-layout-section-${s}`}>
            <span className="create-form-name">{t(sectionLabelKey(entity, s))}</span>
            <span className="create-form-tools">
              {canEdit && (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    onClick={() => moveSection(i, -1)}
                    disabled={busy || i === 0}
                    aria-label={`${t('settings.moveUp')}: ${t(sectionLabelKey(entity, s))}`}
                    title={t('settings.moveUp')}
                  >
                    <span aria-hidden="true">↑</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    onClick={() => moveSection(i, 1)}
                    disabled={busy || i === layout.sections.length - 1}
                    aria-label={`${t('settings.moveDown')}: ${t(sectionLabelKey(entity, s))}`}
                    title={t('settings.moveDown')}
                  >
                    <span aria-hidden="true">↓</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm layout-hide"
                    onClick={() => void save({ ...layout, sections: layout.sections.filter((x) => x !== s) })}
                    disabled={busy}
                    aria-label={`${t('layouts.hide')}: ${t(sectionLabelKey(entity, s))}`}
                    data-testid={`preview-layout-hide-${s}`}
                  >
                    {t('layouts.hide')}
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
      {hiddenSections.length > 0 && (
        <div className="layout-hidden">
          <span className="ui-help">{t('layouts.hiddenCards')}</span>
          <ul className="layout-hidden-list">
            {hiddenSections.map((s) => (
              <li key={s}>
                <span>{t(sectionLabelKey(entity, s))}</span>
                {canEdit && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void save({ ...layout, sections: [...layout.sections, s] })}
                    disabled={busy}
                    aria-label={`${t('layouts.show')}: ${t(sectionLabelKey(entity, s))}`}
                    data-testid={`preview-layout-show-${s}`}
                  >
                    {t('layouts.show')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canEdit ? (
        <div className="layout-foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reset()} disabled={busy} data-testid="preview-layout-reset">
            {t('createForm.reset')}
          </button>
          <p className="ui-help">{t('layouts.privacyHelp')}</p>
        </div>
      ) : (
        <p className="ui-help">{t('common.adminOnly')}</p>
      )}
      <StatusLine status={status} />
    </div>
  );
}

/** Valor del selector de board para el de leads (los demás son ids de pipeline). */
export const LEAD_BOARD = 'leads';

/**
 * Ajustes › Ventas › Tarjetas del board, como "Edit cards" de HubSpot: por
 * pipeline de deals y para el board de leads, hasta MAX_CARD_PROPERTIES
 * propiedades debajo del nombre, con una tarjeta de muestra al lado.
 */
export function CardLayoutPanel({
  pipelines,
  initial,
  customFields,
  canEdit,
  initialPipelineId,
  baseCurrency,
  locale,
  me,
  leadLayout,
  leadCustomFields = [],
}: {
  pipelines: Array<{ id: string; name: string }>;
  initial: Record<string, CardLayout>;
  customFields: CardCustomDef[];
  /** Tarjetas del board de leads (sin él, el selector solo ofrece pipelines). */
  leadLayout?: CardLayout;
  leadCustomFields?: CardCustomDef[];
  canEdit: boolean;
  initialPipelineId?: string;
  baseCurrency: string;
  locale: string;
  /** Quien mira (para las iniciales de la muestra). */
  me: { id: string; name: string };
}) {
  const t = useTranslations('crm');
  const [pipelineId, setPipelineId] = useState(
    initialPipelineId && (pipelines.some((p) => p.id === initialPipelineId) || (leadLayout && initialPipelineId === LEAD_BOARD))
      ? initialPipelineId
      : (pipelines[0]?.id ?? (leadLayout ? LEAD_BOARD : '')),
  );
  const [layouts, setLayouts] = useState<Record<string, CardLayout>>(() => (leadLayout ? { ...initial, [LEAD_BOARD]: leadLayout } : initial));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  if (!pipelines.length && !leadLayout) return <p className="ui-help">{t('layouts.noPipelines')}</p>;
  const isLeads = pipelineId === LEAD_BOARD;
  const entity = isLeads ? 'leads' : 'deals';
  const fieldsHere = isLeads ? leadCustomFields : customFields;
  const layout = layouts[pipelineId] ?? { properties: [] };
  const customLabel = new Map(fieldsHere.map((f) => [`custom.${f.name}`, f.label]));
  const labelOf = (k: string) => customLabel.get(k) ?? (t.has(cardLabelKey(k, entity)) ? t(cardLabelKey(k, entity)) : k);
  const builtins: readonly string[] = isLeads ? LEAD_CARD_PROPERTIES : CARD_PROPERTIES;
  const available = [...builtins, ...fieldsHere.map((f) => `custom.${f.name}`)].filter((k) => !layout.properties.includes(k));
  const target = isLeads ? { entity: 'leads' } : { pipelineId };
  const targetQuery = isLeads ? 'entity=leads' : `pipelineId=${encodeURIComponent(pipelineId)}`;

  async function save(next: CardLayout) {
    const prev = layouts[pipelineId];
    setLayouts((l) => ({ ...l, [pipelineId]: next }));
    setBusy(true);
    setStatus(null);
    const res = await fetch('/api/crm/layouts', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'card', ...target, ...next }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setLayouts((l) => ({ ...l, [pipelineId]: prev }));
      setStatus({ kind: 'error', text: t('errors.generic') });
      return;
    }
    const saved = (await res.json().catch(() => null)) as { layout?: CardLayout } | null;
    if (saved?.layout) setLayouts((l) => ({ ...l, [pipelineId]: saved.layout! }));
    setStatus({ kind: 'saved', text: t('createForm.saved') });
  }

  async function reset() {
    setBusy(true);
    setStatus(null);
    const res = await fetch(`/api/crm/layouts?kind=card&${targetQuery}`, { method: 'DELETE' }).catch(() => null);
    const fresh = res?.ok
      ? await fetch(`/api/crm/layouts?kind=card&${targetQuery}`)
          .then((r) => (r.ok ? (r.json() as Promise<{ layout: CardLayout }>) : null))
          .catch(() => null)
      : null;
    setBusy(false);
    if (!fresh) {
      setStatus({ kind: 'error', text: t('errors.generic') });
      return;
    }
    setLayouts((l) => ({ ...l, [pipelineId]: fresh.layout }));
    setStatus({ kind: 'saved', text: t('createForm.saved') });
  }

  // Tarjeta de muestra: valores de ejemplo, con las fechas cerca de hoy.
  const now = new Date();
  const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  const sample = {
    amount: 12000,
    currency: baseCurrency,
    company_name: t('layouts.sample.company'),
    contact_name: t('layouts.sample.contact'),
    close_date: inDays(30),
    owner_id: me.id,
    priority: 'high',
    deal_type: 'newbusiness',
    source: 'referral',
    next_step: t('layouts.sample.nextStep'),
    created_at: `${inDays(-12)} 12:00:00`,
    last_activity_at: `${inDays(-2)} 12:00:00`,
    custom: JSON.stringify(Object.fromEntries(customFields.map((f) => [f.name, f.label]))),
  };
  // Las personalizadas de muestra muestran su nombre como valor (texto), sin inventar datos.
  const sampleDefs = fieldsHere.map((f) => ({ ...f, type: 'text', options: null }));
  const sampleLead = {
    contact: t('layouts.sample.contact'),
    company: t('layouts.sample.company'),
    owner: me.name,
    source: 'referral',
    created_at: sample.created_at,
    last_activity_at: sample.last_activity_at,
    custom: JSON.stringify(Object.fromEntries(leadCustomFields.map((f) => [f.name, f.label]))),
  };

  return (
    <div className="create-form layout-panel layout-cards" data-testid="card-layout-panel">
      <div className="layout-cards-edit">
        <div className="ui-field create-form-object">
          <label className="label" htmlFor="card-layout-pipeline">
            {leadLayout ? t('layouts.boardLabel') : t('deals.pipelineLabel')}
          </label>
          <select
            id="card-layout-pipeline"
            className="select"
            value={pipelineId}
            onChange={(e) => {
              setPipelineId(e.target.value);
              setStatus(null);
            }}
          >
            {leadLayout ? (
              <>
                {pipelines.length > 0 && (
                  <optgroup label={t('layouts.dealBoards')}>
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value={LEAD_BOARD}>{t('layouts.leadBoard')}</option>
              </>
            ) : (
              pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
        </div>
        <KeyList
          key={`card-${pipelineId}`}
          id="card-layout-props"
          keys={layout.properties}
          available={available}
          labelOf={labelOf}
          max={MAX_CARD_PROPERTIES}
          canEdit={canEdit}
          busy={busy}
          onChange={(properties) => void save({ properties })}
        />
        {canEdit ? (
          <div className="layout-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reset()} disabled={busy} data-testid="card-layout-reset">
              {t('createForm.reset')}
            </button>
            <p className="ui-help">{t('layouts.cardPrivacyHelp', { max: MAX_CARD_PROPERTIES })}</p>
          </div>
        ) : (
          <p className="ui-help">{t('common.adminOnly')}</p>
        )}
        <StatusLine status={status} />
      </div>
      <figure className="layout-cards-sample" aria-label={t('layouts.sampleLabel')}>
        <figcaption className="ui-help">{t('layouts.sampleLabel')}</figcaption>
        <article className="kb-card layout-sample-card" data-testid="card-layout-sample">
          {isLeads ? (
            <>
              <span className="kb-card-name">{t('layouts.sample.lead')}</span>
              <LeadCardFields lead={sampleLead} keys={layout.properties} customDefs={sampleDefs} locale={locale} />
            </>
          ) : (
            <>
              <span className="kb-card-name">{t('layouts.sample.deal')}</span>
              <DealCardFields
                deal={sample}
                keys={layout.properties}
                customDefs={sampleDefs}
                owners={new Map([[me.id, me.name]])}
                locale={locale}
              />
            </>
          )}
        </article>
      </figure>
    </div>
  );
}

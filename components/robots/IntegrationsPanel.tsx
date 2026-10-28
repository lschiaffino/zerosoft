'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  CRM_COMPANY_FIELDS,
  CRM_CONTACT_FIELDS,
  MAX_DESTINATIONS,
  listVariables,
  type RobotDestination,
  type RobotSettings,
  type RobotStep,
} from '@/lib/robots-schema';
import FormSection from '@/components/ui/FormSection';

type Kind = RobotDestination['kind'];

function newDestination(kind: Kind): RobotDestination {
  const id = Math.random().toString(36).slice(2, 10);
  if (kind === 'crm') return { id, kind, enabled: true, variable: '', object: 'contacts', mapping: {}, onExisting: 'fill' };
  if (kind === 'sheets') return { id, kind, enabled: true, variable: '', credential: '', spreadsheetId: '', sheet: 'Sheet1', mode: 'sync' };
  return { id, kind, enabled: true, variable: '', credential: '', baseId: '', table: '', mergeField: '' };
}

/** Pestaña Integraciones: email con los cambios y envíos a CRM, Google Sheets y Airtable. */
export default function IntegrationsPanel({
  steps,
  settings,
  onSettings,
  readOnly,
  columns,
  changesPerDay,
  usesLogin,
  flowSection,
}: {
  steps: RobotStep[];
  settings: RobotSettings;
  onSettings: (s: RobotSettings) => void;
  readOnly: boolean;
  /** Columnas conocidas (de la última corrida) para los mapeos. */
  columns: string[];
  changesPerDay: number;
  /** El robot inicia sesión (credenciales o sesión guardada): aviso al enviar datos. */
  usesLogin: boolean;
  /** Sección "Flow, webhooks y API". */
  flowSection: React.ReactNode;
}) {
  const t = useTranslations('robots.integrations');
  const uid = useId();
  const [addKind, setAddKind] = useState<Kind>('crm');
  const change = settings.changeEmail ?? { enabled: false, to: [] };
  const [toText, setToText] = useState((change.to ?? []).join(', '));
  const dests = settings.destinations ?? [];
  const lists = listVariables(steps);

  const setDest = (i: number, next: RobotDestination) => onSettings({ ...settings, destinations: dests.map((d, k) => (k === i ? next : d)) });

  return (
    <div className="robots-advanced">
      <FormSection title={t('changeTitle')} description={t('changeDesc')}>
        <label className="ui-switch">
          <input
            type="checkbox"
            role="switch"
            checked={change.enabled === true}
            disabled={readOnly}
            onChange={(e) => onSettings({ ...settings, changeEmail: { enabled: e.target.checked, to: change.to ?? [] } })}
          />
          <span>{t('changeOn')}</span>
        </label>
        {change.enabled && (
          <div className="ui-field">
            <label className="label" htmlFor={`${uid}-to`}>
              {t('changeTo')}
            </label>
            <input
              id={`${uid}-to`}
              className="input"
              type="text"
              inputMode="email"
              value={toText}
              readOnly={readOnly}
              aria-describedby={`${uid}-to-help`}
              onChange={(e) => {
                setToText(e.target.value);
                const to = e.target.value
                  .split(/[,;\s]+/)
                  .map((x) => x.trim())
                  .filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))
                  .slice(0, 10);
                onSettings({ ...settings, changeEmail: { enabled: true, to } });
              }}
            />
            <p className="ui-help" id={`${uid}-to-help`}>
              {t('changeToHint', { max: changesPerDay })}
            </p>
          </div>
        )}
      </FormSection>

      <FormSection title={t('destTitle')} description={t('destDesc')}>
        {usesLogin && <p className="robots-note-warn">{t('loginWarning')}</p>}
        {dests.length === 0 && <p className="robots-muted robots-small">{t('empty')}</p>}
        <ol className="robots-steplist">
          {dests.map((d, i) => (
            <li key={d.id} className="robots-step">
              <div className="robots-step-head">
                <span className="robots-step-num data">{i + 1}</span>
                <h3 className="robots-step-type">{t(`kinds.${d.kind}`)}</h3>
                <label className="ui-check">
                  <input type="checkbox" checked={d.enabled !== false} disabled={readOnly} onChange={(e) => setDest(i, { ...d, enabled: e.target.checked })} />
                  <span>{t('enabled')}</span>
                </label>
                {!readOnly && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSettings({ ...settings, destinations: dests.filter((_, k) => k !== i) })}>
                    {t('remove')}
                  </button>
                )}
              </div>
              <div className="robots-step-body">
                <p className="ui-help">{t(`kindHints.${d.kind}`)}</p>
                <div className="robots-fields">
                  <div className="ui-field">
                    <label className="label" htmlFor={`${uid}-${d.id}-var`}>
                      {t('variable')}
                    </label>
                    <select id={`${uid}-${d.id}-var`} className="select" value={d.variable ?? ''} disabled={readOnly} onChange={(e) => setDest(i, { ...d, variable: e.target.value })}>
                      <option value="">{t('variableDataset')}</option>
                      {lists.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  {d.kind === 'crm' && (
                    <CrmFields dest={d} readOnly={readOnly} columns={columns} onChange={(next) => setDest(i, next)} />
                  )}
                  {d.kind === 'sheets' && (
                    <>
                      <TextField label={t('credential')} value={d.credential} readOnly={readOnly} onChange={(v) => setDest(i, { ...d, credential: v })} hint={t('credentialHint')} />
                      <TextField label={t('spreadsheetId')} value={d.spreadsheetId} readOnly={readOnly} onChange={(v) => setDest(i, { ...d, spreadsheetId: v.trim() })} hint={t('spreadsheetHint')} />
                      <TextField label={t('sheet')} value={d.sheet} readOnly={readOnly} onChange={(v) => setDest(i, { ...d, sheet: v })} />
                      <div className="ui-field">
                        <label className="label" htmlFor={`${uid}-${d.id}-mode`}>
                          {t('mode')}
                        </label>
                        <select id={`${uid}-${d.id}-mode`} className="select" value={d.mode} disabled={readOnly} onChange={(e) => setDest(i, { ...d, mode: e.target.value as 'sync' | 'append' })}>
                          <option value="sync">{t('modes.sync')}</option>
                          <option value="append">{t('modes.append')}</option>
                        </select>
                      </div>
                    </>
                  )}
                  {d.kind === 'airtable' && (
                    <>
                      <TextField label={t('credential')} value={d.credential} readOnly={readOnly} onChange={(v) => setDest(i, { ...d, credential: v })} hint={t('credentialHint')} />
                      <TextField label={t('baseId')} value={d.baseId} readOnly={readOnly} onChange={(v) => setDest(i, { ...d, baseId: v.trim() })} hint={t('baseHint')} />
                      <TextField label={t('table')} value={d.table} readOnly={readOnly} onChange={(v) => setDest(i, { ...d, table: v })} />
                      <TextField label={t('mergeField')} value={d.mergeField ?? ''} readOnly={readOnly} onChange={(v) => setDest(i, { ...d, mergeField: v })} hint={t('mergeHint')} />
                    </>
                  )}
                </div>
                {(d.kind === 'sheets' || d.kind === 'airtable') && (
                  <Link href="/app/flow/credentials" className="robots-link">
                    {t('credentialsLink')}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
        {!readOnly && dests.length < MAX_DESTINATIONS && (
          <div className="robots-add">
            <select className="select" value={addKind} aria-label={t('addLabel')} onChange={(e) => setAddKind(e.target.value as Kind)}>
              {(['crm', 'sheets', 'airtable'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSettings({ ...settings, destinations: [...dests, newDestination(addKind)] })}>
              {t('add')}
            </button>
          </div>
        )}
      </FormSection>

      {flowSection}
    </div>
  );
}

function TextField({ label, value, onChange, readOnly, hint }: { label: string; value: string; onChange: (v: string) => void; readOnly: boolean; hint?: string }) {
  const id = useId();
  return (
    <div className="ui-field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="input data" value={value} readOnly={readOnly} spellCheck={false} autoComplete="off" onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-h` : undefined} />
      {hint && (
        <p className="ui-help" id={`${id}-h`}>
          {hint}
        </p>
      )}
    </div>
  );
}

function CrmFields({
  dest,
  readOnly,
  columns,
  onChange,
}: {
  dest: Extract<RobotDestination, { kind: 'crm' }>;
  readOnly: boolean;
  columns: string[];
  onChange: (d: Extract<RobotDestination, { kind: 'crm' }>) => void;
}) {
  const t = useTranslations('robots.integrations');
  const uid = useId();
  const fields = dest.object === 'contacts' ? CRM_CONTACT_FIELDS : CRM_COMPANY_FIELDS;
  return (
    <>
      <div className="ui-field">
        <label className="label" htmlFor={`${uid}-obj`}>
          {t('object')}
        </label>
        <select
          id={`${uid}-obj`}
          className="select"
          value={dest.object}
          disabled={readOnly}
          onChange={(e) => onChange({ ...dest, object: e.target.value as 'contacts' | 'companies', mapping: {} })}
        >
          <option value="contacts">{t('objects.contacts')}</option>
          <option value="companies">{t('objects.companies')}</option>
        </select>
      </div>
      <div className="ui-field">
        <label className="label" htmlFor={`${uid}-onex`}>
          {t('onExisting')}
        </label>
        <select
          id={`${uid}-onex`}
          className="select"
          value={dest.onExisting ?? 'fill'}
          disabled={readOnly}
          onChange={(e) => onChange({ ...dest, onExisting: e.target.value as 'fill' | 'skip' | 'overwrite' })}
        >
          <option value="fill">{t('onExistingOptions.fill')}</option>
          <option value="skip">{t('onExistingOptions.skip')}</option>
          <option value="overwrite">{t('onExistingOptions.overwrite')}</option>
        </select>
      </div>
      <fieldset className="robots-wide robots-mapping">
        <legend className="label">{t('mapping')}</legend>
        <p className="ui-help">{t('mappingHint')}</p>
        <div className="robots-fields">
          {fields.map((f) => (
            <div key={f} className="ui-field">
              <label className="label" htmlFor={`${uid}-${f}`}>
                {t(`fields.${f}`)}
              </label>
              <input
                id={`${uid}-${f}`}
                className="input data"
                list={`${uid}-cols`}
                value={dest.mapping[f] ?? ''}
                readOnly={readOnly}
                placeholder={t('none')}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => {
                  const mapping = { ...dest.mapping };
                  if (e.target.value.trim()) mapping[f] = e.target.value.trim().slice(0, 60);
                  else delete mapping[f];
                  onChange({ ...dest, mapping });
                }}
              />
            </div>
          ))}
        </div>
        <datalist id={`${uid}-cols`}>
          {columns.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </fieldset>
    </>
  );
}

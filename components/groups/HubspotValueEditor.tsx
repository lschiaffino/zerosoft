'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { hubspotMulti, hubspotTime, type HubspotOwner, type HubspotPropDef } from '@/lib/groups-hubspot-shared';

/** datetime-local ↔ ISO: el campo trabaja en la hora de la persona. */
function toLocalInput(value: string): string {
  const ms = hubspotTime(value);
  if (ms === null) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  if (!value) return '';
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}

/** El valor de una fecha de HubSpot (ISO o milisegundos) como lo quiere <input type="date">. */
function toDateInput(value: string): string {
  const ms = hubspotTime(value);
  return ms === null ? '' : new Date(ms).toISOString().slice(0, 10);
}

/**
 * El editor de una propiedad de HubSpot según su tipo. Enter guarda (salvo en
 * el texto largo), Esc cancela. Lo usan el panel de HubSpot del chat y la
 * edición en la celda de la tabla de grupos.
 */
export default function HubspotValueEditor({
  def,
  value,
  owners,
  onSave,
  onCancel,
}: {
  def: HubspotPropDef;
  value: string;
  owners: HubspotOwner[];
  onSave: (raw: string | string[]) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('groups');
  const [draft, setDraft] = useState(() => (def.kind === 'date' ? toDateInput(value) : def.kind === 'datetime' ? toLocalInput(value) : value));
  const [picked, setPicked] = useState<string[]>(() => hubspotMulti(value));
  const label = t('hubspot.screen.valueOf', { label: def.label });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (def.kind === 'multi') onSave(picked);
    else if (def.kind === 'datetime') onSave(fromLocalInput(draft));
    else onSave(draft);
  };
  let field;
  if (def.kind === 'textarea') {
    field = <textarea className="textarea" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} rows={4} maxLength={10000} autoFocus />;
  } else if (def.kind === 'number') {
    field = <input className="input" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} maxLength={40} autoFocus />;
  } else if (def.kind === 'date') {
    field = <input className="input" type="date" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} autoFocus />;
  } else if (def.kind === 'datetime') {
    field = <input className="input" type="datetime-local" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} autoFocus />;
  } else if (def.kind === 'bool') {
    field = (
      <label className="gr-check-label gr-hsx-option">
        <input type="checkbox" className="ui-check" checked={draft === 'true'} onChange={(e) => setDraft(e.target.checked ? 'true' : 'false')} autoFocus />
        {def.label}
      </label>
    );
  } else if (def.kind === 'multi') {
    // Un valor guardado que ya no es una opción se sigue viendo, para poder sacarlo.
    const options = [...def.options, ...picked.filter((v) => !def.options.some((o) => o.value === v)).map((v) => ({ label: v, value: v }))];
    field = (
      <fieldset className="gr-hsx-options" aria-label={label}>
        {options.map((o) => (
          <label key={o.value} className="gr-check-label gr-hsx-option">
            <input
              type="checkbox"
              className="ui-check"
              checked={picked.includes(o.value)}
              onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, o.value] : cur.filter((v) => v !== o.value)))}
            />
            {o.label}
          </label>
        ))}
      </fieldset>
    );
  } else if (def.kind === 'owner' && owners.length > 0) {
    field = (
      <select className="select" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} autoFocus>
        <option value="">{t('hubspot.screen.noOwner')}</option>
        {!owners.some((o) => o.id === draft) && draft && <option value={draft}>{draft}</option>}
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  } else if (def.kind === 'select' && def.options.length > 0) {
    field = (
      <select className="select" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} autoFocus>
        <option value="">{t('hubspot.screen.noValue')}</option>
        {!def.options.some((o) => o.value === draft) && draft && <option value={draft}>{draft}</option>}
        {def.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else {
    field = <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} maxLength={10000} autoFocus />;
  }
  return (
    <form className="gr-hsx-editor" onSubmit={submit}>
      {field}
      <div className="gr-hsx-editor-actions">
        <button type="submit" className="btn btn-primary btn-sm">
          {t('common.save')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

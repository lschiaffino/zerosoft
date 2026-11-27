'use client';

import { useTranslations } from 'next-intl';
import { FORM_FIELD_TYPES, MAX_FIELD_OPTIONS, MAX_FORM_FIELDS, newFieldId, type TrackFormField, type TrackFormFieldType } from '@/lib/track-forms';

/** Campo mientras se edita: las opciones como texto, una por línea. */
export interface DraftFormField {
  id: string;
  label: string;
  type: TrackFormFieldType;
  required: boolean;
  help: string;
  options: string;
}

export function toDraftFields(fields: TrackFormField[]): DraftFormField[] {
  return fields.map((f) => ({ id: f.id, label: f.label, type: f.type, required: Boolean(f.required), help: f.help ?? '', options: (f.options ?? []).join('\n') }));
}

/** Lo que se manda al guardar: sin campos sin nombre ni listas sin opciones. */
export function fromDraftFields(fields: DraftFormField[]): Array<Omit<TrackFormField, 'options' | 'help'> & { options?: string[]; help?: string }> {
  return fields
    .filter((f) => f.label.trim())
    .map((f) => {
      const options = f.options
        .split('\n')
        .map((o) => o.trim())
        .filter(Boolean)
        .slice(0, MAX_FIELD_OPTIONS);
      return {
        id: f.id,
        label: f.label.trim(),
        type: f.type === 'select' && options.length === 0 ? 'text' : f.type,
        required: f.required,
        help: f.help.trim() || undefined,
        options: f.type === 'select' && options.length ? options : undefined,
      };
    });
}

/**
 * Campos del formulario de pedidos dentro del editor de plantillas: nombre,
 * tipo, obligatorio, ayuda y opciones; subir, bajar y quitar.
 */
export default function FormFieldsEditor({ idPrefix, value, onChange }: { idPrefix: string; value: DraftFormField[]; onChange: (next: DraftFormField[]) => void }) {
  const t = useTranslations('track');
  const patch = (i: number, p: Partial<DraftFormField>) => onChange(value.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () => onChange([...value, { id: newFieldId(value), label: '', type: 'text', required: false, help: '', options: '' }]);

  return (
    <fieldset className="track-form-fields" data-testid="track-form-fields">
      <legend className="label">{t('forms.fieldsTitle')}</legend>
      <p className="ui-help">{t('forms.fieldsHelp')}</p>
      {value.length > 0 && (
        <ol className="track-form-field-list">
          {value.map((f, i) => {
            const p = `${idPrefix}-field-${f.id}`;
            return (
              <li key={f.id} className="track-form-field" data-testid="track-form-field">
                <div className="track-form-field-main">
                  <div className="ui-field">
                    <label className="label" htmlFor={`${p}-label`}>
                      {t('forms.fieldLabel')}
                    </label>
                    <input
                      id={`${p}-label`}
                      className="input"
                      value={f.label}
                      maxLength={200}
                      placeholder={t('forms.fieldLabelPlaceholder')}
                      onChange={(e) => patch(i, { label: e.target.value })}
                      data-testid="track-form-field-label"
                    />
                  </div>
                  <div className="ui-field track-form-field-type">
                    <label className="label" htmlFor={`${p}-type`}>
                      {t('forms.fieldType')}
                    </label>
                    <select
                      id={`${p}-type`}
                      className="select"
                      value={f.type}
                      onChange={(e) => patch(i, { type: e.target.value as TrackFormFieldType })}
                      data-testid="track-form-field-type"
                    >
                      {FORM_FIELD_TYPES.map((ty) => (
                        <option key={ty} value={ty}>
                          {t(`forms.types.${ty}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {f.type === 'select' && (
                  <div className="ui-field">
                    <label className="label" htmlFor={`${p}-options`}>
                      {t('forms.fieldOptions')}
                    </label>
                    <textarea
                      id={`${p}-options`}
                      className="textarea"
                      rows={3}
                      value={f.options}
                      placeholder={t('forms.fieldOptionsPlaceholder')}
                      onChange={(e) => patch(i, { options: e.target.value })}
                      data-testid="track-form-field-options"
                    />
                  </div>
                )}
                <div className="ui-field">
                  <label className="label" htmlFor={`${p}-help`}>
                    {t('forms.fieldHelp')} <span className="ui-optional">{t('common.optional')}</span>
                  </label>
                  <input id={`${p}-help`} className="input" value={f.help} maxLength={300} onChange={(e) => patch(i, { help: e.target.value })} />
                </div>
                <div className="track-form-field-foot">
                  <label className="ui-check">
                    <input type="checkbox" checked={f.required} onChange={(e) => patch(i, { required: e.target.checked })} data-testid="track-form-field-required" />
                    <span>{t('forms.fieldRequired')}</span>
                  </label>
                  <div className="track-form-field-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('forms.moveUp', { name: f.label || String(i + 1) })}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => move(i, 1)}
                      disabled={i === value.length - 1}
                      aria-label={t('forms.moveDown', { name: f.label || String(i + 1) })}
                    >
                      ↓
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(value.filter((_, j) => j !== i))} data-testid="track-form-field-remove">
                      {t('forms.removeField')}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {value.length < MAX_FORM_FIELDS && (
        <button type="button" className="btn btn-sm" onClick={add} data-testid="track-form-add-field">
          {t('forms.addField')}
        </button>
      )}
    </fieldset>
  );
}

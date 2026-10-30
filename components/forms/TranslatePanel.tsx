'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { translatableStrings } from '@/lib/forms/engine';
import { FORM_LANGS, type FormDefinition, type FormLang } from '@/lib/forms/types';

type SetDef = (fn: (d: FormDefinition) => FormDefinition) => void;

/** Idioma base, idiomas extra y la traducción de cada texto (lo que falta queda en el idioma base). */
export default function TranslatePanel({ def, setDef }: { def: FormDefinition; setDef: SetDef }) {
  const t = useTranslations('forms.builder.translate');
  const tl = useTranslations('forms.langs');
  const strings = useMemo(() => translatableStrings(def), [def]);
  const extra = def.languages.filter((l) => l !== def.lang);
  return (
    <div className="ui-fields fm-translate">
      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor="fm-base-lang">
            {t('base')}
          </label>
          <select id="fm-base-lang" className="select" value={def.lang} onChange={(e) => setDef((d) => ({ ...d, lang: e.target.value as FormLang, languages: d.languages.filter((l) => l !== e.target.value) }))}>
            {FORM_LANGS.map((l) => (
              <option key={l} value={l}>
                {tl(l)}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="fm-radio-row">
          <legend className="label">{t('extra')}</legend>
          {FORM_LANGS.filter((l) => l !== def.lang).map((l) => (
            <label key={l} className="ui-check">
              <input
                type="checkbox"
                checked={def.languages.includes(l)}
                onChange={(e) => setDef((d) => ({ ...d, languages: e.target.checked ? [...d.languages.filter((x) => x !== l), l] : d.languages.filter((x) => x !== l) }))}
              />
              <span>{tl(l)}</span>
            </label>
          ))}
        </fieldset>
      </div>
      <p className="ui-help">{t('help')}</p>
      {extra.length > 0 && strings.length > 0 && (
        <div className="table-wrap">
          <table className="table fm-tr-table">
            <thead>
              <tr>
                <th scope="col">{tl(def.lang)}</th>
                {extra.map((l) => (
                  <th key={l} scope="col">
                    {tl(l)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {strings.map((s) => (
                <tr key={s.key}>
                  <th scope="row" className="fm-tr-source">
                    {s.source}
                  </th>
                  {extra.map((l) => (
                    <td key={l}>
                      <textarea
                        className="textarea fm-tr-input"
                        rows={1}
                        aria-label={t('inputLabel', { lang: tl(l), text: s.source.slice(0, 60) })}
                        value={def.translations[l]?.[s.key] ?? ''}
                        maxLength={2000}
                        onChange={(e) => setDef((d) => ({ ...d, translations: { ...d.translations, [l]: { ...(d.translations[l] ?? {}), [s.key]: e.target.value } } }))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

'use client';

import { useTranslations } from 'next-intl';

interface FolderSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Carpetas en las que quien mira puede editar. */
  folders: Array<{ id: string; name: string }>;
}

/** Campo "Carpeta" de los formularios de link ('' = sin carpeta). */
export default function FolderSelect({ id, value, onChange, folders }: FolderSelectProps) {
  const t = useTranslations('link');
  return (
    <div className="ui-field">
      <label className="label" htmlFor={id}>
        {t('folders.field')} <span className="ui-optional">{t('common.optional')}</span>
      </label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('folders.noFolder')}</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </div>
  );
}

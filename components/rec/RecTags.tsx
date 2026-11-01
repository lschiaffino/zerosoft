'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cleanTag, MAX_REC_TAGS } from '@/lib/rec-schema';

/** Etiquetas de un video: Enter o coma las agrega, Retroceso con el campo vacío saca la última. */
export default function RecTags({ tags, canEdit, busy, onSave }: { tags: string[]; canEdit: boolean; busy: boolean; onSave: (next: string[]) => void }) {
  const t = useTranslations('rec.tags');
  const [draft, setDraft] = useState('');

  function add() {
    const tag = cleanTag(draft);
    setDraft('');
    if (!tag || tags.includes(tag) || tags.length >= MAX_REC_TAGS) return;
    onSave([...tags, tag]);
  }

  return (
    <div className="ui-field rec-tags-field" data-testid="rec-tags">
      <label className="label" htmlFor="rec-tag-input">
        {t('label')}
      </label>
      {tags.length > 0 ? (
        <ul className="rec-tags" aria-label={t('label')}>
          {tags.map((tag) => (
            <li key={tag} className="rec-tag" data-testid="rec-tag">
              <span>#{tag}</span>
              {canEdit && (
                <button type="button" className="rec-tag-x" aria-label={t('remove', { tag })} disabled={busy} onClick={() => onSave(tags.filter((x) => x !== tag))}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                    <path d="M5 5l14 14M19 5L5 19" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !canEdit && <p className="ui-help">{t('none')}</p>
      )}
      {canEdit && (
        <>
          <input
            id="rec-tag-input"
            className="input"
            value={draft}
            maxLength={40}
            placeholder={t('placeholder')}
            disabled={tags.length >= MAX_REC_TAGS}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft.trim() && add()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                add();
              } else if (e.key === 'Backspace' && !draft && tags.length) {
                onSave(tags.slice(0, -1));
              }
            }}
            data-testid="rec-tag-input"
          />
          <p className="ui-help">{tags.length >= MAX_REC_TAGS ? t('limit', { n: MAX_REC_TAGS }) : t('help')}</p>
        </>
      )}
    </div>
  );
}

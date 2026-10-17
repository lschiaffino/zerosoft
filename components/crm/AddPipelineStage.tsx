'use client';

import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';

/** Chip "+ Add pipeline" junto a los tabs de pipelines. */
export function AddPipelineChip() {
  const t = useTranslations('crm.deals');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const res = await fetch('/api/crm/pipelines', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setName('');
      setOpen(false);
      router.refresh();
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        {t('addPipeline')}
      </button>
    );
  }
  return (
    <span className="chip-add-input">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={t('pipelineNamePlaceholder')}
        maxLength={100}
        disabled={busy}
      />
      <button type="button" onClick={() => void submit()} disabled={busy || !name.trim()}>
        +
      </button>
    </span>
  );
}

/** Columna "+ Add stage" al final del board. */
export function AddStageColumn({ pipelineId }: { pipelineId: string }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const res = await fetch(`/api/crm/pipelines/${pipelineId}/stages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setName('');
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <div className="kb-col kb-col-add">
      {open ? (
        <div className="kb-add-stage-form">
          <input
            autoFocus
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
              if (e.key === 'Escape') setOpen(false);
            }}
            placeholder={t('deals.stageNamePlaceholder')}
            maxLength={100}
            disabled={busy}
          />
          <div className="kb-add-stage-actions">
            <button
              type="button"
              className="btn btn-solid btn-small"
              onClick={() => void submit()}
              disabled={busy || !name.trim()}
            >
              {t('deals.addStageConfirm')}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="kb-add-stage" onClick={() => setOpen(true)}>
          {t('deals.addStage')}
        </button>
      )}
    </div>
  );
}

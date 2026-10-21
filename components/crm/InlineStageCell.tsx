'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import StageRequirementsDialog, { readRequirements, type StageRequirements } from './StageRequirementsDialog';

interface StageOption {
  id: string;
  name: string;
  is_won: 0 | 1;
  is_lost: 0 | 1;
}

interface InlineStageCellProps {
  dealId: string;
  stageId: string;
  stages: StageOption[];
  className?: string;
}

export default function InlineStageCell({ dealId, stageId, stages, className = '' }: InlineStageCellProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [req, setReq] = useState<{ body: { stageId: string; lostReason?: string }; requirements: StageRequirements } | null>(null);
  const current = stages.find((s) => s.id === stageId);

  async function save(nextId: string) {
    if (nextId === stageId || busy) return;
    setBusy(true);
    const body: { stageId: string; lostReason?: string } = { stageId: nextId };
    const target = stages.find((s) => s.id === nextId);
    if (target?.is_lost) body.lostReason = '';
    const res = await fetch(`/api/crm/deals/${dealId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    setEditing(false);
    if (res && res.ok) {
      router.refresh();
      return;
    }
    const requirements = await readRequirements(res);
    if (requirements) setReq({ body, requirements });
  }

  const dialog = req && (
    <StageRequirementsDialog
      dealId={dealId}
      request={req.body}
      requirements={req.requirements}
      onCancel={() => setReq(null)}
      onDone={() => {
        setReq(null);
        router.refresh();
      }}
    />
  );

  if (editing) {
    return (
      <select
        className={`cell-inline-input${busy ? ' row-busy' : ''}`}
        value={stageId}
        autoFocus
        disabled={busy}
        onChange={(e) => {
          void save(e.target.value);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false);
        }}
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`cell-inline ${className}`}
        title={t('common.edit')}
        onClick={() => setEditing(true)}
      >
        {current?.name ?? '—'}
      </button>
      {dialog}
    </>
  );
}

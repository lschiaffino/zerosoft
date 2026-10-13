'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import QuickModal from '@/components/app/QuickModal';

interface WorkflowQuickCreateProps {
  /** Triggers disponibles (value + label traducido), resueltos en el server. */
  triggers: Array<{ value: string; label: string }>;
  testId?: string;
}

/**
 * Alta rápida de workflow: nombre + trigger en un modal. Crea un borrador
 * (deshabilitado, sin acciones) y lleva directo al editor para completarlo.
 */
export default function WorkflowQuickCreate({ triggers, testId = 'workflow-quick-create' }: WorkflowQuickCreateProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<string>(triggers[0]?.value ?? 'manual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), enabled: false, triggers: [{ type: trigger }], actions: [] }),
    }).catch(() => null);
    if (res && res.status === 201) {
      const wf = (await res.json().catch(() => null)) as { id?: string } | null;
      if (wf?.id) {
        router.push(`/app/crm/workflows/${wf.id}`);
        return;
      }
    }
    setBusy(false);
    setError(t('errors.generic'));
  }

  return (
    <>
      <button type="button" className="btn btn-solid btn-small" onClick={() => setOpen(true)} data-testid={testId}>
        {t('workflows.new')}
      </button>
      <QuickModal
        open={open}
        onClose={() => setOpen(false)}
        crumb={`CRM › ${t('workflows.new')}`}
        onSubmit={submit}
        submitLabel={busy ? t('common.creating') : t('workflows.quickCreate')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!name.trim()}
        busy={busy}
        error={error}
        hint={t('quick.hint')}
      >
        <input
          data-autofocus
          className="qm-title"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('workflows.name')}
          aria-label={t('workflows.name')}
          maxLength={500}
        />
        <div className="qm-row">
          <label className="qm-field">
            <span>{t('workflows.trigger')}</span>
            <select value={trigger} onChange={(e) => setTrigger(e.target.value)} data-testid="workflow-quick-trigger">
              {triggers.map((tt) => (
                <option key={tt.value} value={tt.value}>
                  {tt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">{t('workflows.quickNote')}</p>
      </QuickModal>
    </>
  );
}

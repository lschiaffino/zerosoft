'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import QuickModal from '@/components/app/QuickModal';

interface Stage {
  id: string;
  name: string;
  kind: 'open' | 'qualified' | 'disqualified';
}

interface Pipeline {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string; is_won: number; is_lost: number }>;
}

async function patchLead(id: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`/api/crm/leads/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  return !!res?.ok;
}

/** Camino de etapas del lead (como el de HubSpot): un clic mueve el lead a esa etapa. */
export function LeadStagePath({ leadId, stages, current }: { leadId: string; stages: Stage[]; current: string }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  return (
    <div className="lead-path-wrap">
      <ol className="lead-path" aria-label={t('leads.stagePath')}>
        {stages.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={`lead-path-step kind-${s.kind}${s.id === current ? ' current' : ''}`}
              aria-current={s.id === current ? 'step' : undefined}
              disabled={busy !== null || s.id === current}
              onClick={async () => {
                setBusy(s.id);
                setError(false);
                const ok = await patchLead(leadId, { stageId: s.id });
                setBusy(null);
                if (ok) router.refresh();
                else setError(true);
              }}
            >
              {s.name}
            </button>
          </li>
        ))}
      </ol>
      {error && (
        <p className="ui-error" role="alert">
          {t('errors.generic')}
        </p>
      )}
    </div>
  );
}

interface LeadActionsProps {
  leadId: string;
  leadName: string;
  dealId: string | null;
  stageKind: 'open' | 'qualified' | 'disqualified';
  disqualifiedStageId: string | null;
  firstOpenStageId: string | null;
  pipelines: Pipeline[];
  currency: string;
}

/** Convertir en deal, descalificar (con motivo) y reabrir. */
export default function LeadActions({
  leadId,
  leadName,
  dealId,
  stageKind,
  disqualifiedStageId,
  firstOpenStageId,
  pipelines,
  currency,
}: LeadActionsProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [dialog, setDialog] = useState<'convert' | 'disqualify' | null>(null);
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? '');
  const pipeline = pipelines.find((p) => p.id === pipelineId);
  const openStages = (pipeline?.stages ?? []).filter((s) => !s.is_won && !s.is_lost);
  const [stageId, setStageId] = useState(openStages[0]?.id ?? '');
  const [dealName, setDealName] = useState(leadName);
  const [amount, setAmount] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setDialog(null);
    setError(null);
  }

  async function convert() {
    if (!pipelineId || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/leads/${leadId}/convert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pipelineId,
        stageId: stageId || undefined,
        dealName: dealName.trim() || undefined,
        amount: amount ? Number(amount) : undefined,
        currency,
        closeDate: closeDate || null,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 201) {
      const { dealId: created } = (await res.json()) as { dealId: string };
      close();
      router.push(`/app/crm/deals/${created}`);
      router.refresh();
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
    setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  }

  async function disqualify() {
    if (!disqualifiedStageId || busy) return;
    setBusy(true);
    const ok = await patchLead(leadId, { stageId: disqualifiedStageId, disqualifyReason: reason.trim() });
    setBusy(false);
    if (ok) {
      close();
      router.refresh();
    } else setError(t('errors.generic'));
  }

  async function reopen() {
    if (!firstOpenStageId) return;
    if (await patchLead(leadId, { stageId: firstOpenStageId, disqualifyReason: '' })) router.refresh();
  }

  if (dealId) {
    return (
      <Link href={`/app/crm/deals/${dealId}`} className="btn btn-secondary btn-sm">
        {t('leads.convert.viewDeal')}
      </Link>
    );
  }

  return (
    <>
      {stageKind === 'disqualified' ? (
        firstOpenStageId && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={reopen}>
            {t('leads.reopen')}
          </button>
        )
      ) : (
        disqualifiedStageId && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('disqualify')}>
            {t('leads.disqualify.cta')}
          </button>
        )
      )}
      {/* Un lead descalificado se reabre antes de convertirlo en deal. */}
      {stageKind !== 'disqualified' && (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog('convert')} data-testid="lead-convert">
          {t('leads.convert.cta')}
        </button>
      )}

      <QuickModal
        open={dialog === 'convert'}
        onClose={close}
        title={t('leads.convert.title')}
        centered
        onSubmit={convert}
        submitLabel={busy ? t('leads.convert.busy') : t('leads.convert.submit')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!pipelineId}
        busy={busy}
        error={error ?? (pipelines.length ? null : t('leads.convert.noPipeline'))}
      >
        <label className="qm-field">
          <span>{t('leads.convert.dealName')}</span>
          <input data-autofocus value={dealName} onChange={(e) => setDealName(e.target.value)} maxLength={500} />
        </label>
        <div className="qm-row">
          <label className="qm-field">
            <span>{t('leads.convert.pipeline')}</span>
            <select
              value={pipelineId}
              onChange={(e) => {
                setPipelineId(e.target.value);
                const p = pipelines.find((x) => x.id === e.target.value);
                setStageId(p?.stages.find((s) => !s.is_won && !s.is_lost)?.id ?? '');
              }}
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="qm-field">
            <span>{t('leads.convert.stage')}</span>
            <select value={stageId} onChange={(e) => setStageId(e.target.value)}>
              {openStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="qm-row">
          <label className="qm-field">
            <span>
              {t('leads.convert.amount')} ({currency})
            </span>
            <input type="number" min={0} step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="qm-field">
            <span>{t('leads.convert.closeDate')}</span>
            <input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
          </label>
        </div>
      </QuickModal>

      <QuickModal
        open={dialog === 'disqualify'}
        onClose={close}
        title={t('leads.disqualify.title')}
        centered
        onSubmit={disqualify}
        submitLabel={t('leads.disqualify.submit')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        error={error}
      >
        <label className="qm-field">
          <span>{t('leads.disqualify.reason')}</span>
          <input data-autofocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
      </QuickModal>
    </>
  );
}

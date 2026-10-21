'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { normalizeCompanyDomain } from '@/lib/crm-domain';
import { DomainPrefillNote, useDomainPrefill } from './DomainPrefill';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import { LIFECYCLE_STAGES } from '@/lib/crm-constants';

export type QuickCreateKind = 'contact' | 'company' | 'deal';

interface Option {
  id: string;
  name: string;
}

interface PipelineOption extends Option {
  stages: Array<{ id: string; name: string; is_won: number; is_lost: number }>;
}

interface CrmQuickCreateProps {
  kind: QuickCreateKind;
  /** Pipeline preseleccionado (deals: el que está viendo el board). */
  defaultPipelineId?: string;
  /** "solid" = CTA principal del header; "ghost" = botón secundario (empty state). */
  variant?: 'solid' | 'empty';
  label?: string;
  /** Company pre-vinculada (detalle de company): el contacto/deal nace asociado. */
  fixedCompanyId?: string;
  fixedCompanyName?: string;
  /** Clase del botón disparador (por defecto el CTA sólido). */
  buttonClassName?: string;
}

const KNOWN_ERRORS = new Set([
  'invalid_email',
  'missing_name',
  'invalid_input',
  'invalid_company',
  'invalid_stage',
  'rate_limited',
]);

const LIST_PATH: Record<QuickCreateKind, string> = {
  contact: '/app/crm/contacts',
  company: '/app/crm/companies',
  deal: '/app/crm/deals',
};

/**
 * Alta rápida de contacto / company / deal en un modal, sin salir de la
 * lista (como HubSpot/Linear). Atajo "C"; `?new=1` en la URL lo abre (lo usan
 * los links viejos a /new y el menú "New" del sidebar). El formulario completo
 * sigue disponible en /new?full=1.
 */
export default function CrmQuickCreate({
  kind,
  defaultPipelineId,
  variant = 'solid',
  label,
  fixedCompanyId,
  fixedCompanyName,
  buttonClassName,
}: CrmQuickCreateProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  // ?new=1 → abre el modal y limpia el parámetro.
  // Con company fija (detalle) no reaccionamos a ?new=1 ni al atajo global.
  const primary = variant === 'solid' && !fixedCompanyId;

  useEffect(() => {
    if (!primary) return;
    if (searchParams.get('new') === '1') {
      setOpen(true);
      const params = new URLSearchParams(searchParams.toString());
      params.delete('new');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [searchParams, pathname, router, primary]);

  useKeyShortcut('c', () => setOpen(true), primary && !open);

  const text = label ?? t(`quick.${kind}.cta`);

  return (
    <>
      <button
        type="button"
        className={buttonClassName ?? 'btn btn-solid btn-small'}
        onClick={() => setOpen(true)}
        data-testid={fixedCompanyId ? `crm-quick-${kind}-company` : `crm-quick-${kind}`}
      >
        {text}
        {primary && (
          <span className="kbd-hint" aria-hidden>
            C
          </span>
        )}
      </button>
      {open && (
        <QuickCreateForm
          kind={kind}
          defaultPipelineId={defaultPipelineId}
          fixedCompanyId={fixedCompanyId}
          fixedCompanyName={fixedCompanyName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function QuickCreateForm({
  kind,
  defaultPipelineId,
  fixedCompanyId,
  fixedCompanyName,
  onClose,
}: {
  kind: QuickCreateKind;
  defaultPipelineId?: string;
  fixedCompanyId?: string;
  fixedCompanyName?: string;
  onClose: () => void;
}) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createMore, setCreateMore] = useState(false);
  const [createdNote, setCreatedNote] = useState<{ id: string; name: string } | null>(null);

  // Contacto
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [companyId, setCompanyId] = useState(fixedCompanyId ?? '');
  const [lifecycle, setLifecycle] = useState<string>('lead');
  const [companies, setCompanies] = useState<Option[]>(
    fixedCompanyId ? [{ id: fixedCompanyId, name: fixedCompanyName ?? '—' }] : [],
  );

  // Company
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [industry, setIndustry] = useState('');
  const prefill = useDomainPrefill();

  // Deal
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [pipelineId, setPipelineId] = useState(defaultPipelineId ?? '');
  const [stageId, setStageId] = useState('');
  const [amount, setAmount] = useState('');
  const [closeDate, setCloseDate] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (kind === 'contact') {
      fetch('/api/crm/companies?pageSize=100&sort=name')
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((d: { rows: Option[] }) => {
          if (cancelled) return;
          const rows = d.rows.map((c) => ({ id: c.id, name: c.name }));
          // La company fija puede no estar entre las primeras 100: la agregamos igual.
          if (fixedCompanyId && !rows.some((c) => c.id === fixedCompanyId)) {
            rows.unshift({ id: fixedCompanyId, name: fixedCompanyName ?? '—' });
          }
          setCompanies(rows);
        })
        .catch(() => null);
    }
    if (kind === 'deal') {
      fetch('/api/crm/pipelines')
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((d: { rows: PipelineOption[] }) => {
          if (cancelled) return;
          setPipelines(d.rows);
          const p = d.rows.find((x) => x.id === defaultPipelineId) ?? d.rows[0];
          if (p) {
            setPipelineId(p.id);
            setStageId(p.stages.find((s) => !s.is_won && !s.is_lost)?.id ?? p.stages[0]?.id ?? '');
          }
        })
        .catch(() => null);
    }
    return () => {
      cancelled = true;
    };
  }, [kind, defaultPipelineId, fixedCompanyId, fixedCompanyName]);

  const pipeline = pipelines.find((p) => p.id === pipelineId);

  const changePipeline = (id: string) => {
    setPipelineId(id);
    const p = pipelines.find((x) => x.id === id);
    setStageId(p?.stages.find((s) => !s.is_won && !s.is_lost)?.id ?? p?.stages[0]?.id ?? '');
  };

  const canSubmit =
    kind === 'contact'
      ? !!(firstName.trim() || lastName.trim() || email.trim())
      : kind === 'company'
        ? !!name.trim()
        : !!name.trim() && !!pipelineId && !!stageId;

  const reset = useCallback(() => {
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setName('');
    setDomain('');
    setIndustry('');
    setAmount('');
    setCloseDate('');
  }, []);

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    let url = '';
    let body: Record<string, unknown> = {};
    if (kind === 'contact') {
      url = '/api/crm/contacts';
      body = {
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        lifecycleStage: lifecycle,
        companyId: companyId || null,
      };
    } else if (kind === 'company') {
      url = '/api/crm/companies';
      body = {
        name: name.trim(),
        domain: domain.trim() || undefined,
        industry: industry.trim() || undefined,
        // Lo que se precargó del sitio (solo si sigue siendo el mismo dominio).
        ...(prefill.info && prefill.info.domain === normalizeCompanyDomain(domain)
          ? { website: prefill.info.website || undefined, phone: prefill.info.phone || undefined }
          : {}),
      };
    } else {
      url = '/api/crm/deals';
      body = {
        pipelineId,
        stageId,
        name: name.trim(),
        amount: amount ? Number(amount) : 0,
        closeDate: closeDate || null,
        ...(fixedCompanyId ? { companyId: fixedCompanyId } : {}),
      };
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (res && res.status === 201) {
      const created = (await res.json().catch(() => null)) as { id?: string } | null;
      const label =
        kind === 'contact' ? [firstName, lastName].filter(Boolean).join(' ').trim() || email.trim() : name.trim();
      router.refresh();
      if (createMore) {
        if (created?.id) setCreatedNote({ id: created.id, name: label });
        reset();
        const first = document.querySelector<HTMLInputElement>('.qm [data-autofocus]');
        first?.focus();
      } else {
        onClose();
      }
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    setError(t(KNOWN_ERRORS.has(code) ? `errors.${code}` : 'errors.generic'));
  }

  const recordPath = (id: string) => `${LIST_PATH[kind]}/${id}`;

  return (
    <QuickModal
      open
      onClose={onClose}
      crumb={`CRM › ${t(`quick.${kind}.title`)}`}
      onSubmit={submit}
      submitLabel={busy ? t('common.creating') : t('common.create')}
      cancelLabel={t('common.cancel')}
      submitDisabled={!canSubmit}
      busy={busy}
      error={error}
      hint={t('quick.hint')}
      footExtra={
        <>
          <label className="qm-check">
            <input type="checkbox" checked={createMore} onChange={(e) => setCreateMore(e.target.checked)} />
            {t('quick.createMore')}
          </label>
          <Link href={`${LIST_PATH[kind]}/new?full=1`} className="qm-link" onClick={onClose}>
            {t('quick.fullForm')}
          </Link>
        </>
      }
    >
      {createdNote && (
        <p className="qm-created">
          {t('quick.created')}{' '}
          <Link href={recordPath(createdNote.id)} onClick={onClose}>
            {createdNote.name || '—'}
          </Link>
        </p>
      )}

      {kind === 'contact' && (
        <>
          <div className="qm-row">
            <input
              data-autofocus
              className="qm-title"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder={t('contacts.form.firstName')}
              aria-label={t('contacts.form.firstName')}
              maxLength={200}
            />
            <input
              className="qm-title"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder={t('contacts.form.lastName')}
              aria-label={t('contacts.form.lastName')}
              maxLength={200}
            />
          </div>
          <div className="qm-row">
            <label className="qm-field">
              <span>{t('contacts.form.email')}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} />
            </label>
            <label className="qm-field">
              <span>{t('contacts.form.phone')}</span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={60} />
            </label>
          </div>
          <div className="qm-row">
            <label className="qm-field">
              <span>{t('contacts.form.company')}</span>
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                disabled={!!fixedCompanyId}
              >
                <option value="">{t('contacts.form.noCompany')}</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="qm-field">
              <span>{t('contacts.form.lifecycle')}</span>
              <select value={lifecycle} onChange={(e) => setLifecycle(e.target.value)}>
                {LIFECYCLE_STAGES.map((l) => (
                  <option key={l} value={l}>
                    {t(`enums.lifecycle.${l}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}

      {kind === 'company' && (
        <>
          <input
            data-autofocus
            className="qm-title"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('companies.form.name')}
            aria-label={t('companies.form.name')}
            maxLength={500}
          />
          <div className="qm-row">
            <label className="qm-field">
              <span>{t('companies.form.domain')}</span>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                onBlur={async (e) => {
                  const info = await prefill.lookup(e.target.value);
                  if (info?.name && !name.trim()) setName(info.name);
                }}
                placeholder="acme.com"
                maxLength={500}
              />
              <DomainPrefillNote info={prefill.info} loading={prefill.loading} />
            </label>
            <label className="qm-field">
              <span>{t('companies.form.industry')}</span>
              <input value={industry} onChange={(e) => setIndustry(e.target.value)} maxLength={200} />
            </label>
          </div>
        </>
      )}

      {kind === 'deal' && (
        <>
          <input
            data-autofocus
            className="qm-title"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('deals.form.namePlaceholder')}
            aria-label={t('deals.form.name')}
            maxLength={500}
          />
          {fixedCompanyId && (
            <p className="qm-created" data-testid="quick-deal-company">
              {t('contacts.form.company')}: <strong>{fixedCompanyName ?? '—'}</strong>
            </p>
          )}
          <div className="qm-row">
            {pipelines.length > 1 && (
              <label className="qm-field">
                <span>{t('deals.pipelineLabel')}</span>
                <select value={pipelineId} onChange={(e) => changePipeline(e.target.value)}>
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="qm-field">
              <span>{t('deals.form.stage')}</span>
              <select value={stageId} onChange={(e) => setStageId(e.target.value)}>
                {(pipeline?.stages ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="qm-row">
            <label className="qm-field">
              <span>{t('deals.form.amount')}</span>
              <input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="qm-field">
              <span>{t('deals.form.closeDate')}</span>
              <input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
            </label>
          </div>
        </>
      )}
    </QuickModal>
  );
}

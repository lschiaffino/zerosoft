'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DomainPrefillNote, siteExtras, useDomainPrefill } from './DomainPrefill';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import { EmailTakenText, emailTakenFrom, type EmailTakenExisting } from './EmailTakenNotice';
import CreateFormFields, { missingFromResponse, useCreateForm, useMissingMessage, type CreateFormOption } from './CreateFormFields';
import { createFormBody } from './formPayload';
import { configuredFields, isRequired, missingRequired, type CreateFormEntity } from '@/lib/crm-create-form-shared';

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
  'invalid_contact',
  'invalid_owner',
  'invalid_stage',
  'field_readonly',
  'value_taken',
  'rate_limited',
]);

const LIST_PATH: Record<QuickCreateKind, string> = {
  contact: '/app/crm/contacts',
  company: '/app/crm/companies',
  deal: '/app/crm/deals',
};

const ENTITY: Record<QuickCreateKind, CreateFormEntity> = { contact: 'contacts', company: 'companies', deal: 'deals' };

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
  const entity = ENTITY[kind];
  const form = useCreateForm(entity);
  const missingMessage = useMissingMessage(entity);
  const fieldsRef = useRef<HTMLDivElement>(null);
  /** Cambia para volver a montar los campos configurados vacíos ("Crear otro"). */
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createMore, setCreateMore] = useState(false);
  /** Ya hay un contacto con ese email (undefined = sin aviso). */
  const [taken, setTaken] = useState<EmailTakenExisting | undefined>(undefined);
  const [createdNote, setCreatedNote] = useState<{ id: string; name: string } | null>(null);

  const configured = form ? configuredFields(entity, form.fields) : [];
  const required = (key: string) => (form ? isRequired(entity, form.fields, key) : false);
  const needs = (key: string) => configured.some((f) => f.key === key);
  const needsCompanies = needs('companyId');
  const needsContacts = needs('contactId');

  // Contacto
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [companies, setCompanies] = useState<CreateFormOption[]>(
    fixedCompanyId ? [{ value: fixedCompanyId, label: fixedCompanyName ?? '—' }] : [],
  );
  const [contacts, setContacts] = useState<CreateFormOption[] | null>(null);

  // Company
  const [name, setName] = useState('');
  // El blur del dominio resuelve después de un await: lee el nombre vigente, no el del render.
  const nameRef = useRef(name);
  nameRef.current = name;
  const [domain, setDomain] = useState('');
  const prefill = useDomainPrefill();

  // Deal
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [pipelineId, setPipelineId] = useState(defaultPipelineId ?? '');
  const [stageId, setStageId] = useState('');

  useEffect(() => {
    let cancelled = false;
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
  }, [kind, defaultPipelineId]);

  // Las listas para elegir empresa o contacto, solo si el formulario las muestra.
  useEffect(() => {
    if (!needsCompanies) return;
    let cancelled = false;
    fetch('/api/crm/companies?pageSize=100&sort=name')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows: Option[] }) => {
        if (cancelled) return;
        const rows = d.rows.map((c) => ({ value: c.id, label: c.name }));
        // La company fija puede no estar entre las primeras 100: la agregamos igual.
        if (fixedCompanyId && !rows.some((c) => c.value === fixedCompanyId)) {
          rows.unshift({ value: fixedCompanyId, label: fixedCompanyName ?? '—' });
        }
        setCompanies(rows);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [needsCompanies, fixedCompanyId, fixedCompanyName]);

  useEffect(() => {
    if (!needsContacts) return;
    let cancelled = false;
    fetch('/api/crm/contacts?pageSize=100')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows: Array<{ id: string; first_name: string; last_name: string; email: string }> }) => {
        if (cancelled) return;
        setContacts(d.rows.map((c) => ({ value: c.id, label: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email })));
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needsContacts]);

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

  function reset() {
    setFirstName('');
    setLastName('');
    setEmail('');
    setName('');
    setDomain('');
    setRound((r) => r + 1);
  }

  /** Valores de las propiedades configuradas (inputs sin estado dentro del form del modal). */
  function configuredValues(): Record<string, unknown> {
    const formEl = fieldsRef.current?.closest('form');
    if (!formEl) return {};
    return createFormBody(entity, new FormData(formEl), configured);
  }

  async function submit() {
    if (!canSubmit || busy) return;
    setError(null);
    setTaken(undefined);
    let url = '';
    let body: Record<string, unknown> = {};
    const extra = configuredValues();
    if (kind === 'contact') {
      url = '/api/crm/contacts';
      body = {
        ...extra,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        email: email.trim() || undefined,
        ...(fixedCompanyId ? { companyId: fixedCompanyId } : {}),
      };
    } else if (kind === 'company') {
      url = '/api/crm/companies';
      const site = prefill.infoFor(domain);
      body = {
        // Lo que se precargó del sitio (solo si sigue siendo el mismo dominio); lo escrito gana.
        ...(site ? siteExtras(site) : {}),
        ...extra,
        name: name.trim(),
        domain: domain.trim() || undefined,
      };
      if (!body.industry && site?.industry) body.industry = site.industry;
    } else {
      url = '/api/crm/deals';
      body = {
        ...extra,
        pipelineId,
        stageId,
        name: name.trim(),
        ...(fixedCompanyId ? { companyId: fixedCompanyId } : {}),
      };
    }
    // Las obligatorias del formulario, antes de ir al server (que igual las exige).
    const missing = form ? missingRequired(entity, form.fields, body) : [];
    if (missing.length) {
      setError(missingMessage(missing, form?.fields));
      return;
    }
    setBusy(true);
    if (kind === 'company' && domain.trim() && !prefill.existingFor(domain)) {
      // Antes de crear, el chequeo rápido de duplicado (sin esperar la
      // búsqueda del sitio, que puede tardar). Si aparece uno que la persona
      // todavía no vio, el aviso queda a la vista y el botón pasa a "Crear igual".
      const found = await prefill.checkExisting(domain);
      if (found?.existing) {
        setBusy(false);
        return;
      }
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
    // Ya hay un contacto con ese email: el aviso lo nombra y lo enlaza (si esta persona lo ve).
    const existing = emailTakenFrom(data);
    if (existing !== undefined) {
      setTaken(existing);
      return;
    }
    const missingServer = missingFromResponse(data);
    if (missingServer) {
      setError(missingMessage(missingServer.fields, form?.fields, missingServer.labels));
      return;
    }
    setError(t(KNOWN_ERRORS.has(code) ? `errors.${code}` : 'errors.generic'));
  }

  const recordPath = (id: string) => `${LIST_PATH[kind]}/${id}`;
  const star = (key: string) =>
    required(key) ? (
      <span className="crm-req" aria-hidden="true">
        {' '}
        *
      </span>
    ) : null;
  const reqAttr = (key: string) => (required(key) ? { required: true, 'aria-required': true as const } : {});

  return (
    <QuickModal
      open
      onClose={onClose}
      crumb={`CRM › ${t(`quick.${kind}.title`)}`}
      onSubmit={submit}
      submitLabel={
        busy
          ? t('common.creating')
          : kind === 'company' && prefill.existingFor(domain)
            ? t('companies.enrich.createAnyway')
            : t('common.create')
      }
      cancelLabel={t('common.cancel')}
      submitDisabled={!canSubmit}
      busy={busy}
      error={taken !== undefined ? <EmailTakenText existing={taken} onOpen={onClose} /> : error}
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
              {...reqAttr('firstName')}
            />
            <input
              className="qm-title"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder={t('contacts.form.lastName')}
              aria-label={t('contacts.form.lastName')}
              maxLength={200}
              {...reqAttr('lastName')}
            />
          </div>
          <div className="qm-row">
            <label className="qm-field">
              <span>
                {t('contacts.form.email')}
                {star('email')}
              </span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} {...reqAttr('email')} />
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
              <span>
                {t('companies.form.domain')}
                {star('domain')}
              </span>
              <input
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value);
                  prefill.onDomainInput(e.target.value);
                }}
                onBlur={async (e) => {
                  const info = await prefill.lookup(e.target.value);
                  if (info?.name && !nameRef.current.trim()) setName(info.name);
                }}
                placeholder="acme.com"
                maxLength={500}
                spellCheck={false}
                data-testid="quick-company-domain"
                {...reqAttr('domain')}
              />
            </label>
          </div>
          {/* Lugar fijo para el aviso: que aparezca no corre el botón Crear bajo el puntero. */}
          <DomainPrefillNote domain={domain} prefill={prefill} className="qm-enrich-slot" />
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
        </>
      )}

      {/* Lo que el workspace eligió para el alta (Ajustes › Datos › Formulario de alta). */}
      <div ref={fieldsRef} className="qm-row" data-testid="quick-create-fields" key={round}>
        {form && (
          <CreateFormFields
            entity={entity}
            fields={configured}
            variant="quick"
            idPrefix={`qc-${kind}`}
            ctx={{ companies, contacts, people: form.people, me: form.me, baseCurrency: form.baseCurrency, fixedCompanyId }}
          />
        )}
      </div>
    </QuickModal>
  );
}

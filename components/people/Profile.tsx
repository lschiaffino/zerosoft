'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { CustomField, EmployeeDto } from '@/lib/people';
import { HOLIDAY_COUNTRIES } from '@/lib/people-time';
import { api, Avatar, Dialog, Fact, Field, Tabs, useDay, useErrorText, useToast } from './people-ui';
import { CompensationSection, DocumentsSection, OnboardingSection, OneOnOneSection, PerformanceSection, TimeOffSection } from './ProfileSections';

type TabKey = 'overview' | 'timeoff' | 'documents' | 'performance' | 'compensation' | 'onboarding' | 'notes';

export interface ProfileProps {
  employee: EmployeeDto;
  fields: CustomField[];
  people: Array<{ id: string; name: string }>;
  hr: boolean;
  myEmployeeId: string | null;
  tab: string;
  templates: Array<{ id: string; name: string; kind: string }>;
}

const TYPES = ['full_time', 'part_time', 'contractor', 'intern'] as const;

export default function Profile({ employee: e, fields, people, hr, myEmployeeId, tab: initialTab, templates }: ProfileProps) {
  const t = useTranslations('people');
  const router = useRouter();
  const day = useDay();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [editing, setEditing] = useState<'job' | 'personal' | null>(null);
  const [offboarding, setOffboarding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'overview', label: t('profile.tabs.overview') },
    ...(e.can.seeTimeOff ? [{ key: 'timeoff' as const, label: t('profile.tabs.timeoff') }] : []),
    { key: 'documents', label: t('profile.tabs.documents') },
    ...(e.can.seePerformance ? [{ key: 'performance' as const, label: t('profile.tabs.performance') }] : []),
    ...(e.can.seeCompensation ? [{ key: 'compensation' as const, label: t('profile.tabs.compensation') }] : []),
    ...(hr || e.can.isSelf || e.can.isManager ? [{ key: 'onboarding' as const, label: t('profile.tabs.onboarding') }] : []),
    ...(myEmployeeId && !e.can.isSelf ? [{ key: 'notes' as const, label: t('profile.tabs.notes') }] : []),
  ];
  const [tab, setTab] = useState<TabKey>(tabs.some((x) => x.key === initialTab) ? (initialTab as TabKey) : 'overview');
  const changeTab = (k: TabKey) => {
    setTab(k);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', k);
    window.history.replaceState(null, '', url.toString());
  };

  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const get = (k: string) => (fd.has(k) ? String(fd.get(k)) : undefined);
    let body: Record<string, unknown>;
    if (editing === 'job') {
      const custom: Record<string, string> = {};
      for (const f of fields) if (fd.has(`custom_${f.id}`)) custom[f.id] = String(fd.get(`custom_${f.id}`));
      body = {
        name: get('name'),
        jobTitle: get('jobTitle'),
        department: get('department'),
        managerId: get('managerId') || null,
        workEmail: get('workEmail'),
        location: get('location'),
        country: get('country'),
        startDate: get('startDate') || null,
        employmentType: get('employmentType'),
        payPeriod: get('payPeriod'),
        phone: get('phone'),
        ...(fields.length ? { custom } : {}),
      };
    } else {
      const contacts = [0, 1].map((i) => ({ name: get(`ec_name_${i}`) ?? '', relation: get(`ec_rel_${i}`) ?? '', phone: get(`ec_phone_${i}`) ?? '' }));
      body = {
        phone: get('phone'),
        pronouns: get('pronouns'),
        bio: get('bio'),
        personal: { personalEmail: get('personalEmail'), address: get('address'), birthDate: get('birthDate') ?? '', nationalId: get('nationalId'), emergencyContacts: contacts },
      };
      if (!hr && !e.can.isSelf) delete body.personal;
    }
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
    setBusy(true);
    setError('');
    const res = await api(`/api/people/employees/${e.id}`, { method: 'PATCH', json: body });
    setBusy(false);
    if (!res.ok) return setError(errText(res.data.error));
    setEditing(null);
    push(t('common.saved'));
    router.refresh();
  };

  const uploadPhoto = async (file: File) => {
    const fd = new FormData();
    fd.set('file', file);
    const res = await api(`/api/people/employees/${e.id}/photo`, { method: 'POST', body: fd });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(t('common.saved'));
    router.refresh();
  };

  const remove = async () => {
    const res = await api(`/api/people/employees/${e.id}`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.push('/app/people');
    router.refresh();
  };

  const doOffboard = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setBusy(true);
    setError('');
    const res = await api(`/api/people/employees/${e.id}/offboard`, {
      method: 'POST',
      json: { endDate: String(fd.get('endDate') ?? ''), templateId: String(fd.get('templateId') ?? ''), removeFromWorkspace: fd.get('remove') === 'on' },
    });
    setBusy(false);
    if (!res.ok) return setError(errText(res.data.error));
    setOffboarding(false);
    push(t('offboard.done'));
    router.refresh();
  };

  const canEditPhoto = hr || e.can.isSelf;
  const p = e.personal;

  return (
    <div className="app-page ui-page ppl-page">
      {toast}
      <PageHeader
        back={{ href: '/app/people', label: t('nav.directory') }}
        title={
          <span className="ppl-title">
            <span className="ppl-photo">
              <Avatar name={e.name} photo={e.photo} size={56} />
              {canEditPhoto && (
                <>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => photoInput.current?.click()}>
                    {t('profile.changePhoto')}
                  </button>
                  <input
                    ref={photoInput}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
                    hidden
                    aria-label={t('profile.changePhoto')}
                    onChange={(ev) => {
                      const f = ev.target.files?.[0];
                      if (f) void uploadPhoto(f);
                      ev.target.value = '';
                    }}
                  />
                </>
              )}
            </span>
            <span>{e.name}</span>
          </span>
        }
        description={[e.jobTitle, e.department].filter(Boolean).join(' · ') || t('profile.noTitle')}
        actions={
          <>
            {(hr || e.can.isSelf) && (
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(hr ? 'job' : 'personal')}>
                {t('profile.edit')}
              </button>
            )}
            {hr && e.status !== 'terminated' && !e.can.isSelf && (
              <button type="button" className="btn btn-secondary" onClick={() => setOffboarding(true)}>
                {t('offboard.action')}
              </button>
            )}
            {hr && !e.can.isSelf && (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                {t('profile.delete')}
              </button>
            )}
          </>
        }
      />
      {e.status !== 'active' && (
        <p className="ppl-note">
          <span className={`badge ${e.status === 'terminated' ? 'badge-outline' : 'badge-warn'}`}>{t(`status.${e.status}`)}</span>
          {e.endDate && <span> {t('profile.endsOn', { date: day(e.endDate) })}</span>}
        </p>
      )}

      <Tabs items={tabs} value={tab} onChange={changeTab} label={t('profile.sections')} />

      <div className="ppl-tabpanel" role="tabpanel" aria-label={tabs.find((x) => x.key === tab)?.label}>
        {tab === 'overview' && (
          <div className="ppl-grid">
            <section className="ppl-panel" aria-labelledby="ppl-job">
              <h2 id="ppl-job" className="ppl-panel-title">
                {t('profile.job')}
              </h2>
              <dl className="ppl-facts">
                <Fact label={t('fields.jobTitle')} value={e.jobTitle} />
                <Fact label={t('fields.department')} value={e.department} />
                <Fact label={t('fields.manager')} value={e.managerId ? <Link href={`/app/people/${e.managerId}`}>{e.managerName}</Link> : null} />
                <Fact label={t('fields.workEmail')} value={e.workEmail ? <a href={`mailto:${e.workEmail}`}>{e.workEmail}</a> : null} />
                <Fact label={t('fields.phone')} value={e.phone} hidden={e.phone === null} />
                <Fact label={t('fields.location')} value={[e.location, e.country ? t(`countries.${e.country}`) : ''].filter(Boolean).join(' · ')} hidden={e.location === null} />
                <Fact label={t('fields.startDate')} value={e.startDate ? day(e.startDate) : null} hidden={e.startDate === undefined} />
                <Fact label={t('fields.employmentType')} value={e.employmentType ? t(`types.${e.employmentType}`) : null} hidden={e.employmentType === null} />
                {e.birthday && <Fact label={t('fields.birthday')} value={day(`2000-${e.birthday}`, { month: 'long', day: 'numeric' })} />}
                {e.pronouns && <Fact label={t('fields.pronouns')} value={e.pronouns} />}
                {fields
                  .filter((f) => e.custom[f.id] != null)
                  .map((f) => (
                    <Fact key={f.id} label={f.label} value={f.kind === 'date' ? day(e.custom[f.id]) : e.custom[f.id]} />
                  ))}
              </dl>
              {e.bio && <p className="ppl-bio">{e.bio}</p>}
            </section>
            {e.reports.length > 0 && (
              <section className="ppl-panel" aria-labelledby="ppl-reports">
                <h2 id="ppl-reports" className="ppl-panel-title">
                  {t('profile.reports', { count: e.reports.length })}
                </h2>
                <ul className="ppl-list">
                  {e.reports.map((r) => (
                    <li key={r.id}>
                      <Link href={`/app/people/${r.id}`}>{r.name}</Link>
                      {r.jobTitle && <span className="ppl-muted"> · {r.jobTitle}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {e.can.seePersonal && p && (
              <section className="ppl-panel" aria-labelledby="ppl-personal" data-testid="people-personal">
                <h2 id="ppl-personal" className="ppl-panel-title">
                  {t('profile.personal')}
                  <span className="badge badge-outline">{t('profile.sensitive')}</span>
                </h2>
                <dl className="ppl-facts">
                  <Fact label={t('fields.personalEmail')} value={p.personalEmail} />
                  <Fact label={t('fields.address')} value={p.address} />
                  <Fact label={t('fields.birthDate')} value={p.birthDate ? day(p.birthDate) : null} />
                  <Fact label={t('fields.nationalId')} value={p.nationalId} />
                  <Fact
                    label={t('fields.emergencyContacts')}
                    value={
                      p.emergencyContacts.length ? (
                        <ul className="ppl-list">
                          {p.emergencyContacts.map((c, i) => (
                            <li key={i}>
                              {c.name}
                              {c.relation && ` (${c.relation})`}
                              {c.phone && ` · ${c.phone}`}
                            </li>
                          ))}
                        </ul>
                      ) : null
                    }
                  />
                </dl>
                {(hr || e.can.isSelf) && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing('personal')}>
                    {t('profile.editPersonal')}
                  </button>
                )}
              </section>
            )}
          </div>
        )}
        {tab === 'timeoff' && <TimeOffSection employeeId={e.id} hr={hr} isSelf={e.can.isSelf} />}
        {tab === 'documents' && <DocumentsSection employeeId={e.id} hr={hr} isSelf={e.can.isSelf} />}
        {tab === 'performance' && <PerformanceSection employeeId={e.id} />}
        {tab === 'compensation' && <CompensationSection employeeId={e.id} hr={hr} />}
        {tab === 'onboarding' && <OnboardingSection employeeId={e.id} hr={hr} templates={templates} />}
        {tab === 'notes' && <OneOnOneSection employeeId={e.id} name={e.name} />}
      </div>

      <Dialog open={editing !== null} title={editing === 'job' ? t('profile.edit') : t('profile.editPersonal')} onClose={() => setEditing(null)} wide>
        <form onSubmit={save}>
          <div className="ui-modal-body ui-fields">
            {editing === 'job' && (
              <div className="ui-fields-2 ppl-fields">
                <Field label={t('fields.name')} htmlFor="pe-name">
                  <input id="pe-name" name="name" className="input" defaultValue={e.name} required maxLength={120} autoFocus />
                </Field>
                <Field label={t('fields.jobTitle')} htmlFor="pe-title">
                  <input id="pe-title" name="jobTitle" className="input" defaultValue={e.jobTitle} maxLength={120} />
                </Field>
                <Field label={t('fields.department')} htmlFor="pe-dept">
                  <input id="pe-dept" name="department" className="input" defaultValue={e.department} maxLength={80} />
                </Field>
                <Field label={t('fields.manager')} htmlFor="pe-mgr">
                  <select id="pe-mgr" name="managerId" className="select" defaultValue={e.managerId ?? ''}>
                    <option value="">{t('profile.noManager')}</option>
                    {people
                      .filter((x) => x.id !== e.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label={t('fields.workEmail')} htmlFor="pe-email">
                  <input id="pe-email" name="workEmail" type="email" className="input" defaultValue={e.workEmail} maxLength={200} />
                </Field>
                <Field label={t('fields.phone')} htmlFor="pe-phone">
                  <input id="pe-phone" name="phone" className="input" defaultValue={e.phone ?? ''} maxLength={40} />
                </Field>
                <Field label={t('fields.location')} htmlFor="pe-loc">
                  <input id="pe-loc" name="location" className="input" defaultValue={e.location ?? ''} maxLength={120} />
                </Field>
                <Field label={t('fields.country')} htmlFor="pe-country">
                  <select id="pe-country" name="country" className="select" defaultValue={e.country}>
                    <option value="">{t('profile.noCountry')}</option>
                    {HOLIDAY_COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {t(`countries.${c}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('fields.startDate')} htmlFor="pe-start">
                  <input id="pe-start" name="startDate" type="date" className="input" defaultValue={e.startDate ?? ''} />
                </Field>
                <Field label={t('fields.employmentType')} htmlFor="pe-type">
                  <select id="pe-type" name="employmentType" className="select" defaultValue={e.employmentType ?? 'full_time'}>
                    {TYPES.map((d) => (
                      <option key={d} value={d}>
                        {t(`types.${d}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('fields.payPeriod')} htmlFor="pe-pay">
                  <select id="pe-pay" name="payPeriod" className="select" defaultValue={e.payPeriod || 'monthly'}>
                    {(['monthly', 'semimonthly', 'biweekly', 'weekly'] as const).map((d) => (
                      <option key={d} value={d}>
                        {t(`payPeriods.${d}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                {fields.map((f) => (
                  <Field key={f.id} label={f.label} htmlFor={`pe-c-${f.id}`}>
                    {f.kind === 'select' ? (
                      <select id={`pe-c-${f.id}`} name={`custom_${f.id}`} className="select" defaultValue={e.custom[f.id] ?? ''}>
                        <option value="" />
                        {f.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input id={`pe-c-${f.id}`} name={`custom_${f.id}`} className="input" type={f.kind === 'date' ? 'date' : f.kind === 'number' ? 'number' : 'text'} defaultValue={e.custom[f.id] ?? ''} />
                    )}
                  </Field>
                ))}
              </div>
            )}
            {editing === 'personal' && (
              <div className="ui-fields-2 ppl-fields">
                <Field label={t('fields.phone')} htmlFor="pp-phone">
                  <input id="pp-phone" name="phone" className="input" defaultValue={e.phone ?? ''} maxLength={40} autoFocus />
                </Field>
                <Field label={t('fields.pronouns')} htmlFor="pp-pron">
                  <input id="pp-pron" name="pronouns" className="input" defaultValue={e.pronouns} maxLength={40} />
                </Field>
                {p && (
                  <>
                    <Field label={t('fields.personalEmail')} htmlFor="pp-pemail">
                      <input id="pp-pemail" name="personalEmail" type="email" className="input" defaultValue={p.personalEmail} maxLength={200} />
                    </Field>
                    <Field label={t('fields.birthDate')} htmlFor="pp-birth">
                      <input id="pp-birth" name="birthDate" type="date" className="input" defaultValue={p.birthDate} />
                    </Field>
                    <Field label={t('fields.address')} htmlFor="pp-addr">
                      <input id="pp-addr" name="address" className="input" defaultValue={p.address} maxLength={500} />
                    </Field>
                    <Field label={t('fields.nationalId')} htmlFor="pp-nid">
                      <input id="pp-nid" name="nationalId" className="input" defaultValue={p.nationalId} maxLength={60} />
                    </Field>
                    {[0, 1].map((i) => (
                      <fieldset key={i} className="ppl-fieldset">
                        <legend className="label">{t('profile.emergencyContact', { n: i + 1 })}</legend>
                        <input name={`ec_name_${i}`} className="input" aria-label={t('fields.name')} placeholder={t('fields.name')} defaultValue={p.emergencyContacts[i]?.name ?? ''} maxLength={120} />
                        <input name={`ec_rel_${i}`} className="input" aria-label={t('profile.relation')} placeholder={t('profile.relation')} defaultValue={p.emergencyContacts[i]?.relation ?? ''} maxLength={60} />
                        <input name={`ec_phone_${i}`} className="input" aria-label={t('fields.phone')} placeholder={t('fields.phone')} defaultValue={p.emergencyContacts[i]?.phone ?? ''} maxLength={40} />
                      </fieldset>
                    ))}
                  </>
                )}
                <Field label={t('fields.bio')} htmlFor="pp-bio">
                  <textarea id="pp-bio" name="bio" className="textarea" defaultValue={e.bio} maxLength={2000} />
                </Field>
              </div>
            )}
            {error && (
              <p className="ppl-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            {editing === 'job' && (
              <button type="button" className="btn btn-ghost" onClick={() => setEditing('personal')}>
                {t('profile.editPersonal')}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t('common.save')}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={offboarding} title={t('offboard.title', { name: e.name })} onClose={() => setOffboarding(false)}>
        <form onSubmit={doOffboard}>
          <div className="ui-modal-body ui-fields">
            <Field label={t('offboard.endDate')} htmlFor="ob-end">
              <input id="ob-end" name="endDate" type="date" className="input" required defaultValue={new Date().toISOString().slice(0, 10)} autoFocus />
            </Field>
            <Field label={t('offboard.template')} htmlFor="ob-tpl">
              <select id="ob-tpl" name="templateId" className="select" defaultValue={templates.find((x) => x.kind === 'offboarding')?.id ?? ''}>
                <option value="">{t('offboard.noTemplate')}</option>
                {templates
                  .filter((x) => x.kind === 'offboarding')
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </Field>
            {e.hasAccount && (
              <label className="ppl-check">
                <input type="checkbox" name="remove" />
                <span>
                  <strong>{t('offboard.remove')}</strong>
                  <span className="ppl-hint">{t('offboard.removeHint')}</span>
                </span>
              </label>
            )}
            {error && (
              <p className="ppl-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setOffboarding(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary btn-danger" disabled={busy}>
              {t('offboard.confirm')}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={confirmDelete} title={t('profile.deleteTitle')} onClose={() => setConfirmDelete(false)}>
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            void remove();
          }}
        >
          <div className="ui-modal-body">
            <p>{t('profile.deleteBody', { name: e.name })}</p>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary btn-danger" autoFocus>
              {t('profile.delete')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

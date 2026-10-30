'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { EmployeeSummary } from '@/lib/people';
import { HOLIDAY_COUNTRIES } from '@/lib/people-time';
import { api, Avatar, Dialog, Field, useErrorText } from './people-ui';

const TYPES = ['full_time', 'part_time', 'contractor', 'intern'] as const;

export interface DirectoryProps {
  employees: EmployeeSummary[];
  facets: { departments: string[]; locations: string[] };
  hr: boolean;
  templates: Array<{ id: string; name: string }>;
  filters: { q: string; department: string; location: string; type: string; status: string };
  openNew: boolean;
}

export default function Directory({ employees, facets, hr, templates, filters, openNew }: DirectoryProps) {
  const t = useTranslations('people');
  const router = useRouter();
  const errText = useErrorText();
  const [q, setQ] = useState(filters.q);
  const [adding, setAdding] = useState(openNew && hr);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const filtered = Boolean(filters.q || filters.department || filters.location || filters.type || filters.status);

  const go = (next: Partial<DirectoryProps['filters']>) => {
    const f = { ...filters, ...next };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) sp.set(k, v);
    router.push(`/app/people${sp.toString() ? `?${sp}` : ''}`);
  };

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
    setBusy(true);
    setError('');
    const res = await api<{ employee: { id: string } }>('/api/people/employees', {
      method: 'POST',
      json: { ...body, managerId: body.managerId || null, startDate: body.startDate || null, onboardingTemplateId: body.onboardingTemplateId || null },
    });
    setBusy(false);
    if (!res.ok) return setError(errText(res.data.error));
    setAdding(false);
    router.push(`/app/people/${res.data.employee.id}`);
    router.refresh();
  };

  return (
    <div className="app-page ui-page ppl-page">
      <PageHeader
        title={t('nav.directory')}
        description={t('directory.desc', { count: employees.length })}
        actions={
          hr ? (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              {t('directory.add')}
            </button>
          ) : undefined
        }
      />
      <div className="ppl-toolbar">
        <form
          role="search"
          className="ppl-search"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: q.trim() });
          }}
        >
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('directory.search')} aria-label={t('directory.search')} />
        </form>
        <select className="select" aria-label={t('fields.department')} value={filters.department} onChange={(e) => go({ department: e.target.value })}>
          <option value="">{t('directory.allDepartments')}</option>
          {facets.departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select className="select" aria-label={t('fields.location')} value={filters.location} onChange={(e) => go({ location: e.target.value })}>
          <option value="">{t('directory.allLocations')}</option>
          {facets.locations.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select className="select" aria-label={t('fields.employmentType')} value={filters.type} onChange={(e) => go({ type: e.target.value })}>
          <option value="">{t('directory.allTypes')}</option>
          {TYPES.map((d) => (
            <option key={d} value={d}>
              {t(`types.${d}`)}
            </option>
          ))}
        </select>
        {hr && (
          <select className="select" aria-label={t('fields.status')} value={filters.status} onChange={(e) => go({ status: e.target.value })}>
            <option value="">{t('directory.current')}</option>
            {(['active', 'onboarding', 'offboarding', 'terminated'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        )}
      </div>

      {employees.length === 0 ? (
        filtered ? (
          <EmptyState compact body={t('directory.noMatch')} />
        ) : (
          <EmptyState product="people" title={t('directory.emptyTitle')} body={t('directory.emptyBody')} />
        )
      ) : (
        <div className="table-wrap">
          <table className="table ppl-table">
            <thead>
              <tr>
                <th scope="col">{t('fields.name')}</th>
                <th scope="col" className="ppl-hide-sm">
                  {t('fields.department')}
                </th>
                <th scope="col" className="ppl-hide-sm">
                  {t('fields.location')}
                </th>
                <th scope="col" className="ppl-hide-sm">
                  {t('fields.workEmail')}
                </th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} data-testid="people-row">
                  <th scope="row">
                    <Link href={`/app/people/${e.id}`} className="ppl-rowlink">
                      <Avatar name={e.name} photo={e.photo} />
                      <span className="ppl-rowtext">
                        <span className="ppl-rowtitle">{e.name}</span>
                        <span className="ppl-rowmeta">{e.jobTitle || t('profile.noTitle')}</span>
                      </span>
                      {e.status !== 'active' && <span className={`badge ${e.status === 'terminated' ? 'badge-outline' : 'badge-warn'}`}>{t(`status.${e.status}`)}</span>}
                    </Link>
                  </th>
                  <td className="ppl-hide-sm">{e.department}</td>
                  <td className="ppl-hide-sm">{e.location ?? ''}</td>
                  <td className="ppl-hide-sm ppl-ellipsis">{e.workEmail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={adding} title={t('directory.add')} onClose={() => setAdding(false)} wide>
        <form onSubmit={create}>
          <div className="ui-modal-body ui-fields">
            <div className="ui-fields-2 ppl-fields">
              <Field label={t('fields.name')} htmlFor="ppl-new-name">
                <input id="ppl-new-name" name="name" className="input" required maxLength={120} autoFocus />
              </Field>
              <Field label={t('fields.workEmail')} htmlFor="ppl-new-email" hint={t('directory.emailHint')}>
                <input id="ppl-new-email" name="workEmail" type="email" className="input" maxLength={200} />
              </Field>
              <Field label={t('fields.jobTitle')} htmlFor="ppl-new-title">
                <input id="ppl-new-title" name="jobTitle" className="input" maxLength={120} />
              </Field>
              <Field label={t('fields.department')} htmlFor="ppl-new-dept">
                <input id="ppl-new-dept" name="department" className="input" maxLength={80} list="ppl-depts" />
                <datalist id="ppl-depts">
                  {facets.departments.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </Field>
              <Field label={t('fields.manager')} htmlFor="ppl-new-mgr">
                <select id="ppl-new-mgr" name="managerId" className="select" defaultValue="">
                  <option value="">{t('profile.noManager')}</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('fields.startDate')} htmlFor="ppl-new-start">
                <input id="ppl-new-start" name="startDate" type="date" className="input" />
              </Field>
              <Field label={t('fields.employmentType')} htmlFor="ppl-new-type">
                <select id="ppl-new-type" name="employmentType" className="select" defaultValue="full_time">
                  {TYPES.map((d) => (
                    <option key={d} value={d}>
                      {t(`types.${d}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('fields.location')} htmlFor="ppl-new-loc">
                <input id="ppl-new-loc" name="location" className="input" maxLength={120} />
              </Field>
              <Field label={t('fields.country')} htmlFor="ppl-new-country" hint={t('directory.countryHint')}>
                <select id="ppl-new-country" name="country" className="select" defaultValue="">
                  <option value="">{t('profile.noCountry')}</option>
                  {HOLIDAY_COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`countries.${c}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('directory.onboarding')} htmlFor="ppl-new-tpl">
                <select id="ppl-new-tpl" name="onboardingTemplateId" className="select" defaultValue="">
                  <option value="">{t('directory.noOnboarding')}</option>
                  {templates.map((tp) => (
                    <option key={tp.id} value={tp.id}>
                      {tp.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {error && (
              <p className="ppl-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t('directory.create')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

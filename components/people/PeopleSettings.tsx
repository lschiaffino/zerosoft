'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { CustomField, PeopleSettings as Settings } from '@/lib/people';
import type { Policy } from '@/lib/people-timeoff';
import { CONFIGURABLE_FIELDS } from '@/lib/people-access';
import { HOLIDAY_COUNTRIES } from '@/lib/people-time';
import { api, Dialog, Field, Tabs, useDay, useErrorText, useToast } from './people-ui';
import { DocumentList, UploadDocumentDialog, useLoad, Loading, LoadError } from './ProfileSections';
import type { PeopleDocument } from '@/lib/people-docs';

type TabKey = 'policies' | 'holidays' | 'fields' | 'visibility' | 'documents' | 'access';

export interface SettingsProps {
  settings: Settings;
  policies: Policy[];
  fields: CustomField[];
  holidays: Array<{ id: string; country: string; date: string; name: string }>;
  seeded: Record<string, Array<{ date: string; name: string }>>;
  members: Array<{ id: string; name: string; email: string; role: string }>;
  wsAdmin: boolean;
  tab: string;
}

export default function PeopleSettings({ settings, policies, fields, holidays, seeded, members, wsAdmin, tab: initialTab }: SettingsProps) {
  const t = useTranslations('people');
  const router = useRouter();
  const locale = useLocale();
  const day = useDay();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'policies', label: t('settings.tabs.policies') },
    { key: 'holidays', label: t('settings.tabs.holidays') },
    { key: 'fields', label: t('settings.tabs.fields') },
    { key: 'visibility', label: t('settings.tabs.visibility') },
    { key: 'documents', label: t('settings.tabs.documents') },
    { key: 'access', label: t('settings.tabs.access') },
  ];
  const [tab, setTab] = useState<TabKey>(tabs.some((x) => x.key === initialTab) ? (initialTab as TabKey) : 'policies');
  const [policy, setPolicy] = useState<Policy | 'new' | null>(null);
  const [field, setField] = useState<CustomField | 'new' | null>(null);
  const [country, setCountry] = useState<string>(HOLIDAY_COUNTRIES[0]);
  const [uploading, setUploading] = useState(false);
  const docs = useLoad<{ documents: PeopleDocument[] }>('/api/people/documents');
  const changeTab = (k: TabKey) => {
    setTab(k);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', k);
    window.history.replaceState(null, '', url.toString());
  };
  const done = (msg = t('common.saved')) => {
    push(msg);
    router.refresh();
  };

  const savePolicy = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const n = (k: string) => (String(fd.get(k) ?? '') === '' ? null : Number(fd.get(k)));
    const body = { name: fd.get('name'), kind: fd.get('kind'), accrual: fd.get('accrual'), daysPerYear: n('daysPerYear') ?? 0, carryoverMax: n('carryoverMax'), capDays: n('capDays'), halfDay: fd.get('halfDay') === 'on' };
    const res = policy === 'new' ? await api('/api/people/policies', { method: 'POST', json: body }) : await api(`/api/people/policies/${(policy as Policy).id}`, { method: 'PATCH', json: body });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setPolicy(null);
    done();
  };
  const removePolicy = async (id: string) => {
    const res = await api(`/api/people/policies/${id}`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    done();
  };
  const saveField = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      label: fd.get('label'),
      kind: fd.get('kind'),
      sensitive: fd.get('sensitive') === 'on',
      options: String(fd.get('options') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const res = field === 'new' ? await api('/api/people/fields', { method: 'POST', json: body }) : await api(`/api/people/fields/${(field as CustomField).id}`, { method: 'PATCH', json: body });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setField(null);
    done();
  };
  const removeField = async (id: string) => {
    const res = await api(`/api/people/fields/${id}`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    done();
  };
  const patchSettings = async (body: Record<string, unknown>) => {
    const res = await api('/api/people/settings', { method: 'PATCH', json: body });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    done();
  };
  const addHoliday = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const res = await api('/api/people/holidays', { method: 'POST', json: { date: fd.get('date'), name: fd.get('name'), country: fd.get('country') } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    form.reset();
    done();
  };
  const removeHoliday = async (id: string) => {
    const res = await api(`/api/people/holidays/${id}`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    done();
  };
  const createHandbook = async () => {
    const res = await api<{ url: string }>('/api/people/handbook', { method: 'POST', json: { locale } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(t('settings.handbookCreated'));
    docs.reload();
    router.refresh();
  };
  const editing = policy && policy !== 'new' ? policy : null;
  const editingField = field && field !== 'new' ? field : null;

  return (
    <div className="app-page ui-page ppl-page">
      {toast}
      <PageHeader title={t('settings.title')} description={t('settings.desc')} />
      <Tabs items={tabs} value={tab} onChange={changeTab} label={t('settings.title')} />
      <div className="ppl-tabpanel" role="tabpanel">
        {tab === 'policies' && (
          <section className="ppl-panel">
            <div className="ppl-panel-head">
              <h2 className="ppl-panel-title">{t('settings.tabs.policies')}</h2>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setPolicy('new')}>
                {t('settings.newPolicy')}
              </button>
            </div>
            {policies.length === 0 ? (
              <EmptyState compact quiet body={t('timeoff.noPolicies')} />
            ) : (
              <div className="table-wrap">
                <table className="table ppl-table" data-testid="people-policies">
                  <thead>
                    <tr>
                      <th scope="col">{t('fields.name')}</th>
                      <th scope="col">{t('settings.accrual')}</th>
                      <th scope="col" className="num">
                        {t('settings.daysPerYear')}
                      </th>
                      <th scope="col" className="ppl-hide-sm">
                        {t('settings.carryover')}
                      </th>
                      <th scope="col" className="ppl-hide-sm">
                        {t('settings.cap')}
                      </th>
                      <th scope="col">
                        <span className="sr-only">{t('common.actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {policies.map((p) => (
                      <tr key={p.id}>
                        <th scope="row">
                          {p.name}
                          {p.archived && <span className="badge badge-outline">{t('settings.archived')}</span>}
                          <div className="ppl-rowmeta">{t(`settings.kinds.${p.kind}`)}</div>
                        </th>
                        <td>{t(`settings.accruals.${p.accrual}`)}</td>
                        <td className="num">{p.accrual === 'none' ? '' : p.daysPerYear}</td>
                        <td className="ppl-hide-sm">{p.carryoverMax == null ? t('settings.unlimited') : p.carryoverMax}</td>
                        <td className="ppl-hide-sm">{p.capDays == null ? t('settings.unlimited') : p.capDays}</td>
                        <td className="ppl-actions">
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPolicy(p)}>
                            {t('common.edit')}
                          </button>
                          {!p.archived && (
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => removePolicy(p.id)}>
                              {t('common.delete')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="ppl-hint">{t('settings.policiesHint')}</p>
          </section>
        )}

        {tab === 'holidays' && (
          <div className="ppl-stack">
            <section className="ppl-panel">
              <div className="ppl-panel-head">
                <h2 className="ppl-panel-title">{t('settings.nationalHolidays')}</h2>
                <select className="select" value={country} onChange={(e) => setCountry(e.target.value)} aria-label={t('fields.country')}>
                  {HOLIDAY_COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`countries.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
              <p className="ppl-hint">{t('settings.holidaysHint')}</p>
              <ul className="ppl-list ppl-columns" data-testid="people-holidays">
                {(seeded[country] ?? []).map((h) => (
                  <li key={h.date + h.name}>
                    <span className="ppl-muted">{day(h.date)}</span> {h.name}
                  </li>
                ))}
              </ul>
            </section>
            <section className="ppl-panel">
              <h2 className="ppl-panel-title">{t('settings.customHolidays')}</h2>
              <form className="ppl-inline-form" onSubmit={addHoliday}>
                <input name="date" type="date" className="input" required aria-label={t('settings.date')} />
                <input name="name" className="input" required maxLength={120} placeholder={t('settings.holidayName')} aria-label={t('settings.holidayName')} />
                <select name="country" className="select" aria-label={t('fields.country')} defaultValue="">
                  <option value="">{t('settings.allCountries')}</option>
                  {HOLIDAY_COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`countries.${c}`)}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn btn-secondary">
                  {t('common.add')}
                </button>
              </form>
              {holidays.length === 0 ? (
                <EmptyState compact quiet body={t('settings.noCustomHolidays')} />
              ) : (
                <ul className="ppl-list">
                  {holidays.map((h) => (
                    <li key={h.id} className="ppl-row">
                      <span>
                        <span className="ppl-muted">{day(h.date)}</span> {h.name} {h.country && <span className="badge badge-outline">{h.country}</span>}
                      </span>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeHoliday(h.id)}>
                        {t('common.delete')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {tab === 'fields' && (
          <section className="ppl-panel">
            <div className="ppl-panel-head">
              <h2 className="ppl-panel-title">{t('settings.tabs.fields')}</h2>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setField('new')}>
                {t('settings.newField')}
              </button>
            </div>
            <p className="ppl-hint">{t('settings.fieldsHint')}</p>
            {fields.length === 0 ? (
              <EmptyState compact quiet body={t('settings.noFields')} />
            ) : (
              <ul className="ppl-list">
                {fields.map((f) => (
                  <li key={f.id} className="ppl-row">
                    <span>
                      <strong>{f.label}</strong> <span className="ppl-muted">· {t(`settings.fieldKinds.${f.kind}`)}</span>
                      {f.sensitive && <span className="badge badge-outline">{t('profile.sensitive')}</span>}
                    </span>
                    <span className="ppl-actions">
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setField(f)}>
                        {t('common.edit')}
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeField(f.id)}>
                        {t('common.delete')}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'visibility' && (
          <form
            className="ppl-panel"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void patchSettings({ visibility: Object.fromEntries(CONFIGURABLE_FIELDS.map((f) => [f, fd.get(f)])) });
            }}
          >
            <h2 className="ppl-panel-title">{t('settings.tabs.visibility')}</h2>
            <p className="ppl-hint">{t('settings.visibilityHint')}</p>
            <div className="ui-fields-2 ppl-fields">
              {CONFIGURABLE_FIELDS.map((f) => (
                <Field key={f} label={t(`fields.${f}`)} htmlFor={`vis-${f}`}>
                  <select id={`vis-${f}`} name={f} className="select" defaultValue={settings.visibility[f] ?? 'everyone'}>
                    <option value="everyone">{t('settings.levels.everyone')}</option>
                    <option value="managers">{t('settings.levels.managers')}</option>
                    <option value="hr">{t('settings.levels.hr')}</option>
                  </select>
                </Field>
              ))}
            </div>
            <p className="ppl-hint">{t('settings.alwaysPrivate')}</p>
            <div className="ppl-panel-actions">
              <button type="submit" className="btn btn-primary">
                {t('common.save')}
              </button>
            </div>
          </form>
        )}

        {tab === 'documents' && (
          <div className="ppl-stack">
            <section className="ppl-panel">
              <div className="ppl-panel-head">
                <h2 className="ppl-panel-title">{t('settings.policiesDocs')}</h2>
                <span className="ppl-panel-actions">
                  {!settings.handbookPageId && (
                    <button type="button" className="btn btn-sm btn-secondary" onClick={createHandbook}>
                      {t('settings.createHandbook')}
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => setUploading(true)}>
                    {t('documents.upload')}
                  </button>
                </span>
              </div>
              {settings.handbookPageId && (
                <p>
                  <Link href={`/app/docs/${settings.handbookPageId}`}>{t('settings.openHandbook')}</Link>
                </p>
              )}
              {docs.error ? (
                <LoadError retry={docs.reload} />
              ) : !docs.data ? (
                <Loading />
              ) : (
                <DocumentList
                  docs={docs.data.documents}
                  hr
                  onChange={(m, tone) => {
                    push(m, tone);
                    docs.reload();
                  }}
                />
              )}
            </section>
            <form
              className="ppl-panel"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                void patchSettings({ welcome: String(fd.get('welcome') ?? '') });
              }}
            >
              <h2 className="ppl-panel-title">{t('settings.welcome')}</h2>
              <Field label={t('settings.welcomeText')} htmlFor="set-welcome" hint={t('settings.welcomeHint')}>
                <textarea id="set-welcome" name="welcome" className="textarea" defaultValue={settings.welcome} maxLength={4000} />
              </Field>
              <div className="ppl-panel-actions">
                <Link href="/app/people/welcome" className="btn btn-ghost">
                  {t('settings.previewWelcome')}
                </Link>
                <button type="submit" className="btn btn-primary">
                  {t('common.save')}
                </button>
              </div>
            </form>
          </div>
        )}

        {tab === 'access' && (
          <form
            className="ppl-panel"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void patchSettings({ hrAdmins: fd.getAll('hr').map(String) });
            }}
          >
            <h2 className="ppl-panel-title">{t('settings.hrAdmins')}</h2>
            <p className="ppl-hint">{t('settings.hrAdminsHint')}</p>
            <ul className="ppl-list">
              {members.map((m) => {
                const implicit = m.role === 'owner' || m.role === 'admin';
                return (
                  <li key={m.id}>
                    <label className="ppl-check">
                      <input type="checkbox" name="hr" value={m.id} defaultChecked={implicit || settings.hrAdmins.includes(m.id)} disabled={implicit || !wsAdmin} />
                      <span>
                        {m.name || m.email}
                        <span className="ppl-muted"> · {implicit ? t('settings.implicitHr') : m.email}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {wsAdmin ? (
              <div className="ppl-panel-actions">
                <button type="submit" className="btn btn-primary">
                  {t('common.save')}
                </button>
              </div>
            ) : (
              <p className="ppl-hint">{t('settings.onlyAdmins')}</p>
            )}
          </form>
        )}
      </div>

      <Dialog open={policy !== null} title={editing ? editing.name : t('settings.newPolicy')} onClose={() => setPolicy(null)}>
        <form onSubmit={savePolicy}>
          <div className="ui-modal-body ui-fields">
            <Field label={t('fields.name')} htmlFor="pol-name">
              <input id="pol-name" name="name" className="input" required maxLength={80} defaultValue={editing?.name ?? ''} autoFocus />
            </Field>
            <div className="ui-fields-2 ppl-fields">
              <Field label={t('settings.kind')} htmlFor="pol-kind">
                <select id="pol-kind" name="kind" className="select" defaultValue={editing?.kind ?? 'vacation'}>
                  {(['vacation', 'sick', 'personal', 'other'] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`settings.kinds.${k}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('settings.accrual')} htmlFor="pol-accrual">
                <select id="pol-accrual" name="accrual" className="select" defaultValue={editing?.accrual ?? 'annual'}>
                  {(['annual', 'monthly', 'per_pay_period', 'none'] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`settings.accruals.${k}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('settings.daysPerYear')} htmlFor="pol-days">
                <input id="pol-days" name="daysPerYear" type="number" min={0} max={366} step="0.5" className="input" defaultValue={editing?.daysPerYear ?? 15} />
              </Field>
              <Field label={t('settings.carryover')} htmlFor="pol-carry" hint={t('settings.blankUnlimited')}>
                <input id="pol-carry" name="carryoverMax" type="number" min={0} max={366} step="0.5" className="input" defaultValue={editing?.carryoverMax ?? ''} />
              </Field>
              <Field label={t('settings.cap')} htmlFor="pol-cap" hint={t('settings.blankUnlimited')}>
                <input id="pol-cap" name="capDays" type="number" min={0} max={366} step="0.5" className="input" defaultValue={editing?.capDays ?? ''} />
              </Field>
            </div>
            <label className="ppl-check">
              <input type="checkbox" name="halfDay" defaultChecked={editing?.halfDay ?? true} />
              <span>{t('settings.allowHalf')}</span>
            </label>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setPolicy(null)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={field !== null} title={editingField ? editingField.label : t('settings.newField')} onClose={() => setField(null)}>
        <form onSubmit={saveField}>
          <div className="ui-modal-body ui-fields">
            <Field label={t('settings.fieldLabel')} htmlFor="fld-label">
              <input id="fld-label" name="label" className="input" required maxLength={80} defaultValue={editingField?.label ?? ''} autoFocus />
            </Field>
            <Field label={t('settings.fieldKind')} htmlFor="fld-kind">
              <select id="fld-kind" name="kind" className="select" defaultValue={editingField?.kind ?? 'text'}>
                {(['text', 'number', 'date', 'select'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`settings.fieldKinds.${k}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('settings.options')} htmlFor="fld-options" hint={t('settings.optionsHint')}>
              <input id="fld-options" name="options" className="input" defaultValue={editingField?.options.join(', ') ?? ''} />
            </Field>
            <label className="ppl-check">
              <input type="checkbox" name="sensitive" defaultChecked={editingField?.sensitive ?? false} />
              <span>{t('settings.sensitiveField')}</span>
            </label>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setField(null)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Dialog>

      {uploading && (
        <UploadDocumentDialog
          open
          employeeId={null}
          onClose={() => setUploading(false)}
          onDone={() => {
            setUploading(false);
            push(t('documents.uploaded'));
            docs.reload();
          }}
        />
      )}
    </div>
  );
}

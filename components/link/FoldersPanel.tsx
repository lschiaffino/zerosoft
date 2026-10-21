'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import EmptyState from '@/components/ui/EmptyState';

type Access = 'none' | 'view' | 'edit';

export interface FolderView {
  id: string;
  name: string;
  default_access: Access;
  /** Acceso de quien mira. */
  access: Access;
  links: number;
}

export interface FolderPerson {
  id: string;
  name: string;
}

interface FoldersPanelProps {
  initial: FolderView[];
  canManage: boolean;
  /** Personas del workspace (sin el owner): a quién se le puede dar otro acceso. */
  people: FolderPerson[];
}

const ACCESS: Access[] = ['none', 'view', 'edit'];

/**
 * Carpetas de links: alta, nombre, acceso por defecto de los miembros y
 * excepciones por persona. Owner y admins siempre editan todo.
 */
export default function FoldersPanel({ initial, canManage, people }: FoldersPanelProps) {
  const t = useTranslations('link');
  const [rows, setRows] = useState(initial);
  const [name, setName] = useState('');
  const [defaultAccess, setDefaultAccess] = useState<Access>('edit');
  const [open, setOpen] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, Record<string, Access | ''>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, { text: string; tone: 'ok' | 'error' }>>({});

  const errorText = (code: string | undefined) =>
    code && t.has(`folders.errors.${code}`) ? t(`folders.errors.${code}`) : t('errors.generic');
  const readError = async (res: Response | null) =>
    errorText(res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : undefined);

  async function add(): Promise<string | void> {
    const res = await fetch('/api/links/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), defaultAccess }),
    }).catch(() => null);
    if (res?.status === 201) {
      const row = (await res.json()) as Omit<FolderView, 'access' | 'links'>;
      setRows((prev) => [...prev, { ...row, access: 'edit' as const, links: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      return;
    }
    return readError(res);
  }

  async function patch(id: string, body: Record<string, unknown>, okText: string) {
    setBusy(id);
    const res = await fetch(`/api/links/folders/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      const data = (await res.json()) as { name: string; default_access: Access };
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, name: data.name, default_access: data.default_access } : r)));
      setNotice((n) => ({ ...n, [id]: { text: okText, tone: 'ok' } }));
      return true;
    }
    const text = await readError(res);
    setNotice((n) => ({ ...n, [id]: { text, tone: 'error' } }));
    return false;
  }

  async function toggleAccess(id: string) {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    if (members[id]) return;
    const res = await fetch(`/api/links/folders/${id}`).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { members: Array<{ user_id: string; access: Access }> }) : null;
    setMembers((m) => ({ ...m, [id]: Object.fromEntries((data?.members ?? []).map((x) => [x.user_id, x.access])) }));
  }

  async function saveMembers(id: string) {
    const draft = members[id] ?? {};
    const list = people.map((p) => ({ userId: p.id, access: draft[p.id] || null }));
    await patch(id, { members: list }, t('folders.saved'));
  }

  async function remove(row: FolderView) {
    if (!window.confirm(t('folders.removeConfirm', { name: row.name, n: row.links }))) return;
    setBusy(row.id);
    const res = await fetch(`/api/links/folders/${row.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    if (res?.status === 204) {
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      return;
    }
    const text = await readError(res);
    setNotice((n) => ({ ...n, [row.id]: { text, tone: 'error' } }));
  }

  const accessLabel = (a: Access) => t(`folders.access.${a}`);

  const addForm = canManage && (
    <FormSection
      title={t('folders.addTitle')}
      description={t('folders.addDesc')}
      onSubmit={add}
      submitLabel={t('folders.add')}
      disabled={!name.trim()}
      className="lk-form"
    >
      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor="folder-name">
            {t('folders.name')}
          </label>
          <input
            id="folder-name"
            className="input"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('folders.namePlaceholder')}
            autoComplete="off"
          />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="folder-default">
            {t('folders.defaultAccess')}
          </label>
          <select
            id="folder-default"
            className="select"
            value={defaultAccess}
            onChange={(e) => setDefaultAccess(e.target.value as Access)}
          >
            {ACCESS.map((a) => (
              <option key={a} value={a}>
                {accessLabel(a)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </FormSection>
  );

  return (
    <>
      {rows.length === 0 && addForm}

      <section className="lk-domains" aria-labelledby="folders-list-title">
        <h2 className="lk-h" id="folders-list-title">
          {t('folders.listTitle')}
        </h2>
        {rows.length === 0 ? (
          <EmptyState title={t('folders.empty')} body={t('folders.emptyBody')} product="link" />
        ) : (
          <ul className="lk-domain-list">
            {rows.map((f) => (
              <li key={f.id} className="panel lk-domain" data-testid="link-folder">
                <div className="lk-domain-head">
                  <Link href={{ pathname: '/app/links', query: { folder: f.id } }} className="lk-domain-host">
                    {f.name}
                  </Link>
                  <span className="ui-help">{t('folders.linksCount', { n: f.links })}</span>
                  {!canManage && <span className="badge">{accessLabel(f.access)}</span>}
                  {canManage && (
                    <span className="lk-domain-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-expanded={open === f.id}
                        aria-controls={`folder-access-${f.id}`}
                        onClick={() => void toggleAccess(f.id)}
                      >
                        {t('folders.manageAccess')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost btn-danger"
                        onClick={() => void remove(f)}
                        disabled={busy === f.id}
                      >
                        {t('folders.remove')}
                      </button>
                    </span>
                  )}
                </div>

                {canManage && open === f.id && (
                  <form
                    id={`folder-access-${f.id}`}
                    className="lk-domain-root"
                    aria-label={t('folders.accessTitle', { name: f.name })}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const newName = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
                      const def = (form.elements.namedItem('default') as HTMLSelectElement).value as Access;
                      void (async () => {
                        const changed: Record<string, unknown> = {};
                        if (newName && newName !== f.name) changed.name = newName;
                        if (def !== f.default_access) changed.defaultAccess = def;
                        if (Object.keys(changed).length > 0 && !(await patch(f.id, changed, t('folders.saved')))) return;
                        if (people.length > 0) await saveMembers(f.id);
                        else setNotice((n) => ({ ...n, [f.id]: { text: t('folders.saved'), tone: 'ok' } }));
                      })();
                    }}
                  >
                    <div className="ui-fields-2">
                      <div className="ui-field">
                        <label className="label" htmlFor={`fn-${f.id}`}>
                          {t('folders.name')}
                        </label>
                        <input id={`fn-${f.id}`} name="name" className="input" maxLength={60} defaultValue={f.name} />
                      </div>
                      <div className="ui-field">
                        <label className="label" htmlFor={`fd-${f.id}`}>
                          {t('folders.defaultAccess')}
                        </label>
                        <select id={`fd-${f.id}`} name="default" className="select" defaultValue={f.default_access}>
                          {ACCESS.map((a) => (
                            <option key={a} value={a}>
                              {accessLabel(a)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="ui-help">{t('folders.adminsHelp')}</p>
                    {people.length > 0 && (
                      <div className="table-wrap">
                        <table className="table table-compact">
                          <caption className="sr-only">{t('folders.accessTitle', { name: f.name })}</caption>
                          <thead>
                            <tr>
                              <th scope="col">{t('folders.person')}</th>
                              <th scope="col">{t('folders.accessCol')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {people.map((p) => (
                              <tr key={p.id}>
                                <td>{p.name}</td>
                                <td>
                                  <select
                                    className="select lk-select-auto"
                                    aria-label={t('folders.accessFor', { name: p.name })}
                                    value={members[f.id]?.[p.id] ?? ''}
                                    disabled={!members[f.id]}
                                    onChange={(e) =>
                                      setMembers((m) => ({
                                        ...m,
                                        [f.id]: { ...(m[f.id] ?? {}), [p.id]: e.target.value as Access | '' },
                                      }))
                                    }
                                  >
                                    <option value="">{t('folders.useDefault', { access: accessLabel(f.default_access) })}</option>
                                    {ACCESS.map((a) => (
                                      <option key={a} value={a}>
                                        {accessLabel(a)}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div>
                      <button type="submit" className="btn" aria-busy={busy === f.id || undefined}>
                        {t('folders.save')}
                      </button>
                    </div>
                  </form>
                )}
                {notice[f.id] && (
                  <p className={notice[f.id].tone === 'error' ? 'ui-error' : 'ui-help lk-ok'} role={notice[f.id].tone === 'error' ? 'alert' : 'status'}>
                    {notice[f.id].text}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {rows.length > 0 && addForm}
    </>
  );
}

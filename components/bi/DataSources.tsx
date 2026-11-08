'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LocalDate from '@/components/ui/LocalDate';
import BiDialog from './BiDialog';
import { biApi, biErrorText, notifyBiChanged } from './client';
import type { DatabaseDto } from '@/lib/bi/store';
import type { SchemaTable } from '@/lib/bi/types';
import { PRODUCT_CONFIG, isProductKey } from '@/lib/products';

type Form = { id?: string; name: string; engine: 'postgres' | 'mysql'; host: string; port: string; dbname: string; username: string; password: string; ssl: 'require' | 'verify' | 'disable'; sqlAccess: 'admins' | 'members' };
const EMPTY: Form = { name: '', engine: 'postgres', host: '', port: '5432', dbname: '', username: '', password: '', ssl: 'require', sqlAccess: 'admins' };

/** Datos: las tablas propias del workspace y las bases externas (conectar, sincronizar, editar, borrar). */
export default function DataSources({ initialDatabases, zsTables, isAdmin }: { initialDatabases: DatabaseDto[]; zsTables: SchemaTable[]; isAdmin: boolean }) {
  const t = useTranslations('bi');
  const locale = useLocale();
  const [dbs, setDbs] = useState(initialDatabases);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DatabaseDto | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tables, setTables] = useState<Record<string, SchemaTable[]>>({ zerosoft: zsTables });

  const field = (k: keyof Form) => ({
    value: form?.[k] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => (f ? { ...f, [k]: e.target.value } : f)),
  });

  const toggle = async (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (!tables[id]) {
      try {
        const d = await biApi<{ tables: SchemaTable[] }>(`/api/bi/schema?source=${encodeURIComponent(id)}`);
        setTables((m) => ({ ...m, [id]: d.tables }));
      } catch {
        setTables((m) => ({ ...m, [id]: [] }));
      }
    }
  };

  const tableList = (list: SchemaTable[] | undefined) =>
    !list ? (
      <p className="bi-muted" role="status">
        {t('common.loading')}
      </p>
    ) : list.length === 0 ? (
      <p className="bi-muted">{t('sql.noTables')}</p>
    ) : (
      <ul className="bi-data-tables" role="list">
        {list.map((tb) => (
          <li key={tb.name}>
            <strong>{tb.name}</strong>
            {tb.app && isProductKey(tb.app) && <span className="bi-muted"> · {PRODUCT_CONFIG[tb.app].name}</span>}
            <span className="bi-data-cols">{tb.columns.map((c) => c.name).join(', ')}</span>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="app-page ui-page bi-page">
      <PageHeader
        title={t('data.title')}
        description={t('data.description')}
        actions={
          isAdmin ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setError(null);
                setForm({ ...EMPTY });
              }}
            >
              {t('data.connect')}
            </button>
          ) : undefined
        }
      />

      <section className="bi-data-section">
        <h2 className="bi-h2">{t('data.own')}</h2>
        <p className="bi-muted">{t('data.ownBody')}</p>
        <div className="bi-data-row">
          <button type="button" className="bi-schema-toggle" aria-expanded={open === 'zerosoft'} onClick={() => void toggle('zerosoft')}>
            <span aria-hidden="true">{open === 'zerosoft' ? '▾' : '▸'}</span> {t('editor.zerosoft')} · {t('data.tables', { n: String(zsTables.length) })}
          </button>
        </div>
        {open === 'zerosoft' && tableList(tables.zerosoft)}
      </section>

      <section className="bi-data-section">
        <h2 className="bi-h2">{t('data.external')}</h2>
        {!isAdmin && <p className="bi-muted">{t('data.adminOnly')}</p>}
        {dbs.length === 0 ? (
          <p className="bi-muted bi-empty-result">{t('data.none')}</p>
        ) : (
          <ul className="bi-db-list" role="list" data-testid="bi-dbs">
            {dbs.map((d) => (
              <li key={d.id} className="bi-db">
                <div className="bi-data-row">
                  <button type="button" className="bi-schema-toggle" aria-expanded={open === d.id} onClick={() => void toggle(d.id)}>
                    <span aria-hidden="true">{open === d.id ? '▾' : '▸'}</span> {d.name}
                  </button>
                  <span className="bi-muted">
                    {d.engine === 'postgres' ? 'PostgreSQL' : 'MySQL'} · {d.host}:{d.port}/{d.dbname} · {t('data.tables', { n: String(d.tables) })}
                    {d.syncedAt && (
                      <>
                        {' · '}
                        {t('data.synced')} <LocalDate value={d.syncedAt} locale={locale} />
                      </>
                    )}
                  </span>
                  {isAdmin && (
                    <span className="bi-row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy !== null}
                        aria-busy={busy === `sync-${d.id}`}
                        onClick={async () => {
                          setBusy(`sync-${d.id}`);
                          setError(null);
                          try {
                            const r = await biApi<{ tables: SchemaTable[] }>(`/api/bi/databases/${d.id}/sync`, { body: {} });
                            setTables((m) => ({ ...m, [d.id]: r.tables }));
                            setDbs((l) => l.map((x) => (x.id === d.id ? { ...x, tables: r.tables.length, syncedAt: new Date().toISOString() } : x)));
                          } catch (err) {
                            setError(biErrorText(err, t));
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        {t('data.sync')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setError(null);
                          setForm({ id: d.id, name: d.name, engine: d.engine, host: d.host, port: String(d.port), dbname: d.dbname, username: d.username, password: '', ssl: d.ssl, sqlAccess: d.sqlAccess });
                        }}
                      >
                        {t('common.edit')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(d)}>
                        {t('common.delete')}
                      </button>
                    </span>
                  )}
                </div>
                {open === d.id && tableList(tables[d.id])}
              </li>
            ))}
          </ul>
        )}
        {error && !form && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <BiDialog open={form !== null} title={form?.id ? t('data.editTitle') : t('data.connect')} onClose={() => setForm(null)} wide>
        {form && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy('save');
              setError(null);
              const body = { ...form, port: Number(form.port), password: form.password || undefined };
              try {
                if (form.id) {
                  const { database } = await biApi<{ database: DatabaseDto }>(`/api/bi/databases/${form.id}`, { method: 'PATCH', body });
                  setDbs((l) => l.map((x) => (x.id === database.id ? database : x)));
                  setTables((m) => {
                    const next = { ...m };
                    delete next[database.id];
                    return next;
                  });
                } else {
                  const { database } = await biApi<{ database: DatabaseDto }>('/api/bi/databases', { body });
                  setDbs((l) => [...l, database]);
                }
                setForm(null);
                notifyBiChanged();
              } catch (err) {
                setError(biErrorText(err, t));
              } finally {
                setBusy(null);
              }
            }}
          >
            <div className="ui-modal-body ui-fields">
              <p className="bi-muted">{t('data.readOnlyTip')}</p>
              <div className="bi-form-grid">
                <label className="ui-field">
                  <span className="label">{t('data.name')}</span>
                  {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                  <input className="input" required maxLength={120} autoFocus {...field('name')} />
                </label>
                <label className="ui-field">
                  <span className="label">{t('data.engine')}</span>
                  <select
                    className="input"
                    value={form.engine}
                    onChange={(e) => {
                      const engine = e.target.value as Form['engine'];
                      setForm((f) => (f ? { ...f, engine, port: f.port === '5432' || f.port === '3306' ? (engine === 'mysql' ? '3306' : '5432') : f.port } : f));
                    }}
                  >
                    <option value="postgres">PostgreSQL</option>
                    <option value="mysql">MySQL</option>
                  </select>
                </label>
                <label className="ui-field">
                  <span className="label">{t('data.host')}</span>
                  <input className="input" required maxLength={253} {...field('host')} placeholder="db.example.com" autoComplete="off" />
                </label>
                <label className="ui-field">
                  <span className="label">{t('data.port')}</span>
                  <input className="input" required type="number" min={1} max={65535} {...field('port')} />
                </label>
                <label className="ui-field">
                  <span className="label">{t('data.dbname')}</span>
                  <input className="input" required maxLength={128} {...field('dbname')} autoComplete="off" />
                </label>
                <label className="ui-field">
                  <span className="label">{t('data.username')}</span>
                  <input className="input" required maxLength={128} {...field('username')} autoComplete="off" />
                </label>
                <label className="ui-field">
                  <span className="label">{t('data.password')}</span>
                  <input className="input" type="password" maxLength={1024} {...field('password')} autoComplete="new-password" placeholder={form.id ? t('data.passwordKeep') : ''} />
                </label>
                <label className="ui-field">
                  <span className="label">{t('data.ssl')}</span>
                  <select className="input" {...field('ssl')}>
                    <option value="require">{t('data.sslRequire')}</option>
                    <option value="verify">{t('data.sslVerify')}</option>
                    <option value="disable">{t('data.sslDisable')}</option>
                  </select>
                </label>
                <label className="ui-field">
                  <span className="label">{t('data.sqlAccess')}</span>
                  <select className="input" {...field('sqlAccess')}>
                    <option value="admins">{t('data.sqlAdmins')}</option>
                    <option value="members">{t('data.sqlMembers')}</option>
                  </select>
                </label>
              </div>
              {error && (
                <p className="ui-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-sm" onClick={() => setForm(null)} disabled={busy === 'save'}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-sm btn-primary" disabled={busy === 'save'} aria-busy={busy === 'save'}>
                {busy === 'save' ? t('data.testing') : t('data.testAndSave')}
              </button>
            </div>
          </form>
        )}
      </BiDialog>
      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? t('common.deleteTitle', { name: deleting.name }) : ''}
        body={t('data.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await biApi(`/api/bi/databases/${deleting.id}`, { method: 'DELETE' });
            setDbs((l) => l.filter((x) => x.id !== deleting.id));
            notifyBiChanged();
          } catch (err) {
            setError(biErrorText(err, t));
          } finally {
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}

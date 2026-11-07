'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import TitleInput from '@/components/ui/TitleInput';
import type { LinkDto } from '@/lib/send/core';
import type { SpaceAccessDto, SpaceAnalytics, SpaceItemDto } from '@/lib/send/spaces';
import LinksPanel from './LinksPanel';
import { api, formatSeconds, SendDialog, useDate, useErrorText, useToast } from './ui';

type Tab = 'documents' | 'links' | 'access' | 'activity';

/** Un espacio: sus documentos, links, acceso por persona y números. */
export default function SpaceDetail({
  space: initial,
  initialItems,
  initialAccess,
  links: initialLinks,
  documents,
  templates,
  analytics,
  admin,
}: {
  space: { id: string; title: string; description: string; sharing: string; canEdit: boolean };
  initialItems: SpaceItemDto[];
  initialAccess: SpaceAccessDto[];
  links: LinkDto[];
  documents: Array<{ id: string; title: string }>;
  templates: Array<{ id: string; name: string }>;
  analytics: SpaceAnalytics;
  admin: boolean;
}) {
  const t = useTranslations('send.spaces');
  const tv = useTranslations('send.visits');
  const tc = useTranslations('send.common');
  const errorText = useErrorText();
  const router = useRouter();
  const date = useDate();
  const [toasts, toast] = useToast();
  const [space, setSpace] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [items, setItems] = useState(initialItems);
  const [links, setLinks] = useState(initialLinks);
  const [access, setAccess] = useState(initialAccess);
  const [tab, setTab] = useState<Tab>('documents');
  const [adding, setAdding] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [grantEmail, setGrantEmail] = useState('');
  const [grantDocs, setGrantDocs] = useState<string[]>([]);
  const [granting, setGranting] = useState(false);

  const available = documents.filter((d) => !items.some((i) => i.documentId === d.id));

  const saveItems = async (next: Array<{ documentId: string; folder: string }>) => {
    const r = await api<{ items: SpaceItemDto[] }>(`/api/send/spaces/${space.id}`, { method: 'PATCH', json: { items: next } });
    if (r.ok) setItems(r.data.items);
    else toast(errorText(r.data.error), 'bad');
  };
  const asPlain = () => items.map((i) => ({ documentId: i.documentId, folder: i.folder }));
  const move = (index: number, delta: number) => {
    const list = asPlain();
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    [list[index], list[to]] = [list[to], list[index]];
    void saveItems(list);
  };

  const saveTitle = async () => {
    const next = title.trim();
    if (!next || next === space.title) return setTitle(space.title);
    const r = await api(`/api/send/spaces/${space.id}`, { method: 'PATCH', json: { title: next } });
    if (r.ok) setSpace((s) => ({ ...s, title: next }));
    else setTitle(space.title);
  };

  const remove = async () => {
    setBusy(true);
    const r = await api(`/api/send/spaces/${space.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!r.ok) return toast(errorText(r.data.error), 'bad');
    router.push('/app/send/spaces');
    router.refresh();
  };

  const grant = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api<{ access: SpaceAccessDto[] }>(`/api/send/spaces/${space.id}/access`, { method: 'PUT', json: { email: grantEmail, documentIds: grantDocs } });
    if (!r.ok) return toast(errorText(r.data.error), 'bad');
    setAccess(r.data.access);
    setGranting(false);
    setGrantEmail('');
    setGrantDocs([]);
  };
  const [lastRevoke, setLastRevoke] = useState<string | null>(null);
  const askRevoke = (email: string) => {
    // Sacar a la última persona de la lista vuelve a abrir el espacio para cualquiera con un link.
    if (access.length === 1) setLastRevoke(email);
    else void revoke(email);
  };
  const revoke = async (email: string) => {
    const r = await api<{ access: SpaceAccessDto[] }>(`/api/send/spaces/${space.id}/access?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
    if (r.ok) setAccess(r.data.access);
  };

  const a = analytics;
  const tabs: Tab[] = ['documents', 'links', 'access', 'activity'];

  return (
    <div className="app-page ui-page sd-page">
      {toasts}
      <nav className="sd-crumb" aria-label={t('title')}>
        <Link href="/app/send/spaces">{t('title')}</Link>
      </nav>
      <div className="sd-doc-head">
        <div className="sd-doc-title">
          {space.canEdit ? <TitleInput className="ui-title-input sd-title-input" value={title} maxLength={200} aria-label={t('colTitle')} onValueChange={setTitle} onBlur={saveTitle} data-testid="send-space-title-input" /> : <h1 className="sd-title-static">{space.title}</h1>}
        </div>
        {space.canEdit && (
          <div className="sd-doc-actions">
            <select
              className="input sd-sharing"
              value={space.sharing}
              aria-label={t('sharing')}
              data-testid="send-space-sharing"
              onChange={async (e) => {
                const sharing = e.target.value;
                const r = await api(`/api/send/spaces/${space.id}`, { method: 'PATCH', json: { sharing } });
                if (r.ok) setSpace((x) => ({ ...x, sharing }));
                else toast(errorText(r.data.error), 'bad');
              }}
            >
              <option value="private">{t('sharingPrivate')}</option>
              <option value="workspace">{t('sharingWorkspace')}</option>
            </select>
            <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setDeleting(true)} data-testid="send-space-delete">
              {tc('delete')}
            </button>
          </div>
        )}
      </div>
      <div className="ui-tabs sd-tabs" role="tablist" aria-label={t('title')}>
        {tabs.map((x) => (
          <button key={x} type="button" role="tab" className="ui-tab" aria-selected={tab === x} onClick={() => setTab(x)} data-testid={`send-space-tab-${x}`}>
            {t(`tab_${x}`)}
          </button>
        ))}
      </div>

      {tab === 'documents' && (
        <section data-testid="send-space-documents">
          {space.canEdit && (
            <div className="sd-filters">
              <select className="input" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label={t('addDocument')} data-testid="send-space-pick">
                <option value="">{t('addDocument')}</option>
                {available.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!adding}
                onClick={() => {
                  void saveItems([...asPlain(), { documentId: adding, folder: '' }]);
                  setAdding('');
                }}
                data-testid="send-space-add"
              >
                {t('add')}
              </button>
            </div>
          )}
          {items.length === 0 ? (
            <EmptyState compact body={documents.length ? t('docsEmpty') : t('docsEmptyNoDocs')} />
          ) : (
            <ul className="sd-items">
              {items.map((it, i) => (
                <li key={it.documentId} data-testid="send-space-item">
                  <div className="sd-link-main">
                    <Link className="sd-rowtitle" href={`/app/send/documents/${it.documentId}`}>
                      {it.title}
                    </Link>
                    <input
                      className="input sd-folder"
                      placeholder={t('folder')}
                      aria-label={t('folder')}
                      defaultValue={it.folder}
                      disabled={!space.canEdit}
                      maxLength={80}
                      onBlur={(e) => {
                        if (e.target.value !== it.folder) void saveItems(asPlain().map((x) => (x.documentId === it.documentId ? { ...x, folder: e.target.value } : x)));
                      }}
                    />
                  </div>
                  {space.canEdit && (
                    <div className="sd-link-actions">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('moveUp')}>
                        ↑
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={t('moveDown')}>
                        ↓
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void saveItems(asPlain().filter((x) => x.documentId !== it.documentId))} data-testid="send-space-remove">
                        {t('remove')}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'links' && <LinksPanel links={links} setLinks={setLinks} createUrl={`/api/send/spaces/${space.id}/links`} templates={templates} canCreate={items.length > 0} />}

      {tab === 'access' && (
        <section data-testid="send-space-access">
          <div className="sd-section-head">
            <h2>{t('accessTitle')}</h2>
            {space.canEdit && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setGranting(true)} data-testid="send-access-new">
                {t('accessNew')}
              </button>
            )}
          </div>
          <p className="sd-help">{t('accessHelp')}</p>
          {access.length === 0 ? (
            <EmptyState compact body={t('accessEmpty')} />
          ) : (
            <ul className="sd-items">
              {access.map((g) => (
                <li key={g.email} data-testid="send-access-row">
                  <div className="sd-link-main">
                    <strong className="sd-wrap">{g.email}</strong>
                    <span className="sd-rowmeta">{g.documentIds.length ? g.documentIds.map((id) => items.find((i) => i.documentId === id)?.title ?? '').filter(Boolean).join(', ') : t('accessNone')}</span>
                  </div>
                  {space.canEdit && (
                    <div className="sd-link-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => askRevoke(g.email)} data-testid="send-access-remove">
                        {t('remove')}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <SendDialog open={granting} title={t('accessNew')} onClose={() => setGranting(false)}>
            <form onSubmit={grant}>
              <div className="ui-modal-body sd-link-body">
                <div className="sd-field">
                  <label htmlFor="sa-email">{t('accessEmail')}</label>
                  <input id="sa-email" className="input" type="email" required value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} autoFocus data-testid="send-access-email" />
                </div>
                <fieldset className="sd-fieldset">
                  <legend>{t('accessDocs')}</legend>
                  {items.map((it) => (
                    <label className="sd-check" key={it.documentId}>
                      <input type="checkbox" checked={grantDocs.includes(it.documentId)} onChange={(e) => setGrantDocs((x) => (e.target.checked ? [...x, it.documentId] : x.filter((d) => d !== it.documentId)))} data-testid="send-access-doc" />
                      <span>{it.title}</span>
                    </label>
                  ))}
                </fieldset>
              </div>
              <div className="ui-modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setGranting(false)}>
                  {tc('cancel')}
                </button>
                <button type="submit" className="btn btn-primary" data-testid="send-access-save">
                  {tc('save')}
                </button>
              </div>
            </form>
          </SendDialog>
        </section>
      )}

      {tab === 'activity' && (
        <section data-testid="send-space-activity">
          <div className="sd-filters">
            {admin && (
              <a className="btn btn-secondary btn-sm sd-push" href={`/api/send/spaces/${space.id}/analytics?format=csv`} data-testid="send-space-export">
                {tv('export')}
              </a>
            )}
          </div>
          <div className="sd-kpis">
            <div>
              <strong className="num">{a.totals.visits}</strong>
              <span>{tv('kVisits')}</span>
            </div>
            <div>
              <strong className="num">{a.totals.visitors}</strong>
              <span>{tv('kVisitors')}</span>
            </div>
            <div>
              <strong className="num">{formatSeconds(a.totals.seconds)}</strong>
              <span>{t('kTotalTime')}</span>
            </div>
            <div>
              <strong className="num">{a.totals.downloads}</strong>
              <span>{tv('kDownloads')}</span>
            </div>
          </div>
          {a.totals.visits === 0 && a.denied.length === 0 ? (
            <EmptyState compact body={tv('empty')} />
          ) : (
            <>
              <h3 className="sd-h3">{t('perDocument')}</h3>
              <div className="table-wrap">
                <table className="table sd-table" data-testid="send-space-docstats">
                  <thead>
                    <tr>
                      <th scope="col">{t('colDocument')}</th>
                      <th scope="col" className="num">
                        {tv('kVisits')}
                      </th>
                      <th scope="col" className="num">
                        {tv('colTime')}
                      </th>
                      <th scope="col" className="num">
                        {tv('colCompletion')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.documents.map((d) => (
                      <tr key={d.documentId}>
                        <th scope="row">
                          <Link className="sd-rowtitle" href={`/app/send/documents/${d.documentId}?tab=activity`}>
                            {d.title}
                          </Link>
                        </th>
                        <td className="num">{d.visits}</td>
                        <td className="num">{formatSeconds(d.seconds)}</td>
                        <td className="num">{d.avgCompletion}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3 className="sd-h3">{tv('peopleTitle')}</h3>
              <div className="table-wrap">
                <table className="table sd-table" data-testid="send-space-people">
                  <thead>
                    <tr>
                      <th scope="col">{tv('colVisitor')}</th>
                      <th scope="col" className="num">
                        {t('colDocuments')}
                      </th>
                      <th scope="col" className="num">
                        {tv('colTime')}
                      </th>
                      <th scope="col" className="sd-hide-sm">
                        {tv('colLast')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.visitors.map((v) => (
                      <tr key={v.key}>
                        <th scope="row">
                          <span className="sd-rowtitle sd-wrap">{v.email ?? tv('anonymous')}</span>
                          {v.email && <span className={`badge ${v.verified ? 'badge-ok' : 'badge-outline'}`}>{v.verified ? tv('verified') : tv('unverified')}</span>}
                        </th>
                        <td className="num">{v.documents}</td>
                        <td className="num">{formatSeconds(v.seconds)}</td>
                        <td className="sd-hide-sm">{date(v.lastSeenAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {a.denied.length > 0 && (
                <>
                  <h3 className="sd-h3">{tv('deniedTitle')}</h3>
                  <ul className="sd-denied" data-testid="send-space-denied">
                    {a.denied.map((d, i) => (
                      <li key={i}>
                        <span className="sd-wrap">{d.email ?? tv('anonymous')}</span>
                        <span className="sd-rowmeta">
                          {d.linkName ? `${d.linkName} · ` : ''}
                          {date(d.at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>
      )}
      <ConfirmDialog
        open={lastRevoke !== null}
        title={t('lastAccessTitle')}
        body={t('lastAccessBody')}
        confirmLabel={t('lastAccessConfirm')}
        cancelLabel={tc('cancel')}
        danger
        onConfirm={() => {
          const email = lastRevoke;
          setLastRevoke(null);
          if (email) void revoke(email);
        }}
        onCancel={() => setLastRevoke(null)}
      />
      <ConfirmDialog open={deleting} title={t('deleteTitle')} body={t('deleteBody')} confirmLabel={tc('delete')} cancelLabel={tc('cancel')} danger busy={busy} onConfirm={remove} onCancel={() => setDeleting(false)} />
    </div>
  );
}

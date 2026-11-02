'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import TitleInput from '@/components/ui/TitleInput';
import type { LinkDto, VersionDto } from '@/lib/send/core';
import type { DocumentAnalytics } from '@/lib/send/analytics';
import AnalyticsPanels from './AnalyticsPanels';
import LinksPanel from './LinksPanel';
import { api, formatBytes, formatSeconds, pumpVersion, uploadFile, useDate, useErrorText, useToast, type UploadedVersion } from './ui';

type Tab = 'links' | 'activity' | 'pages' | 'versions' | 'preview';

export interface DocumentDetailProps {
  document: { id: string; title: string; sharing: string; canEdit: boolean; currentVersionId: string | null };
  versions: VersionDto[];
  links: LinkDto[];
  templates: Array<{ id: string; name: string }>;
  admin: boolean;
  initialTab?: string;
}

const ACCEPT = '.pdf,.docx,.pptx,.mp4,.webm,.mov,.m4v';

/** Un documento: links, quién leyó qué, páginas, versiones y vista previa. */
export default function DocumentDetail({ document: initial, versions: initialVersions, links: initialLinks, templates, admin, initialTab }: DocumentDetailProps) {
  const t = useTranslations('send');
  const tc = useTranslations('send.common');
  const errorText = useErrorText();
  const router = useRouter();
  const date = useDate();
  const [toasts, toast] = useToast();
  const [doc, setDoc] = useState(initial);
  const [versions, setVersions] = useState(initialVersions);
  const [links, setLinks] = useState(initialLinks);
  const [title, setTitle] = useState(initial.title);
  const [tab, setTab] = useState<Tab>((['links', 'activity', 'pages', 'versions', 'preview'] as Tab[]).includes(initialTab as Tab) ? (initialTab as Tab) : 'links');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState('');
  const [analytics, setAnalytics] = useState<DocumentAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState(false);
  const [filter, setFilter] = useState<{ version: string; link: string }>({ version: '', link: '' });
  const [live, setLive] = useState<Array<{ email: string | null; emailVerified: boolean; country: string | null; city: string | null; linkName: string }>>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const current = versions.find((v) => v.current) ?? null;
  const latest = versions[0] ?? null;
  const pending = latest && latest.id !== current?.id && (latest.status === 'processing' || latest.status === 'uploading') ? latest : null;
  const failed = latest && latest.status === 'failed' ? latest : null;

  const reloadVersions = useCallback(async () => {
    const r = await api<{ document: DocumentDetailProps['document']; versions: VersionDto[] }>(`/api/send/documents/${doc.id}`);
    if (r.ok) {
      setVersions(r.data.versions);
      setDoc(r.data.document);
    }
  }, [doc.id]);

  const loadAnalytics = useCallback(async () => {
    const qs = new URLSearchParams();
    if (filter.version) qs.set('version', filter.version);
    if (filter.link) qs.set('link', filter.link);
    const r = await api<DocumentAnalytics>(`/api/send/documents/${doc.id}/analytics?${qs}`);
    if (r.ok) {
      setAnalytics(r.data);
      setAnalyticsError(false);
    } else setAnalyticsError(true);
  }, [doc.id, filter]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  // Si la versión quedó a medio procesar (se cerró la pestaña), se sigue desde acá.
  useEffect(() => {
    if (!pending && latest?.status !== 'processing') return;
    const v = pending ?? latest;
    if (!v || v.status !== 'processing') return;
    let stop = false;
    void (async () => {
      await pumpVersion(v.id, { id: v.id, status: v.status, error: v.error, pageCount: v.pageCount, renderedCount: v.renderedCount, note: v.note }, () => undefined);
      if (!stop) await reloadVersions();
    })();
    return () => {
      stop = true;
    };
  }, [pending, latest, reloadVersions]);

  // Quién está leyendo ahora: cada 8 s con la pestaña visible.
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      const r = await api<{ readers: typeof live }>(`/api/send/documents/${doc.id}/live`);
      if (r.ok) {
        setLive((prev) => {
          if (prev.length !== r.data.readers.length) void loadAnalytics();
          return r.data.readers;
        });
      }
    };
    void tick();
    const h = window.setInterval(tick, 8000);
    return () => window.clearInterval(h);
  }, [doc.id, loadAnalytics]);

  const saveTitle = async () => {
    const next = title.trim();
    if (!next || next === doc.title) {
      setTitle(doc.title);
      return;
    }
    const r = await api<{ document: { title: string } }>(`/api/send/documents/${doc.id}`, { method: 'PATCH', json: { title: next } });
    if (r.ok) {
      setDoc((d) => ({ ...d, title: r.data.document.title }));
      router.refresh();
    } else {
      toast(errorText(r.data.error), 'bad');
      setTitle(doc.title);
    }
  };

  const setSharing = async (sharing: string) => {
    const r = await api(`/api/send/documents/${doc.id}`, { method: 'PATCH', json: { sharing } });
    if (r.ok) setDoc((d) => ({ ...d, sharing }));
    else toast(errorText(r.data.error), 'bad');
  };

  const remove = async () => {
    setBusy(true);
    const r = await api(`/api/send/documents/${doc.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!r.ok) return toast(errorText(r.data.error), 'bad');
    router.push('/app/send');
    router.refresh();
  };

  const replace = async (file: File) => {
    setReplacing(t('new.preparing'));
    try {
      const r = await api<{ version: UploadedVersion }>(`/api/send/documents/${doc.id}/versions`, { method: 'POST', json: { file: { name: file.name, mime: file.type, size: file.size } } });
      if (!r.ok) throw new Error(r.data.error);
      const done = await uploadFile(r.data.version.id, file, (p) => setReplacing(p.phase === 'upload' ? t('new.uploading', { pct: Math.round((p.done / p.total) * 100) }) : p.total ? t('new.rendering', { done: p.done, total: p.total }) : t('new.preparing')));
      await reloadVersions();
      if (done.status === 'ready') toast(t('versions.replaced'));
      else toast(errorText(done.error), 'bad');
    } catch (err) {
      toast(errorText(err instanceof Error ? err.message : 'generic'), 'bad');
      await reloadVersions();
    } finally {
      setReplacing('');
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const tabs: Tab[] = ['links', 'activity', 'pages', 'versions', 'preview'];

  return (
    <div className="app-page ui-page sd-page">
      {toasts}
      <nav className="sd-crumb" aria-label={t('home.title')}>
        <Link href="/app/send">{t('nav.documents')}</Link>
      </nav>
      <div className="sd-doc-head">
        <div className="sd-doc-title">
          {doc.canEdit ? (
            <TitleInput
              className="ui-title-input sd-title-input"
              value={title}
              maxLength={200}
              aria-label={t('detail.titleLabel')}
              onValueChange={setTitle}
              onBlur={saveTitle}
              data-testid="send-doc-title"
            />
          ) : (
            <h1 className="sd-title-static">{doc.title}</h1>
          )}
          <p className="sd-rowmeta">
            {current ? `${t(`kind.${current.kind}`)} · ${current.kind === 'video' && current.durationSec ? formatSeconds(current.durationSec) : t('home.pages', { count: current.pageCount })} · ${t('versions.label', { n: current.n })}` : t('status.processing')}
          </p>
        </div>
        {doc.canEdit && (
          <div className="sd-doc-actions">
            <input ref={fileInput} className="sr-only" type="file" accept={ACCEPT} data-testid="send-replace-file" tabIndex={-1} aria-hidden="true" onChange={(e) => e.target.files?.[0] && replace(e.target.files[0])} />
            <button type="button" className="btn btn-secondary btn-sm" disabled={!!replacing} onClick={() => fileInput.current?.click()} data-testid="send-replace">
              {t('detail.replace')}
            </button>
            <select className="input sd-sharing" value={doc.sharing} onChange={(e) => setSharing(e.target.value)} aria-label={t('detail.sharing')} data-testid="send-sharing">
              <option value="private">{t('detail.sharingPrivate')}</option>
              <option value="workspace">{t('detail.sharingWorkspace')}</option>
            </select>
            <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setDeleting(true)} data-testid="send-doc-delete">
              {tc('delete')}
            </button>
          </div>
        )}
      </div>

      {live.length > 0 && (
        <div className="sd-live-bar" role="status" data-testid="send-live-bar">
          <span className="sd-live">
            <i aria-hidden="true" />
            {t('live.reading')}
          </span>
          {live.map((r, i) => (
            <span key={i} className="sd-rowmeta">
              {r.email ? `${r.email}${r.emailVerified ? '' : ` (${t('visits.unverifiedShort')})`}` : [r.city, r.country].filter(Boolean).join(', ') || t('visits.anonymous')}
              {r.linkName ? ` · ${r.linkName}` : ''}
            </span>
          ))}
        </div>
      )}
      {replacing && (
        <p className="sd-notice" role="status" data-testid="send-replacing">
          {replacing}
        </p>
      )}
      {!replacing && pending && (
        <p className="sd-notice" role="status" data-testid="send-processing">
          {pending.pageCount ? t('new.rendering', { done: pending.renderedCount, total: pending.pageCount }) : t('new.preparing')}
        </p>
      )}
      {failed && (
        <p className="sd-notice sd-notice-bad" role="alert" data-testid="send-failed">
          {errorText(failed.error)} {current ? t('detail.keepsCurrent', { n: current.n }) : t('detail.replaceToFix')}
        </p>
      )}
      {current?.note === 'simplified' && (
        <p className="sd-notice" data-testid="send-simplified">
          {t(`detail.simplified_${current.kind}`)}
        </p>
      )}

      <div className="ui-tabs sd-tabs" role="tablist" aria-label={t('detail.tabs')}>
        {tabs.map((x) => (
          <button key={x} type="button" role="tab" className="ui-tab" aria-selected={tab === x} onClick={() => setTab(x)} data-testid={`send-tab-${x}`}>
            {t(`detail.tab_${x}`)}
          </button>
        ))}
      </div>

      {tab === 'links' && <LinksPanel links={links} setLinks={setLinks} createUrl={`/api/send/documents/${doc.id}/links`} templates={templates} canCreate={!!current} />}

      {(tab === 'activity' || tab === 'pages') && (
        <AnalyticsPanels
          mode={tab}
          analytics={analytics}
          error={analyticsError}
          onRetry={loadAnalytics}
          versions={versions}
          links={links}
          filter={filter}
          setFilter={setFilter}
          exportUrl={admin ? `/api/send/documents/${doc.id}/export` : null}
          currentVersionId={current?.id ?? null}
          kind={current?.kind ?? 'pdf'}
          bucketSec={current?.bucketSec ?? null}
        />
      )}

      {tab === 'versions' && (
        <section data-testid="send-versions">
          <div className="sd-section-head">
            <h2>{t('versions.title')}</h2>
          </div>
          <p className="sd-help">{t('versions.help')}</p>
          <div className="table-wrap">
            <table className="table sd-table">
              <thead>
                <tr>
                  <th scope="col">{t('versions.col')}</th>
                  <th scope="col" className="num">
                    {t('home.colVisits')}
                  </th>
                  <th scope="col" className="num sd-hide-sm">
                    {t('versions.colCompletion')}
                  </th>
                  <th scope="col" className="num sd-hide-sm">
                    {t('versions.colTime')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => {
                  const s = analytics?.versions.find((x) => x.versionId === v.id);
                  return (
                    <tr key={v.id} data-testid="send-version-row">
                      <th scope="row">
                        <span className="sd-rowtitle">
                          {t('versions.label', { n: v.n })}
                          {v.current && <span className="badge badge-ok sd-badge-inline">{t('versions.current')}</span>}
                          {v.status === 'failed' && <span className="badge badge-bad sd-badge-inline">{t('status.failed')}</span>}
                          {(v.status === 'processing' || v.status === 'uploading') && <span className="badge badge-info sd-badge-inline">{t('status.processing')}</span>}
                        </span>
                        <span className="sd-rowmeta">
                          {v.name} · {formatBytes(v.size)} · {date(v.createdAt, false)}
                        </span>
                      </th>
                      <td className="num">{s?.visits ?? 0}</td>
                      <td className="num sd-hide-sm">{s ? `${s.avgCompletion}%` : ''}</td>
                      <td className="num sd-hide-sm">{s ? formatSeconds(s.avgSeconds) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'preview' && <Preview current={current} />}

      <ConfirmDialog open={deleting} title={t('detail.deleteTitle')} body={t('detail.deleteBody')} confirmLabel={tc('delete')} cancelLabel={tc('cancel')} danger busy={busy} onConfirm={remove} onCancel={() => setDeleting(false)} />
    </div>
  );
}

function Preview({ current }: { current: VersionDto | null }) {
  const t = useTranslations('send');
  if (!current) return <p className="sd-help">{t('status.processing')}</p>;
  if (current.kind === 'video') {
    return (
      <section data-testid="send-preview">
        <video className="sd-preview-video" controls preload="metadata" src={`/api/send/versions/${current.id}/file`} />
      </section>
    );
  }
  return (
    <section className="sd-preview" data-testid="send-preview">
      {Array.from({ length: current.pageCount }, (_, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} loading="lazy" src={`/api/send/versions/${current.id}/pages/${i + 1}?w=480`} alt={t('viewer.pageAlt', { page: i + 1 })} />
      ))}
    </section>
  );
}

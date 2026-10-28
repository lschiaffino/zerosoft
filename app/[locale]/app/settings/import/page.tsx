import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import { Link } from '@/i18n/navigation';
import { PRODUCT_CONFIG } from '@/lib/products';
import {
  IMPORT_HUB_APPS,
  importSource,
  importSourcesFor,
  isImportHubApp,
  type ImportHubApp,
  type ImportSourceDef,
} from '@/lib/import-registry';
import { listWorkspaceImportJobs, type ImportJobView } from '@/lib/import-jobs';
import {
  listImportJobs as listCrmImportJobs,
  activeImportJob as activeCrmImportJob,
  type ImportJobView as CrmJobView,
} from '@/lib/crm-import-jobs';
import { listTeamspaces } from '@/lib/docs-access';
import { canCreateDocPage } from '@/lib/docs-guard';
import { parseDbUtc } from '@/lib/utils';
import FormSection from '@/components/ui/FormSection';
import ProductGlyph from '@/components/brand/ProductGlyph';
import ClientMessages from '@/components/i18n/ClientMessages';
import CrmMigrationPanel from '@/components/crm/CrmMigrationPanel';
import NotionApiImportPanel from '@/components/docs/NotionApiImportPanel';
import NotionImportPanel from '@/components/docs/NotionImportPanel';
import TrackImportPanel from '@/components/track/TrackImportPanel';
import CalendlyImportPanel from '@/components/calendar/CalendlyImportPanel';
import type { ImportSource as DocsZipSource } from '@/lib/docs-import-sources';
import '@/styles/import-shared.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'import');
}

interface RecentRow {
  key: string;
  app: ImportHubApp;
  name: string;
  sourceId: string | null;
  status: string;
  createdAt: string;
  summary: string;
}

const STATUS_KEYS = new Set(['preview', 'queued', 'running', 'fetching', 'importing', 'uploading', 'done', 'failed', 'cancelled']);

/** Fuente del registro para un job de import_jobs (los CSV de Track van al CSV genérico). */
function sourceIdFor(job: ImportJobView): string | null {
  const id = `${job.app === 'cal' ? 'cal' : job.app}:${job.source}`;
  if (importSource(id)) return id;
  if (job.app === 'track' && job.source.endsWith('_csv')) return 'track:csv';
  return null;
}

/**
 * Ajustes › Importar: el hub de importación. Sin `source`, todas las fuentes
 * por app (token o archivo) y los imports recientes; con `?source=<app>:<fuente>`,
 * cómo sacar el token (pasos y permisos exactos) y el importador de esa
 * fuente. `?app=` (el atajo "Importar" de cada app) pone primero esa app.
 */
export default async function ImportSettingsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ source?: string; app?: string }>;
}) {
  const { locale } = await props.params;
  const { source, app } = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'settings.importHub' });
  const admin = isWorkspaceAdmin(user);
  const def = importSource(source);

  if (def) return <SourceDetail locale={locale} def={def} admin={admin} user={user} />;

  const focus = isImportHubApp(app) ? app : null;
  const apps = focus ? [focus, ...IMPORT_HUB_APPS.filter((a) => a !== focus)] : [...IMPORT_HUB_APPS];

  const [generic, crm, crmActive] = await Promise.all([
    // Un miembro ve solo sus imports (los de los demás pueden nombrar páginas privadas).
    listWorkspaceImportJobs(user.id, 15, admin ? null : realUserId(user)).catch(() => [] as ImportJobView[]),
    admin ? listCrmImportJobs(user.id, 10).catch(() => [] as CrmJobView[]) : Promise.resolve([] as CrmJobView[]),
    admin ? activeCrmImportJob(user.id).catch(() => null) : Promise.resolve(null),
  ]);
  const crmRows = crmActive && !crm.some((j) => j.id === crmActive.id) ? [crmActive, ...crm] : crm;
  const recent: RecentRow[] = [
    ...crmRows.map((j) => ({
      key: `crm-${j.id}`,
      app: 'crm' as const,
      name: j.provider === 'hubspot' ? 'HubSpot' : 'Pipedrive',
      sourceId: `crm:${j.provider}`,
      status: j.status,
      createdAt: j.createdAt,
      summary: t('recentCrm', {
        contacts: j.counts.contacts.created + j.counts.contacts.updated,
        companies: j.counts.companies.created + j.counts.companies.updated,
        deals: j.counts.deals.created + j.counts.deals.updated,
      }),
    })),
    ...generic.map((j) => {
      const sid = sourceIdFor(j);
      const report = (j.report ?? {}) as { created?: number; updated?: number };
      return {
        key: `job-${j.id}`,
        app: j.app === 'cal' ? ('cal' as const) : (j.app as ImportHubApp),
        name: (sid && importSource(sid)?.name) || j.source,
        sourceId: sid,
        status: j.status,
        createdAt: j.created_at,
        summary:
          typeof report.created === 'number'
            ? t('recentCreatedUpdated', {
                created: report.created,
                updated: report.updated ?? 0,
              })
            : t('recentItems', { count: j.total }),
      };
    }),
  ]
    .sort((a, b) => parseDbUtc(b.createdAt).getTime() - parseDbUtc(a.createdAt).getTime())
    .slice(0, 15);
  const fmt = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const when = (raw: string) => {
    const d = parseDbUtc(raw);
    return Number.isNaN(d.getTime()) ? raw : fmt.format(d);
  };

  return (
    <div className="st-stack st-imp" data-testid="import-hub">
      <FormSection title={t('title')} description={t('desc')}>
        <p className="ui-help">{t('safety')}</p>
        {!admin && <p className="ximp-note">{t('memberNote')}</p>}
      </FormSection>

      <FormSection title={t('recentTitle')} description={t('recentDesc')}>
        {recent.length === 0 ? (
          <p className="ui-help" data-testid="import-hub-recent-empty">
            {t('recentEmpty')}
          </p>
        ) : (
          <ul className="st-imp-recent" data-testid="import-hub-recent">
            {recent.map((r) => (
              <li key={r.key} className="st-imp-recent-row" data-status={r.status}>
                <span className="st-imp-recent-name">
                  <ProductGlyph product={r.app} size={12} />
                  {r.sourceId ? <Link href={`/app/settings/import?source=${encodeURIComponent(r.sourceId)}`}>{r.name}</Link> : r.name}
                  <span className="ui-help"> · {PRODUCT_CONFIG[r.app].name}</span>
                </span>
                <span className="st-imp-recent-status">{STATUS_KEYS.has(r.status) ? t(`status.${r.status}`) : r.status}</span>
                <span className="ui-help">{r.summary}</span>
                <span className="ui-help data">{when(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </FormSection>

      {apps.map((a) => (
        <FormSection
          key={a}
          id={`import-${a}`}
          className="st-imp-app"
          title={
            <span className="st-imp-app-title" data-focus={focus === a || undefined}>
              <ProductGlyph product={a} size={14} />
              {t('appTitle', { app: PRODUCT_CONFIG[a].name })}
            </span>
          }
          description={t(`appDesc.${a}`)}
        >
          <ul className="st-imp-sources" data-testid={`import-hub-app-${a}`}>
            {importSourcesFor(a).map((s) => (
              <li key={s.id} className="st-imp-source" data-testid={`import-source-${s.id}`}>
                <div className="st-imp-source-main">
                  <span className="st-imp-source-name">{s.name}</span>
                  <span className="st-imp-auth">{t(`auth.${s.auth}`)}</span>
                  {s.adminOnly && <span className="ui-help">{t('adminOnly')}</span>}
                </div>
                <p className="ui-help st-imp-source-what">{s.entities.map((e) => t(`entities.${e}`)).join(', ')}</p>
                <div className="st-imp-source-cta">
                  <Link
                    className="btn btn-secondary btn-sm"
                    href={`/app/settings/import?source=${encodeURIComponent(s.id)}`}
                    aria-label={t('importFromLabel', {
                      source: s.name,
                      app: PRODUCT_CONFIG[a].name,
                    })}
                  >
                    {t('importCta')}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </FormSection>
      ))}
    </div>
  );
}

async function SourceDetail({
  locale,
  def,
  admin,
  user,
}: {
  locale: string;
  def: ImportSourceDef;
  admin: boolean;
  user: Awaited<ReturnType<typeof requireUser>>;
}) {
  const t = await getTranslations({ locale, namespace: 'settings.importHub' });
  const appName = PRODUCT_CONFIG[def.app].name;
  const steps = Array.from({ length: def.stepCount }, (_, i) => t(`steps.${def.steps}.${i + 1}`));

  let panel: ReactNode = null;
  if (def.adminOnly && !admin && def.panel !== 'docs-api') {
    // Mismo aviso para toda fuente que solo importan admins (como Notion por API).
    panel = <p className="ximp-note">{t('adminOnlySource', { source: def.name, app: appName })}</p>;
  } else if (def.panel === 'crm') {
    panel = (
      <ClientMessages locale={locale} namespaces={['crm.migrate', 'crm.common', 'crm.settings']}>
        <CrmMigrationPanel canAdmin={admin} initialProvider={def.source as 'hubspot' | 'pipedrive'} locale={locale} embedded />
      </ClientMessages>
    );
  } else if (def.panel === 'track') {
    panel = (
      <ClientMessages locale={locale} namespaces={['track.importer']}>
        <TrackImportPanel isAdmin={admin} initialSource={def.panelSource} showExport={false} />
      </ClientMessages>
    );
  } else if (def.panel === 'cal') {
    panel = (
      <ClientMessages locale={locale} namespaces={['calendar.importer']}>
        <CalendlyImportPanel canEdit={admin} />
      </ClientMessages>
    );
  } else if (def.panel === 'docs-api' || def.panel === 'docs-zip') {
    const all = await listTeamspaces(user.id, realUserId(user));
    const teamspaces: Array<{ id: string; name: string }> = [];
    for (const ts of all) {
      if (ts.deleted_at) continue;
      if (await canCreateDocPage(user, { teamspace_id: ts.id })) teamspaces.push({ id: ts.id, name: ts.name });
    }
    const canWorkspace = await canCreateDocPage(user, {});
    if (def.panel === 'docs-api') {
      panel = admin ? (
        <NotionApiImportPanel teamspaces={teamspaces} canWorkspace={canWorkspace} />
      ) : (
        <p className="ximp-note">{t('adminOnlyLong')}</p>
      );
    } else {
      panel =
        canWorkspace || teamspaces.length > 0 ? (
          <ClientMessages locale={locale} namespaces={['docs.notionImport']}>
            <NotionImportPanel
              blobUpload={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
              teamspaces={teamspaces}
              canWorkspace={canWorkspace}
              initialSource={(def.panelSource ?? 'notion') as DocsZipSource}
            />
          </ClientMessages>
        ) : (
          <p className="ximp-note">{t('noDestination')}</p>
        );
    }
  } else if (def.href) {
    panel = (
      <div className="ximp-actions">
        <Link className="btn btn-primary" href={def.href}>
          {t('openImporter', { app: appName })}
        </Link>
      </div>
    );
  }

  return (
    <div className="st-stack st-imp" data-testid="import-hub-source" data-source={def.id}>
      <p>
        <Link href={`/app/settings/import?app=${def.app}`} className="st-imp-back">
          {t('backAll')}
        </Link>
      </p>
      <FormSection
        title={
          <span className="st-imp-app-title">
            <ProductGlyph product={def.app} size={14} />
            {t('detailTitle', { source: def.name, app: appName })}
          </span>
        }
        description={t(`detailDesc.${def.auth}`, {
          source: def.name,
          app: appName,
        })}
      >
        <div className="st-imp-howto" data-testid="import-hub-howto">
          <h3 className="st-imp-h">
            {t(def.auth === 'token' ? 'howtoToken' : 'howtoFile', {
              source: def.name,
            })}
          </h3>
          <ol className="st-imp-steps">
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {def.scopes && def.scopes.length > 0 && (
            <div className="st-imp-scopes">
              <p className="label">{t(def.id === 'docs:notion_api' ? 'capabilitiesTitle' : 'scopesTitle')}</p>
              <ul className="mono" data-testid="import-hub-scopes">
                {def.scopes.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {(def.tokenUrl || def.docsUrl) && (
            <p className="st-imp-links">
              {def.tokenUrl && (
                <a href={def.tokenUrl} target="_blank" rel="noopener noreferrer">
                  {t(def.auth === 'token' ? 'openTokenPage' : 'openExportPage', { source: def.name })}
                </a>
              )}
              {def.docsUrl && (
                <a href={def.docsUrl} target="_blank" rel="noopener noreferrer">
                  {t('officialDocs', { source: def.name })}
                </a>
              )}
            </p>
          )}
          {def.auth === 'token' && <p className="ui-help">{t('safety')}</p>}
        </div>
      </FormSection>
      <div className="st-imp-flow">{panel}</div>
    </div>
  );
}

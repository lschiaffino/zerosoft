/**
 * Docs: bases sincronizadas (como las "synced databases" de Notion). Una base
 * de solo lectura que trae issues o PRs de GitHub, issues de Jira (por JQL),
 * registros de Salesforce (SOQL) o deals, contactos y empresas del CRM de
 * zerosoft. El cron de cada minuto refresca las vencidas (cada origen se
 * reclama con compare-and-set) y "Sincronizar ahora" corre al momento.
 *
 * - Credenciales cifradas con lib/secret-box, nunca devueltas ni logueadas.
 * - Las llamadas salen por safeFetch (sin hosts privados).
 * - Las filas llevan id estable por ítem: lo que se borra en el origen sale
 *   de la base y lo nuevo entra; las vistas (filtros, orden) son del usuario.
 * - En e2e (DOCS_SYNC_FAKE=1, nunca en un deploy de producción) los
 *   proveedores externos responden datos fijos sin salir a internet.
 *
 * Server-only.
 */
import { createHash } from 'crypto';
import { getDb, type DocsPageRow } from './db';
import { open, seal } from './secret-box';
import { safeFetch } from './safe-fetch';
import { parseBlocks } from './docs';
import type { DbOption, DbProperty, DbPropertyType, DbRow, DbSyncProvider, DbValue, DocsBlock, DocsDatabase } from './docs-types';
import { stringifyBlocks } from './docs-types';
import { newDbId, normalizeDatabase } from './docs-database';
import { sanitizeBlocks, sanitizeDatabase } from './docs-sanitize';
import { mdToBlocks } from './docs-platform-text';
import { nextUpdatedAt, recordRevisions } from './docs-revisions';

export const SYNC_PROVIDERS: DbSyncProvider[] = ['github', 'jira', 'salesforce', 'crm'];
export const SALESFORCE_OBJECTS = ['Opportunity', 'Account', 'Contact', 'Lead', 'Case'] as const;
export const CRM_OBJECTS = ['deals', 'contacts', 'companies'] as const;
export const SYNC_INTERVALS = [15, 60, 360, 1440] as const;
/** Tope de ítems por base (como el límite de filas de una base). */
export const SYNC_MAX_ITEMS = 1000;

export class DocsSyncError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
    this.name = 'DocsSyncError';
  }
}

export interface SyncConfig {
  /** github: owner/repo. */
  repo?: string;
  /** github: issues o pulls. */
  kind?: 'issues' | 'pulls';
  /** github: open o all. */
  state?: 'open' | 'all';
  /** jira: acme.atlassian.net. */
  site?: string;
  jql?: string;
  /** jira: email de la cuenta del token. */
  email?: string;
  /** salesforce: https://acme.my.salesforce.com y objeto. */
  instanceUrl?: string;
  object?: string;
  /** crm: deals, contacts o companies. */
  crmObject?: (typeof CRM_OBJECTS)[number];
}

export interface SyncSecret {
  token?: string;
  /** salesforce: refresh token de una Connected App (renueva el access token en cada corrida). */
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface SyncSourceRow {
  id: string;
  workspace_id: string;
  page_id: string;
  block_id: string;
  provider: DbSyncProvider;
  config: string;
  secret: string | null;
  created_by: string | null;
  status: string;
  last_error: string | null;
  item_count: number;
  interval_min: number;
  last_synced_at: string | null;
  next_sync_at: string | null;
  claimed_until: string | null;
}

export interface SyncSourceDto {
  id: string;
  pageId: string;
  blockId: string;
  provider: DbSyncProvider;
  config: SyncConfig;
  label: string;
  status: 'pending' | 'ok' | 'error';
  error: string | null;
  itemCount: number;
  intervalMin: number;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  hasToken: boolean;
}

export function syncFakeActive(): boolean {
  return process.env.DOCS_SYNC_FAKE === '1' && process.env.VERCEL_ENV !== 'production';
}

function parseConfig(raw: string): SyncConfig {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as SyncConfig) : {};
  } catch {
    return {};
  }
}

function readSecret(row: Pick<SyncSourceRow, 'secret'>): SyncSecret {
  if (!row.secret) return {};
  try {
    return JSON.parse(open(row.secret)) as SyncSecret;
  } catch {
    return {};
  }
}

/** "acme/web · Issues", "ENG · JQL", "Salesforce · Opportunity", "CRM · Deals". */
export function syncLabel(provider: DbSyncProvider, cfg: SyncConfig): string {
  switch (provider) {
    case 'github':
      return `${cfg.repo ?? ''} · ${cfg.kind === 'pulls' ? 'Pull requests' : 'Issues'}`;
    case 'jira':
      return `${cfg.site ?? ''} · ${(cfg.jql ?? '').slice(0, 80)}`;
    case 'salesforce':
      return `Salesforce · ${cfg.object ?? ''}`;
    default:
      return `CRM · ${cfg.crmObject === 'contacts' ? 'Contacts' : cfg.crmObject === 'companies' ? 'Companies' : 'Deals'}`;
  }
}

export function toDto(r: SyncSourceRow): SyncSourceDto {
  const config = parseConfig(r.config);
  return {
    id: r.id,
    pageId: r.page_id,
    blockId: r.block_id,
    provider: r.provider,
    config,
    label: syncLabel(r.provider, config),
    status: r.status === 'ok' || r.status === 'error' ? r.status : 'pending',
    error: r.last_error,
    itemCount: r.item_count,
    intervalMin: r.interval_min,
    lastSyncedAt: r.last_synced_at,
    nextSyncAt: r.next_sync_at,
    hasToken: Boolean(r.secret),
  };
}

// ---------- Validación de la configuración ----------

const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const SITE_RE = /^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/;

/** Normaliza y valida lo que manda el diálogo. Tira DocsSyncError con el campo que falta. */
export function normalizeConfig(provider: DbSyncProvider, raw: Record<string, unknown>): SyncConfig {
  const s = (k: string, max = 300) => (typeof raw[k] === 'string' ? (raw[k] as string).trim().slice(0, max) : '');
  switch (provider) {
    case 'github': {
      let repo = s('repo', 220).replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
      repo = repo.split('/').slice(0, 2).join('/');
      if (!REPO_RE.test(repo)) throw new DocsSyncError('invalid_repo');
      return { repo, kind: raw.kind === 'pulls' ? 'pulls' : 'issues', state: raw.state === 'all' ? 'all' : 'open' };
    }
    case 'jira': {
      const site = s('site', 120).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!SITE_RE.test(site)) throw new DocsSyncError('invalid_site');
      const jql = s('jql', 1000) || 'ORDER BY updated DESC';
      const email = s('email', 200).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DocsSyncError('invalid_email');
      return { site, jql, email };
    }
    case 'salesforce': {
      const instanceUrl = s('instanceUrl', 200).replace(/\/+$/, '');
      let url: URL;
      try {
        url = new URL(instanceUrl);
      } catch {
        throw new DocsSyncError('invalid_instance');
      }
      if (url.protocol !== 'https:' || !/\.(my\.)?salesforce\.com$|\.force\.com$/.test(url.hostname)) throw new DocsSyncError('invalid_instance');
      const object = (SALESFORCE_OBJECTS as readonly string[]).includes(s('object')) ? s('object') : 'Opportunity';
      return { instanceUrl: url.origin, object };
    }
    default:
      return { crmObject: (CRM_OBJECTS as readonly string[]).includes(s('crmObject')) ? (s('crmObject') as SyncConfig['crmObject']) : 'deals' };
  }
}

// ---------- Ítems ----------

/** Un ítem del origen, ya como valores por propiedad (clave = id de propiedad). */
export interface SyncItem {
  key: string;
  title: string;
  values: Record<string, string | number | boolean | string[] | null>;
  body?: string;
}

interface ColumnDef {
  id: string;
  name: string;
  type: DbPropertyType;
}

/** Propiedades fijas por origen (los ids no cambian: las vistas y filtros siguen valiendo). */
export function syncColumns(provider: DbSyncProvider, cfg: SyncConfig): ColumnDef[] {
  const title: ColumnDef = { id: 'title', name: 'Name', type: 'title' };
  switch (provider) {
    case 'github':
      return [
        { ...title, name: 'Title' },
        { id: 'number', name: 'Number', type: 'text' },
        { id: 'state', name: 'State', type: 'select' },
        { id: 'author', name: 'Author', type: 'text' },
        { id: 'assignees', name: 'Assignees', type: 'text' },
        { id: 'labels', name: 'Labels', type: 'multi_select' },
        ...(cfg.kind === 'pulls' ? [{ id: 'draft', name: 'Draft', type: 'checkbox' as const }] : [{ id: 'milestone', name: 'Milestone', type: 'text' as const }]),
        { id: 'created', name: 'Created', type: 'date' },
        { id: 'updated', name: 'Updated', type: 'date' },
        { id: 'url', name: 'URL', type: 'url' },
      ];
    case 'jira':
      return [
        { ...title, name: 'Summary' },
        { id: 'key', name: 'Key', type: 'text' },
        { id: 'status', name: 'Status', type: 'select' },
        { id: 'type', name: 'Type', type: 'select' },
        { id: 'priority', name: 'Priority', type: 'select' },
        { id: 'assignee', name: 'Assignee', type: 'text' },
        { id: 'created', name: 'Created', type: 'date' },
        { id: 'updated', name: 'Updated', type: 'date' },
        { id: 'url', name: 'URL', type: 'url' },
      ];
    case 'salesforce':
      return salesforceColumns(cfg.object ?? 'Opportunity');
    default:
      if (cfg.crmObject === 'contacts')
        return [
          title,
          { id: 'email', name: 'Email', type: 'email' },
          { id: 'phone', name: 'Phone', type: 'phone' },
          { id: 'job', name: 'Job title', type: 'text' },
          { id: 'stage', name: 'Lifecycle stage', type: 'select' },
          { id: 'company', name: 'Company', type: 'text' },
          { id: 'updated', name: 'Updated', type: 'date' },
          { id: 'url', name: 'URL', type: 'url' },
        ];
      if (cfg.crmObject === 'companies')
        return [
          title,
          { id: 'domain', name: 'Domain', type: 'url' },
          { id: 'industry', name: 'Industry', type: 'select' },
          { id: 'employees', name: 'Employees', type: 'number' },
          { id: 'country', name: 'Country', type: 'text' },
          { id: 'updated', name: 'Updated', type: 'date' },
          { id: 'url', name: 'URL', type: 'url' },
        ];
      return [
        title,
        { id: 'stage', name: 'Stage', type: 'select' },
        { id: 'amount', name: 'Amount', type: 'number' },
        { id: 'currency', name: 'Currency', type: 'text' },
        { id: 'close', name: 'Close date', type: 'date' },
        { id: 'owner', name: 'Owner', type: 'text' },
        { id: 'updated', name: 'Updated', type: 'date' },
        { id: 'url', name: 'URL', type: 'url' },
      ];
  }
}

function salesforceColumns(object: string): ColumnDef[] {
  const base: ColumnDef[] = [{ id: 'title', name: 'Name', type: 'title' }];
  const tail: ColumnDef[] = [
    { id: 'owner', name: 'Owner', type: 'text' },
    { id: 'updated', name: 'Last modified', type: 'date' },
    { id: 'url', name: 'URL', type: 'url' },
  ];
  switch (object) {
    case 'Account':
      return [...base, { id: 'industry', name: 'Industry', type: 'select' }, { id: 'type', name: 'Type', type: 'select' }, { id: 'website', name: 'Website', type: 'url' }, ...tail];
    case 'Contact':
      return [...base, { id: 'email', name: 'Email', type: 'email' }, { id: 'phone', name: 'Phone', type: 'phone' }, { id: 'account', name: 'Account', type: 'text' }, ...tail];
    case 'Lead':
      return [...base, { id: 'company', name: 'Company', type: 'text' }, { id: 'status', name: 'Status', type: 'select' }, { id: 'email', name: 'Email', type: 'email' }, ...tail];
    case 'Case':
      return [...base, { id: 'status', name: 'Status', type: 'select' }, { id: 'priority', name: 'Priority', type: 'select' }, { id: 'number', name: 'Case number', type: 'text' }, ...tail];
    default:
      return [
        ...base,
        { id: 'stage', name: 'Stage', type: 'select' },
        { id: 'amount', name: 'Amount', type: 'number' },
        { id: 'close', name: 'Close date', type: 'date' },
        { id: 'account', name: 'Account', type: 'text' },
        ...tail,
      ];
  }
}

const SF_FIELDS: Record<string, string> = {
  Opportunity: 'Id, Name, StageName, Amount, CloseDate, Account.Name, Owner.Name, LastModifiedDate',
  Account: 'Id, Name, Industry, Type, Website, Owner.Name, LastModifiedDate',
  Contact: 'Id, Name, Email, Phone, Account.Name, Owner.Name, LastModifiedDate',
  Lead: 'Id, Name, Company, Status, Email, Owner.Name, LastModifiedDate',
  Case: 'Id, Subject, Status, Priority, CaseNumber, Owner.Name, LastModifiedDate',
};

const day = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await safeFetch(url, { headers: { accept: 'application/json', 'user-agent': 'zerosoft-docs-sync', ...headers } }, 15_000);
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel().catch(() => {});
    throw new DocsSyncError('auth_failed');
  }
  if (res.status === 404) {
    await res.body?.cancel().catch(() => {});
    throw new DocsSyncError('source_not_found');
  }
  if (res.status === 429) {
    await res.body?.cancel().catch(() => {});
    throw new DocsSyncError('rate_limited');
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new DocsSyncError(`http_${res.status}`);
  }
  return res.json();
}

/** Página siguiente del header Link de GitHub. */
function nextLink(link: string | null): string | null {
  const m = link?.split(',').find((p) => /rel="next"/.test(p))?.match(/<([^>]+)>/);
  return m ? m[1] : null;
}

async function fetchGithub(cfg: SyncConfig, secret: SyncSecret): Promise<SyncItem[]> {
  const base = process.env.DOCS_SYNC_GITHUB_API_URL?.trim() || 'https://api.github.com';
  const headers: Record<string, string> = { 'x-github-api-version': '2022-11-28', accept: 'application/vnd.github+json' };
  if (secret.token) headers.authorization = `Bearer ${secret.token}`;
  const path = cfg.kind === 'pulls' ? 'pulls' : 'issues';
  let url: string | null = `${base}/repos/${cfg.repo}/${path}?state=${cfg.state === 'all' ? 'all' : 'open'}&per_page=100&sort=updated&direction=desc`;
  const items: SyncItem[] = [];
  for (let page = 0; url && page < 10 && items.length < SYNC_MAX_ITEMS; page++) {
    const res = await safeFetch(url, { headers: { 'user-agent': 'zerosoft-docs-sync', ...headers } }, 15_000);
    if (res.status === 401 || res.status === 403) throw new DocsSyncError(res.headers.get('x-ratelimit-remaining') === '0' ? 'rate_limited' : 'auth_failed');
    if (res.status === 404) throw new DocsSyncError('source_not_found');
    if (!res.ok) throw new DocsSyncError(`http_${res.status}`);
    const list = (await res.json()) as Array<Record<string, unknown>>;
    for (const it of Array.isArray(list) ? list : []) {
      // El endpoint de issues también trae los PRs.
      if (path === 'issues' && it.pull_request) continue;
      const user = it.user as { login?: string } | null;
      const assignees = (Array.isArray(it.assignees) ? it.assignees : []) as Array<{ login?: string }>;
      const labels = (Array.isArray(it.labels) ? it.labels : []) as Array<{ name?: string } | string>;
      const milestone = it.milestone as { title?: string } | null;
      const merged = path === 'pulls' && typeof it.merged_at === 'string';
      items.push({
        key: String(it.id ?? it.number),
        title: str(it.title),
        values: {
          number: `#${str(it.number)}`,
          state: merged ? 'merged' : str(it.state),
          author: user?.login ?? '',
          assignees: assignees.map((a) => a.login ?? '').filter(Boolean).join(', '),
          labels: labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
          ...(path === 'pulls' ? { draft: it.draft === true } : { milestone: milestone?.title ?? '' }),
          created: day(it.created_at),
          updated: day(it.updated_at),
          url: str(it.html_url),
        },
        body: typeof it.body === 'string' ? it.body : undefined,
      });
    }
    url = nextLink(res.headers.get('link'));
  }
  return items.slice(0, SYNC_MAX_ITEMS);
}

/** Texto plano de un campo en Atlassian Document Format (descripción de Jira). */
function adfText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'text') return n.text ?? '';
  const inner = (n.content ?? []).map(adfText).join(n.type === 'doc' ? '\n\n' : '');
  return n.type === 'paragraph' || n.type === 'heading' ? inner : inner;
}

async function fetchJira(cfg: SyncConfig, secret: SyncSecret): Promise<SyncItem[]> {
  if (!secret.token) throw new DocsSyncError('missing_token');
  const base = process.env.DOCS_SYNC_JIRA_API_URL?.trim() || `https://${cfg.site}`;
  const auth = `Basic ${Buffer.from(`${cfg.email}:${secret.token}`).toString('base64')}`;
  const items: SyncItem[] = [];
  let next: string | undefined;
  for (let page = 0; page < 10 && items.length < SYNC_MAX_ITEMS; page++) {
    const qs = new URLSearchParams({
      jql: cfg.jql || 'ORDER BY updated DESC',
      maxResults: '100',
      fields: 'summary,status,issuetype,priority,assignee,created,updated,description',
    });
    if (next) qs.set('nextPageToken', next);
    const data = (await getJson(`${base}/rest/api/3/search/jql?${qs}`, { authorization: auth })) as {
      issues?: Array<{ id: string; key: string; fields?: Record<string, unknown> }>;
      nextPageToken?: string;
      isLast?: boolean;
    };
    for (const it of data.issues ?? []) {
      const f = it.fields ?? {};
      const name = (k: string) => ((f[k] as { name?: string } | null)?.name ?? '');
      items.push({
        key: it.id,
        title: str(f.summary),
        values: {
          key: it.key,
          status: name('status'),
          type: name('issuetype'),
          priority: name('priority'),
          assignee: ((f.assignee as { displayName?: string } | null)?.displayName ?? ''),
          created: day(f.created),
          updated: day(f.updated),
          url: `https://${cfg.site}/browse/${encodeURIComponent(it.key)}`,
        },
        body: adfText(f.description).trim() || undefined,
      });
    }
    if (data.isLast !== false || !data.nextPageToken) break;
    next = data.nextPageToken;
  }
  return items.slice(0, SYNC_MAX_ITEMS);
}

/** Access token de Salesforce: el guardado, o uno nuevo con el refresh token de la Connected App. */
async function salesforceToken(cfg: SyncConfig, secret: SyncSecret): Promise<string> {
  if (secret.refreshToken && secret.clientId) {
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: secret.refreshToken, client_id: secret.clientId });
    if (secret.clientSecret) body.set('client_secret', secret.clientSecret);
    const res = await safeFetch(`${cfg.instanceUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }, 15_000);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new DocsSyncError('auth_failed');
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new DocsSyncError('auth_failed');
    return data.access_token;
  }
  if (!secret.token) throw new DocsSyncError('missing_token');
  return secret.token;
}

async function fetchSalesforce(cfg: SyncConfig, secret: SyncSecret): Promise<SyncItem[]> {
  const object = cfg.object ?? 'Opportunity';
  const token = await salesforceToken(cfg, secret);
  const soql = `SELECT ${SF_FIELDS[object] ?? SF_FIELDS.Opportunity} FROM ${object} ORDER BY LastModifiedDate DESC LIMIT ${SYNC_MAX_ITEMS}`;
  const data = (await getJson(`${cfg.instanceUrl}/services/data/v61.0/query?q=${encodeURIComponent(soql)}`, { authorization: `Bearer ${token}` })) as {
    records?: Array<Record<string, unknown>>;
  };
  const rel = (r: Record<string, unknown>, k: string) => ((r[k] as { Name?: string } | null)?.Name ?? '');
  return (data.records ?? []).map((r) => {
    const common = { owner: rel(r, 'Owner'), updated: day(r.LastModifiedDate), url: `${cfg.instanceUrl}/${str(r.Id)}` };
    let values: SyncItem['values'];
    switch (object) {
      case 'Account':
        values = { industry: str(r.Industry), type: str(r.Type), website: str(r.Website), ...common };
        break;
      case 'Contact':
        values = { email: str(r.Email), phone: str(r.Phone), account: rel(r, 'Account'), ...common };
        break;
      case 'Lead':
        values = { company: str(r.Company), status: str(r.Status), email: str(r.Email), ...common };
        break;
      case 'Case':
        values = { status: str(r.Status), priority: str(r.Priority), number: str(r.CaseNumber), ...common };
        break;
      default:
        values = { stage: str(r.StageName), amount: typeof r.Amount === 'number' ? r.Amount : null, close: day(r.CloseDate), account: rel(r, 'Account'), ...common };
    }
    return { key: str(r.Id), title: str(object === 'Case' ? r.Subject : r.Name), values };
  });
}

/** CRM de zerosoft: con la visibilidad de quien creó la base (como si lo abriera en el CRM). */
async function fetchCrm(ws: string, personId: string, cfg: SyncConfig): Promise<SyncItem[]> {
  const { ownerScopeFor, ownerScopeSql } = await import('./crm-visibility');
  const { workspaceRole } = await import('./api-auth');
  const scope = await ownerScopeFor({ workspaceId: ws, personId, role: await workspaceRole(ws, personId) });
  const db = getDb();
  if (cfg.crmObject === 'contacts') {
    const sc = ownerScopeSql('c', scope);
    const rows = (await db
      .prepare(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.job_title, c.lifecycle_stage, c.updated_at, co.name AS company
         FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id
         WHERE c.user_id = ?${sc.sql ? ` AND ${sc.sql}` : ''} ORDER BY c.updated_at DESC LIMIT ${SYNC_MAX_ITEMS}`,
      )
      .all(ws, ...sc.args)) as Array<Record<string, string>>;
    return rows.map((r) => ({
      key: r.id,
      title: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || r.email,
      values: { email: r.email, phone: r.phone, job: r.job_title, stage: r.lifecycle_stage, company: r.company ?? '', updated: day(r.updated_at), url: `/app/crm/contacts/${r.id}` },
    }));
  }
  if (cfg.crmObject === 'companies') {
    const sc = ownerScopeSql('c', scope);
    const rows = (await db
      .prepare(`SELECT c.* FROM crm_companies c WHERE c.user_id = ?${sc.sql ? ` AND ${sc.sql}` : ''} ORDER BY c.updated_at DESC LIMIT ${SYNC_MAX_ITEMS}`)
      .all(ws, ...sc.args)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      key: str(r.id),
      title: str(r.name),
      values: {
        domain: str(r.domain) ? `https://${str(r.domain)}` : '',
        industry: str(r.industry),
        employees: typeof r.employees === 'number' ? r.employees : null,
        country: str(r.country),
        updated: day(r.updated_at),
        url: `/app/crm/companies/${str(r.id)}`,
      },
    }));
  }
  const sc = ownerScopeSql('d', scope);
  const rows = (await db
    .prepare(
      `SELECT d.id, d.name, d.amount, d.currency, d.close_date, d.updated_at, s.name AS stage, u.name AS owner_name, u.email AS owner_email
       FROM crm_deals d LEFT JOIN crm_stages s ON s.id = d.stage_id LEFT JOIN users u ON u.id = d.owner_id
       WHERE d.user_id = ?${sc.sql ? ` AND ${sc.sql}` : ''} ORDER BY d.updated_at DESC LIMIT ${SYNC_MAX_ITEMS}`,
    )
    .all(ws, ...sc.args)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    key: str(r.id),
    title: str(r.name),
    values: {
      stage: str(r.stage),
      amount: typeof r.amount === 'number' ? r.amount : null,
      currency: str(r.currency),
      close: day(r.close_date),
      owner: str(r.owner_name) || str(r.owner_email),
      updated: day(r.updated_at),
      url: `/app/crm/deals/${str(r.id)}`,
    },
  }));
}

/** Datos fijos de e2e (DOCS_SYNC_FAKE=1). */
export function fakeItems(provider: DbSyncProvider, cfg: SyncConfig): SyncItem[] {
  if (provider === 'github') {
    if (cfg.repo === 'acme/missing') throw new DocsSyncError('source_not_found');
    const pulls = cfg.kind === 'pulls';
    return [1, 2, 3].map((n) => ({
      key: `${pulls ? 'pr' : 'is'}${n}`,
      title: pulls ? `Pull request ${n}` : ['Login button is broken', 'Add dark mode', 'Docs typo'][n - 1],
      values: {
        number: `#${n}`,
        state: n === 3 ? 'closed' : 'open',
        author: 'octocat',
        assignees: n === 1 ? 'ada' : '',
        labels: n === 1 ? ['bug'] : n === 2 ? ['enhancement'] : [],
        ...(pulls ? { draft: n === 2 } : { milestone: n === 1 ? 'v1.0' : '' }),
        created: '2026-10-01',
        updated: '2026-10-20',
        url: `https://github.com/${cfg.repo}/${pulls ? 'pull' : 'issues'}/${n}`,
      },
      body: n === 1 ? 'Steps to reproduce:\n\n1. Open the app\n2. Click **Log in**' : undefined,
    }));
  }
  if (provider === 'jira') {
    return ['ENG-1', 'ENG-2'].map((key, i) => ({
      key: `j${i}`,
      title: i === 0 ? 'Checkout fails on Safari' : 'Upgrade payment SDK',
      values: { key, status: i === 0 ? 'In Progress' : 'To Do', type: i === 0 ? 'Bug' : 'Task', priority: 'High', assignee: 'Ada Lovelace', created: '2026-10-02', updated: '2026-10-21', url: `https://${cfg.site}/browse/${key}` },
    }));
  }
  return [
    { key: 'sf1', title: 'Acme renewal', values: { stage: 'Negotiation', amount: 12000, close: '2026-11-30', account: 'Acme', owner: 'Ada Lovelace', updated: '2026-10-22', url: `${cfg.instanceUrl}/006A` } },
    { key: 'sf2', title: 'Globex expansion', values: { stage: 'Prospecting', amount: 5000, close: '2026-12-15', account: 'Globex', owner: 'Ada Lovelace', updated: '2026-10-20', url: `${cfg.instanceUrl}/006B` } },
  ];
}

export async function fetchItems(row: Pick<SyncSourceRow, 'provider' | 'config' | 'secret' | 'workspace_id' | 'created_by'>): Promise<SyncItem[]> {
  const cfg = parseConfig(row.config);
  if (row.provider === 'crm') return fetchCrm(row.workspace_id, row.created_by ?? row.workspace_id, cfg);
  if (syncFakeActive()) return fakeItems(row.provider, cfg);
  const secret = readSecret(row);
  if (row.provider === 'github') return fetchGithub(cfg, secret);
  if (row.provider === 'jira') return fetchJira(cfg, secret);
  return fetchSalesforce(cfg, secret);
}

// ---------- Base ----------

/** Id de fila estable por ítem (válido para el saneado: [A-Za-z0-9_-]). */
export function rowIdFor(sourceId: string, key: string): string {
  return `s${createHash('sha1').update(`${sourceId}:${key}`).digest('hex').slice(0, 20)}`;
}

/**
 * La base con los ítems del origen (puro). Conserva vistas, ids de opciones
 * (por nombre) y la fecha de alta de las filas que siguen.
 */
export function buildSyncedDatabase(
  prev: DocsDatabase | null,
  source: Pick<SyncSourceRow, 'id' | 'provider' | 'config'>,
  items: SyncItem[],
  now = new Date().toISOString(),
): DocsDatabase {
  const cfg = parseConfig(source.config);
  const cols = syncColumns(source.provider, cfg);
  const prevProps = new Map((prev?.properties ?? []).map((p) => [p.id, p]));
  const optionIds = new Map<string, Map<string, string>>();
  for (const p of prev?.properties ?? []) optionIds.set(p.id, new Map((p.options ?? []).map((o) => [o.name.toLowerCase(), o.id])));
  const options = new Map<string, DbOption[]>();
  const optionId = (propId: string, name: string): string => {
    const known = optionIds.get(propId) ?? new Map<string, string>();
    optionIds.set(propId, known);
    let id = known.get(name.toLowerCase());
    if (!id) {
      id = newDbId();
      known.set(name.toLowerCase(), id);
    }
    const list = options.get(propId) ?? [];
    if (!list.some((o) => o.id === id)) list.push({ id, name: name.slice(0, 200) });
    options.set(propId, list);
    return id;
  };
  const prevRows = new Map((prev?.rows ?? []).map((r) => [r.id, r]));
  const rows: DbRow[] = items.slice(0, SYNC_MAX_ITEMS).map((it) => {
    const id = rowIdFor(source.id, it.key);
    const values: Record<string, DbValue> = { title: it.title.slice(0, 2000) };
    for (const c of cols) {
      if (c.type === 'title') continue;
      const v = it.values[c.id];
      if (v === undefined || v === null || v === '') continue;
      if (c.type === 'select') values[c.id] = optionId(c.id, String(v));
      else if (c.type === 'multi_select') values[c.id] = (Array.isArray(v) ? v : [String(v)]).map((n) => optionId(c.id, String(n)));
      else if (c.type === 'number') values[c.id] = typeof v === 'number' ? v : Number(v) || null;
      else if (c.type === 'checkbox') values[c.id] = v === true;
      else values[c.id] = Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v.slice(0, 5000) : String(v);
    }
    const old = prevRows.get(id);
    const body = it.body ? mdToBlocks(it.body.slice(0, 20_000)).slice(0, 100) : undefined;
    return {
      id,
      values,
      ...(body?.length ? { body } : {}),
      created_at: old?.created_at ?? now,
      updated_at: old && JSON.stringify(old.values) === JSON.stringify(values) ? old.updated_at : now,
    };
  });
  const properties: DbProperty[] = cols.map((c) => ({
    id: c.id,
    name: prevProps.get(c.id)?.name ?? c.name,
    type: c.type,
    ...(c.type === 'select' || c.type === 'multi_select' ? { options: options.get(c.id) ?? [] } : {}),
  }));
  const views = prev?.views?.length ? prev.views : [{ id: newDbId(), name: '', type: 'table' as const }];
  return {
    properties,
    rows,
    views,
    ...(prev?.active_view ? { active_view: prev.active_view } : {}),
    title: prev?.title || syncLabel(source.provider, cfg),
    sync: { source_id: source.id, provider: source.provider, label: syncLabel(source.provider, cfg), synced_at: now },
  };
}

/** Escribe la base en su bloque (compare-and-set sobre updated_at, reintenta). false si el bloque ya no existe. */
async function writeDatabase(source: SyncSourceRow, items: SyncItem[]): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const page = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(source.page_id)) as DocsPageRow | undefined;
    if (!page) return false;
    // Página bloqueada: no se escribe; se reintenta cuando la desbloqueen.
    if (page.locked === 1) throw new DocsSyncError('page_locked', 423);
    const blocks = parseBlocks(page.content);
    const index = blocks.findIndex((b) => b.id === source.block_id && b.type === 'database' && !b.linked);
    if (index === -1) return false;
    const prev = normalizeDatabase(blocks[index]);
    if (prev.sync && prev.sync.source_id !== source.id) return false;
    const now = nextUpdatedAt(page.updated_at);
    const db = sanitizeDatabase(buildSyncedDatabase(prev, source, items, now));
    const next: DocsBlock[] = blocks.map((b, i) => (i === index ? { ...b, db, columns: undefined, rows: undefined, view: undefined } : b));
    const content = stringifyBlocks(sanitizeBlocks(next));
    const res = await getDb()
      .prepare('UPDATE docs_pages SET content = ?, updated_at = ? WHERE id = ? AND updated_at = ?')
      .run(content, now, page.id, page.updated_at);
    if (res.changes === 0) continue;
    await recordRevisions(page, { updated_at: now, title: page.title, icon: page.icon, cover_url: page.cover_url, content }).catch(() => undefined);
    return true;
  }
  throw new DocsSyncError('conflict', 409);
}

const CLAIM_MS = 5 * 60_000;

/** Reclama un origen (compare-and-set). `force` ignora next_sync_at ("Sincronizar ahora"). */
export async function claimSource(id: string, now = new Date(), force = false): Promise<boolean> {
  const iso = now.toISOString();
  const res = await getDb()
    .prepare(
      `UPDATE docs_synced_sources SET claimed_until = ?
       WHERE id = ? AND (claimed_until IS NULL OR claimed_until < ?)${force ? '' : ' AND (next_sync_at IS NULL OR next_sync_at <= ?)'}`,
    )
    .run(new Date(now.getTime() + CLAIM_MS).toISOString(), id, iso, ...(force ? [] : [iso]));
  return res.changes > 0;
}

export function errorCode(err: unknown): string {
  if (err instanceof DocsSyncError) return err.code;
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'timeout';
  if (err instanceof Error && /private|unsafe|https/i.test(err.message)) return 'unsafe_url';
  return 'network_error';
}

/** Corre una sincronización ya reclamada. Nunca tira: el error queda en el origen. */
export async function runSync(id: string): Promise<SyncSourceDto | null> {
  const row = (await getDb().prepare('SELECT * FROM docs_synced_sources WHERE id = ?').get(id)) as SyncSourceRow | undefined;
  if (!row) return null;
  const now = new Date();
  try {
    const items = await fetchItems(row);
    const ok = await writeDatabase(row, items);
    if (!ok) {
      // El bloque se borró de la página: el origen ya no tiene a dónde escribir.
      await getDb().prepare('DELETE FROM docs_synced_sources WHERE id = ?').run(id);
      return null;
    }
    await getDb()
      .prepare(
        `UPDATE docs_synced_sources SET status = 'ok', last_error = NULL, item_count = ?, last_synced_at = ?, next_sync_at = ?, claimed_until = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(items.length, now.toISOString(), new Date(now.getTime() + row.interval_min * 60_000).toISOString(), now.toISOString(), id);
  } catch (err) {
    // Con error, se reintenta en el próximo intervalo (como mucho en una hora).
    const retry = Math.min(row.interval_min, 60);
    await getDb()
      .prepare(`UPDATE docs_synced_sources SET status = 'error', last_error = ?, next_sync_at = ?, claimed_until = NULL, updated_at = ? WHERE id = ?`)
      .run(errorCode(err), new Date(now.getTime() + retry * 60_000).toISOString(), now.toISOString(), id);
  }
  const after = (await getDb().prepare('SELECT * FROM docs_synced_sources WHERE id = ?').get(id)) as SyncSourceRow | undefined;
  return after ? toDto(after) : null;
}

/** Cron: refresca los orígenes vencidos (cada uno reclamado con compare-and-set). */
export async function syncDueSources(opts: { budgetMs?: number; limit?: number; now?: Date } = {}): Promise<number> {
  const start = Date.now();
  const now = opts.now ?? new Date();
  const iso = now.toISOString();
  const due = (await getDb()
    .prepare(
      `SELECT id FROM docs_synced_sources WHERE (next_sync_at IS NULL OR next_sync_at <= ?) AND (claimed_until IS NULL OR claimed_until < ?)
       ORDER BY next_sync_at LIMIT ?`,
    )
    .all(iso, iso, opts.limit ?? 20)) as Array<{ id: string }>;
  let done = 0;
  for (const d of due) {
    if (opts.budgetMs !== undefined && Date.now() - start > opts.budgetMs) break;
    if (!(await claimSource(d.id, now))) continue;
    await runSync(d.id);
    done++;
  }
  return done;
}

// ---------- Alta, cambios y baja ----------

export async function getSource(id: string): Promise<SyncSourceRow | null> {
  return ((await getDb().prepare('SELECT * FROM docs_synced_sources WHERE id = ?').get(id)) as SyncSourceRow | undefined) ?? null;
}

export async function sourcesForPage(pageId: string): Promise<SyncSourceRow[]> {
  return (await getDb().prepare('SELECT * FROM docs_synced_sources WHERE page_id = ?').all(pageId)) as SyncSourceRow[];
}

function cleanSecret(raw: Record<string, unknown> | undefined): SyncSecret | null {
  if (!raw) return null;
  const s = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string).trim().slice(0, 4000) : '');
  const out: SyncSecret = {};
  if (s('token')) out.token = s('token');
  if (s('refreshToken')) out.refreshToken = s('refreshToken');
  if (s('clientId')) out.clientId = s('clientId');
  if (s('clientSecret')) out.clientSecret = s('clientSecret');
  return Object.keys(out).length ? out : null;
}

/**
 * Crea el origen para un bloque nuevo y trae los datos por primera vez. No
 * escribe la página: devuelve el bloque para que el editor lo inserte (el
 * guardado lo acepta porque el origen está registrado para ese bloque).
 * Si la primera sincronización falla, el origen no se crea.
 */
export async function createSource(input: {
  workspaceId: string;
  pageId: string;
  personId: string;
  provider: DbSyncProvider;
  config: Record<string, unknown>;
  secret?: Record<string, unknown>;
  intervalMin?: number;
}): Promise<{ source: SyncSourceDto; block: DocsBlock }> {
  if (!SYNC_PROVIDERS.includes(input.provider)) throw new DocsSyncError('invalid_provider');
  const config = normalizeConfig(input.provider, input.config);
  const secret = cleanSecret(input.secret);
  if (input.provider === 'jira' && !secret?.token) throw new DocsSyncError('missing_token');
  if (input.provider === 'salesforce' && !secret?.token && !secret?.refreshToken) throw new DocsSyncError('missing_token');
  const count = (await getDb().prepare('SELECT COUNT(*) AS n FROM docs_synced_sources WHERE workspace_id = ?').get(input.workspaceId)) as { n: number };
  if (Number(count.n) >= 50) throw new DocsSyncError('limit_reached', 409);
  const id = crypto.randomUUID();
  const blockId = crypto.randomUUID();
  const interval = (SYNC_INTERVALS as readonly number[]).includes(Number(input.intervalMin)) ? Number(input.intervalMin) : 15;
  const row: SyncSourceRow = {
    id,
    workspace_id: input.workspaceId,
    page_id: input.pageId,
    block_id: blockId,
    provider: input.provider,
    config: JSON.stringify(config),
    secret: secret ? seal(JSON.stringify(secret)) : null,
    created_by: input.personId,
    status: 'ok',
    last_error: null,
    item_count: 0,
    interval_min: interval,
    last_synced_at: null,
    next_sync_at: null,
    claimed_until: null,
  };
  let items: SyncItem[];
  try {
    items = await fetchItems(row);
  } catch (err) {
    throw new DocsSyncError(errorCode(err));
  }
  const now = new Date();
  await getDb()
    .prepare(
      `INSERT INTO docs_synced_sources (id, workspace_id, page_id, block_id, provider, config, secret, created_by, status, item_count, interval_min, last_synced_at, next_sync_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?, ?, ?)`,
    )
    .run(id, row.workspace_id, row.page_id, blockId, row.provider, row.config, row.secret, row.created_by, items.length, interval, now.toISOString(), new Date(now.getTime() + interval * 60_000).toISOString());
  const db = sanitizeDatabase(buildSyncedDatabase(null, row, items, now.toISOString()));
  const block: DocsBlock = { id: blockId, type: 'database', content: '', db };
  const saved = (await getSource(id))!;
  return { source: toDto(saved), block };
}

/**
 * Cambia el origen. Las credenciales son de quien creó la base: si otra
 * persona cambia la configuración (repo, JQL, sitio, instancia, objeto) o el
 * token, pasa a ser la dueña del origen y tiene que poner su propio token
 * (nunca se reenvía el token de otra persona a otro host u objeto). En el CRM
 * se muestra con la visibilidad de quien lo configuró por última vez.
 */
export async function updateSource(
  id: string,
  patch: { config?: Record<string, unknown>; secret?: Record<string, unknown>; intervalMin?: number },
  personId?: string,
): Promise<SyncSourceDto | null> {
  const row = await getSource(id);
  if (!row) return null;
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  const prevConfig = parseConfig(row.config);
  const nextConfig = patch.config ? normalizeConfig(row.provider, { ...prevConfig, ...patch.config }) : prevConfig;
  const configChanged = JSON.stringify(nextConfig) !== JSON.stringify(prevConfig);
  const secret = cleanSecret(patch.secret);
  const takeover = Boolean(personId && personId !== row.created_by && (configChanged || secret));
  if (takeover) {
    // Otra persona: su token (o ninguno en GitHub público), nunca el del creador.
    if (row.provider === 'jira' && !secret?.token) throw new DocsSyncError('new_token_required');
    if (row.provider === 'salesforce' && !secret?.token && !secret?.refreshToken) throw new DocsSyncError('new_token_required');
    sets.push('created_by = ?', 'secret = ?');
    args.push(personId!, secret ? seal(JSON.stringify(secret)) : null);
  } else if (secret) {
    sets.push('secret = ?');
    args.push(seal(JSON.stringify({ ...readSecret(row), ...secret })));
  }
  if (configChanged) {
    sets.push('config = ?');
    args.push(JSON.stringify(nextConfig));
  }
  if (patch.intervalMin !== undefined && (SYNC_INTERVALS as readonly number[]).includes(Number(patch.intervalMin))) {
    sets.push('interval_min = ?');
    args.push(Number(patch.intervalMin));
  }
  if (sets.length) {
    // Cambió algo: la próxima corrida del cron la toma enseguida.
    sets.push('next_sync_at = NULL', "updated_at = datetime('now')");
    await getDb().prepare(`UPDATE docs_synced_sources SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  }
  return toDto((await getSource(id))!);
}

/** Desvincula: la base queda como una base común (editable) con las filas que tenía. */
export async function unlinkSource(id: string): Promise<boolean> {
  const row = await getSource(id);
  if (!row) return false;
  await getDb().prepare('DELETE FROM docs_synced_sources WHERE id = ?').run(id);
  for (let attempt = 0; attempt < 4; attempt++) {
    const page = (await getDb().prepare('SELECT * FROM docs_pages WHERE id = ?').get(row.page_id)) as DocsPageRow | undefined;
    if (!page) return true;
    const blocks = parseBlocks(page.content);
    let changed = false;
    const next = blocks.map((b) => {
      if (b.id !== row.block_id || !b.db?.sync) return b;
      changed = true;
      const { sync: _s, ...rest } = b.db;
      void _s;
      return { ...b, db: rest };
    });
    if (!changed) return true;
    const now = nextUpdatedAt(page.updated_at);
    const content = stringifyBlocks(next);
    const res = await getDb().prepare('UPDATE docs_pages SET content = ?, updated_at = ? WHERE id = ? AND updated_at = ?').run(content, now, page.id, page.updated_at);
    if (res.changes > 0) {
      await recordRevisions(page, { updated_at: now, title: page.title, icon: page.icon, cover_url: page.cover_url, content }).catch(() => undefined);
      return true;
    }
  }
  return true;
}

/** Orígenes registrados para una página ("origen:bloque"), para que el guardado acepte bases sincronizadas nuevas. */
export async function registeredSyncKeys(pageId: string): Promise<Set<string>> {
  const rows = (await getDb().prepare('SELECT id, block_id FROM docs_synced_sources WHERE page_id = ?').all(pageId)) as Array<{ id: string; block_id: string }>;
  return new Set(rows.map((r) => `${r.id}:${r.block_id}`));
}

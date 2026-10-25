/**
 * Track — Sentry, Zendesk e Intercom.
 *
 * Sentry (integración interna de Sentry, con webhook y token):
 *   - el webhook (recurso `issue` o `event_alert`) crea un issue en el
 *     proyecto elegido (pasa por triage si está activo) con el link a Sentry;
 *   - cuando el issue de Track se completa, el de Sentry se resuelve con la API
 *     (PUT /api/0/organizations/<org>/issues/<id>/).
 *   Firma: `Sentry-Hook-Signature` = HMAC-SHA256(client secret, body) en hex.
 *
 * Zendesk e Intercom: un issue se vincula a un ticket o conversación (desde el
 * issue, o al crearlo por la API con `links`); al completarse o cancelarse, se
 * deja una nota interna en el ticket con el link al issue.
 *
 * Con TRACK_SUPPORT_FAKE=1 no sale nada: las llamadas quedan en el log.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { TrackIssueWithStatus } from './track-data';
import type { TrackEventContext, TrackEventInput } from './track-events';
import { runAsTrackViewer } from './track-access';
import { issueUrl, textToDescription } from './track-api';
import {
  enqueueOutbox,
  findExternalRef,
  getIntegrationById,
  getIntegrationRow,
  integrationConfig,
  integrationSecret,
  integrationToken,
  IntegrationSkip,
  listIssueRefs,
  logIntegrationEvent,
  setExternalRefState,
  touchIntegration,
  upsertExternalRef,
  workspaceOwnerId,
  type IntegrationProvider,
} from './track-integrations';

export function supportFake(): boolean {
  return process.env.TRACK_SUPPORT_FAKE === '1';
}

// ---------- URLs de tickets ----------

export interface ParsedSupportUrl {
  provider: 'sentry' | 'zendesk' | 'intercom' | 'figma';
  externalId: string;
  url: string;
  meta: Record<string, string>;
}

/**
 * Reconoce un link de Sentry (issue), Zendesk (ticket), Intercom
 * (conversación) o Figma (archivo o diseño). Null si no es ninguno.
 */
export function parseSupportUrl(raw: string): ParsedSupportUrl | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  // https://<org>.sentry.io/issues/123/ o https://sentry.io/organizations/<org>/issues/123/
  if (host === 'sentry.io' || host.endsWith('.sentry.io')) {
    const m = /\/issues\/(\d+)/.exec(path);
    if (!m) return null;
    const org = host.endsWith('.sentry.io') && host !== 'sentry.io' ? host.split('.')[0] : (/\/organizations\/([^/]+)/.exec(path)?.[1] ?? '');
    return { provider: 'sentry', externalId: m[1], url: u.toString(), meta: { org } };
  }
  // https://<sub>.zendesk.com/agent/tickets/123
  if (host.endsWith('.zendesk.com')) {
    const m = /\/(?:agent\/)?tickets\/(\d+)/.exec(path);
    if (!m) return null;
    return { provider: 'zendesk', externalId: m[1], url: u.toString(), meta: { subdomain: host.split('.')[0] } };
  }
  // https://app.intercom.com/a/inbox/<app>/inbox/.../conversation/123
  if (host === 'app.intercom.com' || host === 'app.intercom.io') {
    const m = /\/conversations?\/(\d+)/.exec(path);
    if (!m) return null;
    return { provider: 'intercom', externalId: m[1], url: u.toString(), meta: {} };
  }
  // https://www.figma.com/file|design|proto|board/<key>/...
  if (host === 'figma.com' || host === 'www.figma.com') {
    const m = /^\/(file|design|proto|board)\/([A-Za-z0-9]+)/.exec(path);
    if (!m) return null;
    return { provider: 'figma', externalId: `${m[2]}${u.searchParams.get('node-id') ? `:${u.searchParams.get('node-id')}` : ''}`, url: u.toString(), meta: { kind: m[1] } };
  }
  return null;
}

/** URL del embed oficial de Figma para un link de archivo o diseño. */
export function figmaEmbedUrl(url: string): string {
  return `https://www.figma.com/embed?embed_host=zerosoft&url=${encodeURIComponent(url)}`;
}

/** Vincula los links reconocidos a un issue (sentry, zendesk, intercom, figma). */
export async function linkSupportUrls(issueId: string, workspaceId: string, urls: string[], title = ''): Promise<number> {
  let n = 0;
  for (const raw of urls.slice(0, 10)) {
    const parsed = parseSupportUrl(raw);
    if (!parsed) continue;
    await upsertExternalRef({
      issueId,
      workspaceId,
      provider: parsed.provider,
      externalId: parsed.externalId,
      url: parsed.url,
      title,
      meta: parsed.meta,
    });
    n++;
  }
  return n;
}

// ---------- Sentry: webhook entrante ----------

export function verifySentrySignature(secret: string | null, rawBody: string, header: string | null): boolean {
  if (!secret || !header || !/^[0-9a-f]{64}$/i.test(header)) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return timingSafeEqual(Buffer.from(header.toLowerCase()), Buffer.from(expected));
}

export function signSentryBody(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

interface SentryIssuePayload {
  id?: string | number;
  title?: string;
  culprit?: string;
  shortId?: string;
  level?: string;
  permalink?: string;
  web_url?: string;
  project?: { slug?: string; name?: string };
  count?: string | number;
}

interface SentryWebhookBody {
  action?: string;
  data?: {
    issue?: SentryIssuePayload;
    event?: { issue_id?: string | number; title?: string; culprit?: string; web_url?: string; level?: string; issue_url?: string };
    triggered_rule?: string;
  };
}

export interface SentryWebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/** Procesa una entrega del webhook de Sentry (rawBody: el cuerpo exacto). */
export async function handleSentryWebhook(
  integrationId: string,
  resource: string | null,
  rawBody: string,
  signature: string | null,
): Promise<SentryWebhookResult> {
  const row = await getIntegrationById(integrationId);
  if (!row || row.provider !== 'sentry') return { status: 404, body: { error: 'not_found' } };
  if (!verifySentrySignature(integrationSecret(row), rawBody, signature)) return { status: 401, body: { error: 'invalid_signature' } };
  await touchIntegration(row.id);
  if (resource === 'installation' || resource === 'metric_alert') return { status: 200, body: { ok: true } };

  let body: SentryWebhookBody;
  try {
    body = JSON.parse(rawBody) as SentryWebhookBody;
  } catch {
    return { status: 400, body: { error: 'invalid_json' } };
  }
  const cfg = integrationConfig(row);
  const issueIn: SentryIssuePayload | null =
    resource === 'issue' && body.data?.issue
      ? body.data.issue
      : resource === 'event_alert' && body.data?.event?.issue_id
        ? {
            id: body.data.event.issue_id,
            title: body.data.event.title,
            culprit: body.data.event.culprit,
            level: body.data.event.level,
            web_url: body.data.event.web_url,
          }
        : null;
  if (!issueIn?.id) return { status: 202, body: { ignored: 'resource' } };
  const sentryId = String(issueIn.id);
  // Solo issues nuevos o alertas: resolved/assigned/ignored no crean nada.
  if (resource === 'issue' && body.action && body.action !== 'created') {
    const ref = await findExternalRef(row.workspace_id, 'sentry', sentryId);
    if (ref && body.action) await setExternalRefState(ref.id, body.action);
    return { status: 200, body: { updated: Boolean(ref) } };
  }
  const existing = await findExternalRef(row.workspace_id, 'sentry', sentryId);
  if (existing) return { status: 200, body: { duplicate: true, issueId: existing.issue_id } };

  const projectId = typeof cfg.projectId === 'string' ? cfg.projectId : '';
  const { createIssue, getProject } = await import('./track-data');
  const project = projectId ? await getProject(projectId) : undefined;
  if (!project || (project.team_id ?? project.owner_id) !== row.workspace_id) {
    await logIntegrationEvent(row.workspace_id, 'sentry', 'in', 'issue', `${issueIn.title ?? sentryId} · no project`, false);
    return { status: 202, body: { ignored: 'no_project' } };
  }
  const url = issueIn.web_url || issueIn.permalink || '';
  const lines = [
    issueIn.culprit ? `\`${issueIn.culprit}\`` : '',
    issueIn.level ? `Level: ${issueIn.level}` : '',
    issueIn.project?.slug ? `Sentry project: ${issueIn.project.slug}` : '',
    url ? `Sentry: ${url}` : '',
  ].filter(Boolean);
  const actor = row.created_by ?? (await workspaceOwnerId(row.workspace_id));
  const priority = issueIn.level === 'fatal' ? 'urgent' : issueIn.level === 'error' ? 'high' : 'medium';
  const issue = await runAsTrackViewer(
    actor,
    () =>
      createIssue(
        project.id,
        actor,
        { title: (issueIn.title || `Sentry ${issueIn.shortId ?? sentryId}`).slice(0, 200), description: textToDescription(lines.join('\n')), priority },
        { source: 'sentry' },
      ),
    'sentry',
  );
  await upsertExternalRef({
    issueId: issue.id,
    workspaceId: row.workspace_id,
    provider: 'sentry',
    externalId: sentryId,
    url: url || null,
    title: issueIn.shortId ?? issueIn.title ?? '',
    state: 'unresolved',
    meta: { org: String(cfg.orgSlug ?? ''), shortId: issueIn.shortId ?? '' },
  });
  await logIntegrationEvent(row.workspace_id, 'sentry', 'in', resource ?? 'issue', `${issue.identifier} ${issue.title}`);
  return { status: 201, body: { issueId: issue.id, identifier: issue.identifier } };
}

// ---------- Salida: issue completado → Sentry / Zendesk / Intercom ----------

const CLOSE_NOTE: Record<string, string> = {
  done: 'The Track issue {id} was completed: {url}',
  cancelled: 'The Track issue {id} was cancelled: {url}',
};

/** Al completarse o cancelarse un issue, encola resolver/notas en lo vinculado. */
export async function supportOnTrackEvent(
  workspaceId: string,
  event: TrackEventInput,
  _ctx: TrackEventContext,
  issue: TrackIssueWithStatus,
): Promise<number> {
  if (event.type !== 'issue.updated' || event.before.status_id === event.after.status_id) return 0;
  const category = event.after.status_category;
  if (category !== 'done' && category !== 'cancelled') return 0;
  const refs = (await listIssueRefs(issue.id)).filter((r) => r.provider === 'sentry' || r.provider === 'zendesk' || r.provider === 'intercom');
  let n = 0;
  for (const ref of refs) {
    const row = await getIntegrationRow(workspaceId, ref.provider as IntegrationProvider);
    if (!row) continue;
    const cfg = integrationConfig(row);
    if (ref.provider === 'sentry') {
      if (category !== 'done' || cfg.autoResolve === false) continue;
      await enqueueOutbox(workspaceId, 'sentry', 'resolve', { refId: ref.id, sentryId: ref.external_id });
    } else {
      const note = CLOSE_NOTE[category].replace('{id}', issue.identifier).replace('{url}', issueUrl(issue.id));
      await enqueueOutbox(workspaceId, ref.provider as IntegrationProvider, 'note', { refId: ref.id, externalId: ref.external_id, body: note });
    }
    n++;
  }
  return n;
}

async function supportFetch(url: string, init: RequestInit): Promise<void> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 || res.status === 403 || res.status === 404) throw new IntegrationSkip(`http_${res.status}`);
  if (!res.ok) throw new Error(`http_${res.status}`);
}

/** Ejecuta una fila de la cola de Sentry, Zendesk o Intercom. */
export async function runSupportOutbox(workspaceId: string, kind: string, payload: Record<string, unknown>): Promise<void> {
  const db = (await import('./db')).getDb();
  const ref = (await db.prepare('SELECT provider FROM track_external_refs WHERE id = ?').get(String(payload.refId ?? ''))) as
    | { provider: IntegrationProvider }
    | undefined;
  if (!ref) throw new IntegrationSkip('ref_gone');
  const row = await getIntegrationRow(workspaceId, ref.provider);
  if (!row) throw new IntegrationSkip('not_connected');
  const cfg = integrationConfig(row);
  const token = integrationToken(row);

  if (ref.provider === 'sentry' && kind === 'resolve') {
    const base = String(cfg.baseUrl || 'https://sentry.io').replace(/\/$/, '');
    const org = String(cfg.orgSlug ?? '');
    const id = String(payload.sentryId ?? '');
    if (!supportFake()) {
      if (!token || !org) throw new IntegrationSkip('no_token');
      await supportFetch(`${base}/api/0/organizations/${encodeURIComponent(org)}/issues/${encodeURIComponent(id)}/`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      });
    }
    await setExternalRefState(String(payload.refId), 'resolved');
    await logIntegrationEvent(workspaceId, 'sentry', 'out', 'resolve', `Sentry issue ${id} resolved`);
    return;
  }

  if (ref.provider === 'zendesk' && kind === 'note') {
    const sub = String(cfg.subdomain ?? '');
    const email = String(cfg.email ?? '');
    const id = String(payload.externalId ?? '');
    if (!supportFake()) {
      if (!token || !sub || !email) throw new IntegrationSkip('no_token');
      await supportFetch(`https://${encodeURIComponent(sub)}.zendesk.com/api/v2/tickets/${encodeURIComponent(id)}.json`, {
        method: 'PUT',
        headers: {
          authorization: `Basic ${Buffer.from(`${email}/token:${token}`).toString('base64')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ticket: { comment: { body: String(payload.body ?? ''), public: false } } }),
      });
    }
    await logIntegrationEvent(workspaceId, 'zendesk', 'out', 'note', `Ticket ${id}: ${String(payload.body ?? '').slice(0, 160)}`);
    return;
  }

  if (ref.provider === 'intercom' && kind === 'note') {
    const admin = String(cfg.adminId ?? '');
    const id = String(payload.externalId ?? '');
    if (!supportFake()) {
      if (!token || !admin) throw new IntegrationSkip('no_token');
      await supportFetch(`https://api.intercom.io/conversations/${encodeURIComponent(id)}/reply`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ message_type: 'note', type: 'admin', admin_id: admin, body: String(payload.body ?? '') }),
      });
    }
    await logIntegrationEvent(workspaceId, 'intercom', 'out', 'note', `Conversation ${id}: ${String(payload.body ?? '').slice(0, 160)}`);
    return;
  }
  throw new IntegrationSkip('unknown_kind');
}

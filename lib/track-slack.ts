/**
 * Track — integración con Slack (como la de Linear):
 *
 * - Instalación por OAuth v2 (bot) por workspace: SLACK_CLIENT_ID,
 *   SLACK_CLIENT_SECRET y SLACK_SIGNING_SECRET. El token del bot se guarda
 *   cifrado y nunca sale del servidor.
 * - Crear issues: slash command `/track <título>` (crea en el proyecto por
 *   defecto y confirma en privado) y el atajo de mensaje "Create Track issue"
 *   (abre un modal con proyecto, título y descripción prellenados; el issue
 *   queda con el hilo sincronizado).
 * - Hilo sincronizado: lo que se responde en el hilo entra como comentario y
 *   los comentarios del issue (y el cierre) se publican en el hilo.
 * - Avisos por canal: cada proyecto elige canales y eventos (creado, cambio
 *   de estado, completado, comentario).
 * - Unfurl de links de issues (nunca de proyectos privados).
 *
 * Con SLACK_FAKE=1 nada sale a Slack: las llamadas quedan en el log de la
 * integración y devuelven respuestas de ejemplo (tests y demo local).
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb } from './db';
import { open, seal } from './secret-box';
import { runAsTrackViewer, type TrackVia } from './track-access';
import { appBaseUrl, descriptionToText, issueUrl, textToDescription } from './track-api';
import type { TrackIssueWithStatus } from './track-data';
import type { TrackProjectRow } from './db';
import type { TrackEventContext, TrackEventInput } from './track-events';
import {
  enqueueOutbox,
  findExternalRef,
  IntegrationSkip,
  listIssueRefs,
  logIntegrationEvent,
  upsertExternalRef,
  workspaceOwnerId,
  workspacePersonByEmail,
  workspaceTeamId,
} from './track-integrations';

export const SLACK_SCOPES = [
  'commands',
  'chat:write',
  'chat:write.public',
  'links:read',
  'links:write',
  'channels:read',
  'groups:read',
  'channels:history',
  'groups:history',
  'users:read',
  'users:read.email',
];

export const SLACK_CHANNEL_EVENTS = ['issue_created', 'status_changed', 'issue_done', 'comment_created'] as const;
export type SlackChannelEvent = (typeof SLACK_CHANNEL_EVENTS)[number];

export function slackFake(): boolean {
  return process.env.SLACK_FAKE === '1';
}

export function slackConfigured(): boolean {
  return slackFake() || Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET && process.env.SLACK_SIGNING_SECRET);
}

function slackApiBase(): string {
  return (process.env.SLACK_API_URL || 'https://slack.com/api').replace(/\/$/, '');
}

export function slackSigningSecret(): string | null {
  return process.env.SLACK_SIGNING_SECRET || (slackFake() ? 'fake-signing-secret' : null);
}

// ---------- Firma de los requests de Slack ----------

/**
 * `X-Slack-Signature: v0=<hex>` con HMAC-SHA256(signing secret,
 * `v0:<timestamp>:<body>`). Rechaza timestamps de más de 5 minutos (replay).
 */
export function verifySlackSignature(
  secret: string | null,
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  now = Date.now(),
): boolean {
  if (!secret || !timestamp || !signature?.startsWith('v0=')) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const expected = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function signSlackBody(secret: string, rawBody: string, timestamp: number): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
}

// ---------- Conexión ----------

interface SlackRow {
  workspace_id: string;
  slack_team_id: string;
  slack_team_name: string;
  bot_token: string;
  bot_user_id: string | null;
  default_project_id: string | null;
  unfurl: number;
  installed_by: string | null;
  created_at: string;
}

export interface SlackConnection {
  teamId: string;
  teamName: string;
  defaultProjectId: string | null;
  unfurl: boolean;
  createdAt: string;
}

async function getRow(workspaceId: string): Promise<SlackRow | undefined> {
  return (await getDb().prepare('SELECT * FROM track_slack WHERE workspace_id = ?').get(workspaceId)) as SlackRow | undefined;
}

export async function getSlackConnection(workspaceId: string): Promise<SlackConnection | null> {
  const r = await getRow(workspaceId);
  return r
    ? { teamId: r.slack_team_id, teamName: r.slack_team_name, defaultProjectId: r.default_project_id, unfurl: r.unfurl === 1, createdAt: r.created_at }
    : null;
}

export async function saveSlackConnection(
  workspaceId: string,
  input: { teamId: string; teamName: string; botToken: string; botUserId: string | null; installedBy: string },
): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO track_slack (workspace_id, slack_team_id, slack_team_name, bot_token, bot_user_id, installed_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id) DO UPDATE SET slack_team_id = excluded.slack_team_id, slack_team_name = excluded.slack_team_name,
         bot_token = excluded.bot_token, bot_user_id = excluded.bot_user_id, installed_by = excluded.installed_by`,
    )
    .run(workspaceId, input.teamId, input.teamName, seal(input.botToken), input.botUserId, input.installedBy);
}

export async function updateSlackSettings(workspaceId: string, input: { defaultProjectId?: string | null; unfurl?: boolean }): Promise<void> {
  if (input.defaultProjectId !== undefined) {
    await getDb().prepare('UPDATE track_slack SET default_project_id = ? WHERE workspace_id = ?').run(input.defaultProjectId, workspaceId);
  }
  if (input.unfurl !== undefined) {
    await getDb().prepare('UPDATE track_slack SET unfurl = ? WHERE workspace_id = ?').run(input.unfurl ? 1 : 0, workspaceId);
  }
}

export async function disconnectSlack(workspaceId: string): Promise<boolean> {
  const db = getDb();
  const res = await db.prepare('DELETE FROM track_slack WHERE workspace_id = ?').run(workspaceId);
  await db.prepare('DELETE FROM track_slack_channels WHERE workspace_id = ?').run(workspaceId);
  return res.changes > 0;
}

export function slackAuthorizeUrl(state: string, redirectUri: string): string {
  const u = new URL('https://slack.com/oauth/v2/authorize');
  u.searchParams.set('client_id', process.env.SLACK_CLIENT_ID ?? '');
  u.searchParams.set('scope', SLACK_SCOPES.join(','));
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

/** Cambia el `code` del OAuth por el token del bot (oauth.v2.access). */
export async function exchangeSlackCode(
  code: string,
  redirectUri: string,
): Promise<{ teamId: string; teamName: string; botToken: string; botUserId: string | null }> {
  if (slackFake()) return { teamId: 'T_FAKE', teamName: 'Fake Slack', botToken: 'xoxb-fake', botUserId: 'U_BOT' };
  const res = await fetch(`${slackApiBase()}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      redirect_uri: redirectUri,
      client_id: process.env.SLACK_CLIENT_ID ?? '',
      client_secret: process.env.SLACK_CLIENT_SECRET ?? '',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; error?: string; access_token?: string; bot_user_id?: string; team?: { id?: string; name?: string } }
    | null;
  if (!body?.ok || !body.access_token || !body.team?.id) throw new Error(body?.error || 'slack_oauth_failed');
  return { teamId: body.team.id, teamName: body.team.name ?? '', botToken: body.access_token, botUserId: body.bot_user_id ?? null };
}

// ---------- API de Slack ----------

let fakeTs = 0;

function fakeResponse(method: string, body: Record<string, unknown>): Record<string, unknown> {
  if (method === 'conversations.list') {
    return {
      ok: true,
      channels: [
        { id: 'C_GENERAL', name: 'general', is_private: false },
        { id: 'C_ENG', name: 'eng', is_private: false },
      ],
    };
  }
  if (method === 'users.info') {
    const user = String(body.user ?? '');
    const email = user.includes('@') ? user : process.env.SLACK_FAKE_EMAIL || 'demo@zerosoft.ai';
    return { ok: true, user: { id: user, real_name: 'Slack User', profile: { email, real_name: 'Slack User' } } };
  }
  if (method === 'chat.getPermalink') return { ok: true, permalink: `https://fake.slack.com/archives/${body.channel}/p${String(body.message_ts).replace('.', '')}` };
  if (method === 'chat.postMessage') {
    fakeTs += 1;
    return { ok: true, channel: body.channel, ts: `${Math.floor(Date.now() / 1000)}.${String(fakeTs).padStart(6, '0')}` };
  }
  return { ok: true };
}

function describeCall(method: string, body: Record<string, unknown>): string {
  // <url|ZER-1> del mrkdwn de Slack → ZER-1 (el log se lee en Ajustes).
  const text = typeof body.text === 'string' ? body.text.replace(/<([^|>]+)\|([^>]+)>/g, '$2') : '';
  const where = body.channel ? ` ${body.channel}${body.thread_ts ? ` (thread ${body.thread_ts})` : ''}` : '';
  if (method === 'chat.unfurl') return `chat.unfurl${where}: ${Object.keys((body.unfurls as object) ?? {}).join(', ')}`;
  if (method === 'views.open') return 'views.open: create issue modal';
  return `${method}${where}${text ? `: ${text.slice(0, 200)}` : ''}`;
}

/**
 * Llama a un método de la Web API de Slack con el token del bot del workspace.
 * Los métodos de escritura quedan en el log (sin el token).
 */
export async function slackCall(
  workspaceId: string,
  method: string,
  body: Record<string, unknown>,
  opts: { log?: boolean } = {},
): Promise<Record<string, unknown>> {
  const row = await getRow(workspaceId);
  if (!row) throw new IntegrationSkip('slack_not_connected');
  const write = /^(chat\.|views\.)/.test(method);
  if (slackFake()) {
    const out = fakeResponse(method, body);
    if (write && opts.log !== false) await logIntegrationEvent(workspaceId, 'slack', 'out', method, describeCall(method, body));
    return out;
  }
  const isRead = /^(users\.info|conversations\.list|chat\.getPermalink)$/.test(method);
  const url = isRead
    ? `${slackApiBase()}/${method}?${new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]))}`
    : `${slackApiBase()}/${method}`;
  const res = await fetch(url, {
    method: isRead ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${open(row.bot_token)}`,
      ...(isRead ? {} : { 'content-type': 'application/json; charset=utf-8' }),
    },
    body: isRead ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 429) throw new Error('slack_rate_limited');
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json?.ok) {
    const error = String(json?.error ?? `http_${res.status}`);
    // Sin canal / sin permisos / desinstalado: reintentar no sirve.
    if (/not_in_channel|channel_not_found|is_archived|invalid_auth|account_inactive|token_revoked|missing_scope/.test(error)) {
      if (write) await logIntegrationEvent(workspaceId, 'slack', 'out', method, `${describeCall(method, body)} · ${error}`, false);
      throw new IntegrationSkip(error);
    }
    throw new Error(error);
  }
  if (write && opts.log !== false) await logIntegrationEvent(workspaceId, 'slack', 'out', method, describeCall(method, body));
  return json;
}

export async function listSlackChannels(workspaceId: string): Promise<Array<{ id: string; name: string }>> {
  const out = await slackCall(workspaceId, 'conversations.list', { types: 'public_channel,private_channel', exclude_archived: true, limit: 200 });
  const channels = (out.channels as Array<{ id: string; name: string }> | undefined) ?? [];
  return channels.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Canales por proyecto ----------

export interface SlackChannelSub {
  id: string;
  projectId: string;
  projectName: string;
  channelId: string;
  channelName: string;
  events: SlackChannelEvent[];
}

function parseEvents(raw: string): SlackChannelEvent[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v.filter((e) => (SLACK_CHANNEL_EVENTS as readonly string[]).includes(e)) as SlackChannelEvent[]) : [];
  } catch {
    return [];
  }
}

export async function listChannelSubs(workspaceId: string): Promise<SlackChannelSub[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT c.*, p.name AS project_name FROM track_slack_channels c JOIN track_projects p ON p.id = c.project_id
       WHERE c.workspace_id = ? ORDER BY p.name, c.channel_name`,
    )
    .all(workspaceId)) as Array<{ id: string; project_id: string; project_name: string; channel_id: string; channel_name: string; events: string }>;
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    channelId: r.channel_id,
    channelName: r.channel_name,
    events: parseEvents(r.events),
  }));
}

export async function saveChannelSub(
  workspaceId: string,
  input: { projectId: string; channelId: string; channelName: string; events: SlackChannelEvent[] },
): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO track_slack_channels (id, workspace_id, project_id, channel_id, channel_name, events) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, channel_id) DO UPDATE SET events = excluded.events, channel_name = excluded.channel_name`,
    )
    .run(crypto.randomUUID(), workspaceId, input.projectId, input.channelId, input.channelName, JSON.stringify(input.events));
}

export async function deleteChannelSub(workspaceId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_slack_channels WHERE id = ? AND workspace_id = ?').run(id, workspaceId);
  return res.changes > 0;
}

// ---------- Mensajes ----------

type Lang = 'en' | 'es' | 'pt';

const COPY: Record<Lang, Record<string, string>> = {
  en: {
    created: 'New issue {id}: {title}',
    status: '{id} moved to {status}',
    done: '{id} was completed',
    comment: '{name} commented on {id}: {body}',
    createdReply: 'Created {id}: {title}',
    noProject: 'Pick a default project in Track settings, Integrations, Slack.',
    noUser: 'Your Slack email is not a member of this zerosoft workspace.',
    empty: 'Write the issue title after /track, for example: /track Login fails on Safari',
    modalTitle: 'Create Track issue',
    project: 'Project',
    titleLabel: 'Title',
    description: 'Description',
    submit: 'Create',
    fromSlack: 'From Slack',
  },
  es: {
    created: 'Nuevo issue {id}: {title}',
    status: '{id} pasó a {status}',
    done: '{id} quedó completado',
    comment: '{name} comentó en {id}: {body}',
    createdReply: 'Se creó {id}: {title}',
    noProject: 'Elegí un proyecto por defecto en Track, Ajustes, Integraciones, Slack.',
    noUser: 'Tu email de Slack no es miembro de este workspace de zerosoft.',
    empty: 'Escribí el título después de /track, por ejemplo: /track Falla el login en Safari',
    modalTitle: 'Crear issue en Track',
    project: 'Proyecto',
    titleLabel: 'Título',
    description: 'Descripción',
    submit: 'Crear',
    fromSlack: 'Desde Slack',
  },
  pt: {
    created: 'Novo issue {id}: {title}',
    status: '{id} foi para {status}',
    done: '{id} foi concluído',
    comment: '{name} comentou em {id}: {body}',
    createdReply: 'Criado {id}: {title}',
    noProject: 'Escolha um projeto padrão no Track, Configurações, Integrações, Slack.',
    noUser: 'Seu email do Slack não é membro deste workspace do zerosoft.',
    empty: 'Escreva o título depois de /track, por exemplo: /track Login falha no Safari',
    modalTitle: 'Criar issue no Track',
    project: 'Projeto',
    titleLabel: 'Título',
    description: 'Descrição',
    submit: 'Criar',
    fromSlack: 'Do Slack',
  },
};

function copy(key: string, vars: Record<string, string> = {}, lang: Lang = 'en'): string {
  return (COPY[lang][key] ?? COPY.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

/** Escapa &, < y > como pide el mrkdwn de Slack. */
export function slackEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function issueLink(issue: Pick<TrackIssueWithStatus, 'id' | 'identifier'>): string {
  return `<${issueUrl(issue.id)}|${issue.identifier}>`;
}

/** Bloques del unfurl de un issue: título, estado, prioridad y asignado. */
export function issueUnfurlBlocks(issue: TrackIssueWithStatus, projectName: string): Array<Record<string, unknown>> {
  const desc = descriptionToText(issue.description).trim();
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<${issueUrl(issue.id)}|${slackEscape(`${issue.identifier} ${issue.title}`)}>*${desc ? `\n${slackEscape(desc.slice(0, 280))}` : ''}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: [projectName, issue.status_name, issue.priority, issue.assignee_name ?? issue.assignee_email]
            .filter(Boolean)
            .map((s) => slackEscape(String(s)))
            .join(' · '),
        },
      ],
    },
  ];
}

// ---------- Salida: eventos de Track → Slack ----------

/**
 * Encola los mensajes de un evento de Track: avisos a los canales del
 * proyecto y, si el issue tiene hilo sincronizado, la respuesta en el hilo.
 * Devuelve cuántos encoló.
 */
export async function slackOnTrackEvent(
  workspaceId: string,
  event: TrackEventInput,
  ctx: TrackEventContext,
  issue: TrackIssueWithStatus,
  project: TrackProjectRow,
): Promise<number> {
  const conn = await getRow(workspaceId);
  if (!conn) return 0;
  const subs = (await listChannelSubs(workspaceId)).filter((s) => s.projectId === project.id);
  const threads = (await listIssueRefs(issue.id, 'slack_thread')).map((r) => r.external_id);
  if (subs.length === 0 && threads.length === 0) return 0;

  const id = issueLink(issue);
  const title = slackEscape(issue.title);
  const posts: Array<{ channel: string; text: string; thread_ts?: string }> = [];
  const toChannels = (ev: SlackChannelEvent, text: string) => {
    for (const s of subs) if (s.events.includes(ev)) posts.push({ channel: s.channelId, text });
  };
  const toThreads = (text: string) => {
    for (const ref of threads) {
      const [channel, ts] = ref.split(':');
      if (channel && ts) posts.push({ channel, text, thread_ts: ts });
    }
  };

  if (event.type === 'issue.created') {
    // El que nace de un mensaje de Slack ya respondió en su hilo.
    toChannels('issue_created', copy('created', { id, title }));
  } else if (event.type === 'issue.updated') {
    if (event.before.status_id !== event.after.status_id) {
      const doneNow = event.after.status_category === 'done' || event.after.status_category === 'cancelled';
      const statusText = copy('status', { id, status: slackEscape(event.after.status_name ?? '') });
      toChannels('status_changed', statusText);
      if (event.after.status_category === 'done') toChannels('issue_done', copy('done', { id }));
      // Como en Linear: el hilo se entera cuando el issue se completa o se cancela.
      if (doneNow) toThreads(statusText);
    }
  } else if (event.type === 'comment.created') {
    const { getUserById } = await import('./db');
    const author = await getUserById(event.actorId);
    const name = slackEscape(author?.name || author?.email || 'Someone');
    const body = slackEscape(event.body.slice(0, 1500));
    toChannels('comment_created', copy('comment', { name, id, body }));
    // Lo que vino del hilo no vuelve al hilo (eco).
    if (ctx.via !== 'slack') toThreads(`*${name}*: ${body}`);
  }

  for (const p of posts) await enqueueOutbox(workspaceId, 'slack', 'post', p);
  return posts.length;
}

/** Ejecuta una fila de la cola de Slack (lo llama lib/track-integrations). */
export async function runSlackOutbox(workspaceId: string, kind: string, payload: Record<string, unknown>): Promise<void> {
  if (kind === 'post') {
    await slackCall(workspaceId, 'chat.postMessage', {
      channel: payload.channel,
      text: payload.text,
      ...(payload.thread_ts ? { thread_ts: payload.thread_ts } : {}),
      unfurl_links: false,
    });
    return;
  }
  if (kind === 'unfurl') {
    await slackCall(workspaceId, 'chat.unfurl', payload);
    return;
  }
  throw new IntegrationSkip('unknown_kind');
}

// ---------- Entrada: comandos, atajos y eventos de Slack ----------

/** Workspaces de zerosoft conectados a ese team de Slack. */
async function workspacesForTeam(slackTeamId: string): Promise<string[]> {
  const rows = (await getDb().prepare('SELECT workspace_id FROM track_slack WHERE slack_team_id = ?').all(slackTeamId)) as Array<{ workspace_id: string }>;
  return rows.map((r) => r.workspace_id);
}

/**
 * Persona de zerosoft detrás de un usuario de Slack (por email, con
 * users:read.email) en alguno de los workspaces conectados a ese team.
 */
async function resolveSlackUser(
  slackTeamId: string,
  slackUserId: string,
): Promise<{ workspaceId: string; person: { id: string; name: string | null; email: string } } | null> {
  for (const ws of await workspacesForTeam(slackTeamId)) {
    const info = await slackCall(ws, 'users.info', { user: slackUserId }).catch(() => null);
    const email = (info?.user as { profile?: { email?: string } } | undefined)?.profile?.email;
    const person = await workspacePersonByEmail(ws, email);
    if (person) return { workspaceId: ws, person };
  }
  return null;
}

async function visibleProjects(workspaceId: string, personId: string, via: TrackVia = 'slack') {
  const { listProjectMetas } = await import('./track-data');
  const teamId = await workspaceTeamId(workspaceId);
  const owner = await workspaceOwnerId(workspaceId);
  return runAsTrackViewer(personId, () => listProjectMetas(teamId, owner), via);
}

async function createIssueFromSlack(input: {
  workspaceId: string;
  personId: string;
  projectId: string;
  title: string;
  description: string;
}): Promise<TrackIssueWithStatus | null> {
  const { createIssue } = await import('./track-data');
  const projects = await visibleProjects(input.workspaceId, input.personId);
  if (!projects.some((p) => p.id === input.projectId)) return null;
  return runAsTrackViewer(
    input.personId,
    () =>
      createIssue(
        input.projectId,
        input.personId,
        { title: input.title.slice(0, 200), description: textToDescription(input.description) },
        { source: 'slack' },
      ),
    'slack',
  );
}

export interface SlackCommandResult {
  response_type: 'ephemeral' | 'in_channel';
  text: string;
}

/** `/track <título>`: crea el issue en el proyecto por defecto y confirma en privado. */
export async function handleSlackCommand(form: URLSearchParams): Promise<SlackCommandResult> {
  const teamId = form.get('team_id') ?? '';
  const userId = form.get('user_id') ?? '';
  const text = (form.get('text') ?? '').trim();
  const who = await resolveSlackUser(teamId, userId);
  if (!who) return { response_type: 'ephemeral', text: copy('noUser') };
  const row = await getRow(who.workspaceId);
  if (!text) return { response_type: 'ephemeral', text: copy('empty') };
  await logIntegrationEvent(who.workspaceId, 'slack', 'in', 'command', `/track ${text.slice(0, 200)}`);
  const projects = await visibleProjects(who.workspaceId, who.person.id);
  const projectId = row?.default_project_id && projects.some((p) => p.id === row.default_project_id) ? row.default_project_id : projects[0]?.id;
  if (!projectId) return { response_type: 'ephemeral', text: copy('noProject') };
  const issue = await createIssueFromSlack({ workspaceId: who.workspaceId, personId: who.person.id, projectId, title: text, description: '' });
  if (!issue) return { response_type: 'ephemeral', text: copy('noProject') };
  return { response_type: 'ephemeral', text: copy('createdReply', { id: issueLink(issue), title: slackEscape(issue.title) }) };
}

const MODAL_CALLBACK = 'track_create_issue_modal';

function modalView(
  projects: Array<{ id: string; name: string }>,
  defaults: { projectId?: string | null; title: string; description: string },
  meta: Record<string, string>,
): Record<string, unknown> {
  const options = projects.slice(0, 100).map((p) => ({ text: { type: 'plain_text', text: p.name.slice(0, 75) }, value: p.id }));
  const initial = options.find((o) => o.value === defaults.projectId) ?? options[0];
  return {
    type: 'modal',
    callback_id: MODAL_CALLBACK,
    private_metadata: JSON.stringify(meta),
    title: { type: 'plain_text', text: copy('modalTitle') },
    submit: { type: 'plain_text', text: copy('submit') },
    blocks: [
      {
        type: 'input',
        block_id: 'project',
        label: { type: 'plain_text', text: copy('project') },
        element: { type: 'static_select', action_id: 'value', options, ...(initial ? { initial_option: initial } : {}) },
      },
      {
        type: 'input',
        block_id: 'title',
        label: { type: 'plain_text', text: copy('titleLabel') },
        element: { type: 'plain_text_input', action_id: 'value', initial_value: defaults.title.slice(0, 150) },
      },
      {
        type: 'input',
        block_id: 'description',
        optional: true,
        label: { type: 'plain_text', text: copy('description') },
        element: { type: 'plain_text_input', action_id: 'value', multiline: true, initial_value: defaults.description.slice(0, 2900) },
      },
    ],
  };
}

interface SlackInteraction {
  type: string;
  callback_id?: string;
  trigger_id?: string;
  team?: { id: string };
  user?: { id: string };
  channel?: { id: string };
  message?: { ts: string; thread_ts?: string; text?: string };
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: { values?: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>> };
  };
}

/**
 * Atajo de mensaje ("Create Track issue") → modal; envío del modal → issue
 * con el hilo sincronizado y respuesta en el hilo. Devuelve el cuerpo de la
 * respuesta HTTP para Slack (o null = 200 vacío).
 */
export async function handleSlackInteraction(payload: SlackInteraction): Promise<Record<string, unknown> | null> {
  const teamId = payload.team?.id ?? '';
  const userId = payload.user?.id ?? '';
  const who = await resolveSlackUser(teamId, userId);

  if (payload.type === 'message_action' || payload.type === 'shortcut') {
    if (!who || !payload.trigger_id) return null;
    const row = await getRow(who.workspaceId);
    const projects = await visibleProjects(who.workspaceId, who.person.id);
    const text = payload.message?.text ?? '';
    let permalink = '';
    if (payload.channel?.id && payload.message?.ts) {
      const link = await slackCall(who.workspaceId, 'chat.getPermalink', { channel: payload.channel.id, message_ts: payload.message.ts }).catch(() => null);
      permalink = String(link?.permalink ?? '');
    }
    const firstLine = text.split('\n').find((l) => l.trim()) ?? '';
    const meta: Record<string, string> = payload.channel?.id && payload.message?.ts
      ? { channel: payload.channel.id, ts: payload.message.thread_ts ?? payload.message.ts, permalink }
      : {};
    await logIntegrationEvent(who.workspaceId, 'slack', 'in', payload.type, firstLine.slice(0, 200) || 'shortcut');
    await slackCall(who.workspaceId, 'views.open', {
      trigger_id: payload.trigger_id,
      view: modalView(projects, { projectId: row?.default_project_id, title: firstLine, description: permalink ? `${text}\n\n${copy('fromSlack')}: ${permalink}` : text }, meta),
    });
    return null;
  }

  if (payload.type === 'view_submission' && payload.view?.callback_id === MODAL_CALLBACK) {
    if (!who) return { response_action: 'errors', errors: { title: copy('noUser') } };
    const values = payload.view.state?.values ?? {};
    const projectId = values.project?.value?.selected_option?.value ?? '';
    const title = (values.title?.value?.value ?? '').trim();
    const description = values.description?.value?.value ?? '';
    if (!title) return { response_action: 'errors', errors: { title: copy('empty') } };
    const issue = await createIssueFromSlack({ workspaceId: who.workspaceId, personId: who.person.id, projectId, title, description });
    if (!issue) return { response_action: 'errors', errors: { project: copy('noProject') } };
    let meta: { channel?: string; ts?: string; permalink?: string } = {};
    try {
      meta = JSON.parse(payload.view.private_metadata || '{}') as typeof meta;
    } catch {
      meta = {};
    }
    if (meta.channel && meta.ts) {
      await upsertExternalRef({
        issueId: issue.id,
        workspaceId: who.workspaceId,
        provider: 'slack_thread',
        externalId: `${meta.channel}:${meta.ts}`,
        url: meta.permalink || null,
        title: 'Slack thread',
      });
      await enqueueOutbox(who.workspaceId, 'slack', 'post', {
        channel: meta.channel,
        thread_ts: meta.ts,
        text: copy('createdReply', { id: issueLink(issue), title: slackEscape(issue.title) }),
      });
    }
    return { response_action: 'clear' };
  }
  return null;
}

interface SlackEventEnvelope {
  type: string;
  challenge?: string;
  team_id?: string;
  event?: {
    type: string;
    channel?: string;
    user?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
    message_ts?: string;
    links?: Array<{ url: string; domain?: string }>;
  };
}

const ISSUE_URL_RE = /\/app\/track\/issues\/([A-Za-z0-9-]{8,64})/;

/**
 * Events API: verificación de URL, unfurl de links de issues y respuestas en
 * hilos sincronizados (entran como comentario). Devuelve el cuerpo de la
 * respuesta (el challenge) o null.
 */
export async function handleSlackEvent(env: SlackEventEnvelope): Promise<Record<string, unknown> | null> {
  if (env.type === 'url_verification') return { challenge: env.challenge ?? '' };
  if (env.type !== 'event_callback' || !env.event || !env.team_id) return null;
  const ev = env.event;
  const { getIssue, getProject, createIssueComment } = await import('./track-data');

  if (ev.type === 'link_shared' && ev.channel && ev.message_ts && ev.links?.length) {
    const host = new URL(appBaseUrl()).host;
    for (const ws of await workspacesForTeam(env.team_id)) {
      const row = await getRow(ws);
      if (!row?.unfurl) continue;
      const unfurls: Record<string, unknown> = {};
      for (const link of ev.links.slice(0, 5)) {
        let parsed: URL;
        try {
          parsed = new URL(link.url);
        } catch {
          continue;
        }
        if (parsed.host !== host) continue;
        const issueId = ISSUE_URL_RE.exec(parsed.pathname)?.[1];
        const issue = issueId ? await getIssue(issueId) : undefined;
        const project = issue ? await getProject(issue.project_id) : undefined;
        // Solo del workspace conectado y nunca de proyectos privados (como Linear).
        if (!issue || !project || (project.team_id ?? project.owner_id) !== ws || project.visibility === 'private') continue;
        unfurls[link.url] = { blocks: issueUnfurlBlocks(issue, project.name) };
      }
      if (Object.keys(unfurls).length > 0) {
        await logIntegrationEvent(ws, 'slack', 'in', 'link_shared', Object.keys(unfurls).join(', '));
        await enqueueOutbox(ws, 'slack', 'unfurl', { channel: ev.channel, ts: ev.message_ts, unfurls });
        const { runOutboxItem } = await import('./track-integrations');
        const pending = (await getDb()
          .prepare("SELECT id FROM track_integration_outbox WHERE workspace_id = ? AND kind = 'unfurl' AND status = 'pending' AND attempts = 0")
          .all(ws)) as Array<{ id: string }>;
        for (const p of pending) await runOutboxItem(p.id);
      }
    }
    return null;
  }

  // Respuesta en un hilo sincronizado → comentario (sin bots ni ediciones).
  if (ev.type === 'message' && ev.channel && ev.thread_ts && ev.ts !== ev.thread_ts && !ev.bot_id && !ev.subtype && ev.text?.trim()) {
    for (const ws of await workspacesForTeam(env.team_id)) {
      const ref = await findExternalRef(ws, 'slack_thread', `${ev.channel}:${ev.thread_ts}`);
      if (!ref) continue;
      const info = ev.user ? await slackCall(ws, 'users.info', { user: ev.user }).catch(() => null) : null;
      const profile = (info?.user as { real_name?: string; profile?: { email?: string; real_name?: string } } | undefined) ?? undefined;
      const person = await workspacePersonByEmail(ws, profile?.profile?.email);
      // Sin cuenta en zerosoft, firma quien instaló Slack y se aclara el nombre.
      const authorId = person?.id ?? (await getRow(ws))?.installed_by ?? (await workspaceOwnerId(ws));
      const name = profile?.real_name || profile?.profile?.real_name || 'Slack';
      const body = person ? ev.text.trim() : `${name} (Slack): ${ev.text.trim()}`;
      await logIntegrationEvent(ws, 'slack', 'in', 'thread_reply', body.slice(0, 200));
      await runAsTrackViewer(authorId, () => createIssueComment(ref.issue_id, authorId, { body: body.slice(0, 5000) }), 'slack');
      break;
    }
  }
  return null;
}

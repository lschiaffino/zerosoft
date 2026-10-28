/**
 * Talk: slash commands de apps (como los de Slack). Un admin registra
 * `/comando` con la URL de su app; cuando alguien lo escribe en un canal, Talk
 * hace un POST firmado a esa URL y la respuesta se publica en el canal o se
 * le muestra solo a quien lo escribió.
 *
 * Pedido (application/x-www-form-urlencoded, como Slack):
 *   command, text, workspace_id, channel_id, channel_name, thread_id,
 *   user_id, user_name, response_url, trigger_id
 * Firma: X-Talk-Request-Timestamp y X-Talk-Signature = "v0=" +
 * HMAC-SHA256(secreto, "v0:<timestamp>:<cuerpo>") en hex. El secreto se
 * muestra una sola vez al crear el comando y se guarda cifrado (secret-box).
 *
 * Respuesta (3 s): JSON { text, response_type: "ephemeral" | "in_channel" }
 * o texto plano (efímero). Vacío = solo acuse. Después, hasta 5 respuestas
 * más durante 30 minutos con POST del mismo JSON a response_url.
 *
 * Seguridad: la app solo recibe lo que la persona escribió y el canal donde
 * lo escribió; en DMs no se manda el nombre. Para publicar, quien lo invocó
 * tiene que seguir siendo miembro del canal. Server-only.
 */
import { createHash, createHmac, randomBytes } from 'crypto';
import { getDb } from './db';
import { open, seal } from './secret-box';
import { assertPublicUrl, readTextCapped, safeFetch, UnsafeUrlError } from './safe-fetch';
import { siteUrl } from './board-urls';
import { roleAtLeast } from './teams';
import {
  TalkError,
  afterPost,
  emitTalkEvent,
  listTalkPeople,
  nowIso,
  postMessage,
  writableChannel,
  type TalkActor,
  type TalkMessageDto,
} from './talk';

export const COMMAND_TIMEOUT_MS = 3000;
export const RESPONSE_URL_TTL_MS = 30 * 60_000;
export const RESPONSE_URL_USES = 5;
export const MAX_COMMANDS = 50;

/** Los comandos propios de Talk no se pueden registrar. */
const RESERVED = new Set(['remind', 'recordar', 'recordarme', 'lembrar', 'lembrete', 'topic', 'tema', 'leave', 'salir', 'sair', 'status', 'estado', 'summarize', 'resumir', 'huddle']);

export interface TalkCommandDto {
  id: string;
  command: string;
  description: string;
  usageHint: string;
  /** Solo para admins. */
  url?: string;
  createdBy: string;
  createdAt: string;
}

export function normalizeCommand(raw: string): string | null {
  const c = raw.trim().toLowerCase().replace(/^\/+/, '');
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(c)) return null;
  return `/${c}`;
}

function assertAdmin(actor: TalkActor) {
  if (actor.guest || !roleAtLeast(actor.role, 'admin')) throw new TalkError('forbidden', 403);
}

export async function listCommands(actor: TalkActor): Promise<TalkCommandDto[]> {
  const admin = !actor.guest && roleAtLeast(actor.role, 'admin');
  const rows = (await getDb().prepare('SELECT * FROM talk_commands WHERE workspace_id = ? ORDER BY command').all(actor.workspaceId)) as Array<{
    id: string;
    command: string;
    url: string;
    description: string;
    usage_hint: string;
    created_by: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    command: r.command,
    description: r.description,
    usageHint: r.usage_hint,
    ...(admin ? { url: r.url } : {}),
    createdBy: r.created_by,
    createdAt: r.created_at,
  }));
}

export async function createCommand(actor: TalkActor, input: { command: string; url: string; description?: string; usageHint?: string }): Promise<{ command: TalkCommandDto; secret: string }> {
  assertAdmin(actor);
  const command = normalizeCommand(input.command);
  if (!command || RESERVED.has(command.slice(1))) throw new TalkError('invalid_command');
  try {
    await assertPublicUrl(input.url);
  } catch (err) {
    throw new TalkError(err instanceof UnsafeUrlError ? 'invalid_url' : 'invalid_url');
  }
  const db = getDb();
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM talk_commands WHERE workspace_id = ?').get(actor.workspaceId)) as { n: number };
  if (Number(n.n) >= MAX_COMMANDS) throw new TalkError('too_many_commands', 409);
  const secret = randomBytes(24).toString('hex');
  const id = crypto.randomUUID();
  const now = nowIso();
  try {
    await db
      .prepare('INSERT INTO talk_commands (id, workspace_id, command, url, description, usage_hint, secret_enc, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, actor.workspaceId, command, input.url.slice(0, 1000), (input.description ?? '').slice(0, 200), (input.usageHint ?? '').slice(0, 100), seal(secret), actor.personId, now);
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) throw new TalkError('command_taken', 409);
    throw err;
  }
  return {
    command: { id, command, description: input.description ?? '', usageHint: input.usageHint ?? '', url: input.url, createdBy: actor.personId, createdAt: now },
    secret,
  };
}

export async function deleteCommand(actor: TalkActor, id: string): Promise<boolean> {
  assertAdmin(actor);
  return (await getDb().prepare('DELETE FROM talk_commands WHERE id = ? AND workspace_id = ?').run(id, actor.workspaceId)).changes > 0;
}

export function signBody(secret: string, timestamp: string, body: string): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
}

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export interface CommandReply {
  text: string;
  responseType: 'ephemeral' | 'in_channel';
}

/** Lee la respuesta de la app: JSON {text, response_type} o texto plano (efímero). */
export function parseReply(raw: string, contentType: string | null): CommandReply | null {
  const body = raw.trim();
  if (!body) return null;
  if ((contentType ?? '').includes('json') || body.startsWith('{')) {
    try {
      const j = JSON.parse(body) as { text?: unknown; response_type?: unknown };
      const text = typeof j.text === 'string' ? j.text.trim() : '';
      if (!text) return null;
      return { text: text.slice(0, 4000), responseType: j.response_type === 'in_channel' ? 'in_channel' : 'ephemeral' };
    } catch {
      /* no era JSON: texto plano */
    }
  }
  return { text: body.slice(0, 4000), responseType: 'ephemeral' };
}

export interface RunResult {
  ephemeral: string | null;
  ephemeralId?: string | null;
  message: TalkMessageDto | null;
  error?: string;
}

/** Publica la respuesta de una app (en el canal, o solo para quien invocó). */
async function deliver(actor: TalkActor, ctx: { channelId: string; parentId: string | null; command: string }, reply: CommandReply | null): Promise<RunResult> {
  if (!reply) return { ephemeral: null, message: null };
  // Quien lo invocó tiene que poder seguir escribiendo ahí.
  await writableChannel(actor, ctx.channelId);
  if (reply.responseType === 'ephemeral') {
    const id = crypto.randomUUID();
    await emitTalkEvent(actor.workspaceId, 'ephemeral', {
      channelId: ctx.channelId,
      userId: actor.personId,
      payload: { id, botName: ctx.command, text: reply.text, parentId: ctx.parentId, at: nowIso() },
    });
    return { ephemeral: reply.text, ephemeralId: id, message: null };
  }
  const result = await postMessage(actor, { channelId: ctx.channelId, parentId: ctx.parentId, body: reply.text, botName: ctx.command }, { asBot: true });
  void afterPost(actor, result, { asBot: true }).catch(() => undefined);
  return { ephemeral: null, message: result.message };
}

export async function runCommand(actor: TalkActor, input: { channelId: string; parentId?: string | null; command: string; text: string }): Promise<RunResult> {
  const { channel } = await writableChannel(actor, input.channelId);
  const command = normalizeCommand(input.command);
  if (!command) throw new TalkError('unknown_command', 404);
  const db = getDb();
  const row = (await db.prepare('SELECT * FROM talk_commands WHERE workspace_id = ? AND command = ?').get(actor.workspaceId, command)) as
    | { id: string; url: string; secret_enc: string }
    | undefined;
  if (!row) throw new TalkError('unknown_command', 404);
  const token = randomBytes(24).toString('base64url');
  await db
    .prepare('INSERT INTO talk_command_responses (token_hash, command_id, workspace_id, channel_id, user_id, parent_id, uses, expires_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
    .run(hashToken(token), row.id, actor.workspaceId, channel.id, actor.personId, input.parentId ?? null, new Date(Date.now() + RESPONSE_URL_TTL_MS).toISOString());
  const people = await listTalkPeople(actor.workspaceId);
  const me = people.find((p) => p.id === actor.personId);
  const isDm = channel.kind === 'dm' || channel.kind === 'group';
  const form = new URLSearchParams({
    command,
    text: input.text.slice(0, 4000),
    workspace_id: actor.workspaceId,
    channel_id: channel.id,
    channel_name: isDm ? 'directmessage' : channel.name,
    thread_id: input.parentId ?? '',
    user_id: actor.personId,
    user_name: me?.name ?? '',
    response_url: `${siteUrl()}/api/talk/commands/respond?token=${token}`,
    trigger_id: crypto.randomUUID(),
  }).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  let reply: CommandReply | null = null;
  try {
    const res = await safeFetch(
      row.url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-talk-request-timestamp': ts, 'x-talk-signature': signBody(open(row.secret_enc), ts, form), 'user-agent': 'zerosoft-talk/1' },
        body: form,
      },
      COMMAND_TIMEOUT_MS,
    );
    if (!res.ok) return { ephemeral: null, message: null, error: 'command_failed' };
    reply = parseReply(await readTextCapped(res, 64_000), res.headers.get('content-type'));
  } catch {
    return { ephemeral: null, message: null, error: 'command_failed' };
  }
  return deliver(actor, { channelId: channel.id, parentId: input.parentId ?? null, command }, reply);
}

/** POST de la app a response_url (respuestas diferidas). */
export async function respondToCommand(token: string, body: unknown): Promise<RunResult> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new TalkError('not_found', 404);
  const db = getDb();
  const row = (await db
    .prepare('SELECT r.*, c.command FROM talk_command_responses r JOIN talk_commands c ON c.id = r.command_id WHERE r.token_hash = ?')
    .get(hashToken(token))) as { token_hash: string; workspace_id: string; channel_id: string; user_id: string; parent_id: string | null; uses: number; expires_at: string; command: string } | undefined;
  if (!row || Date.parse(row.expires_at) < Date.now()) throw new TalkError('not_found', 404);
  // Claim: cada respuesta gasta un uso (dos POST a la vez no pasan el tope).
  const claim = await db.prepare('UPDATE talk_command_responses SET uses = uses + 1 WHERE token_hash = ? AND uses < ?').run(row.token_hash, RESPONSE_URL_USES);
  if (!claim.changes) throw new TalkError('rate_limited', 429);
  const j = (body ?? {}) as { text?: unknown; response_type?: unknown };
  const reply = typeof j.text === 'string' && j.text.trim() ? { text: j.text.trim().slice(0, 4000), responseType: j.response_type === 'in_channel' ? ('in_channel' as const) : ('ephemeral' as const) } : null;
  if (!reply) throw new TalkError('invalid_input');
  const actor: TalkActor = { workspaceId: row.workspace_id, personId: row.user_id, role: 'member', teamId: null };
  return deliver(actor, { channelId: row.channel_id, parentId: row.parent_id, command: row.command }, reply);
}

/** Cron: borra las response_url vencidas. */
export async function pruneCommandResponses(): Promise<void> {
  await getDb().prepare('DELETE FROM talk_command_responses WHERE expires_at < ?').run(new Date().toISOString());
}

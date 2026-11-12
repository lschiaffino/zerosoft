/**
 * Groups: números, chats (1:1 y grupos), mensajes, miembros, etiquetas,
 * propiedades, respuestas rápidas y ajustes. Server-only.
 *
 * Todo vive bajo el id del dueño del workspace (`ws`, como el resto de las
 * apps); `actor` es la persona real que hace la acción. Las credenciales de
 * cada número se guardan cifradas (secret-box) y nunca salen por la API: el
 * DTO solo dice qué campos están cargados.
 */
import { randomBytes, randomUUID } from 'crypto';
import { after } from 'next/server';
import { dbBatch, getDb, type BatchStatement } from './db';
import { pokeLive } from './wa-live';
import { transientError } from './transient-error';
import { linesSortKey } from './schema/inbox-lines-perf-migration';
import { open, seal } from './secret-box';
import { emitEventSoon } from './events';
import {
  PROVIDER_CAPS,
  PROVIDER_KINDS,
  ProviderError,
  isGroupJid,
  isLidJid,
  isValidPhone,
  lidDigits,
  phoneDigits,
  splitPhones,
  type BridgeConfig,
  type CloudConfig,
  type ConnectState,
  type GroupsProvider,
  type InboundEvent,
  type MediaRef,
  type MemberRole,
  type ParticipantAction,
  type ParticipantResult,
  type ProviderConfig,
  type ProviderKind,
} from './groups-provider';
import { cloudProvider } from './groups-provider-cloud';
import { bridgeProvider, MAX_INBOUND_MEDIA } from './groups-provider-bridge';
import {
  baseMime,
  compactInfo,
  imageSize,
  kindFromMime,
  MediaPlanError,
  planOutboundKind,
  type ContactCard,
  type LocationInfo,
  type MediaInfo,
  type MediaKind,
} from './groups-media';
import { fakeProvider, fakeProviderAllowed } from './groups-provider-fake';
import { deleteManagedInstance, managedAvailable, managedProvider, newManagedInstance, queueManagedDelete } from './groups-provider-managed';
import { sampleProvider } from './groups-provider-sample';
import { learnLinesEvents, withLinesMentions } from './groups-wa-names';
import type { MentionMap } from './wa-mentions';
import { chatAccessSql, maskChat, numberAccessSql, type GroupsViewer } from './groups-access';
import { parsePoll, pollPreview, tallyPoll, voteOptions, type PollDto, type PollInput } from './groups-polls';
import { DEFAULT_SETTINGS, matchKeyword, mediaKind, normalizeSettings, propertyText, reactionCreatesTicket, type GroupsSettings } from './groups-rules';

export { mediaKind, propertyText };

const nowIso = () => new Date().toISOString();
const newId = () => randomUUID();

export class GroupsError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
    this.name = 'GroupsError';
  }
}

// ======================================================================
// Números
// ======================================================================

export interface NumberRow {
  id: string;
  user_id: string;
  name: string;
  provider: ProviderKind;
  phone: string;
  status: ConnectState['status'];
  config: string;
  webhook_secret: string;
  last_error: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Persona dueña de la línea (null = sin dueño). */
  owner_id?: string | null;
  /** 'all' = todo el workspace; 'restricted' = solo dueño, admins y lo que figure en groups_number_access. */
  visibility?: string;
}

export interface NumberDto {
  id: string;
  name: string;
  provider: ProviderKind;
  phone: string;
  status: ConnectState['status'];
  lastError: string;
  caps: (typeof PROVIDER_CAPS)[ProviderKind];
  /** Campos de configuración cargados (los secretos nunca se devuelven). */
  configured: Record<string, boolean>;
  /** Campos no secretos, para editar. */
  settings: { baseUrl?: string; session?: string; phoneNumberId?: string; wabaId?: string };
  createdAt: string;
  ownerId: string | null;
  ownerName: string;
  visibility: 'all' | 'restricted';
  /** Quién la ve cuando es restringida (solo se devuelve a admins y a quien es dueño de la línea). */
  access?: { personIds: string[]; teamIds: string[] };
  /** Quien mira puede conectarla, editarla y borrarla (lib/groups-number-perms.ts). Lo completan la ruta y la página. */
  canManage?: boolean;
}

const SECRET_KEYS = ['accessToken', 'appSecret', 'verifyToken', 'apiKey'] as const;
const PLAIN_KEYS = ['baseUrl', 'session', 'phoneNumberId', 'wabaId', 'apiVersion'] as const;

export function readConfig(row: Pick<NumberRow, 'config'>): ProviderConfig {
  const plain = open(row.config);
  if (!plain) return {};
  try {
    return JSON.parse(plain) as ProviderConfig;
  } catch {
    return {};
  }
}

export function toNumberDto(row: NumberRow): NumberDto {
  const cfg = readConfig(row);
  const configured: Record<string, boolean> = {};
  for (const k of [...SECRET_KEYS, ...PLAIN_KEYS]) configured[k] = Boolean((cfg as Record<string, unknown>)[k]);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    phone: row.phone,
    status: row.status,
    lastError: row.last_error,
    caps: PROVIDER_CAPS[row.provider],
    configured,
    // La instancia administrada es nuestra: su servidor y su nombre no se muestran.
    settings: row.provider === 'managed' || row.provider === 'sample' ? {} : { baseUrl: cfg.baseUrl, session: cfg.session, phoneNumberId: cfg.phoneNumberId, wabaId: cfg.wabaId },
    createdAt: row.created_at,
    ownerId: row.owner_id ?? null,
    ownerName: '',
    visibility: row.visibility === 'restricted' ? 'restricted' : 'all',
  };
}

/**
 * Proveedores que esta instancia ofrece al conectar: el QR administrado solo
 * si el servidor tiene su config, el falso solo en tests/demo. El de ejemplo
 * no se agrega a mano (lo carga "Probar con datos de ejemplo").
 */
export function availableProviders(): ProviderKind[] {
  return PROVIDER_KINDS.filter((k) => {
    if (k === 'managed') return managedAvailable();
    if (k === 'sample') return false;
    if (k === 'fake') return fakeProviderAllowed();
    return true;
  });
}

function cleanConfig(kind: ProviderKind, input: Record<string, unknown>, prev: ProviderConfig = {}): ProviderConfig {
  const str = (k: string, max = 500) => {
    const v = input[k];
    if (typeof v !== 'string') return undefined;
    const t = v.trim().slice(0, max);
    return t || undefined;
  };
  const out: Record<string, string | undefined> = { ...(prev as Record<string, string | undefined>) };
  const keys: readonly string[] =
    kind === 'cloud'
      ? ['phoneNumberId', 'accessToken', 'appSecret', 'verifyToken', 'wabaId', 'apiVersion']
      : kind === 'fake' || kind === 'managed' || kind === 'sample'
        ? []
        : ['baseUrl', 'apiKey', 'session'];
  for (const k of keys) {
    const v = str(k, k === 'accessToken' ? 2000 : 500);
    // Un secreto vacío al editar conserva el anterior.
    if (v !== undefined) out[k] = v;
  }
  if (kind === 'cloud') {
    if (!out.phoneNumberId || !/^\d{5,30}$/.test(out.phoneNumberId)) throw new GroupsError('invalid_phone_number_id');
    if (!out.accessToken) throw new GroupsError('missing_access_token');
    if (!out.appSecret) throw new GroupsError('missing_app_secret');
    if (out.apiVersion && !/^v\d{1,2}\.\d$/.test(out.apiVersion)) throw new GroupsError('invalid_api_version');
    // Lo elige la persona y lo pega también en Meta: no hace falta devolverlo nunca.
    if (!out.verifyToken || out.verifyToken.length < 8) throw new GroupsError('missing_verify_token');
  } else if (kind === 'waha' || kind === 'evolution') {
    if (!out.baseUrl || !/^https?:\/\/[^\s]+$/.test(out.baseUrl)) throw new GroupsError('invalid_base_url');
    out.baseUrl = out.baseUrl.replace(/\/+$/, '');
    if (!out.apiKey) throw new GroupsError('missing_api_key');
    if (out.session && !/^[A-Za-z0-9_-]{1,60}$/.test(out.session)) throw new GroupsError('invalid_session');
  }
  return out as ProviderConfig;
}

/**
 * Líneas del workspace. Con `viewer`, solo las que esa persona puede ver
 * (visibilidad por línea); los admins reciben además quién las ve. Dueño y
 * lista de acceso se arman con dos consultas, no una por línea.
 */
export async function listNumbers(ws: string, viewer?: GroupsViewer): Promise<NumberDto[]> {
  const db = getDb();
  const access = numberAccessSql(viewer, 'n');
  const rows = (await db
    .prepare(`SELECT n.* FROM groups_numbers n WHERE n.user_id = ?${access ? ` AND ${access.sql}` : ''} ORDER BY n.created_at`)
    .all(ws, ...(access?.args ?? []))) as NumberRow[];
  if (rows.length === 0) return [];
  const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string>();
  if (ownerIds.length) {
    const us = (await db
      .prepare(`SELECT id, name, email FROM users WHERE id IN (${ownerIds.map(() => '?').join(',')})`)
      .all(...ownerIds)) as Array<{ id: string; name: string | null; email: string }>;
    for (const u of us) names.set(u.id, u.name || u.email);
  }
  const lists = new Map<string, { personIds: string[]; teamIds: string[] }>();
  // Quién ve cada línea: los admins, de todas; un member, solo de las que son suyas (las comparte él).
  const showAccess = (r: NumberRow) => !viewer?.linesScoped || (Boolean(r.owner_id) && r.owner_id === viewer.me);
  if (rows.some(showAccess)) {
    const acc = (await db
      .prepare(`SELECT a.number_id, a.kind, a.ref_id FROM groups_number_access a JOIN groups_numbers n ON n.id = a.number_id WHERE n.user_id = ?`)
      .all(ws)) as Array<{ number_id: string; kind: 'person' | 'team'; ref_id: string }>;
    for (const a of acc) {
      const l = lists.get(a.number_id) ?? { personIds: [], teamIds: [] };
      (a.kind === 'person' ? l.personIds : l.teamIds).push(a.ref_id);
      lists.set(a.number_id, l);
    }
  }
  return rows.map((r) => {
    const d = toNumberDto(r);
    d.ownerName = r.owner_id ? (names.get(r.owner_id) ?? '') : '';
    if (showAccess(r)) d.access = lists.get(r.id) ?? { personIds: [], teamIds: [] };
    return d;
  });
}

/**
 * Líneas caídas: tenían chats (estuvieron conectadas) y ahora piden QR, se
 * desconectaron o dan error. La bandeja muestra un aviso para reconectarlas.
 */
export async function droppedNumbers(ws: string, viewer?: GroupsViewer): Promise<Array<{ id: string; name: string; phone: string; status: string; qr: boolean }>> {
  const access = numberAccessSql(viewer, 'n');
  const rows = (await getDb()
    .prepare(
      `SELECT n.id, n.name, n.phone, n.status, n.provider FROM groups_numbers n
       WHERE n.user_id = ? AND n.status IN ('qr', 'disconnected', 'error')${access ? ` AND ${access.sql}` : ''}
         AND EXISTS (SELECT 1 FROM groups_chats c WHERE c.number_id = n.id) ORDER BY n.created_at`,
    )
    .all(ws, ...(access?.args ?? []))) as Array<{ id: string; name: string; phone: string; status: string; provider: ProviderKind }>;
  return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, status: r.status, qr: PROVIDER_CAPS[r.provider]?.qr ?? false }));
}

export async function getNumberRow(ws: string, id: string): Promise<NumberRow | null> {
  return ((await getDb().prepare('SELECT * FROM groups_numbers WHERE id = ? AND user_id = ?').get(id, ws)) as NumberRow) ?? null;
}

export async function getNumberRowById(id: string): Promise<NumberRow | null> {
  return ((await getDb().prepare('SELECT * FROM groups_numbers WHERE id = ?').get(id)) as NumberRow) ?? null;
}

export async function createNumber(
  ws: string,
  actor: string,
  input: { name?: string; provider: string; config?: Record<string, unknown>; ownerId?: string | null; visibility?: 'all' | 'restricted' },
): Promise<NumberDto> {
  const kind = input.provider as ProviderKind;
  if (!availableProviders().includes(kind)) throw new GroupsError('invalid_provider');
  // Los números del proveedor de prueba (solo existe en tests) no cuentan ni tienen tope: la suite e2e crea decenas en el mismo workspace.
  const count = (await getDb().prepare("SELECT COUNT(*) AS c FROM groups_numbers WHERE user_id = ? AND provider <> 'fake'").get(ws)) as { c: number };
  if (kind !== 'fake' && Number(count.c) >= 50) throw new GroupsError('too_many_numbers');
  const cfg = cleanConfig(kind, input.config ?? {});
  if ((kind === 'waha' || kind === 'evolution') && !cfg.session) cfg.session = `zs-${randomBytes(4).toString('hex')}`;
  // QR administrado: nombre y token de la instancia los genera el servidor.
  if (kind === 'managed') Object.assign(cfg, newManagedInstance());
  const id = newId();
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO groups_numbers (id, user_id, name, provider, status, config, webhook_secret, created_by, created_at, updated_at, owner_id, visibility)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      ws,
      (input.name ?? '').trim().slice(0, 80) || defaultNumberName(kind),
      kind,
      seal(JSON.stringify(cfg)),
      randomBytes(24).toString('hex'),
      actor,
      now,
      now,
      input.ownerId ?? null,
      input.visibility === 'restricted' ? 'restricted' : 'all',
    );
  return toNumberDto((await getNumberRow(ws, id)) as NumberRow);
}

function defaultNumberName(kind: ProviderKind): string {
  return kind === 'managed' ? 'WhatsApp' : kind === 'cloud' ? 'WhatsApp Cloud API' : kind === 'waha' ? 'WAHA' : kind === 'evolution' ? 'Evolution API' : 'Demo number';
}

export async function updateNumber(
  ws: string,
  id: string,
  input: { name?: string; config?: Record<string, unknown> },
): Promise<NumberDto> {
  const row = await getNumberRow(ws, id);
  if (!row) throw new GroupsError('not_found', 404);
  const sets: string[] = [];
  const args: Array<string> = [];
  if (typeof input.name === 'string') {
    sets.push('name = ?');
    args.push(input.name.trim().slice(0, 80) || row.name);
  }
  if (input.config) {
    sets.push('config = ?');
    args.push(seal(JSON.stringify(cleanConfig(row.provider, input.config, readConfig(row)))));
  }
  if (sets.length) {
    await getDb()
      .prepare(`UPDATE groups_numbers SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(...args, nowIso(), id, ws);
  }
  return toNumberDto((await getNumberRow(ws, id)) as NumberRow);
}

export async function deleteNumber(ws: string, id: string): Promise<boolean> {
  const row = await getNumberRow(ws, id);
  if (!row) return false;
  // El número de ejemplo se lleva todo lo suyo (tickets, tareas, etiquetas que creó).
  if (row.provider === 'sample') {
    const { clearSampleData } = await import('./groups-sample');
    return clearSampleData(ws);
  }
  if (row.provider === 'managed') {
    // Sin la config del servidor no se puede borrar la instancia: no se borra el número a ciegas.
    if (!managedAvailable()) throw new GroupsError('bridge_unavailable', 503);
    const session = String(readConfig(row).session ?? '');
    try {
      await deleteManagedInstance(session);
    } catch {
      await queueManagedDelete(session);
    }
  } else {
    // Cierra la sesión; si el proveedor no está, se borra igual.
    await safeDisconnect(row);
  }
  const files = await inboundUploads('m.number_id = ?', [id]);
  const r = await getDb().prepare('DELETE FROM groups_numbers WHERE id = ? AND user_id = ?').run(id, ws);
  if (r.changes > 0) await deleteStoredFiles(files);
  // La libreta de WhatsApp del número se va con él.
  if (r.changes > 0) await import('./wa-contacts').then((m) => m.forgetContacts('lines', id)).catch(() => null);
  return r.changes > 0;
}

/** Archivos recibidos que guardamos nosotros (storeInboundMedia): son de un solo mensaje, se pueden borrar con él. */
async function inboundUploads(where: string, args: string[]): Promise<string[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT m.media_url FROM groups_messages m WHERE ${where} AND m.direction = 'in'
         AND (m.media_url LIKE '/uploads/chat/%' OR m.media_url LIKE 'https://%.public.blob.vercel-storage.com/chat/%')`,
    )
    .all(...args)) as Array<{ media_url: string }>;
  return [...new Set(rows.map((r) => r.media_url))];
}

async function deleteStoredFiles(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const { deleteUploads } = await import('./uploads');
  await deleteUploads(urls).catch(() => null);
}

/** El adaptador del número, con sus credenciales descifradas. */
export function providerFor(row: NumberRow): GroupsProvider {
  const cfg = readConfig(row);
  switch (row.provider) {
    case 'cloud':
      return cloudProvider(cfg as CloudConfig);
    case 'waha':
    case 'evolution':
      return bridgeProvider(row.provider, cfg as BridgeConfig, { webhookSecret: row.webhook_secret });
    case 'managed':
      if (!managedAvailable()) throw new GroupsError('provider_unavailable', 503);
      // Con todo el historial: WhatsApp lo manda solo al vincular y solo si la instancia lo pide (ver groups-import.ts).
      return managedProvider(cfg, { fullHistory: true });
    case 'sample':
      return sampleProvider(row.id);
    case 'fake':
      if (!fakeProviderAllowed()) throw new GroupsError('provider_unavailable', 503);
      return fakeProvider(row.id);
    default:
      throw new GroupsError('provider_unavailable', 503);
  }
}

/** Base pública para los webhooks (lo que el proveedor puede alcanzar). */
export function groupsBaseUrl(origin?: string | null): string {
  const env = process.env.GROUPS_WEBHOOK_BASE_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_SITE_URL;
  return String(env || origin || 'http://localhost:3000').replace(/\/+$/, '');
}

export function webhookUrlFor(row: Pick<NumberRow, 'id' | 'webhook_secret'>, origin?: string | null): string {
  return `${groupsBaseUrl(origin)}/api/groups/webhook/${row.id}/${row.webhook_secret}`;
}

export function providerErrorCode(err: unknown): string {
  if (err instanceof ProviderError) return err.code;
  if (err instanceof GroupsError) return err.code;
  return 'provider_error';
}

async function saveState(row: NumberRow, state: ConnectState | null, error = ''): Promise<void> {
  await getDb()
    .prepare('UPDATE groups_numbers SET status = ?, phone = ?, last_error = ?, updated_at = ? WHERE id = ?')
    .run(state?.status ?? 'error', state?.phone ? phoneDigits(state.phone) : row.phone, error, nowIso(), row.id);
  // Recién conectado: se importan sus chats y mensajes (una vez; "Reimportar" lo repite).
  if (state?.status === 'connected' && row.status !== 'connected' && (row.provider === 'managed' || row.provider === 'evolution')) {
    const { queueImport, kickImport } = await import('./groups-import');
    if (await queueImport(row, { restart: false }).catch(() => false)) await kickImport(row.id);
  }
}

export async function connectNumber(ws: string, id: string, origin?: string | null): Promise<ConnectState> {
  const row = await getNumberRow(ws, id);
  if (!row) throw new GroupsError('not_found', 404);
  try {
    const state = await providerFor(row).connect(webhookUrlFor(row, origin));
    await saveState(row, state);
    return state;
  } catch (err) {
    const code = providerErrorCode(err);
    await saveState(row, null, code);
    throw new GroupsError(code, 502);
  }
}

export async function refreshNumber(ws: string, id: string): Promise<ConnectState> {
  const row = await getNumberRow(ws, id);
  if (!row) throw new GroupsError('not_found', 404);
  try {
    const state = await providerFor(row).state();
    await saveState(row, state);
    return state;
  } catch (err) {
    const code = providerErrorCode(err);
    await saveState(row, null, code);
    throw new GroupsError(code, 502);
  }
}

export async function disconnectNumber(ws: string, id: string): Promise<void> {
  const row = await getNumberRow(ws, id);
  if (!row) throw new GroupsError('not_found', 404);
  await safeDisconnect(row);
  await saveState(row, { status: 'disconnected' });
}

async function safeDisconnect(row: NumberRow): Promise<void> {
  try {
    await providerFor(row).disconnect();
  } catch {
    // Sin red o sin config: el número igual queda desconectado acá.
  }
}

// ======================================================================
// Chats
// ======================================================================

export interface ChatRow {
  id: string;
  user_id: string;
  number_id: string;
  folder_id?: string | null;
  provider_chat_id: string;
  kind: 'dm' | 'group';
  name: string;
  phone: string;
  description: string;
  invite_link: string;
  member_count: number;
  assigned_to: string | null;
  properties: string;
  crm_contact_id: string | null;
  crm_company_id: string | null;
  agent_id: string | null;
  agent_conversation_id: string | null;
  status: 'open' | 'closed';
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string;
  awaiting_since: string | null;
  flagged_at: string | null;
  pinned_at?: string | null;
  assigned_team_id?: string | null;
  created_at: string;
  updated_at: string;
  picture_url?: string;
  announce?: number;
  locked?: number;
  ephemeral?: number;
  left_at?: string | null;
  muted_until?: string | null;
  marked_unread?: number;
  archived_at?: string | null;
  hidden_at?: string | null;
  presence?: string | null;
  presence_who?: string | null;
  presence_at?: string | null;
}

export interface LabelDto {
  id: string;
  name: string;
  color: string;
}

export interface ChatDto {
  id: string;
  numberId: string;
  /** Carpeta compartida del workspace (null = sin carpeta). */
  folderId: string | null;
  kind: 'dm' | 'group';
  name: string;
  phone: string;
  description: string;
  /** Chat 1:1: la "info" (estado) del contacto en WhatsApp, de la libreta del número (solo al abrir el chat). */
  about?: string;
  inviteLink: string;
  memberCount: number;
  assignedTo: string | null;
  assignedTeamId: string | null;
  /** Fijado arriba de la lista. */
  pinned: boolean;
  properties: Record<string, unknown>;
  crmContactId: string | null;
  crmCompanyId: string | null;
  agentId: string | null;
  status: 'open' | 'closed';
  unread: number;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  awaitingSince: string | null;
  flagged: boolean;
  labels: LabelDto[];
  createdAt: string;
  /** Ajustes del grupo (lib/groups-org.ts). */
  pictureUrl: string;
  announce: boolean;
  locked: boolean;
  ephemeral: number;
  leftAt: string | null;
  /** Silenciado (sin avisos push), como en WhatsApp. */
  muted: boolean;
  /** Marcado como no leído a mano (WhatsApp muestra un punto, sin número). */
  markedUnread: boolean;
  /** Archivado: fuera de la lista principal, en "Archivados". */
  archived: boolean;
  /** Lo que hace el contacto ahora (escribiendo, grabando, en línea), si es reciente. */
  presence?: ChatPresence | null;
  /** El último mensaje (para la vista previa con tildes): dirección y estado. */
  lastDirection?: string | null;
  lastStatus?: string | null;
  lastSender?: string | null;
  /** Duración (segundos) si el último fue audio o nota de voz; tipo de media o "deleted". */
  lastDuration?: number | null;
  lastKind?: string | null;
  /** Fragmento del mensaje que coincide con la búsqueda. */
  match?: string;
  /** Empresa (o, si no hay, negocio) de HubSpot vinculada al chat (lib/groups-hubspot.ts). */
  hubspotName?: string;
}

export interface ChatPresence {
  state: 'composing' | 'recording' | 'available';
  /** En grupos: el nombre de quien escribe, si lo conocemos (nunca el teléfono). */
  name: string;
  at: string;
}

/** Cuánto vale cada presencia: "escribiendo" se renueva cada pocos segundos; "en línea" dura hasta que se va. */
const PRESENCE_TTL_MS: Record<ChatPresence['state'], number> = { composing: 25_000, recording: 25_000, available: 10 * 60_000 };

export function chatPresence(row: Pick<ChatRow, 'presence' | 'presence_who' | 'presence_at'>, now = Date.now()): ChatPresence | null {
  const state = row.presence as ChatPresence['state'] | null | undefined;
  if (!state || !(state in PRESENCE_TTL_MS) || !row.presence_at) return null;
  const at = Date.parse(row.presence_at);
  if (!Number.isFinite(at) || now - at > PRESENCE_TTL_MS[state]) return null;
  return { state, name: '', at: row.presence_at };
}

/** Presencia con el nombre de quien escribe en un grupo (de los miembros guardados). */
export async function presenceWithName(row: ChatRow): Promise<ChatPresence | null> {
  const p = chatPresence(row);
  if (!p || row.kind !== 'group' || !row.presence_who) return p;
  const m = (await getDb().prepare('SELECT name FROM groups_members WHERE chat_id = ? AND phone = ?').get(row.id, row.presence_who)) as { name: string } | undefined;
  return { ...p, name: m?.name ?? '' };
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Nombre visible: el del grupo o contacto, o el teléfono con +. */
export function chatDisplayName(row: Pick<ChatRow, 'name' | 'phone' | 'provider_chat_id'>): string {
  // Un id "@lid" de WhatsApp no es un teléfono: no se muestra.
  return row.name || (row.phone ? `+${row.phone}` : isLidJid(row.provider_chat_id) ? LID_CHAT_NAME.en : row.provider_chat_id);
}

export function toChatDto(row: ChatRow, labels: LabelDto[] = []): ChatDto {
  return {
    id: row.id,
    numberId: row.number_id,
    folderId: row.folder_id ?? null,
    kind: row.kind,
    name: chatDisplayName(row),
    phone: row.phone,
    description: row.description,
    inviteLink: row.invite_link,
    memberCount: row.member_count,
    assignedTo: row.assigned_to,
    assignedTeamId: row.assigned_team_id ?? null,
    pinned: Boolean(row.pinned_at),
    properties: parseJson<Record<string, unknown>>(row.properties, {}),
    crmContactId: row.crm_contact_id,
    crmCompanyId: row.crm_company_id,
    agentId: row.agent_id,
    status: row.status,
    unread: row.unread_count,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    awaitingSince: row.awaiting_since,
    flagged: Boolean(row.flagged_at),
    labels,
    createdAt: row.created_at,
    pictureUrl: row.picture_url ?? '',
    announce: Boolean(row.announce),
    locked: Boolean(row.locked),
    ephemeral: Number(row.ephemeral ?? 0),
    leftAt: row.left_at ?? null,
    muted: Boolean(row.muted_until && row.muted_until > new Date().toISOString()),
    markedUnread: Boolean(row.marked_unread),
    archived: Boolean(row.archived_at),
    presence: chatPresence(row),
  };
}

async function labelsFor(chatIds: string[]): Promise<Map<string, LabelDto[]>> {
  const out = new Map<string, LabelDto[]>();
  if (chatIds.length === 0) return out;
  const marks = chatIds.map(() => '?').join(',');
  const rows = (await getDb()
    .prepare(
      `SELECT cl.chat_id, l.id, l.name, l.color FROM groups_chat_labels cl JOIN groups_labels l ON l.id = cl.label_id
       WHERE cl.chat_id IN (${marks}) ORDER BY l.name COLLATE NOCASE`,
    )
    .all(...chatIds)) as Array<{ chat_id: string; id: string; name: string; color: string }>;
  for (const r of rows) {
    const list = out.get(r.chat_id) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    out.set(r.chat_id, list);
  }
  return out;
}

export async function getChatRow(ws: string, id: string): Promise<ChatRow | null> {
  return ((await getDb().prepare('SELECT * FROM groups_chats WHERE id = ? AND user_id = ?').get(id, ws)) as ChatRow) ?? null;
}

export async function getChat(ws: string, id: string): Promise<ChatDto | null> {
  const row = await getChatRow(ws, id);
  if (!row) return null;
  const dto = toChatDto(row, (await labelsFor([row.id])).get(row.id) ?? []);
  if (dto.lastMessagePreview.includes('@')) {
    const { resolveTextMentions, someoneWord } = await import('./wa-contacts');
    dto.lastMessagePreview = (
      await resolveTextMentions('lines', [{ accountId: row.number_id, text: dto.lastMessagePreview }], { someone: () => someoneWord(ws) }).catch(() => [dto.lastMessagePreview])
    )[0];
  }
  if (row.kind === 'dm') {
    // La "info" del contacto: la trae el repaso diario a la libreta del número.
    const key = row.phone || lidDigits(row.provider_chat_id);
    if (key) {
      const { lookupContacts } = await import('./wa-contacts');
      const about = (await lookupContacts({ app: 'lines', accountId: row.number_id }, [key]).catch(() => new Map())).get(key)?.about ?? '';
      if (about) dto.about = about;
    }
  }
  return dto;
}

export const CHAT_FILTERS = ['all', 'unread', 'unanswered', 'flagged', 'mine', 'unassigned', 'closed'] as const;
export type ChatFilter = (typeof CHAT_FILTERS)[number];

/** Filtro por propiedad propia: `is` (también dentro de multiselección o desplegable dependiente), `set` o `unset`. */
export interface PropertyFilter {
  key: string;
  op: 'is' | 'set' | 'unset';
  value?: string;
}

export interface ChatQuery {
  filter?: ChatFilter;
  q?: string;
  labelId?: string;
  teamId?: string;
  /** Cualquiera de estas etiquetas (listas guardadas). */
  labelIds?: string[];
  /** 'me', 'none' o el id de una persona. */
  assignee?: string;
  props?: PropertyFilter[];
  kind?: 'dm' | 'group';
  numberId?: string;
  /** Carpeta (incluye sus subcarpetas) o 'none' para los que no están en ninguna. */
  folderId?: string;
  /** Líneas de las que esta persona es dueña. */
  ownerId?: string;
  limit?: number;
  offset?: number;
  /** Quién mira: acceso por etiqueta y teléfonos ocultos (lib/groups-access.ts). */
  viewer?: GroupsViewer;
  /** Solo los archivados (sin esto, la lista los deja afuera salvo al buscar). */
  archived?: boolean;
  /** Vinculados (o no) a un registro de HubSpot. */
  hubspot?: 'linked' | 'unlinked';
  /**
   * Paginado por cursor (la bandeja): '' pide la primera página y el `next` de
   * una página pide la que sigue. Sin esto, `limit` y `offset` como siempre.
   */
  cursor?: string | null;
  /** false: no cuenta el total (la bandeja no lo usa; contar recorre todos los chats). */
  count?: boolean;
  /** Condiciones sobre propiedades de la empresa de HubSpot vinculada (lib/groups-hubspot-filter.ts). */
  hsProps?: import('./groups-hubspot-shared').HubspotPropFilter[];
  /**
   * Los filtros del panel de la bandeja y de las listas guardadas (lib/groups-filters.ts): varias opciones por
   * campo, sí o no, fechas. Se cruzan con lo demás de esta consulta. Con esto, el estado (abiertos, cerrados) sale de acá.
   */
  filters?: import('./groups-filters').LinesFilters;
  /** Minutos al este de UTC de quien mira: dónde empieza "hoy" en los filtros por fecha. */
  tzOffsetMin?: number;
}

/** Cursor de la bandeja: (orden, id) del último chat de la página. */
export function encodeChatCursor(k: string, id: string): string {
  return Buffer.from(JSON.stringify([k, id]), 'utf8').toString('base64url');
}

export function decodeChatCursor(raw: string | null | undefined): { k: string; id: string } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string' && v[0].length <= 80 && v[1].length <= 120) return { k: v[0], id: v[1] };
  } catch {
    /* cursor roto: primera página */
  }
  return null;
}

let ftsOk: boolean | null = null;

/** ¿Está el índice de texto completo de los mensajes? (migración 370; sin FTS5 la búsqueda usa LIKE). */
async function hasMessagesFts(): Promise<boolean> {
  if (ftsOk !== null) return ftsOk;
  try {
    await getDb().prepare("SELECT rowid FROM groups_messages_fts WHERE groups_messages_fts MATCH '\"x\"' LIMIT 1").all();
    ftsOk = true;
  } catch {
    ftsOk = false;
  }
  return ftsOk;
}

/** Expresión MATCH: todas las palabras, cada una como prefijo ("fact" encuentra "factura"). '' si no hay palabras. */
export function chatSearchMatch(q: string): string {
  const words = q
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  return words.map((w) => `"${w}"*`).join(' ');
}

/** Tope de mensajes que se miran por búsqueda (los más recientes que coinciden). */
const SEARCH_HITS = 400;

/**
 * Chats con algún mensaje que coincide con la búsqueda y el fragmento más
 * nuevo de cada uno. null: sin índice de texto completo (se busca con LIKE).
 * Siempre dentro del workspace; el acceso por línea y etiqueta lo aplica la
 * lista, que solo usa estos ids para filtrar.
 */
async function chatsMatchingMessages(ws: string, q: string): Promise<Map<string, string> | null> {
  const match = chatSearchMatch(q);
  if (!match || !(await hasMessagesFts())) return null;
  try {
    const rows = (await getDb()
      .prepare(
        `SELECT m.chat_id, m.body, m.created_at FROM groups_messages_fts f JOIN groups_messages m ON m.rowid = f.rowid
         WHERE groups_messages_fts MATCH ? AND m.user_id = ? ORDER BY f.rowid DESC LIMIT ${SEARCH_HITS}`,
      )
      .all(match, ws)) as Array<{ chat_id: string; body: string; created_at: string }>;
    const latest = new Map<string, { body: string; at: string }>();
    for (const r of rows) {
      const prev = latest.get(r.chat_id);
      if (!prev || r.created_at > prev.at) latest.set(r.chat_id, { body: r.body, at: r.created_at });
    }
    return new Map([...latest].map(([id, v]) => [id, v.body]));
  } catch {
    return null;
  }
}

/** El chat tiene un vínculo con HubSpot y el workspace sigue conectado (alias c de groups_chats). */
const HUBSPOT_LINKED_SQL = `EXISTS (SELECT 1 FROM groups_hubspot_links zhl JOIN groups_hubspot zh ON zh.user_id = zhl.user_id AND zh.token != '' WHERE zhl.chat_id = c.id)`;

function likeArg(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listChats(ws: string, me: string, query: ChatQuery = {}): Promise<{ rows: ChatDto[]; total: number; next?: string | null; pinned?: number }> {
  const where: string[] = ['c.user_id = ?', 'c.hidden_at IS NULL'];
  const args: Array<string | number> = [ws];
  const filter = query.filter ?? 'all';
  // Como WhatsApp: los archivados van aparte, pero la búsqueda los encuentra.
  if (query.archived) where.push('c.archived_at IS NOT NULL');
  else if (!(query.q ?? '').trim()) where.push('c.archived_at IS NULL');
  if (query.filters) {
    // Estado, tipo, líneas, asignación, etiquetas, sí o no, fechas y propiedades. El acceso de quien mira va aparte, más abajo.
    const { linesFiltersSql } = await import('./groups-filters');
    const fx = linesFiltersSql(filter === 'closed' ? { ...query.filters, status: ['closed'] } : query.filters, { me, tzOffsetMin: query.tzOffsetMin });
    where.push(...fx.where);
    args.push(...fx.args);
  } else if (filter === 'closed') where.push("c.status = 'closed'");
  else where.push("c.status = 'open'");
  if (filter === 'unread') where.push('c.unread_count > 0');
  if (filter === 'unanswered') where.push('c.awaiting_since IS NOT NULL');
  if (filter === 'flagged') where.push('c.flagged_at IS NOT NULL');
  if (filter === 'mine') {
    where.push('c.assigned_to = ?');
    args.push(me);
  }
  if (filter === 'unassigned') where.push('c.assigned_to IS NULL');
  if (query.kind) {
    where.push('c.kind = ?');
    args.push(query.kind);
  }
  if (query.numberId) {
    where.push('c.number_id = ?');
    args.push(query.numberId);
  }
  if (query.ownerId) {
    where.push('c.number_id IN (SELECT zo.id FROM groups_numbers zo WHERE zo.user_id = c.user_id AND zo.owner_id = ?)');
    args.push(query.ownerId === 'me' ? me : query.ownerId);
  }
  if (query.folderId === 'none') where.push('c.folder_id IS NULL');
  else if (query.folderId) {
    const { folderScope } = await import('./groups-lines');
    const ids = await folderScope(ws, query.folderId);
    if (ids.length === 0) where.push('0 = 1');
    else {
      where.push(`c.folder_id IN (${ids.map(() => '?').join(',')})`);
      args.push(...ids);
    }
  }
  if (query.teamId) {
    where.push('c.assigned_team_id = ?');
    args.push(query.teamId);
  }
  if (query.labelId) {
    where.push('EXISTS (SELECT 1 FROM groups_chat_labels cl WHERE cl.chat_id = c.id AND cl.label_id = ?)');
    args.push(query.labelId);
  }
  const anyLabels = (query.labelIds ?? []).filter(Boolean).slice(0, 20);
  if (anyLabels.length) {
    where.push(`EXISTS (SELECT 1 FROM groups_chat_labels cl WHERE cl.chat_id = c.id AND cl.label_id IN (${anyLabels.map(() => '?').join(',')}))`);
    args.push(...anyLabels);
  }
  if (query.hubspot === 'linked') where.push(HUBSPOT_LINKED_SQL);
  else if (query.hubspot === 'unlinked') where.push(`NOT ${HUBSPOT_LINKED_SQL}`);
  if (query.hsProps?.length) {
    const { hubspotFilterSql } = await import('./groups-hubspot-filter');
    const hs = await hubspotFilterSql(ws, query.hsProps);
    if (hs) {
      where.push(hs.sql);
      args.push(...hs.args);
    }
  }
  if (query.assignee === 'none') where.push('c.assigned_to IS NULL');
  else if (query.assignee) {
    where.push('c.assigned_to = ?');
    args.push(query.assignee === 'me' ? me : query.assignee);
  }
  for (const pf of (query.props ?? []).slice(0, 10)) {
    if (!/^[a-z0-9_]{1,40}$/.test(pf.key)) continue;
    const path = `$."${pf.key}"`;
    if (pf.op === 'set') {
      where.push('json_extract(c.properties, ?) IS NOT NULL');
      args.push(path);
    } else if (pf.op === 'unset') {
      where.push('json_extract(c.properties, ?) IS NULL');
      args.push(path);
    } else if (pf.value !== undefined && pf.value !== '') {
      // json_each sobre un valor suelto devuelve ese valor: sirve para texto, número, multiselección y dependiente.
      where.push('EXISTS (SELECT 1 FROM json_each(c.properties, ?) je WHERE CAST(je.value AS TEXT) = ?)');
      args.push(path, String(pf.value).slice(0, 200));
    }
  }
  const access = chatAccessSql(query.viewer);
  if (access) {
    where.push(access.sql);
    args.push(...access.args);
  }
  const q = (query.q ?? '').trim().slice(0, 200);
  let matchSelect = 'NULL AS match';
  const matchArgs: string[] = [];
  // Fragmento del mensaje que coincide, por chat (cuando la búsqueda usa el índice de texto completo).
  let snippets: Map<string, string> | null = null;
  if (q) {
    const like = likeArg(q);
    snippets = await chatsMatchingMessages(ws, q);
    if (snippets) {
      const ids = [...snippets.keys()];
      where.push(`(c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\'${ids.length ? ` OR c.id IN (${ids.map(() => '?').join(',')})` : ''})`);
      args.push(like, like, ...ids);
    } else {
      where.push(
        `(c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM groups_messages m WHERE m.chat_id = c.id AND m.body LIKE ? ESCAPE '\\'))`,
      );
      args.push(like, like, like);
      matchSelect = `(SELECT body FROM groups_messages m WHERE m.chat_id = c.id AND m.body LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC LIMIT 1) AS match`;
      matchArgs.push(like);
    }
  }
  const keyset = query.cursor !== undefined && query.cursor !== null;
  // Por cursor, la bandeja refresca de una vez todo lo que ya cargó (hasta 1000).
  const limit = Math.min(Math.max(1, query.limit ?? 50), keyset ? 1000 : 500);
  const offset = Math.max(0, query.offset ?? 0);
  const whereSql = where.join(' AND ');
  const db = getDb();
  const total = query.count === false ? { c: 0 } : ((await db.prepare(`SELECT COUNT(*) AS c FROM groups_chats c WHERE ${whereSql}`).get(...args)) as { c: number });
  const select = `SELECT c.*, ${matchSelect},
         (SELECT m.direction || '|' || m.status || '|' || COALESCE(json_extract(CASE WHEN json_valid(m.meta) THEN m.meta END, '$.media.duration'), '') || '|' || CASE WHEN m.deleted_at IS NOT NULL THEN 'deleted' ELSE COALESCE(json_extract(CASE WHEN json_valid(m.meta) THEN m.meta END, '$.media.kind'), '') END || '|' || CASE WHEN m.sender_name != '' THEN m.sender_name WHEN m.sender_phone != '' THEN '+' || m.sender_phone ELSE '' END FROM groups_messages m WHERE m.chat_id = c.id AND m.direction IN ('in', 'out')
           ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_info,
         (SELECT zhl.name FROM groups_hubspot_links zhl JOIN groups_hubspot zh ON zh.user_id = zhl.user_id AND zh.token != ''
           WHERE zhl.chat_id = c.id AND zhl.object_type IN ('company', 'deal') ORDER BY zhl.object_type LIMIT 1) AS hubspot_name`;
  type ListRow = ChatRow & { match: string | null; last_info: string | null; hubspot_name: string | null; sort_key?: string | null };
  let rows: ListRow[];
  let next: string | null = null;
  let pinnedCount = 0;
  if (keyset) {
    // Por cursor: los fijados entran todos en la primera página; el resto va por (orden, id) y cada página lee solo
    // sus filas (idx_groups_chats_list). Una carpeta es un conjunto chico: `+` hace que se filtre por carpeta y se ordene eso.
    const key = linesSortKey('c');
    const cursor = decodeChatCursor(query.cursor);
    const smallSet = Boolean(query.folderId && query.folderId !== 'none');
    const pinned = cursor
      ? []
      : ((await db
          // Los fijados son pocos: se leen por su índice (sin él, el motor recorre la bandeja entera buscándolos).
          .prepare(
            `${select}, ${key} AS sort_key FROM groups_chats c INDEXED BY idx_groups_chats_pinned WHERE ${whereSql} AND c.pinned_at IS NOT NULL ORDER BY c.pinned_at DESC, ${key} DESC, c.id DESC LIMIT 100`,
          )
          .all(...matchArgs, ...args)) as ListRow[]);
    const rest = [whereSql, 'c.pinned_at IS NULL'];
    const restArgs: Array<string | number> = [...args];
    if (cursor) {
      // El primer término deja que el índice arranque en la clave del cursor.
      rest.push(`${key} <= ?`, `(${key} < ? OR c.id < ?)`);
      restArgs.push(cursor.k, cursor.k, cursor.id);
    }
    const page = (await db
      .prepare(`${select}, ${key} AS sort_key FROM groups_chats c WHERE ${rest.join(' AND ')} ORDER BY ${smallSet ? '+' : ''}${key} DESC, c.id DESC LIMIT ?`)
      .all(...matchArgs, ...restArgs, limit + 1)) as ListRow[];
    const more = page.length > limit;
    const shown = more ? page.slice(0, limit) : page;
    const last = shown[shown.length - 1];
    if (more && last && last.sort_key != null) next = encodeChatCursor(String(last.sort_key), last.id);
    rows = [...pinned, ...shown];
    pinnedCount = pinned.length;
  } else {
    rows = (await db
      .prepare(
        `${select}
       FROM groups_chats c WHERE ${whereSql}
       ORDER BY (c.pinned_at IS NULL), c.pinned_at DESC, COALESCE(c.last_message_at, c.created_at) DESC, c.id LIMIT ? OFFSET ?`,
      )
      .all(...matchArgs, ...args, limit, offset)) as ListRow[];
  }
  const labels = await labelsFor(rows.map((r) => r.id));
  const presences = await presenceNames(rows);
  // "@<dígitos>" (teléfono o lid) → "@Nombre" en la vista previa y en el fragmento de la búsqueda, con la libreta de cada número.
  const { resolveTextMentions, someoneWord } = await import('./wa-contacts');
  const texts = rows.flatMap((r) => [r.last_message_preview ?? '', r.match ?? snippets?.get(r.id) ?? '']);
  const named = await resolveTextMentions(
    'lines',
    texts.map((text, i) => ({ accountId: text.includes('@') ? rows[Math.floor(i / 2)].number_id : '', text })),
    { someone: () => someoneWord(ws) },
  ).catch(() => texts);
  return {
    rows: rows.map((r, i) => {
      r.last_message_preview = named[i * 2];
      const [dir, st, dur, lastKind, ...rest] = (r.last_info ?? '').split('|');
      const sender = rest.join('|');
      const match = (r.match ?? snippets?.get(r.id)) ? named[i * 2 + 1] : null;
      return maskChat(query.viewer, {
        ...toChatDto(r, labels.get(r.id) ?? []),
        lastDirection: dir || null,
        lastStatus: st || null,
        lastSender: sender || null,
        lastDuration: Number(dur) || null,
        lastKind: lastKind || null,
        ...(presences.has(r.id) ? { presence: presences.get(r.id) } : {}),
        ...(match ? { match: matchExcerpt(match, q) } : {}),
        ...(r.hubspot_name ? { hubspotName: r.hubspot_name } : {}),
      });
    }),
    total: Number(total.c),
    ...(keyset ? { next, pinned: pinnedCount } : {}),
  };
}

/** El fragmento del mensaje alrededor de lo buscado (160 caracteres), para que la coincidencia se vea. */
function matchExcerpt(body: string, q: string): string {
  if (body.length <= 160) return body;
  const first = q.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const at = first ? body.toLowerCase().indexOf(first) : -1;
  if (at < 100) return body.slice(0, 160);
  const from = Math.max(0, at - 40);
  return `…${body.slice(from, from + 159)}`;
}

/** Quién escribe en los grupos de la página con presencia vigente: una consulta para todos (antes, una por grupo). */
async function presenceNames(rows: ChatRow[]): Promise<Map<string, ChatPresence | null>> {
  const out = new Map<string, ChatPresence | null>();
  for (const r of rows) if (r.kind === 'group' && chatPresence(r)) out.set(r.id, chatPresence(r));
  const live = rows.filter((r) => out.has(r.id) && r.presence_who);
  if (live.length === 0) return out;
  const marks = live.map(() => '?').join(',');
  const names = (await getDb()
    .prepare(`SELECT chat_id, phone, name FROM groups_members WHERE chat_id IN (${marks}) AND phone IN (${marks})`)
    .all(...live.map((r) => r.id), ...live.map((r) => r.presence_who as string))) as Array<{ chat_id: string; phone: string; name: string }>;
  const byKey = new Map(names.map((n) => [`${n.chat_id}|${n.phone}`, n.name]));
  for (const r of live) {
    const p = out.get(r.id);
    if (p) out.set(r.id, { ...p, name: byKey.get(`${r.id}|${r.presence_who}`) ?? '' });
  }
  return out;
}

/** Chats abiertos con algo sin leer (sin los silenciados), con el mismo acceso que la bandeja. */
export async function countUnreadChats(ws: string, viewer?: GroupsViewer): Promise<number> {
  const where = ["c.user_id = ?", "c.status = 'open'", 'c.unread_count > 0', '(c.muted_until IS NULL OR c.muted_until < ?)', 'c.hidden_at IS NULL', 'c.archived_at IS NULL'];
  const args: Array<string | number> = [ws, nowIso()];
  const access = chatAccessSql(viewer);
  if (access) {
    where.push(access.sql);
    args.push(...access.args);
  }
  const r = (await getDb().prepare(`SELECT COUNT(*) AS n FROM groups_chats c WHERE ${where.join(' AND ')}`).get(...args)) as { n: number };
  return Number(r.n);
}

/** Archivados que ve quien mira: cuántos hay y cuántos tienen algo sin leer (la fila "Archivados"). */
export async function countArchivedChats(ws: string, viewer?: GroupsViewer): Promise<{ total: number; unread: number }> {
  const where = ['c.user_id = ?', 'c.archived_at IS NOT NULL', 'c.hidden_at IS NULL'];
  const args: Array<string | number> = [ws];
  const access = chatAccessSql(viewer);
  if (access) {
    where.push(access.sql);
    args.push(...access.args);
  }
  const r = (await getDb()
    .prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN c.unread_count > 0 THEN 1 ELSE 0 END) AS u FROM groups_chats c WHERE ${where.join(' AND ')}`)
    .get(...args)) as { n: number; u: number | null };
  return { total: Number(r.n), unread: Number(r.u ?? 0) };
}

/** Busca o crea el chat de un número (por id del proveedor). */
export async function upsertChat(
  number: Pick<NumberRow, 'id' | 'user_id'>,
  input: { providerChatId: string; kind: 'dm' | 'group'; name?: string; phone?: string },
  /**
   * `silent`: sin evento de "chat nuevo". `hiddenAt` y `assignedTo` valen solo
   * si el chat se crea acá (uno que ya existía no se toca): un chat que abre
   * una persona nace fuera de la lista hasta su primer mensaje (lib/groups-new-chat.ts).
   */
  opts: { silent?: boolean; hiddenAt?: string; assignedTo?: string } = {},
): Promise<ChatRow> {
  const db = getDb();
  const insert = chatInsert(number, input, opts);
  const inserted = await db.prepare(insert.sql).run(...insert.args);
  const row = (await db
    .prepare('SELECT * FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?')
    .get(number.id, input.providerChatId)) as ChatRow;
  return finishChat(number, row, input, inserted.changes > 0, opts);
}

type ChatInput = { providerChatId: string; kind: 'dm' | 'group'; name?: string; phone?: string };

/** El INSERT de un chat que puede existir (no pisa nada si ya está). */
function chatInsert(number: Pick<NumberRow, 'id' | 'user_id'>, input: ChatInput, opts: { hiddenAt?: string; assignedTo?: string } = {}): BatchStatement {
  const now = nowIso();
  return {
    sql: `INSERT OR IGNORE INTO groups_chats (id, user_id, number_id, provider_chat_id, kind, name, phone, hidden_at, assigned_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [newId(), number.user_id, number.id, input.providerChatId, input.kind, (input.name ?? '').slice(0, 200), input.phone ?? '', opts.hiddenAt ?? null, opts.assignedTo ?? null, now, now],
  };
}

/** Lo que sigue a tener la fila del chat: completar el nombre y avisar si es nuevo. */
async function finishChat(number: Pick<NumberRow, 'id' | 'user_id'>, row: ChatRow, input: ChatInput, created: boolean, opts: { silent?: boolean } = {}): Promise<ChatRow> {
  const db = getDb();
  // El nombre de un 1:1 viene del perfil del contacto: se completa si faltaba.
  if (input.name && !row.name) {
    await db.prepare('UPDATE groups_chats SET name = ? WHERE id = ?').run(input.name.slice(0, 200), row.id);
    row.name = input.name.slice(0, 200);
  }
  // Un 1:1 sin nombre (lo abrió el número, o llegó sin perfil) o con el genérico del lid: el de la libreta, si lo tiene.
  if (input.kind === 'dm' && (!row.name || Object.values(LID_CHAT_NAME).includes(row.name))) {
    const key = row.phone || lidDigits(row.provider_chat_id);
    if (key) {
      const { displayName, lookupContacts } = await import('./wa-contacts');
      const known = displayName((await lookupContacts({ app: 'lines', accountId: number.id }, [key]).catch(() => new Map())).get(key));
      if (known && known !== row.name) {
        await db.prepare('UPDATE groups_chats SET name = ? WHERE id = ?').run(known.slice(0, 200), row.id);
        row.name = known.slice(0, 200);
      }
    }
  }
  // Importados del historial: no disparan flujos ni webhooks de "chat nuevo".
  if (created && !opts.silent) await emitEventSoon(number.user_id, 'groups.chat.created', { chat: chatEventInfo(row) });
  return row;
}

/** Datos del chat en los eventos (webhooks, Flow, integraciones). */
export function chatEventInfo(chat: Pick<ChatRow, 'id' | 'kind' | 'name' | 'phone' | 'provider_chat_id' | 'crm_company_id' | 'crm_contact_id'>) {
  return { id: chat.id, kind: chat.kind, name: chatDisplayName(chat), crmCompanyId: chat.crm_company_id ?? null, crmContactId: chat.crm_contact_id ?? null };
}

export interface ChatPatch {
  name?: string;
  description?: string;
  assignedTo?: string | null;
  assignedTeamId?: string | null;
  pinned?: boolean;
  /** false: marcar como no leído (queda con 1 sin leer si no tenía). */
  read?: boolean;
  status?: 'open' | 'closed';
  crmContactId?: string | null;
  crmCompanyId?: string | null;
  agentId?: string | null;
  properties?: Record<string, unknown>;
  labelIds?: string[];
  flagged?: boolean;
  /** Silenciar (sin push) o volver a avisar. */
  muted?: boolean;
  /** Archivar o desarchivar (como WhatsApp). */
  archived?: boolean;
  /** "Eliminar chat": sale de la lista hasta que llegue o salga un mensaje nuevo. */
  hidden?: boolean;
}

async function assertWorkspacePerson(ws: string, personId: string): Promise<void> {
  const { isWorkspacePerson } = await import('./crm-refs');
  if (!(await isWorkspacePerson(ws, personId))) throw new GroupsError('invalid_assignee');
}

/**
 * Cambia un chat. `actor` (la persona que lo hace, o null si es el sistema)
 * queda en el historial de asignación y cierre, y decide a quién se avisa.
 */
export async function updateChat(ws: string, id: string, patch: ChatPatch, actor: string | null = null): Promise<ChatDto> {
  const row = await getChatRow(ws, id);
  if (!row) throw new GroupsError('not_found', 404);
  const db = getDb();
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };

  // Nombre y descripción de un grupo se cambian también en WhatsApp.
  if (patch.name !== undefined || patch.description !== undefined) {
    const name = patch.name !== undefined ? patch.name.trim().slice(0, 100) : undefined;
    const description = patch.description !== undefined ? patch.description.trim().slice(0, 2000) : undefined;
    if (name !== undefined && !name) throw new GroupsError('invalid_name');
    if (row.kind === 'group') {
      const number = await getNumberRow(ws, row.number_id);
      if (!number) throw new GroupsError('not_found', 404);
      try {
        await providerFor(number).updateGroup(row.provider_chat_id, { name, description });
      } catch (err) {
        throw new GroupsError(providerErrorCode(err), 502);
      }
    }
    if (name !== undefined) set('name', name);
    if (description !== undefined) set('description', description);
  }
  if (patch.assignedTo !== undefined) {
    if (patch.assignedTo) await assertWorkspacePerson(ws, patch.assignedTo);
    set('assigned_to', patch.assignedTo || null);
  }
  if (patch.assignedTeamId !== undefined) {
    if (patch.assignedTeamId) {
      const ok = await db.prepare('SELECT 1 AS x FROM groups_teams WHERE id = ? AND user_id = ?').get(patch.assignedTeamId, ws);
      if (!ok) throw new GroupsError('invalid_team');
    }
    set('assigned_team_id', patch.assignedTeamId || null);
  }
  if (patch.pinned !== undefined) set('pinned_at', patch.pinned ? row.pinned_at || nowIso() : null);
  if (patch.status) set('status', patch.status);
  if (patch.muted !== undefined) set('muted_until', patch.muted ? '9999-12-31T00:00:00.000Z' : null);
  if (patch.archived !== undefined) set('archived_at', patch.archived ? row.archived_at || nowIso() : null);
  if (patch.hidden !== undefined) {
    set('hidden_at', patch.hidden ? nowIso() : null);
    // Oculto no queda fijado ni archivado (como "Eliminar chat" en WhatsApp).
    if (patch.hidden) {
      set('pinned_at', null);
      set('archived_at', null);
    }
  }
  if (patch.crmContactId !== undefined) {
    if (patch.crmContactId) {
      const ok = await db.prepare('SELECT 1 AS x FROM crm_contacts WHERE id = ? AND user_id = ?').get(patch.crmContactId, ws);
      if (!ok) throw new GroupsError('invalid_contact');
    }
    set('crm_contact_id', patch.crmContactId || null);
  }
  if (patch.crmCompanyId !== undefined) {
    if (patch.crmCompanyId) {
      const ok = await db.prepare('SELECT 1 AS x FROM crm_companies WHERE id = ? AND user_id = ?').get(patch.crmCompanyId, ws);
      if (!ok) throw new GroupsError('invalid_company');
    }
    set('crm_company_id', patch.crmCompanyId || null);
  }
  if (patch.agentId !== undefined) {
    if (patch.agentId) {
      const ok = await db.prepare('SELECT 1 AS x FROM agents WHERE id = ? AND user_id = ?').get(patch.agentId, ws);
      if (!ok) throw new GroupsError('invalid_agent');
    }
    set('agent_id', patch.agentId || null);
    if (patch.agentId !== row.agent_id) set('agent_conversation_id', null);
  }
  if (patch.properties !== undefined) set('properties', JSON.stringify(await cleanProperties(ws, patch.properties)));
  if (patch.read === true) {
    set('unread_count', 0);
    set('marked_unread', 0);
    // Tildes azules en WhatsApp (opcional en Ajustes > Tickets y SLA): después de responder.
    if (row.unread_count > 0) await runAfter(() => sendReadReceipts(ws, row));
  }
  if (patch.read === false && row.unread_count === 0) {
    set('unread_count', 1);
    set('marked_unread', 1);
  }
  if (patch.flagged === false) {
    set('flagged_at', null);
    set('awaiting_since', null);
  }
  if (patch.flagged === true) set('flagged_at', nowIso());
  if (sets.length) {
    await db.prepare(`UPDATE groups_chats SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`).run(...args, nowIso(), id, ws);
  }
  if (patch.labelIds !== undefined) await setChatLabels(ws, id, patch.labelIds);
  // Archivar o desarchivar también se manda a WhatsApp (después de responder, con reintentos: lib/wa-archive-sync.ts).
  // "Eliminar chat" (hidden) saca el archivado solo acá: en el teléfono el chat queda como estaba.
  if (patch.archived !== undefined && patch.hidden === undefined && patch.archived !== !!row.archived_at) {
    const { requestArchivePush } = await import('./wa-archive-sync');
    await requestArchivePush('lines', ws, [id], patch.archived);
  }
  const { afterChatChange } = await import('./groups-inbox');
  await afterChatChange(ws, actor, row, patch);
  return (await getChat(ws, id)) as ChatDto;
}

/**
 * Marca leídos en WhatsApp los últimos recibidos de un chat (lo que estaba sin
 * leer, hasta 50) si el workspace activó las tildes azules y el proveedor puede.
 */
export async function sendReadReceipts(ws: string, chat: ChatRow): Promise<void> {
  try {
    if (!(await getSettings(ws)).readReceipts) return;
    const number = await getNumberRow(ws, chat.number_id);
    if (!number) return;
    const provider = providerFor(number);
    if (!provider.markRead) return;
    const n = Math.min(50, Math.max(1, chat.unread_count));
    const rows = (await getDb()
      .prepare(
        `SELECT provider_message_id AS pid FROM groups_messages WHERE chat_id = ? AND direction = 'in' AND provider_message_id IS NOT NULL
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(chat.id, n)) as Array<{ pid: string }>;
    if (rows.length) await provider.markRead(chat.provider_chat_id, rows.map((r) => r.pid));
  } catch {
    // Best effort: si WhatsApp no lo toma, el chat igual queda leído en Groups.
  }
}

/**
 * Saca el chat de Groups (no borra el grupo en WhatsApp: no se puede). Si
 * llega un mensaje nuevo, vuelve a aparecer.
 */
export async function deleteChat(ws: string, id: string): Promise<boolean> {
  const files = await inboundUploads('m.chat_id = ? AND m.user_id = ?', [id, ws]);
  const r = await getDb().prepare('DELETE FROM groups_chats WHERE id = ? AND user_id = ?').run(id, ws);
  if (r.changes > 0) await deleteStoredFiles(files);
  return r.changes > 0;
}

// ======================================================================
// Mensajes
// ======================================================================

export interface MessageRow {
  id: string;
  user_id: string;
  chat_id: string;
  number_id: string;
  provider_message_id: string | null;
  direction: 'in' | 'out' | 'note' | 'system';
  sender_phone: string;
  sender_name: string;
  author_id: string | null;
  author_kind: string;
  body: string;
  media_url: string;
  media_type: string;
  media_name: string;
  reply_to_id: string | null;
  reactions: string;
  status: string;
  error: string;
  /** Encuesta (JSON PollInput) o ''. */
  poll?: string;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  pinned_at?: string | null;
  pinned_by?: string | null;
  forwarded?: number;
  translations?: string;
  meta?: string;
  /** Modo "preguntas": 1 pide respuesta, 0 es un comentario, null sin clasificar. */
  needs_reply?: number | null;
}

/** Traducciones cacheadas: idioma → texto ('' = ya estaba en ese idioma). `_lang` = idioma detectado. */
export type MessageTranslations = Record<string, string>;

export interface Reaction {
  emoji: string;
  by: string;
  fromMe: boolean;
  /** Cuándo (si el proveedor lo dijo): una más vieja no pisa una más nueva. */
  at?: string;
}

export interface MessageDto {
  id: string;
  chatId: string;
  direction: MessageRow['direction'];
  senderPhone: string;
  senderName: string;
  authorId: string | null;
  authorKind: string;
  body: string;
  media: MessageMediaDto | null;
  /** Ubicación compartida (lat/lng, nombre, dirección). */
  location?: LocationInfo;
  /** Tarjetas de contacto (nombre, teléfonos). */
  contacts?: ContactCard[];
  replyToId: string | null;
  reactions: Reaction[];
  status: string;
  error: string;
  createdAt: string;
  ticketId?: string | null;
  editedAt: string | null;
  /** Borrado para todos (el texto queda para el equipo). */
  deletedAt: string | null;
  pinnedAt: string | null;
  forwarded: boolean;
  translations: MessageTranslations;
  /** Llamadas (author_kind 'call'), eventos ('event') y menciones de notas. */
  meta: Record<string, unknown>;
  needsReply?: boolean | null;
  /** Encuesta con sus resultados (votos por webhook). */
  poll?: PollDto | null;
  /** Orden de llegada (solo al listar): con createdAt arma el cursor para pedir los anteriores ("<createdAt>~<seq>"). */
  seq?: number;
  /** A quién son las menciones del texto ("@<dígitos>" → nombre y teléfono, de la libreta del número). */
  mentionNames?: MentionMap;
}

/**
 * Un archivo del mensaje como lo dibuja la interfaz. `url` vacía: no hay
 * archivo para abrir (más grande que el tope, "ver una vez" o no se pudo
 * bajar); `pending`: todavía no se bajó del proveedor (abrir la URL lo baja).
 */
export interface MessageMediaDto extends Omit<MediaInfo, 'kind'> {
  url: string;
  /** Mimetype. */
  type: string;
  /** Nombre del archivo (el original en documentos). */
  name: string;
  kind: MediaKind;
  pending?: boolean;
}

interface StoredMeta {
  media?: MediaInfo;
  location?: LocationInfo;
  contacts?: ContactCard[];
  [k: string]: unknown;
}

function mediaDtoFor(row: MessageRow, stored: MediaInfo | undefined): MessageMediaDto | null {
  if (!row.media_type) return null;
  const { kind: storedKind, ...rest } = stored && typeof stored === 'object' ? stored : ({} as Partial<MediaInfo>);
  return {
    ...rest,
    url: mediaUrlFor(row),
    type: row.media_type,
    name: row.media_name,
    kind: storedKind ?? kindFromMime(row.media_type),
    ...(row.media_url.startsWith('evo:') ? { pending: true } : {}),
  };
}

/** URL de la media para el navegador: las de proveedor pasan por el proxy autenticado. */
function mediaUrlFor(row: MessageRow): string {
  if (!row.media_url) return '';
  if (row.media_url.startsWith('meta:') || row.media_url.startsWith('bridge:') || row.media_url.startsWith('evo:')) return `/api/groups/media/${row.id}`;
  return row.media_url;
}

export function toMessageDto(row: MessageRow & { ticket_id?: string | null; poll_votes?: string | null; rn?: number }): MessageDto {
  const poll = parsePoll(row.poll);
  const { media: storedMedia, location, contacts, ...meta } = parseJson<StoredMeta>(row.meta ?? '', {});
  return {
    id: row.id,
    chatId: row.chat_id,
    direction: row.direction,
    senderPhone: row.sender_phone,
    senderName: row.sender_name,
    authorId: row.author_id,
    authorKind: row.author_kind,
    body: row.body,
    media: mediaDtoFor(row, storedMedia),
    ...(location ? { location } : {}),
    ...(Array.isArray(contacts) && contacts.length ? { contacts } : {}),
    replyToId: row.reply_to_id,
    reactions: parseJson<Reaction[]>(row.reactions, []),
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    ticketId: row.ticket_id ?? null,
    editedAt: row.edited_at ?? null,
    deletedAt: row.deleted_at ?? null,
    pinnedAt: row.pinned_at ?? null,
    forwarded: Boolean(row.forwarded),
    translations: parseJson<MessageTranslations>(row.translations, {}),
    meta,
    needsReply: row.needs_reply == null ? null : Boolean(row.needs_reply),
    ...(poll ? { poll: tallyPoll(poll, parseJson<string[]>(row.poll_votes, []).map((v) => parseJson<string[]>(v, []))) } : {}),
    ...(typeof row.rn === 'number' ? { seq: row.rn } : {}),
  };
}

export async function listMessages(
  ws: string,
  chatId: string,
  opts: { after?: string; before?: string; limit?: number } = {},
): Promise<MessageDto[]> {
  const limit = Math.min(Math.max(1, opts.limit ?? 200), 500);
  // `before`: los anteriores (cargar más al subir en el hilo). Con "<createdAt>~<seq>" el corte es exacto: los
  // mensajes de la misma hora que el más viejo no se saltean. Con una fecha sola, los estrictamente anteriores.
  const [beforeAt, beforeSeq] = (opts.before ?? '').split('~');
  const seq = beforeSeq && /^\d{1,15}$/.test(beforeSeq) ? Number(beforeSeq) : null;
  const where = ['m.chat_id = ?', 'm.user_id = ?'];
  const args: Array<string | number> = [chatId, ws];
  if (opts.after) {
    where.push('m.created_at > ?');
    args.push(opts.after);
  }
  if (beforeAt && seq !== null) {
    where.push('m.created_at <= ?', '(m.created_at < ? OR m.rowid < ?)');
    args.push(beforeAt, beforeAt, seq);
  } else if (beforeAt) {
    where.push('m.created_at < ?');
    args.push(beforeAt);
  }
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM (
         SELECT m.*, m.rowid AS rn, (SELECT t.id FROM groups_tickets t WHERE t.message_id = m.id) AS ticket_id,
           CASE WHEN m.poll != '' THEN (SELECT json_group_array(v.options) FROM groups_poll_votes v WHERE v.message_id = m.id) END AS poll_votes
         FROM groups_messages m WHERE ${where.join(' AND ')}
         ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?
       ) ORDER BY created_at ASC, rn ASC`,
    )
    .all(...args, limit)) as Array<MessageRow & { ticket_id: string | null; rn: number }>;
  const out = rows.map(toMessageDto);
  // "@<dígitos>" → "@Nombre" con la libreta del número (los mensajes de un chat son de un solo número).
  if (rows.length) await withLinesMentions(rows[0].number_id, out, rows[0].chat_id).catch(() => null);
  return out;
}

export async function getMessageRow(ws: string, id: string): Promise<MessageRow | null> {
  return ((await getDb().prepare('SELECT * FROM groups_messages WHERE id = ? AND user_id = ?').get(id, ws)) as MessageRow) ?? null;
}

/**
 * Vista previa de la lista: el texto, o el nombre del archivo, o un marcador
 * neutro ([image], [audio], [video], [file]) que la interfaz traduce.
 */
export function previewOf(body: string, mediaType: string, mediaName = '', meta: StoredMeta = {}): string {
  const text = body.replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 140);
  if (meta.media?.viewOnce) return '[viewOnce]';
  if (meta.media?.kind === 'voice' || meta.media?.ptt) return '[voice]';
  if (meta.media?.kind === 'sticker') return '[sticker]';
  if (mediaName.trim()) return mediaName.trim().slice(0, 140);
  if (mediaType) return `[${mediaKind(mediaType)}]`;
  if (meta.location) return '[location]';
  if (meta.contacts?.length) return '[contact]';
  return '';
}

/** Vista previa de una fila guardada (con los datos de media del meta). */
function previewOfRow(row: Pick<MessageRow, 'body' | 'media_type' | 'media_name' | 'meta'>): string {
  return previewOf(row.body, row.media_type, row.media_name, parseJson<StoredMeta>(row.meta ?? '', {}));
}

export interface InsertMessage {
  ws: string;
  chatId: string;
  numberId: string;
  providerMessageId: string | null;
  direction: MessageRow['direction'];
  senderPhone?: string;
  senderName?: string;
  authorId?: string | null;
  authorKind?: string;
  body: string;
  media?: { url: string; type: string; name: string } | null;
  replyToId?: string | null;
  status: string;
  error?: string;
  createdAt?: string;
  forwarded?: boolean;
  meta?: Record<string, unknown>;
  poll?: PollInput | null;
  /** Id que puso la pantalla al mandar (único por chat): un reintento del mismo envío devuelve este mensaje. */
  clientId?: string | null;
}

const MESSAGE_COLS = `id, user_id, chat_id, number_id, provider_message_id, direction, sender_phone, sender_name,
         author_id, author_kind, body, media_url, media_type, media_name, reply_to_id, status, error, created_at, forwarded, meta, poll, client_id`;

/** Los valores de un mensaje nuevo, en el orden de MESSAGE_COLS menos chat_id y reply_to_id (que pueden salir de una subconsulta). */
function messageValues(id: string, m: Omit<InsertMessage, 'chatId' | 'replyToId'>) {
  return {
    head: [id, m.ws] as Array<string | number | null>,
    mid: [
      m.numberId,
      m.providerMessageId,
      m.direction,
      m.senderPhone ?? '',
      (m.senderName ?? '').slice(0, 120),
      m.authorId ?? null,
      m.authorKind ?? 'person',
      m.body.slice(0, 8000),
      m.media?.url ?? '',
      m.media?.type ?? '',
      (m.media?.name ?? '').slice(0, 200),
    ] as Array<string | number | null>,
    tail: [m.status, m.error ?? '', m.createdAt ?? nowIso(), m.forwarded ? 1 : 0, JSON.stringify(m.meta ?? {}), m.poll ? JSON.stringify(m.poll) : '', m.clientId ?? null] as Array<string | number | null>,
  };
}

/** El INSERT de un mensaje (devuelve la fila; ninguna si ya existía ese id del proveedor en el número). */
function messageInsert(id: string, m: InsertMessage): BatchStatement {
  const v = messageValues(id, m);
  return {
    sql: `INSERT OR IGNORE INTO groups_messages (${MESSAGE_COLS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    args: [...v.head, m.chatId, ...v.mid, m.replyToId ?? null, ...v.tail],
  };
}

/** El mensaje que se mandó a este chat con este clientId, si ya está guardado (índice único por chat y clientId). */
export async function messageByClientId(chatId: string, clientId: string): Promise<MessageRow | null> {
  return ((await getDb().prepare('SELECT * FROM groups_messages WHERE chat_id = ? AND client_id = ?').get(chatId, clientId)) as MessageRow | undefined) ?? null;
}

/** Inserta un mensaje. null si ya existía (mismo id del proveedor en el número). Una sola ida a la base. */
export async function insertMessage(m: InsertMessage): Promise<MessageRow | null> {
  const stmt = messageInsert(newId(), m);
  const row = (await getDb()
    .prepare(stmt.sql)
    .get(...stmt.args)) as MessageRow | undefined;
  return row ?? null;
}

/** Después de responder: el chat deja de esperar y los tickets abiertos toman su primera respuesta. */
export async function markAnswered(chatId: string, at: string): Promise<void> {
  await dbBatch(answeredStatements(chatId, at));
}

function answeredStatements(chatId: string, at: string): BatchStatement[] {
  return [
    { sql: 'UPDATE groups_chats SET awaiting_since = NULL, flagged_at = NULL, updated_at = ? WHERE id = ?', args: [at, chatId] },
    {
      sql: "UPDATE groups_tickets SET first_response_at = ?, updated_at = ? WHERE chat_id = ? AND first_response_at IS NULL AND status IN ('open', 'in_progress')",
      args: [at, at, chatId],
    },
  ];
}

/** Lo que un mensaje nuevo le cambia a su chat en la lista (`where` elige el chat). */
function chatTouch(at: string, preview: string, incoming: boolean, where: string, whereArgs: string[]): BatchStatement {
  return incoming
    ? {
        sql: `UPDATE groups_chats SET last_message_at = ?, last_message_preview = ?, unread_count = unread_count + 1 - COALESCE(marked_unread, 0), marked_unread = 0,
           awaiting_since = COALESCE(awaiting_since, ?), status = 'open', hidden_at = NULL, presence = NULL, updated_at = ? WHERE ${where}`,
        args: [at, preview, at, at, ...whereArgs],
      }
    : {
        sql: `UPDATE groups_chats SET last_message_at = ?, last_message_preview = ?, hidden_at = NULL, updated_at = ? WHERE ${where}`,
        args: [at, preview, at, ...whereArgs],
      };
}

export async function touchChat(chatId: string, at: string, preview: string, incoming: boolean): Promise<void> {
  const stmt = chatTouch(at, preview, incoming, 'id = ?', [chatId]);
  await getDb()
    .prepare(stmt.sql)
    .run(...stmt.args);
}

/**
 * Un mensaje que llega por webhook, en una sola ida a la base: el chat (se
 * crea si no estaba), el mensaje y lo que le cambia al chat en la lista (que
 * es lo que avisa a las pantallas abiertas). Todo o nada. Un mensaje repetido
 * (mismo id del proveedor) no toca el chat. `withSettings` trae en la misma
 * ida los ajustes del workspace.
 */
async function saveInbound(
  number: Pick<NumberRow, 'id' | 'user_id'>,
  chat: ChatInput,
  m: Omit<InsertMessage, 'chatId' | 'replyToId'> & { replyToProviderId?: string },
  preview: string,
  withSettings: boolean,
): Promise<{ chat: ChatRow; created: boolean; row: MessageRow | null; settings: GroupsSettings | null }> {
  const id = newId();
  const v = messageValues(id, m);
  const at = m.createdAt ?? nowIso();
  const stmts: BatchStatement[] = [
    chatInsert(number, chat),
    { sql: 'SELECT * FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', args: [number.id, chat.providerChatId] },
    {
      sql: `INSERT OR IGNORE INTO groups_messages (${MESSAGE_COLS})
       VALUES (?, ?, (SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ${m.replyToProviderId ? '(SELECT id FROM groups_messages WHERE number_id = ? AND provider_message_id = ?)' : 'NULL'}, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [...v.head, number.id, chat.providerChatId, ...v.mid, ...(m.replyToProviderId ? [number.id, m.replyToProviderId] : []), ...v.tail],
    },
    // Solo si el mensaje entró: uno repetido no existe con este id.
    chatTouch(at, preview, m.direction === 'in', 'id = (SELECT chat_id FROM groups_messages WHERE id = ?)', [id]),
  ];
  if (withSettings) stmts.push({ sql: 'SELECT data FROM groups_settings WHERE user_id = ?', args: [number.user_id] });
  const res = await dbBatch(stmts);
  const data = withSettings ? (res[4].rows[0] as { data: string } | undefined) : undefined;
  return {
    chat: res[1].rows[0] as unknown as ChatRow,
    created: res[0].changes > 0,
    row: (res[2].rows[0] as unknown as MessageRow | undefined) ?? null,
    settings: withSettings ? (data ? normalizeSettings(parseJson(data.data, {})) : { ...DEFAULT_SETTINGS }) : null,
  };
}

/**
 * Tras editar o borrar un mensaje (desde Groups o desde el teléfono): si era
 * el último del chat, la vista previa de la lista pasa a mostrar el texto
 * nuevo o el marcador [deleted]. No toca la hora ni los no leídos.
 */
export async function refreshChatPreview(messageId: string): Promise<void> {
  const db = getDb();
  const msg = (await db.prepare('SELECT * FROM groups_messages WHERE id = ?').get(messageId)) as MessageRow | undefined;
  if (!msg || (msg.direction !== 'in' && msg.direction !== 'out')) return;
  const last = (await db
    .prepare("SELECT id FROM groups_messages WHERE chat_id = ? AND direction IN ('in', 'out') ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(msg.chat_id)) as { id: string } | undefined;
  if (last?.id !== msg.id) return;
  const preview = msg.deleted_at ? '[deleted]' : previewOfRow(msg);
  await db.prepare('UPDATE groups_chats SET last_message_preview = ? WHERE id = ?').run(preview, msg.chat_id);
}

/**
 * Archivo a mandar: subido a zerosoft (/uploads/... o Blob) o una URL https.
 * `kind` pide el tipo de mensaje ("voice" para nota de voz, "sticker",
 * "document" para mandar como archivo); sin él, sale del mimetype.
 */
export interface SendMedia {
  url: string;
  mimetype: string;
  filename: string;
  size?: number;
  kind?: MediaKind | null;
  width?: number;
  height?: number;
  duration?: number;
}

export interface SendInput {
  body: string;
  replyToId?: string | null;
  media?: SendMedia | null;
  note?: boolean;
  authorKind?: 'person' | 'agent' | 'broadcast' | 'scheduled' | 'flow' | 'api';
  /** Reenvío por copia (el proveedor no reenvía nativo). */
  forwarded?: boolean;
  /** Encuesta nativa (WAHA y Evolution; la Cloud API de Meta no tiene). */
  poll?: PollInput | null;
  /** Tarjetas de contacto (vCard) para mandar. */
  contacts?: Array<{ name: string; phone: string }> | null;
  /** Id que puso la pantalla al mandar: vuelve en meta.cid y reemplaza su burbuja provisoria (lib/optimistic-send.ts). */
  clientId?: string;
  /** Grupos: teléfonos mencionados como "@<teléfono>" en el texto (WhatsApp avisa a esas personas). */
  mentions?: string[] | null;
}

/**
 * Menciones a mandar: teléfonos que de verdad aparecen como "@<teléfono>" en
 * el texto, sin repetir y hasta 50. Solo en grupos: en un 1 a 1 no hay a
 * quién mencionar.
 */
export function cleanMentions(raw: unknown, body: string, kind: 'dm' | 'group' | string): string[] {
  if (kind !== 'group' || !Array.isArray(raw) || !body.includes('@')) return [];
  const out: string[] = [];
  for (const m of raw) {
    if (typeof m !== 'string' || !/^\d{6,16}$/.test(m) || out.includes(m)) continue;
    if (!new RegExp(`(^|[^\\w@])@${m}(?!\\d)`).test(body)) continue;
    out.push(m);
    if (out.length >= 50) break;
  }
  return out;
}

/** Tope de envíos por número: WhatsApp bloquea líneas que mandan en ráfaga. Los envíos masivos llevan su propio ritmo. */
export const SEND_RATE = { limit: 40, windowSec: 60 };

export async function sendGate(numberId: string, authorKind?: string): Promise<void> {
  if (authorKind === 'broadcast' || process.env.RATE_LIMIT_DISABLED === 'true') return;
  const { rateLimit } = await import('./rate-limit');
  const r = await rateLimit(`groups-send:${numberId}`, SEND_RATE.limit, SEND_RATE.windowSec);
  if (!r.ok) throw new GroupsError('send_rate_limited', 429);
}

/** Contactos a mandar → válidos (nombre corto y teléfono con dígitos suficientes), hasta 10. */
export function cleanContacts(raw: unknown): Array<{ name: string; phone: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; phone: string }> = [];
  for (const c of raw.slice(0, 10)) {
    const o = (c ?? {}) as Record<string, unknown>;
    const phone = phoneDigits(String(o.phone ?? ''));
    if (!isValidPhone(phone)) continue;
    out.push({ name: String(o.name ?? '').trim().slice(0, 100), phone });
  }
  return out;
}

/**
 * `known`: lo que quien llama ya leyó (la ruta del composer lee el chat y la línea junto con el chequeo de acceso,
 * en vez de una ida a la base por cada cosa) y si ya pasó el tope de envíos de la línea.
 */
export async function sendMessage(
  ws: string,
  actor: string | null,
  chatId: string,
  input: SendInput,
  known: { chat?: ChatRow | null; number?: NumberRow | null; gated?: boolean; existing?: MessageRow | null } = {},
): Promise<MessageDto> {
  const chat = known.chat !== undefined ? known.chat : await getChatRow(ws, chatId);
  if (!chat || chat.id !== chatId || chat.user_id !== ws) throw new GroupsError('not_found', 404);
  // El mismo envío otra vez (se perdió la respuesta y la pantalla reintenta con el mismo clientId): es el que ya está
  // guardado. No sale dos veces a WhatsApp.
  const existing = known.existing !== undefined ? known.existing : input.clientId ? await messageByClientId(chatId, input.clientId) : null;
  if (existing && existing.chat_id === chatId) return toMessageDto(existing);
  const poll = input.poll ?? null;
  const contacts = input.contacts ? cleanContacts(input.contacts) : [];
  if (input.contacts && contacts.length === 0) throw new GroupsError('invalid_contact_card');
  const body = poll ? poll.question : contacts.length ? '' : (input.body ?? '').slice(0, 4096);
  if (!body.trim() && !input.media && !contacts.length) throw new GroupsError('empty_message');
  if ((poll || contacts.length) && input.note) throw new GroupsError('invalid_poll');

  if (input.note) {
    const row = await insertMessage({
      ws,
      chatId,
      numberId: chat.number_id,
      providerMessageId: null,
      direction: 'note',
      authorId: actor,
      body,
      status: 'sent',
    });
    const { afterNoteSaved } = await import('./groups-inbox');
    const saved = await afterNoteSaved(ws, actor, chat, row as MessageRow, '');
    return toMessageDto(saved);
  }

  const number = known.number !== undefined && known.number?.id === chat.number_id ? known.number : await getNumberRow(ws, chat.number_id);
  if (!number || number.user_id !== ws) throw new GroupsError('not_found', 404);
  let replyProviderId: string | undefined;
  if (input.replyToId) {
    const target = await getMessageRow(ws, input.replyToId);
    if (!target || target.chat_id !== chatId) throw new GroupsError('invalid_reply');
    replyProviderId = target.provider_message_id ?? undefined;
  }
  const provider = providerFor(number);
  if (poll && (!provider.caps.polls || !provider.sendPoll)) throw new GroupsError('polls_unsupported');
  if (contacts.length && !provider.sendContact) throw new GroupsError('contacts_unsupported');
  if (!known.gated) await sendGate(number.id, input.authorKind);
  if (input.media && !poll && !contacts.length) return sendMediaMessage(ws, actor, chat, provider, input, body, replyProviderId);
  let providerId: string | null = null;
  let status = 'sent';
  let error = '';
  const mentions = poll || contacts.length ? [] : cleanMentions(input.mentions, body, chat.kind);
  try {
    const res = poll
      ? await provider.sendPoll!(chat.provider_chat_id, poll)
      : contacts.length
        ? await provider.sendContact!(chat.provider_chat_id, contacts)
        : await provider.sendText(chat.provider_chat_id, body, { replyTo: replyProviderId, ...(mentions.length ? { mentions } : {}) });
    providerId = res.id || null;
  } catch (err) {
    status = 'failed';
    error = providerErrorCode(err);
  }
  const at = nowIso();
  const meta: Record<string, unknown> = {
    ...(contacts.length ? { contacts: contacts.map((c) => ({ name: c.name || `+${c.phone}`, phones: [c.phone] })) } : {}),
    ...(input.clientId ? { cid: input.clientId } : {}),
    // Como las que llegan (contextInfo.mentionedJid): el hilo muestra "@Nombre" y los reintentos vuelven a mencionar.
    ...(mentions.length ? { mentions } : {}),
  };
  const preview = poll ? pollPreview(poll) : contacts.length ? '[contact]' : previewOf(body, input.media?.mimetype ?? '', input.media?.filename ?? '');
  // Una sola ida a la base: el mensaje, el chat al tope de la lista y, si salió, el chat deja de esperar.
  const stmts: BatchStatement[] = [
    messageInsert(newId(), {
      ws,
      chatId,
      numberId: chat.number_id,
      providerMessageId: providerId,
      direction: 'out',
      authorId: actor,
      authorKind: input.authorKind ?? 'person',
      body,
      replyToId: input.replyToId ?? null,
      status,
      error,
      createdAt: at,
      forwarded: input.forwarded,
      poll,
      clientId: input.clientId || null,
      ...(Object.keys(meta).length ? { meta } : {}),
    }),
    // Si el eco del webhook (el mismo id del proveedor) llegó antes, ya guardó este mensaje como mandado "desde el
    // teléfono" y el INSERT de arriba no entró: esa fila pasa a ser de quien lo mandó desde acá (autor y clientId).
    // Si el INSERT entró, la fila no es 'phone' y esto no toca nada.
    ...(providerId
      ? [
          {
            sql: `UPDATE groups_messages SET author_id = ?, author_kind = ?, client_id = COALESCE(client_id, ?),
                    meta = CASE WHEN ? = '' THEN meta ELSE json_set(CASE WHEN json_valid(meta) THEN meta ELSE '{}' END, '$.cid', ?) END
                  WHERE number_id = ? AND provider_message_id = ? AND direction = 'out' AND author_kind = 'phone' RETURNING *`,
            args: [actor, input.authorKind ?? 'person', input.clientId || null, input.clientId ?? '', input.clientId ?? '', chat.number_id, providerId],
          },
        ]
      : []),
    chatTouch(at, preview, false, 'id = ?', [chatId]),
    // Un envío masivo no es una respuesta: el chat sigue esperando y el ticket sin primera respuesta.
    ...(status === 'sent' && input.authorKind !== 'broadcast' ? answeredStatements(chatId, at) : []),
  ];
  const res = await dbBatch(stmts);
  const inserted = (res[0].rows[0] as unknown as MessageRow | undefined) ?? null;
  // Ganó el eco: la fila es la que guardó el webhook, ya con su autor (y él ya emitió el evento de "enviado").
  const row = inserted ?? (providerId ? ((res[1].rows[0] as unknown as MessageRow | undefined) ?? null) : null);
  if (!row) throw new GroupsError('send_failed', 502);
  // Quien tenga el chat abierto en esta instancia (otra pestaña, otra persona) lo ve ya.
  pokeLive('lines', ws);
  if (status === 'sent' && inserted) {
    await emitEventSoon(ws, 'groups.message.sent', {
      message: { id: row.id, body: row.body, authorId: actor, authorKind: input.authorKind ?? 'person', status, createdAt: at, ...(poll ? { poll } : {}) },
      chat: chatEventInfo(chat),
    });
  }
  return toMessageDto(row);
}

/**
 * Una subida local (/uploads/chat/... de este mismo servidor, sin Blob): el
 * proveedor no la puede bajar por URL (localhost, o detrás de la sesión), así
 * que se lee del disco y se manda en base64. null si no es una subida local.
 */
async function localChatUpload(url: string): Promise<{ path: string; size: number } | null> {
  let pathname = url;
  if (!url.startsWith('/')) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    let own = '';
    try {
      own = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).host : '';
    } catch {
      own = '';
    }
    if (u.host !== own && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(u.host)) return null;
    pathname = u.pathname;
  }
  const { localUploadPath } = await import('./uploads');
  const file = localUploadPath(pathname, 'chat');
  if (!file) return null;
  const { stat } = await import('fs/promises');
  const st = await stat(file).catch(() => null);
  return st?.isFile() ? { path: file, size: st.size } : null;
}

const posNum = (v: unknown, max: number): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n) : undefined;
};

/** Tipos de mensaje que WhatsApp muestra con texto abajo; en los demás el texto sale aparte. */
const CAPTIONED: ReadonlySet<MediaKind> = new Set<MediaKind>(['image', 'video', 'document']);

/**
 * Manda un archivo. El mensaje se guarda antes de mandarlo (con la URL, el
 * tipo, el nombre, el tamaño y el mimetype) para que el chat lo muestre ya
 * (status "pending"); después toma el id del proveedor y el estado (sent o
 * failed; las tildes llegan por webhook). Si el tipo no lleva texto (audio,
 * nota de voz, sticker), el texto sale como un mensaje aparte.
 */
async function sendMediaMessage(
  ws: string,
  actor: string | null,
  chat: ChatRow,
  provider: GroupsProvider,
  input: SendInput,
  body: string,
  replyProviderId: string | undefined,
): Promise<MessageDto> {
  const media = input.media!;
  const bridged = provider.kind === 'evolution' || provider.kind === 'managed';
  const local = bridged ? await localChatUpload(media.url) : null;
  const size = local?.size ?? posNum(media.size, 2 ** 40);
  let kind: MediaKind;
  try {
    kind = planOutboundKind(media.mimetype, size, media.kind ?? null);
  } catch (err) {
    if (err instanceof MediaPlanError) throw new GroupsError(err.code, err.code === 'media_too_large' ? 413 : 400);
    throw err;
  }
  const captioned = CAPTIONED.has(kind);
  const caption = captioned ? body : '';
  const visual = kind === 'image' || kind === 'video' || kind === 'sticker';
  const info = compactInfo<MediaInfo>({
    kind,
    size,
    mimetype: baseMime(media.mimetype) || undefined,
    width: visual ? posNum(media.width, 20_000) : undefined,
    height: visual ? posNum(media.height, 20_000) : undefined,
    duration: kind === 'audio' || kind === 'voice' || kind === 'video' ? posNum(media.duration, 86_400) : undefined,
    ptt: kind === 'voice' || undefined,
  });
  const authorKind = input.authorKind ?? 'person';
  const at = nowIso();
  // La fila se guarda antes de mandar ("enviando"), con el clientId: si otro pedido con el mismo clientId ya la
  // guardó (un reintento, aun desde otra instancia), el INSERT no entra y no se manda el archivo otra vez.
  const reserved = await insertMessage({
    ws,
    chatId: chat.id,
    numberId: chat.number_id,
    providerMessageId: null,
    direction: 'out',
    authorId: actor,
    authorKind,
    body: caption,
    media: { url: media.url, type: media.mimetype, name: media.filename },
    replyToId: input.replyToId ?? null,
    status: 'pending',
    createdAt: at,
    forwarded: input.forwarded,
    clientId: input.clientId || null,
    meta: { media: info, ...(input.clientId ? { cid: input.clientId } : {}) },
  });
  if (!reserved) {
    const already = input.clientId ? await messageByClientId(chat.id, input.clientId) : null;
    if (already) return toMessageDto(already);
    throw new GroupsError('send_failed', 502);
  }
  const row = reserved;

  let providerId: string | null = null;
  let status = 'sent';
  let error = '';
  try {
    const base64 = local ? (await (await import('fs/promises')).readFile(local.path)).toString('base64') : undefined;
    const res = await provider.sendMedia(chat.provider_chat_id, {
      url: media.url,
      mimetype: media.mimetype,
      filename: media.filename,
      caption,
      kind,
      ...(base64 ? { base64 } : {}),
      ...(replyProviderId ? { replyTo: replyProviderId } : {}),
    });
    providerId = res.id || null;
  } catch (err) {
    status = 'failed';
    error = providerErrorCode(err);
  }
  await settleOutgoing(row.id, chat.number_id, providerId, status, error);
  const saved = ((await getDb().prepare('SELECT * FROM groups_messages WHERE id = ?').get(row.id)) as MessageRow | undefined) ?? row;
  if (status === 'failed') await touchChat(chat.id, at, previewOfRow(saved), false);
  if (status === 'sent') {
    await touchChat(chat.id, at, previewOfRow(saved), false);
    // Un envío masivo no es una respuesta: el chat sigue esperando.
    if (authorKind !== 'broadcast') await markAnswered(chat.id, at);
    await emitEventSoon(ws, 'groups.message.sent', {
      message: {
        id: saved.id,
        body: saved.body,
        authorId: actor,
        authorKind,
        status,
        createdAt: at,
        media: { url: media.url, type: media.mimetype, name: media.filename, kind },
      },
      chat: chatEventInfo(chat),
    });
    // Audio, nota de voz y sticker no llevan texto en WhatsApp: va aparte, después del archivo.
    if (!captioned && body.trim()) {
      await sendMessage(ws, actor, chat.id, { body, authorKind, forwarded: input.forwarded }).catch(() => null);
    }
  }
  return toMessageDto(saved);
}

/**
 * Vuelve a mandar un mensaje propio que no salió, en la misma fila (no crea
 * otra burbuja): pasa a "pending" y después a sent o failed.
 */
export async function retryMessage(ws: string, actor: string | null, messageId: string, isAdmin = false): Promise<MessageDto> {
  const row = await getMessageRow(ws, messageId);
  if (!row || row.direction !== 'out') throw new GroupsError('not_found', 404);
  if (!isAdmin && row.author_id !== actor) throw new GroupsError('forbidden', 403);
  if (row.status !== 'failed') return toMessageDto(row);
  const chat = await getChatRow(ws, row.chat_id);
  const number = chat ? await getNumberRow(ws, chat.number_id) : null;
  if (!chat || !number) throw new GroupsError('not_found', 404);
  await sendGate(number.id);
  // Claim: si dos clics llegan juntos, solo uno reintenta.
  const claimed = await getDb().prepare("UPDATE groups_messages SET status = 'pending', error = '' WHERE id = ? AND status = 'failed'").run(row.id);
  if (claimed.changes === 0) return toMessageDto((await getMessageRow(ws, row.id)) as MessageRow);
  const provider = providerFor(number);
  let replyProviderId: string | undefined;
  if (row.reply_to_id) replyProviderId = (await getMessageRow(ws, row.reply_to_id))?.provider_message_id ?? undefined;
  let providerId: string | null = null;
  let status = 'sent';
  let error = '';
  try {
    const poll = parsePoll(row.poll);
    const cards = parseJson<StoredMeta>(row.meta ?? '', {}).contacts ?? [];
    if (poll && provider.sendPoll) providerId = (await provider.sendPoll(chat.provider_chat_id, poll)).id || null;
    else if (cards.length && provider.sendContact) {
      providerId = (await provider.sendContact(chat.provider_chat_id, cards.map((c) => ({ name: c.name, phone: c.phones[0] ?? '' })))).id || null;
    } else if (row.media_url) {
      const stored = parseJson<StoredMeta>(row.meta ?? '', {}).media;
      const bridged = provider.kind === 'evolution' || provider.kind === 'managed';
      const local = bridged ? await localChatUpload(row.media_url) : null;
      const base64 = local ? (await (await import('fs/promises')).readFile(local.path)).toString('base64') : undefined;
      const kind = stored?.kind ?? planOutboundKind(row.media_type, local?.size ?? stored?.size, null);
      providerId =
        (
          await provider.sendMedia(chat.provider_chat_id, {
            url: row.media_url,
            mimetype: row.media_type,
            filename: row.media_name,
            caption: row.body,
            kind,
            ...(base64 ? { base64 } : {}),
            ...(replyProviderId ? { replyTo: replyProviderId } : {}),
          })
        ).id || null;
    } else {
      const mentions = cleanMentions(parseJson<StoredMeta>(row.meta ?? '', {}).mentions, row.body, chat.kind);
      providerId = (await provider.sendText(chat.provider_chat_id, row.body, { replyTo: replyProviderId, ...(mentions.length ? { mentions } : {}) })).id || null;
    }
  } catch (err) {
    status = 'failed';
    error = providerErrorCode(err);
  }
  await settleOutgoing(row.id, chat.number_id, providerId, status, error);
  const saved = (await getMessageRow(ws, row.id)) as MessageRow;
  if (status === 'sent') {
    const at = nowIso();
    await touchChat(chat.id, at, previewOfRow(saved), false);
    await markAnswered(chat.id, at);
    await emitEventSoon(ws, 'groups.message.sent', {
      message: { id: saved.id, body: saved.body, authorId: actor, authorKind: saved.author_kind, status, createdAt: saved.created_at },
      chat: chatEventInfo(chat),
    });
  }
  return toMessageDto(saved);
}

/**
 * Guarda el id del proveedor y el estado de un mensaje que mandamos. Si el eco
 * del webhook llegó a guardarse antes con ese id, se queda la fila nuestra.
 */
async function settleOutgoing(rowId: string, numberId: string, providerId: string | null, status: string, error: string): Promise<void> {
  const db = getDb();
  const run = () =>
    db.prepare('UPDATE groups_messages SET provider_message_id = ?, status = ?, error = ? WHERE id = ?').run(providerId, status, error, rowId);
  try {
    await run();
  } catch {
    await db.prepare('DELETE FROM groups_messages WHERE number_id = ? AND provider_message_id = ? AND id != ?').run(numberId, providerId, rowId);
    await run();
  }
}

export async function reactToMessage(ws: string, actor: string, messageId: string, emoji: string): Promise<MessageDto> {
  const msg = await getMessageRow(ws, messageId);
  if (!msg || msg.direction === 'note' || msg.direction === 'system') throw new GroupsError('not_found', 404);
  if (!msg.provider_message_id) throw new GroupsError('not_sent');
  const chat = await getChatRow(ws, msg.chat_id);
  const number = chat ? await getNumberRow(ws, chat.number_id) : null;
  if (!chat || !number) throw new GroupsError('not_found', 404);
  const clean = String(emoji ?? '').trim().slice(0, 16);
  try {
    await providerFor(number).react(chat.provider_chat_id, msg.provider_message_id, clean, msg.direction === 'out');
  } catch (err) {
    throw new GroupsError(providerErrorCode(err), 502);
  }
  await applyReaction(msg, { emoji: clean, by: actor, fromMe: true });
  if (clean) await maybeTicketFromReaction(ws, msg, clean, actor);
  return toMessageDto((await getMessageRow(ws, messageId)) as MessageRow);
}

/** Aplica una reacción. false si no cambió nada: la misma otra vez, o una más vieja que la que ya hay de esa persona. */
export async function applyReaction(msg: MessageRow, r: Reaction): Promise<boolean> {
  const current = parseJson<Reaction[]>(msg.reactions, []);
  const prev = current.find((x) => x.by === r.by);
  if (prev && r.at && prev.at && prev.at > r.at) return false;
  // La misma reacción otra vez, o sacar una que no está.
  if ((prev?.emoji ?? '') === r.emoji) return false;
  const list = current.filter((x) => x.by !== r.by);
  if (r.emoji) list.push(r);
  await getDb().prepare('UPDATE groups_messages SET reactions = ? WHERE id = ?').run(JSON.stringify(list.slice(-50)), msg.id);
  return true;
}

async function maybeTicketFromReaction(ws: string, msg: MessageRow, emoji: string, actor: string | null): Promise<void> {
  const settings = await getSettings(ws);
  if (!reactionCreatesTicket(settings, emoji)) return;
  const { createTicket } = await import('./groups-tickets');
  await createTicket(ws, actor, { chatId: msg.chat_id, messageId: msg.id, source: 'reaction' }).catch(() => null);
}

// ======================================================================
// Webhook: eventos del proveedor
// ======================================================================

const LID_CHAT_NAME: Record<string, string> = { es: 'Contacto de WhatsApp', en: 'WhatsApp contact', pt: 'Contato do WhatsApp' };

export async function lidChatName(ws: string): Promise<string> {
  const row = (await getDb().prepare('SELECT locale FROM users WHERE id = ?').get(ws)) as { locale?: string | null } | undefined;
  return LID_CHAT_NAME[String(row?.locale ?? '').slice(0, 2)] ?? LID_CHAT_NAME.es;
}

/** Datos del archivo, la ubicación y los contactos de un mensaje recibido (van en meta). */
export function inboundMeta(ev: Extract<InboundEvent, { type: 'message' }>): StoredMeta | undefined {
  const meta: StoredMeta = {};
  if (ev.media?.info) meta.media = compactInfo(ev.media.info);
  if (ev.location) meta.location = ev.location;
  if (ev.contacts?.length) meta.contacts = ev.contacts.slice(0, 20);
  // A quién menciona (teléfono o "<lid>@lid"): con eso "@<dígitos>" se muestra con el nombre.
  const mentions = (ev.mentions ?? []).filter((m) => typeof m === 'string' && /^\d{5,20}(@lid)?$/.test(m)).slice(0, 50);
  if (mentions.length) meta.mentions = mentions;
  return Object.keys(meta).length ? meta : undefined;
}

/** Archivos recibidos que se bajan por webhook: de a uno y con un total por webhook. */
export const INBOUND_MEDIA_PER_WEBHOOK = 10;
export const INBOUND_MEDIA_BUDGET = 25 * 1024 * 1024;

/** Corre el trabajo después de la respuesta (next/server after); fuera de un request, acá mismo. */
async function runAfter(job: () => Promise<unknown>): Promise<void> {
  try {
    after(() => job().catch(logAfterError));
  } catch {
    await job().catch(logAfterError);
  }
}

/** Lo que corre después de responder no puede fallar en silencio: queda el nombre del error (nunca el contenido). */
function logAfterError(err: unknown): null {
  // eslint-disable-next-line no-console
  console.error('[groups] after-response job failed', (err as Error)?.name ?? 'error');
  return null;
}

/** Los archivos de un webhook, en orden, hasta el tope de cantidad y de bytes. */
async function storeInboundBatch(number: NumberRow, items: Array<{ messageId: string; ref: MediaRef }>): Promise<void> {
  let budget = INBOUND_MEDIA_BUDGET;
  for (const it of items.slice(0, INBOUND_MEDIA_PER_WEBHOOK)) {
    if (budget <= 0) break;
    const res = await storeInboundMedia(number, it.messageId, it.ref, { budget, retry: true }).catch(() => null);
    if (res) budget -= res.bytes;
  }
}

/** Fallas que no se arreglan reintentando: tipo no permitido, más grande que el tope, el gateway no lo tiene. */
function permanentMediaError(err: unknown): boolean {
  if (err instanceof ProviderError) return err.code === 'not_found' || err.httpStatus === 413 || err.httpStatus === 400;
  const code = (err as { code?: string })?.code;
  return code === 'file_type_not_allowed';
}

/**
 * Baja un archivo recibido por el gateway (Evolution) y lo guarda en nuestro
 * storage, como los adjuntos que se mandan. Respeta el tope de tamaño (y el
 * presupuesto que quede del webhook) y los tipos permitidos. Si la falla es
 * pasajera, el mensaje queda con "evo:<id>" y la ruta de media reintenta al
 * abrirlo; si es definitiva, queda sin archivo (con tipo y nombre) y no se
 * vuelve a pedir.
 */
export async function storeInboundMedia(
  number: NumberRow,
  messageId: string,
  ref: MediaRef,
  opts: { budget?: number; retry?: boolean } = {},
): Promise<{ url: string; bytes: number } | null> {
  let provider: GroupsProvider;
  try {
    provider = providerFor(number);
  } catch {
    return null;
  }
  if (!provider.fetchMedia) return null;
  const { saveUpload } = await import('./uploads');
  const max = Math.max(0, Math.min(MAX_INBOUND_MEDIA, opts.budget ?? MAX_INBOUND_MEDIA));
  const markFailed = () =>
    getDb()
      .prepare("UPDATE groups_messages SET media_url = '' WHERE id = ? AND number_id = ? AND media_url LIKE 'evo:%'")
      .run(messageId, number.id);
  try {
    let file;
    try {
      file = await provider.fetchMedia(ref, max);
    } catch (err) {
      // El gateway puede guardar el mensaje un instante después de avisarlo: un reintento corto.
      if (!opts.retry || permanentMediaError(err)) throw err;
      await new Promise((r) => setTimeout(r, 2000));
      file = await provider.fetchMedia(ref, max);
    }
    const mimetype = file.mimetype.split(';')[0].trim() || 'application/octet-stream';
    const filename = file.filename || `whatsapp-${ref.providerMessageId.slice(0, 24)}`;
    const url = await saveUpload('chat', filename, mimetype, file.data);
    const r = await getDb()
      .prepare("UPDATE groups_messages SET media_url = ?, media_type = CASE WHEN media_type = '' THEN ? ELSE media_type END WHERE id = ? AND number_id = ? AND media_url LIKE 'evo:%'")
      .run(url, mimetype, messageId, number.id);
    if (r.changes === 0) {
      // Otro pedido lo guardó primero: el archivo de más se borra.
      const { deleteUploads } = await import('./uploads');
      await deleteUploads([url]);
      return null;
    }
    await completeMediaInfo(messageId, file.data, mimetype).catch(() => null);
    return { url, bytes: file.data.length };
  } catch (err) {
    // Más grande que lo que quedaba del presupuesto del webhook (no del tope): queda para cuando se abra.
    const overBudget = err instanceof ProviderError && err.httpStatus === 413 && max < MAX_INBOUND_MEDIA;
    if (permanentMediaError(err) && !overBudget) await markFailed();
    throw err;
  }
}

/** Con el archivo ya bajado: tamaño real, mimetype y medidas de la imagen si el webhook no las traía. */
async function completeMediaInfo(messageId: string, data: Buffer, mimetype: string): Promise<void> {
  const db = getDb();
  const row = (await db.prepare('SELECT meta, media_type FROM groups_messages WHERE id = ?').get(messageId)) as { meta: string; media_type: string } | undefined;
  if (!row) return;
  const meta = parseJson<StoredMeta>(row.meta, {});
  const info: MediaInfo = { kind: kindFromMime(row.media_type || mimetype), ...(meta.media ?? {}) };
  info.size = data.length;
  info.mimetype ??= mimetype;
  if ((info.kind === 'image' || info.kind === 'sticker') && !(info.width && info.height)) {
    const dims = imageSize(data);
    if (dims && dims.width > 0 && dims.height > 0) Object.assign(info, dims);
  }
  await db.prepare('UPDATE groups_messages SET meta = ? WHERE id = ?').run(JSON.stringify({ ...meta, media: compactInfo(info) }), messageId);
}

export interface IngestResult {
  messages: number;
  duplicates: number;
  ignored: number;
  /** Mensajes que no se pudieron guardar (un error, no un repetido): el webhook responde 500 y el proveedor reintenta. */
  failed?: number;
}

export async function ingestEvents(number: NumberRow, events: InboundEvent[], opts: { history?: boolean } = {}): Promise<IngestResult> {
  // Historial (messages.set al vincular, o la importación): se guarda sin avisos, reglas ni SLA.
  if (opts.history || events.some((e) => e.type === 'message' && e.history)) {
    const { ingestHistory } = await import('./groups-import');
    const live = opts.history ? [] : events.filter((e) => !(e.type === 'message' && e.history));
    const past = opts.history ? events : events.filter((e) => e.type === 'message' && e.history);
    const h = await ingestHistory(number, past);
    if (live.length === 0) return h;
    const r = await ingestEvents(number, live);
    // Solo lo en vivo puede pedir un reintento: el historial nunca (un mensaje roto del historial no hace que el
    // proveedor reenvíe la tanda entera una y otra vez).
    return { messages: h.messages + r.messages, duplicates: h.duplicates + r.duplicates, ignored: h.ignored + r.ignored, ...(r.failed ? { failed: r.failed } : {}) };
  }
  const res: IngestResult = { messages: 0, duplicates: 0, ignored: 0 };
  const ws = number.user_id;
  const later: Array<{ messageId: string; ref: MediaRef }> = [];
  // Lo que sigue a guardar un mensaje (miembros del grupo, asignación, avisos, eventos, agente) corre después de
  // responder el webhook, en orden: el mensaje ya está guardado y a la vista, y el que sigue no espera.
  const post: Array<() => Promise<unknown>> = [];
  // Los ajustes del workspace llegan con el primer mensaje de la tanda (en la misma ida a la base).
  let settings: GroupsSettings | null = null;
  const batchSettings = async () => (settings ??= await getSettings(ws));
  const slice = events.slice(0, 200);
  // La libreta del número (nombres de perfil, lid ↔ teléfono). Si la tanda trae a alguien solo con su lid, primero:
  // así sale con teléfono. Si no, la libreta no cambia cómo se guarda nada y se aprende mientras se guarda el mensaje.
  let batch = slice;
  let learning: Promise<unknown> | null = null;
  if (slice.some(needsBookFirst)) batch = await learnLinesEvents(number, slice);
  else learning = learnLinesEvents(number, slice).catch(() => null);
  for (const ev of batch) {
    // El mensaje ya quedó guardado: lo que falle después se loguea, no pide reintento (el reintento no lo rehace).
    let saved = false;
    try {
      if (ev.type === 'message') {
        const isGroup = ev.isGroup || isGroupJid(ev.chatId);
        let dmName = isGroup ? ev.chatName : ev.fromMe ? undefined : ev.senderName || ev.chatName;
        // 1:1 con id "@lid" y sin nombre de perfil: un nombre legible en el idioma del workspace (nunca el lid).
        if (!isGroup && !dmName && isLidJid(ev.chatId)) dmName = await lidChatName(ws);
        const at = ev.timestamp && Number.isFinite(Date.parse(ev.timestamp)) ? new Date(ev.timestamp).toISOString() : nowIso();
        const meta = inboundMeta(ev);
        const media = ev.media && (ev.media.type || ev.media.url) ? ev.media : null;
        const chatInput: ChatInput = { providerChatId: ev.chatId, kind: isGroup ? 'group' : 'dm', name: dmName, phone: isGroup ? '' : phoneDigits(ev.chatId) };
        // Una sola ida a la base: el chat, el mensaje y el chat al tope de la lista (lo que avisa a las pantallas).
        const stored = await saveInbound(
          number,
          chatInput,
          {
            ws,
            numberId: number.id,
            providerMessageId: ev.providerMessageId,
            direction: ev.fromMe ? 'out' : 'in',
            senderPhone: ev.senderPhone,
            senderName: ev.senderName,
            authorKind: ev.fromMe ? 'phone' : 'person',
            body: ev.body,
            media,
            replyToProviderId: ev.replyToProviderId || undefined,
            status: ev.fromMe ? (ev.status ?? 'sent') : 'received',
            createdAt: at,
            forwarded: ev.forwarded,
            meta,
            poll: ev.poll && ev.poll.options.length >= 2 ? ev.poll : null,
          },
          previewOf(ev.body.slice(0, 8000), media?.type ?? '', (media?.name ?? '').slice(0, 200), meta ?? {}),
          settings === null,
        );
        saved = true;
        settings ??= stored.settings;
        const row = stored.row;
        // Quien tenga el chat abierto en esta instancia se entera ya (lib/wa-live.ts).
        if (row) pokeLive('lines', ws);
        if (!row) {
          res.duplicates++;
          // Repetido (un reintento del proveedor): lo de antes de responder se vuelve a aplicar, porque todo es
          // idempotente; lo de después (asignación, avisos) ya corrió la primera vez.
          await finishChat(number, stored.chat, chatInput, false).catch(logAfterError);
          continue;
        }
        res.messages++;
        const chat = await finishChat(number, stored.chat, chatInput, stored.created).catch((err) => {
          logAfterError(err);
          return stored.chat;
        });
        // Archivo que el gateway baja aparte (Evolution): se guarda después de responder el webhook.
        if (ev.media?.fetchRef && row.media_url.startsWith('evo:')) {
          const ref = ev.media.fetchRef;
          later.push({ messageId: row.id, ref });
        }
        // Lo de antes de responder. Si algo de esto falla, el mensaje ya está guardado: se loguea y se sigue.
        await (async () => {
          if (!ev.fromMe) {
            const st = await batchSettings();
            // Modo "preguntas": el chat espera recién cuando la AI dice que el mensaje pide respuesta (lib/groups-flag.ts).
            if (st.flagMode === 'questions') {
              await getDb().prepare('UPDATE groups_chats SET awaiting_since = NULL WHERE id = ? AND awaiting_since = ?').run(chat.id, at);
            }
            // Archivado: vuelve a la lista con un mensaje nuevo solo si el workspace lo pidió.
            if (chat.archived_at && !st.keepArchived) await getDb().prepare('UPDATE groups_chats SET archived_at = NULL WHERE id = ?').run(chat.id);
            // Ticket por palabra clave: antes de responder.
            if (matchKeyword(st.ticketKeywords, row.body)) {
              const { createTicket } = await import('./groups-tickets');
              await createTicket(ws, null, { chatId: chat.id, messageId: row.id, source: 'keyword' });
            }
          } else {
            // Respondido desde el teléfono: el chat deja de esperar. Antes de responder, por lo mismo.
            await markAnswered(chat.id, at);
          }
        })().catch(logAfterError);
        post.push(async () => {
          // Grupo que no conocíamos: se traen sus miembros una vez (best effort).
          if (chat.kind === 'group' && chat.member_count === 0 && PROVIDER_CAPS[number.provider].groups) {
            await syncMembers(ws, chat.id).catch(() => null);
          }
          // Quien escribe en un grupo es miembro: se guarda (o completa) su nombre de perfil.
          if (chat.kind === 'group' && !ev.fromMe && ev.senderPhone) {
            const r = await getDb()
              .prepare(
                `INSERT INTO groups_members (chat_id, phone, name, role, created_at) VALUES (?, ?, ?, 'member', ?)
               ON CONFLICT(chat_id, phone) DO UPDATE SET name = excluded.name WHERE excluded.name != '' AND groups_members.name != excluded.name`,
              )
              .run(chat.id, phoneDigits(ev.senderPhone), (ev.senderName ?? '').slice(0, 120), at);
            if (r.changes > 0) await refreshMemberCount(chat.id);
          }
          if (ev.fromMe) {
            await emitEventSoon(ws, 'groups.message.sent', {
              message: { id: row.id, body: row.body, authorId: null, authorKind: 'phone', status: row.status, createdAt: at },
              chat: chatEventInfo(chat),
            });
            return;
          }
          await afterInbound(ws, chat, row, await batchSettings(), true);
        });
      } else if (ev.type === 'reaction') {
        const msg = (await getDb()
          .prepare('SELECT * FROM groups_messages WHERE number_id = ? AND provider_message_id = ?')
          .get(number.id, ev.targetProviderMessageId)) as MessageRow | undefined;
        if (!msg) {
          res.ignored++;
          continue;
        }
        // Una reacción más vieja que la que ya está (un reintento que llega tarde) no la pisa.
        if (!(await applyReaction(msg, { emoji: ev.emoji, by: ev.fromMe ? 'phone' : ev.senderPhone, fromMe: ev.fromMe, ...(ev.at ? { at: ev.at } : {}) }))) {
          res.ignored++;
          continue;
        }
        if (ev.emoji) await maybeTicketFromReaction(ws, msg, ev.emoji, null);
      } else if (ev.type === 'poll_vote') {
        const msg = (await getDb()
          .prepare('SELECT * FROM groups_messages WHERE number_id = ? AND provider_message_id = ?')
          .get(number.id, ev.pollProviderMessageId)) as MessageRow | undefined;
        const poll = parsePoll(msg?.poll);
        if (!msg || !poll || !ev.voterPhone) {
          res.ignored++;
          continue;
        }
        const options = voteOptions(poll, ev.options);
        // El mismo voto otra vez (un reintento del proveedor) no cambia nada ni vuelve a avisar.
        const vote = await getDb()
          .prepare(
            `INSERT INTO groups_poll_votes (message_id, voter, voter_name, options, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(message_id, voter) DO UPDATE SET options = excluded.options, updated_at = excluded.updated_at,
               voter_name = CASE WHEN excluded.voter_name != '' THEN excluded.voter_name ELSE groups_poll_votes.voter_name END
             WHERE groups_poll_votes.options IS NOT excluded.options`,
          )
          .run(msg.id, phoneDigits(ev.voterPhone), (ev.voterName ?? '').slice(0, 120), JSON.stringify(options), nowIso());
        if (vote.changes === 0) {
          res.duplicates++;
          continue;
        }
        const chat = await getChatRow(ws, msg.chat_id);
        const dto = (await listMessages(ws, msg.chat_id, { limit: 500 })).find((m) => m.id === msg.id);
        if (chat && dto?.poll) {
          await emitEventSoon(ws, 'groups.poll.voted', {
            poll: { messageId: msg.id, question: poll.question, options: poll.options },
            vote: { voter: phoneDigits(ev.voterPhone), voterName: ev.voterName ?? '', options },
            results: dto.poll.results,
            chat: chatEventInfo(chat),
          });
        }
      } else if (ev.type === 'status') {
        // Nunca vuelve atrás (read no pasa a delivered).
        const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };
        const row = (await getDb()
          .prepare('SELECT id, status FROM groups_messages WHERE number_id = ? AND provider_message_id = ?')
          .get(number.id, ev.providerMessageId)) as { id: string; status: string } | undefined;
        if (row && (rank[ev.status] ?? 0) > (rank[row.status] ?? 0)) {
          // La hora de cada estado queda en meta.ack (Info del mensaje).
          await getDb()
            .prepare("UPDATE groups_messages SET status = ?, meta = json_set(CASE WHEN json_valid(meta) THEN meta ELSE '{}' END, '$.ack.' || ?, ?) WHERE id = ?")
            .run(ev.status, ev.status, nowIso(), row.id);
        }
      } else if (ev.type === 'edit' || ev.type === 'revoke') {
        const msg = (await getDb()
          .prepare('SELECT id FROM groups_messages WHERE number_id = ? AND provider_message_id = ?')
          .get(number.id, ev.providerMessageId)) as { id: string } | undefined;
        if (!msg) {
          res.ignored++;
          continue;
        }
        if (ev.type === 'edit') {
          // Con la hora de la edición: una más vieja que la que ya está (un reintento que llega tarde) no la pisa.
          const when = ev.at && Number.isFinite(Date.parse(ev.at)) ? new Date(ev.at).toISOString() : nowIso();
          const r = await getDb()
            .prepare('UPDATE groups_messages SET body = ?, edited_at = ? WHERE id = ? AND (edited_at IS NULL OR edited_at <= ?) AND body IS NOT ?')
            .run(ev.body.slice(0, 8000), when, msg.id, when, ev.body.slice(0, 8000));
          if (r.changes === 0) {
            res.ignored++;
            continue;
          }
        } else {
          await getDb().prepare('UPDATE groups_messages SET deleted_at = COALESCE(deleted_at, ?), pinned_at = NULL WHERE id = ?').run(nowIso(), msg.id);
        }
        await refreshChatPreview(msg.id);
      } else if (ev.type === 'call') {
        const { ingestCall } = await import('./groups-inbox');
        await ingestCall(number, ev);
        res.messages++;
      } else if (ev.type === 'participants') {
        const chat = (await getDb()
          .prepare('SELECT * FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?')
          .get(number.id, ev.chatId)) as ChatRow | undefined;
        if (!chat) {
          res.ignored++;
          continue;
        }
        await applyMemberChange(chat.id, ev.action, ev.phones);
      } else if (ev.type === 'session') {
        await saveState(number, { status: ev.status, phone: ev.phone });
      } else if (ev.type === 'contact') {
        const { applyContact } = await import('./groups-import');
        await applyContact(number, ev);
      } else if (ev.type === 'archive') {
        if (!(await applyPhoneArchive(number, ev.chatId, ev.archived))) res.ignored++;
      } else if (ev.type === 'presence') {
        // Solo los chats que ya existen: la presencia no crea chats.
        const state = ev.state === 'paused' || ev.state === 'unavailable' ? null : ev.state;
        await getDb()
          .prepare('UPDATE groups_chats SET presence = ?, presence_who = ?, presence_at = ? WHERE number_id = ? AND provider_chat_id = ?')
          .run(state, ev.who.slice(0, 30), nowIso(), number.id, ev.chatId);
      }
    } catch (err) {
      res.ignored++;
      // Un mensaje que no se pudo guardar por algo pasajero (la base, la red): el webhook responde 500 y el proveedor
      // lo reintenta. Si es algo permanente (un evento con forma inesperada), reintentar no lo arregla: se loguea.
      if (ev.type === 'message' && !saved && transientError(err)) res.failed = (res.failed ?? 0) + 1;
      // eslint-disable-next-line no-console
      console.error('[groups] webhook event failed', ev.type, (err as Error)?.name ?? 'error');
    }
  }
  // Estados, reacciones, ediciones, escribiendo: quien mira en esta instancia se entera ya.
  pokeLive('lines', ws);
  if (learning) await learning;
  if (post.length) {
    await runAfter(async () => {
      for (const job of post) await job().catch(logAfterError);
      pokeLive('lines', ws);
    });
  }
  if (later.length) await runAfter(() => storeInboundBatch(number, later));
  return res;
}

/** ¿La tanda trae a alguien solo con su lid? Entonces la libreta va antes: el mensaje se guarda con el teléfono si ya se conoce. */
function needsBookFirst(ev: InboundEvent): boolean {
  if (ev.type !== 'message') return ev.type === 'contact' || ev.type === 'archive';
  const m = ev as { chatId: string; senderPhone?: string; senderLid?: string; chatLid?: string };
  return isLidJid(m.chatId) || Boolean(m.chatLid) || (Boolean(m.senderLid) && !m.senderPhone);
}

/**
 * Archivar o desarchivar desde el teléfono (WhatsApp avisa con el id del chat,
 * que puede ser su lid). Un chat que no existe no se crea; uno que ya está así
 * no se toca; el eco viejo de un pedido nuestro se ignora
 * (lib/wa-archive-sync.ts). Nunca manda nada de vuelta a WhatsApp.
 */
export async function applyPhoneArchive(number: Pick<NumberRow, 'id' | 'user_id'>, chatId: string, archived: boolean): Promise<boolean> {
  const db = getDb();
  const find = (jid: string) =>
    db.prepare('SELECT * FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(number.id, jid) as Promise<ChatRow | undefined>;
  let chat = await find(chatId);
  // El mismo chat con el otro sufijo o id que conoce WhatsApp (teléfono ↔ lid).
  if (!chat && /@(s\.whatsapp\.net|c\.us)$/.test(chatId)) chat = await find(chatId.endsWith('@c.us') ? chatId.replace(/@c\.us$/, '@s.whatsapp.net') : chatId.replace(/@s\.whatsapp\.net$/, '@c.us'));
  if (!chat && isLidJid(chatId)) {
    const { phoneForLid } = await import('./wa-contacts');
    const phone = await phoneForLid({ app: 'lines', accountId: number.id }, lidDigits(chatId)).catch(() => '');
    if (phone) chat = (await find(`${phone}@s.whatsapp.net`)) ?? (await find(`${phone}@c.us`));
  }
  if (!chat || chat.hidden_at || !!chat.archived_at === archived) return false;
  const { isArchiveEcho } = await import('./wa-archive-sync');
  if (await isArchiveEcho('lines', chat.id, archived)) return false;
  const now = nowIso();
  await db
    .prepare('UPDATE groups_chats SET archived_at = ?, pinned_at = CASE WHEN ? THEN NULL ELSE pinned_at END, updated_at = ? WHERE id = ?')
    .run(archived ? now : null, archived ? 1 : 0, now, chat.id);
  return true;
}

/** Mensaje de cliente nuevo: ticket por palabra clave, eventos (Flow/webhooks) y agente. */
async function afterInbound(ws: string, chatRow: ChatRow, msg: MessageRow, known?: Awaited<ReturnType<typeof getSettings>>, ticketDone = false): Promise<void> {
  let chat = chatRow;
  const settings = known ?? (await getSettings(ws));
  const keyword = !ticketDone && matchKeyword(settings.ticketKeywords, msg.body);
  if (keyword) {
    const { createTicket } = await import('./groups-tickets');
    await createTicket(ws, null, { chatId: chat.id, messageId: msg.id, source: 'keyword' }).catch(() => null);
  }
  const { autoAssignChat } = await import('./groups-inbox');
  await autoAssignChat(ws, chat.id).catch(() => null);
  // Silenciado: sin push (el chat igual se marca sin leer).
  const muted = Boolean(chat.muted_until && chat.muted_until > nowIso());
  if (chat.assigned_to && !muted) {
    const { notifyPerson } = await import('./groups-push');
    await notifyPerson(ws, chat.assigned_to, {
      chatId: chat.id,
      title: chatDisplayName(chat),
      // "@<dígitos>" → "@Nombre" también en el aviso.
      body:
        (msg.sender_name ? `${msg.sender_name}: ` : '') +
        (await import('./wa-contacts')
          .then((m) =>
            m.resolveTextMentions(
              'lines',
              [{ accountId: msg.number_id, text: previewOf(msg.body, msg.media_type, msg.media_name), mentions: parseJson<StoredMeta>(msg.meta ?? '', {}).mentions }],
              { someone: () => m.someoneWord(ws) },
            ),
          )
          .then((t) => t[0])
          .catch(() => previewOf(msg.body, msg.media_type, msg.media_name))),
    }).catch(() => null);
  }
  await emitEventSoon(ws, 'groups.message.received', {
    message: { id: msg.id, body: msg.body, senderPhone: msg.sender_phone, senderName: msg.sender_name, createdAt: msg.created_at },
    chat: { id: chat.id, kind: chat.kind, name: chatDisplayName(chat), crmCompanyId: chat.crm_company_id, crmContactId: chat.crm_contact_id },
  });
  if (settings.flagMode === 'questions') {
    const flag = async () => {
      const { flagInbound } = await import('./groups-flag');
      await flagInbound(ws, chat.id, msg).catch(() => null);
    };
    try {
      const { after } = await import('next/server');
      after(flag);
    } catch {
      await flag();
    }
  }
  // Agente por defecto (Agents > Canales): toma los chats 1 a 1 sin agente ni persona asignada.
  if (!chat.agent_id && !chat.assigned_to && chat.kind !== 'group' && settings.defaultAgentId) {
    const agent = (await getDb().prepare('SELECT id FROM agents WHERE id = ? AND user_id = ? AND enabled = 1').get(settings.defaultAgentId, ws)) as { id: string } | undefined;
    if (agent) {
      await getDb().prepare('UPDATE groups_chats SET agent_id = ?, agent_conversation_id = NULL WHERE id = ? AND agent_id IS NULL').run(agent.id, chat.id);
      chat = { ...chat, agent_id: agent.id, agent_conversation_id: null };
    }
  }
  if (chat.agent_id && msg.body.trim()) {
    // El agente puede tardar (modelo, herramientas): contesta después de responderle al webhook.
    const job = async () => {
      const { replyWithAgent } = await import('./groups-agent');
      await replyWithAgent(ws, chat.id, msg.id).catch(() => null);
    };
    try {
      const { after } = await import('next/server');
      after(job);
    } catch {
      await job();
    }
  }
}

// ======================================================================
// Miembros y grupos
// ======================================================================

export interface MemberDto {
  phone: string;
  name: string;
  role: MemberRole;
}

export async function listMembers(ws: string, chatId: string): Promise<MemberDto[]> {
  const rows = (await getDb()
    .prepare(
      // Sin nombre guardado en el grupo: el de la libreta del número (contactos y nombres de perfil de todos sus chats).
      `SELECT m.phone, CASE WHEN m.name <> '' THEN m.name ELSE COALESCE((
           SELECT CASE WHEN w.saved_name <> '' THEN w.saved_name ELSE w.push_name END FROM wa_contacts w
           WHERE w.app = 'lines' AND w.account_id = c.number_id AND w.phone = m.phone LIMIT 1), '') END AS name, m.role
       FROM groups_members m JOIN groups_chats c ON c.id = m.chat_id
       WHERE m.chat_id = ? AND c.user_id = ? ORDER BY CASE m.role WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.phone`,
    )
    .all(chatId, ws)) as MemberDto[];
  return rows;
}

export async function refreshMemberCount(chatId: string): Promise<void> {
  await getDb()
    .prepare('UPDATE groups_chats SET member_count = (SELECT COUNT(*) FROM groups_members WHERE chat_id = ?) WHERE id = ?')
    .run(chatId, chatId);
}

export async function applyMemberChange(chatId: string, action: ParticipantAction, phones: string[]): Promise<void> {
  const db = getDb();
  const now = nowIso();
  if ((action === 'add' || action === 'remove') && phones.length) {
    const chat = (await db.prepare('SELECT * FROM groups_chats WHERE id = ?').get(chatId)) as ChatRow | undefined;
    if (chat) {
      await emitEventSoon(chat.user_id, action === 'add' ? 'groups.member.joined' : 'groups.member.left', {
        phones: phones.map(phoneDigits).filter(Boolean),
        chat: chatEventInfo(chat),
      });
    }
  }
  for (const raw of phones) {
    const phone = phoneDigits(raw);
    if (!phone) continue;
    if (action === 'add') {
      await db.prepare('INSERT OR IGNORE INTO groups_members (chat_id, phone, role, created_at) VALUES (?, ?, ?, ?)').run(chatId, phone, 'member', now);
    } else if (action === 'remove') {
      await db.prepare('DELETE FROM groups_members WHERE chat_id = ? AND phone = ?').run(chatId, phone);
    } else {
      await db
        .prepare("UPDATE groups_members SET role = ? WHERE chat_id = ? AND phone = ? AND role != 'superadmin'")
        .run(action === 'promote' ? 'admin' : 'member', chatId, phone);
    }
  }
  await refreshMemberCount(chatId);
}

export async function groupContext(ws: string, chatId: string): Promise<{ chat: ChatRow; provider: GroupsProvider }> {
  const chat = await getChatRow(ws, chatId);
  if (!chat) throw new GroupsError('not_found', 404);
  if (chat.kind !== 'group') throw new GroupsError('not_a_group');
  const number = await getNumberRow(ws, chat.number_id);
  if (!number) throw new GroupsError('not_found', 404);
  const provider = providerFor(number);
  if (!provider.caps.groups) throw new GroupsError('groups_unsupported');
  return { chat, provider };
}

/** Vuelve a leer los miembros desde WhatsApp. */
export async function syncMembers(ws: string, chatId: string): Promise<MemberDto[]> {
  const { chat, provider } = await groupContext(ws, chatId);
  let list;
  try {
    list = await provider.participants(chat.provider_chat_id);
  } catch (err) {
    throw new GroupsError(providerErrorCode(err), 502);
  }
  await storeMembers(chatId, list);
  // El lid de cada participante (y su nombre, si vino) va a la libreta: con eso las menciones "@<lid>" llevan nombre.
  if (list.some((p) => p.lid)) {
    const { learnLinesChatInfo } = await import('./groups-wa-names');
    await learnLinesChatInfo({ id: chat.number_id, user_id: chat.user_id }, chat.provider_chat_id, { name: '', about: '', pictureUrl: '', participants: list }).catch(() => null);
  }
  return listMembers(ws, chatId);
}

/**
 * Reemplaza los miembros de un grupo por los que dio WhatsApp (sincronizar o
 * el repaso diario). Los nombres que ya conocíamos se conservan.
 */
export async function storeMembers(chatId: string, list: Array<{ phone: string; role: MemberRole; name?: string }>): Promise<void> {
  const db = getDb();
  const now = nowIso();
  // Los nombres que ya conocíamos (de sus mensajes) se conservan: WhatsApp no siempre los manda.
  const known = new Map(
    ((await db.prepare('SELECT phone, name FROM groups_members WHERE chat_id = ?').all(chatId)) as Array<{ phone: string; name: string }>).map((m) => [
      m.phone,
      m.name,
    ]),
  );
  await db.prepare('DELETE FROM groups_members WHERE chat_id = ?').run(chatId);
  // De a 200 filas por INSERT: un grupo de 1.000 miembros son 5 viajes a la base, no 1.000.
  const rows = list.slice(0, 2000).filter((p) => p.phone);
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await db
      .prepare(`INSERT OR REPLACE INTO groups_members (chat_id, phone, name, role, created_at) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?)').join(', ')}`)
      .run(...chunk.flatMap((p) => [chatId, p.phone, (p.name || known.get(p.phone) || '').slice(0, 120), p.role, now]));
  }
  await refreshMemberCount(chatId);
}

export interface BulkMemberResult {
  chatId: string;
  name: string;
  ok: boolean;
  error?: string;
  results: ParticipantResult[];
}

/** Agrega, quita, promueve o degrada los mismos teléfonos en varios grupos. */
export async function updateMembers(
  ws: string,
  chatIds: string[],
  action: ParticipantAction,
  rawPhones: string[],
): Promise<BulkMemberResult[]> {
  const phones = [...new Set(splitPhones(rawPhones).map(phoneDigits).filter((p) => isValidPhone(p)))].slice(0, 200);
  if (phones.length === 0) throw new GroupsError('invalid_phones');
  const ids = [...new Set(chatIds)].slice(0, 100);
  const out: BulkMemberResult[] = [];
  for (const chatId of ids) {
    try {
      const { chat, provider } = await groupContext(ws, chatId);
      const results = await provider.updateParticipants(chat.provider_chat_id, action, phones);
      await applyMemberChange(
        chatId,
        action,
        results.filter((r) => r.ok).map((r) => r.phone),
      );
      out.push({ chatId, name: chatDisplayName(chat), ok: true, results });
    } catch (err) {
      const chat = await getChatRow(ws, chatId);
      out.push({ chatId, name: chat ? chatDisplayName(chat) : chatId, ok: false, error: providerErrorCode(err), results: [] });
    }
  }
  return out;
}

export interface CreateGroupRow {
  name: string;
  phones: string[];
  description?: string;
  admins?: string[];
  labelIds?: string[];
  crmCompanyId?: string | null;
}

export interface CreateGroupResult {
  name: string;
  ok: boolean;
  chatId?: string;
  error?: string;
  /** Teléfonos que WhatsApp no dejó agregar (privacidad): reciben el link. */
  notAdded?: string[];
}

export const MAX_BULK_GROUPS = 50;

/** Crea uno o varios grupos desde un número (de a uno, en orden). */
export async function createGroups(ws: string, numberId: string, rows: CreateGroupRow[]): Promise<CreateGroupResult[]> {
  const number = await getNumberRow(ws, numberId);
  if (!number) throw new GroupsError('not_found', 404);
  const provider = providerFor(number);
  if (!provider.caps.groups) throw new GroupsError('groups_unsupported');
  if (rows.length === 0) throw new GroupsError('empty');
  if (rows.length > MAX_BULK_GROUPS) throw new GroupsError('too_many_groups');
  const out: CreateGroupResult[] = [];
  for (const r of rows) {
    const name = String(r.name ?? '').trim().slice(0, 100);
    if (!name) {
      out.push({ name: '', ok: false, error: 'invalid_name' });
      continue;
    }
    const phones = [...new Set(splitPhones(r.phones ?? []).map(phoneDigits).filter((p) => isValidPhone(p)))].slice(0, 1000);
    try {
      const info = await provider.createGroup(name, phones);
      const chat = await upsertChat(number, { providerChatId: info.id, kind: 'group', name });
      const db = getDb();
      const now = nowIso();
      await db.prepare('UPDATE groups_chats SET name = ?, last_message_at = COALESCE(last_message_at, ?) WHERE id = ?').run(name, now, chat.id);
      // Miembros reales desde WhatsApp (los que no se pudieron agregar no aparecen).
      let members: Array<{ phone: string; role: MemberRole }> = info.participants ?? [];
      try {
        if (!info.participants) members = await provider.participants(info.id);
      } catch {
        members = phones.map((phone) => ({ phone, role: 'member' as const }));
      }
      for (const m of members) {
        await db
          .prepare('INSERT OR REPLACE INTO groups_members (chat_id, phone, role, created_at) VALUES (?, ?, ?, ?)')
          .run(chat.id, m.phone, m.role, now);
      }
      await refreshMemberCount(chat.id);
      const added = new Set(members.map((m) => m.phone));
      const notAdded = phones.filter((p) => !added.has(p));
      if (r.description?.trim()) {
        await provider.updateGroup(info.id, { description: r.description.trim().slice(0, 2000) }).catch(() => null);
        await db.prepare('UPDATE groups_chats SET description = ? WHERE id = ?').run(r.description.trim().slice(0, 2000), chat.id);
      }
      const admins = (r.admins ?? []).map(phoneDigits).filter((p) => added.has(p));
      if (admins.length) {
        const res = await provider.updateParticipants(info.id, 'promote', admins).catch(() => []);
        await applyMemberChange(chat.id, 'promote', res.filter((x) => x.ok).map((x) => x.phone));
      }
      if (r.labelIds?.length) await setChatLabels(ws, chat.id, r.labelIds);
      if (r.crmCompanyId) await updateChat(ws, chat.id, { crmCompanyId: r.crmCompanyId }).catch(() => null);
      out.push({ name, ok: true, chatId: chat.id, notAdded });
    } catch (err) {
      out.push({ name, ok: false, error: providerErrorCode(err) });
    }
  }
  return out;
}

/**
 * CSV de grupos → filas. Columnas (con encabezado): name, participants
 * (teléfonos separados por espacio o ;), description, admins.
 */
export function parseGroupsCsv(rows: string[][]): { rows: CreateGroupRow[]; errors: Array<{ line: number; error: string }> } {
  const errors: Array<{ line: number; error: string }> = [];
  if (rows.length === 0) return { rows: [], errors: [{ line: 1, error: 'empty' }] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const iName = col(['name', 'nombre', 'nome', 'group', 'grupo', 'subject']);
  const iPhones = col(['participants', 'members', 'phones', 'participantes', 'miembros', 'membros', 'telefonos', 'teléfonos', 'telefones']);
  const iDesc = col(['description', 'descripcion', 'descripción', 'descricao', 'descrição']);
  const iAdmins = col(['admins', 'administradores']);
  if (iName < 0) return { rows: [], errors: [{ line: 1, error: 'missing_name_column' }] };
  const out: CreateGroupRow[] = [];
  rows.slice(1).forEach((r, i) => {
    const name = (r[iName] ?? '').trim();
    if (!name && r.every((c) => !c.trim())) return;
    if (!name) {
      errors.push({ line: i + 2, error: 'invalid_name' });
      return;
    }
    const split = (v: string | undefined) =>
      String(v ?? '')
        .split(/[\s;,|]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    const phones = iPhones >= 0 ? split(r[iPhones]) : [];
    const bad = phones.filter((p) => !isValidPhone(p));
    if (bad.length) errors.push({ line: i + 2, error: `invalid_phone:${bad.slice(0, 3).join(' ')}` });
    out.push({
      name,
      phones: phones.filter((p) => isValidPhone(p)).map(phoneDigits),
      description: iDesc >= 0 ? (r[iDesc] ?? '').trim() : '',
      admins: iAdmins >= 0 ? split(r[iAdmins]).filter((p) => isValidPhone(p)).map(phoneDigits) : [],
    });
  });
  return { rows: out, errors };
}

export async function groupInviteLink(ws: string, chatId: string, revoke = false): Promise<string> {
  const { chat, provider } = await groupContext(ws, chatId);
  let link: string;
  try {
    link = await provider.inviteLink(chat.provider_chat_id, revoke);
  } catch (err) {
    throw new GroupsError(providerErrorCode(err), 502);
  }
  await getDb().prepare('UPDATE groups_chats SET invite_link = ?, updated_at = ? WHERE id = ?').run(link, nowIso(), chatId);
  return link;
}

/** Trae los grupos del número desde WhatsApp (y sus miembros, hasta 50 grupos). */
export async function syncGroups(ws: string, numberId: string): Promise<{ groups: number }> {
  const number = await getNumberRow(ws, numberId);
  if (!number) throw new GroupsError('not_found', 404);
  const provider = providerFor(number);
  if (!provider.caps.groups) return { groups: 0 };
  let list;
  try {
    list = await provider.listGroups();
  } catch (err) {
    throw new GroupsError(providerErrorCode(err), 502);
  }
  let n = 0;
  for (const g of list.slice(0, 1000)) {
    const chat = await upsertChat(number, { providerChatId: g.id, kind: 'group', name: g.name });
    if (g.name && g.name !== chat.name) await getDb().prepare('UPDATE groups_chats SET name = ? WHERE id = ?').run(g.name.slice(0, 200), chat.id);
    if (g.announce !== undefined || g.locked !== undefined) {
      await getDb()
        .prepare('UPDATE groups_chats SET announce = COALESCE(?, announce), locked = COALESCE(?, locked), left_at = NULL WHERE id = ?')
        .run(g.announce === undefined ? null : Number(g.announce), g.locked === undefined ? null : Number(g.locked), chat.id);
    }
    if (n < 50) await syncMembers(ws, chat.id).catch(() => null);
    n++;
  }
  return { groups: n };
}

// ======================================================================
// Etiquetas
// ======================================================================

export const LABEL_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;

/** Etiquetas del workspace. Con `viewer`, el conteo es solo de los chats que ve (lib/groups-access). */
export async function listLabels(ws: string, viewer?: GroupsViewer | null): Promise<Array<LabelDto & { count: number }>> {
  const access = chatAccessSql(viewer, 'c');
  const count = access
    ? `SELECT COUNT(*) FROM groups_chat_labels cl JOIN groups_chats c ON c.id = cl.chat_id WHERE cl.label_id = l.id AND ${access.sql}`
    : 'SELECT COUNT(*) FROM groups_chat_labels cl WHERE cl.label_id = l.id';
  return (await getDb()
    .prepare(`SELECT l.id, l.name, l.color, (${count}) AS count FROM groups_labels l WHERE l.user_id = ? ORDER BY l.name COLLATE NOCASE`)
    .all(...(access?.args ?? []), ws)) as Array<LabelDto & { count: number }>;
}

function cleanLabel(input: { name?: string; color?: string }): { name: string; color: string } {
  const name = String(input.name ?? '').trim().slice(0, 40);
  if (!name) throw new GroupsError('invalid_name');
  const color = (LABEL_COLORS as readonly string[]).includes(String(input.color)) ? String(input.color) : 'gray';
  return { name, color };
}

export async function createLabel(ws: string, input: { name?: string; color?: string }): Promise<LabelDto> {
  const { name, color } = cleanLabel(input);
  const id = newId();
  const r = await getDb()
    .prepare('INSERT OR IGNORE INTO groups_labels (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, ws, name, color, nowIso());
  if (r.changes === 0) throw new GroupsError('duplicate_label', 409);
  return { id, name, color };
}

export async function updateLabel(ws: string, id: string, input: { name?: string; color?: string }): Promise<LabelDto> {
  const { name, color } = cleanLabel(input);
  try {
    const r = await getDb().prepare('UPDATE groups_labels SET name = ?, color = ? WHERE id = ? AND user_id = ?').run(name, color, id, ws);
    if (r.changes === 0) throw new GroupsError('not_found', 404);
  } catch (err) {
    if (err instanceof GroupsError) throw err;
    throw new GroupsError('duplicate_label', 409);
  }
  return { id, name, color };
}

export async function deleteLabel(ws: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM groups_labels WHERE id = ? AND user_id = ?').run(id, ws)).changes > 0;
}

export async function setChatLabels(ws: string, chatId: string, labelIds: string[]): Promise<void> {
  const db = getDb();
  const valid = (await db.prepare('SELECT id FROM groups_labels WHERE user_id = ?').all(ws)) as Array<{ id: string }>;
  const ok = new Set(valid.map((v) => v.id));
  const ids = [...new Set(labelIds)].filter((x) => ok.has(x)).slice(0, 20);
  await db.prepare('DELETE FROM groups_chat_labels WHERE chat_id = ?').run(chatId);
  for (const id of ids) await db.prepare('INSERT OR IGNORE INTO groups_chat_labels (chat_id, label_id) VALUES (?, ?)').run(chatId, id);
}

// ======================================================================
// Propiedades propias
// ======================================================================

export const PROPERTY_TYPES = ['text', 'number', 'select', 'multiselect', 'date', 'checkbox', 'url', 'file', 'cascade'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export type PropertyScope = 'chat' | 'ticket';

/** Opción de un desplegable dependiente (hasta 3 niveles). */
export interface CascadeNode {
  label: string;
  children?: CascadeNode[];
}

export interface PropertyDef {
  id: string;
  key: string;
  label: string;
  type: PropertyType;
  /** Opciones de select y multiselección. */
  options: string[];
  /** Árbol del desplegable dependiente. */
  tree?: CascadeNode[];
  scope: PropertyScope;
  /** Tickets: obligatoria para resolver o cerrar. */
  required: boolean;
}

/** Valor de una propiedad de tipo archivo. */
export interface FileValue {
  url: string;
  name: string;
}

type PropertyDefRow = { id: string; key: string; label: string; type: PropertyType; options: string; scope: PropertyScope; required: number };

function toPropertyDef(r: PropertyDefRow): PropertyDef {
  const raw = parseJson<unknown>(r.options, []);
  const isTree = r.type === 'cascade';
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    type: r.type,
    options: !isTree && Array.isArray(raw) ? raw.map(String) : [],
    ...(isTree ? { tree: cleanTree(raw) } : {}),
    scope: r.scope ?? 'chat',
    required: Boolean(r.required),
  };
}

export async function listPropertyDefs(ws: string, scope: PropertyScope = 'chat'): Promise<PropertyDef[]> {
  const rows = (await getDb()
    .prepare('SELECT id, key, label, type, options, scope, required FROM groups_property_defs WHERE user_id = ? AND scope = ? ORDER BY position, created_at')
    .all(ws, scope)) as PropertyDefRow[];
  return rows.map(toPropertyDef);
}

const MAX_TREE_NODES = 300;

/** Árbol de opciones → hasta 3 niveles, etiquetas únicas por nivel, sin vacías. */
export function cleanTree(raw: unknown, depth = 1, budget = { n: 0 }): CascadeNode[] {
  if (!Array.isArray(raw)) return [];
  const out: CascadeNode[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (budget.n >= MAX_TREE_NODES) break;
    const o = (typeof item === 'string' ? { label: item } : (item ?? {})) as { label?: unknown; children?: unknown };
    const label = String(o.label ?? '').trim().slice(0, 60);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    budget.n++;
    const children = depth < 3 ? cleanTree(o.children, depth + 1, budget) : [];
    out.push(children.length ? { label, children } : { label });
  }
  return out;
}

/**
 * Árbol escrito con sangría (dos espacios o un tab por nivel), una opción por
 * línea: "Argentina\n  Buenos Aires\n    CABA".
 */
export function parseTreeText(text: string): CascadeNode[] {
  const root: CascadeNode[] = [];
  const stack: CascadeNode[] = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const indent = (/^[\t ]*/.exec(line)?.[0] ?? '').replace(/\t/g, '  ').length;
    // Un nivel más que el padre como mucho (y nunca más de 3).
    const depth = Math.min(Math.floor(indent / 2), stack.length, 2);
    const node: CascadeNode = { label: line.trim().slice(0, 60) };
    stack.length = depth;
    const parent = stack[depth - 1];
    if (parent) (parent.children ??= []).push(node);
    else root.push(node);
    stack.push(node);
  }
  return cleanTree(root);
}

/** Árbol → texto con sangría (para editarlo). */
export function treeText(tree: CascadeNode[], depth = 0): string {
  return tree
    .map((n) => [`${'  '.repeat(depth)}${n.label}`, ...(n.children?.length ? [treeText(n.children, depth + 1)] : [])].join('\n'))
    .join('\n');
}

/** El camino elegido existe en el árbol (1 a 3 niveles, de la raíz hacia abajo). */
export function isTreePath(tree: CascadeNode[], path: string[]): boolean {
  let level: CascadeNode[] | undefined = tree;
  for (const step of path) {
    const hit: CascadeNode | undefined = level?.find((n) => n.label === step);
    if (!hit) return false;
    level = hit.children;
  }
  return path.length > 0;
}

function propertyKey(label: string): string {
  return (
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || `prop_${randomBytes(3).toString('hex')}`
  );
}

function cleanOptions(type: PropertyType, input: { options?: unknown; tree?: unknown }): { options: string[]; tree: CascadeNode[] } {
  if (type === 'cascade') {
    const tree = typeof input.tree === 'string' ? parseTreeText(input.tree) : cleanTree(input.tree);
    if (tree.length === 0) throw new GroupsError('missing_options');
    return { options: [], tree };
  }
  if (type !== 'select' && type !== 'multiselect') return { options: [], tree: [] };
  const list = Array.isArray(input.options) ? input.options : [];
  const options = [...new Set(list.map((o) => String(o).trim().slice(0, 60)).filter(Boolean))].slice(0, 100);
  if (options.length === 0) throw new GroupsError('missing_options');
  return { options, tree: [] };
}

export async function createPropertyDef(
  ws: string,
  input: { label?: string; type?: string; options?: unknown; tree?: unknown; scope?: string; required?: boolean },
): Promise<PropertyDef> {
  const label = String(input.label ?? '').trim().slice(0, 60);
  if (!label) throw new GroupsError('invalid_name');
  const type = PROPERTY_TYPES.find((t) => t === input.type) ?? 'text';
  const scope: PropertyScope = input.scope === 'ticket' ? 'ticket' : 'chat';
  const key = propertyKey(label);
  const { options, tree } = cleanOptions(type, input);
  const required = Boolean(input.required) && scope === 'ticket';
  const id = newId();
  const count = (await getDb().prepare('SELECT COUNT(*) AS c FROM groups_property_defs WHERE user_id = ? AND scope = ?').get(ws, scope)) as { c: number };
  if (Number(count.c) >= 100) throw new GroupsError('too_many_properties');
  const r = await getDb()
    .prepare(
      'INSERT OR IGNORE INTO groups_property_defs (id, user_id, scope, key, label, type, options, required, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, ws, scope, key, label, type, JSON.stringify(type === 'cascade' ? tree : options), required ? 1 : 0, Number(count.c), nowIso());
  if (r.changes === 0) throw new GroupsError('duplicate_property', 409);
  return { id, key, label, type, options, ...(type === 'cascade' ? { tree } : {}), scope, required };
}

/** Renombrar, cambiar opciones u obligatoria. La clave no cambia (la usan los valores y las variables). */
export async function updatePropertyDef(
  ws: string,
  id: string,
  input: { label?: string; options?: unknown; tree?: unknown; required?: boolean },
): Promise<PropertyDef> {
  const row = (await getDb()
    .prepare('SELECT id, key, label, type, options, scope, required FROM groups_property_defs WHERE id = ? AND user_id = ?')
    .get(id, ws)) as PropertyDefRow | undefined;
  if (!row) throw new GroupsError('not_found', 404);
  const label = input.label !== undefined ? String(input.label).trim().slice(0, 60) : row.label;
  if (!label) throw new GroupsError('invalid_name');
  let options = row.options;
  if (input.options !== undefined || input.tree !== undefined) {
    const o = cleanOptions(row.type, input);
    options = JSON.stringify(row.type === 'cascade' ? o.tree : o.options);
  }
  const required = input.required !== undefined ? (input.required && row.scope === 'ticket' ? 1 : 0) : row.required;
  await getDb().prepare('UPDATE groups_property_defs SET label = ?, options = ?, required = ? WHERE id = ? AND user_id = ?').run(label, options, required, id, ws);
  return toPropertyDef({ ...row, label, options, required });
}

export async function deletePropertyDef(ws: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM groups_property_defs WHERE id = ? AND user_id = ?').run(id, ws)).changes > 0;
}

export type PropertyValue = string | number | string[] | FileValue;

function isSafeFileUrl(url: string): boolean {
  return /^\/uploads\/[\w./-]+$/.test(url) || /^https:\/\/[^\s]+$/.test(url);
}

/** Valores de propiedades → solo claves definidas y valores del tipo correcto. */
export async function cleanProperties(
  ws: string,
  input: Record<string, unknown>,
  scope: PropertyScope = 'chat',
): Promise<Record<string, PropertyValue>> {
  const defs = await listPropertyDefs(ws, scope);
  const out: Record<string, PropertyValue> = {};
  for (const d of defs) {
    const v = input[d.key];
    if (v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0)) continue;
    const bad = () => new GroupsError(`invalid_property:${d.key}`);
    switch (d.type) {
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n)) throw bad();
        out[d.key] = n;
        break;
      }
      case 'select':
        if (!d.options.includes(String(v))) throw bad();
        out[d.key] = String(v);
        break;
      case 'multiselect': {
        const list = (Array.isArray(v) ? v : [v]).map(String);
        if (list.some((x) => !d.options.includes(x))) throw bad();
        out[d.key] = [...new Set(list)];
        break;
      }
      case 'cascade': {
        const path = (Array.isArray(v) ? v : String(v).split(' › ')).map(String).filter(Boolean).slice(0, 3);
        if (!isTreePath(d.tree ?? [], path)) throw bad();
        out[d.key] = path;
        break;
      }
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw bad();
        out[d.key] = String(v);
        break;
      case 'checkbox':
        if (v === true || v === 'true' || v === 1 || v === '1') out[d.key] = 'true';
        break;
      case 'url': {
        const u = String(v).trim().slice(0, 500);
        if (!/^https?:\/\/[^\s]+$/.test(u)) throw bad();
        out[d.key] = u;
        break;
      }
      case 'file': {
        const f = (v ?? {}) as Partial<FileValue>;
        const url = String(f.url ?? '');
        if (!isSafeFileUrl(url)) throw bad();
        out[d.key] = { url: url.slice(0, 1000), name: String(f.name ?? 'file').slice(0, 200) };
        break;
      }
      default:
        out[d.key] = String(v).slice(0, 500);
    }
  }
  return out;
}


/** Campos obligatorios sin completar (tickets al resolver o cerrar). */
export function missingRequired(defs: PropertyDef[], values: Record<string, unknown>): string[] {
  return defs
    .filter((d) => {
      const v = values[d.key];
      return d.required && (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0));
    })
    .map((d) => d.key);
}

// ======================================================================
// Respuestas rápidas
// ======================================================================

export interface QuickReply {
  id: string;
  shortcut: string;
  body: string;
}

export async function listQuickReplies(ws: string): Promise<QuickReply[]> {
  return (await getDb()
    .prepare('SELECT id, shortcut, body FROM groups_quick_replies WHERE user_id = ? ORDER BY shortcut')
    .all(ws)) as QuickReply[];
}

function cleanQuickReply(input: { shortcut?: string; body?: string }): { shortcut: string; body: string } {
  const shortcut = String(input.shortcut ?? '')
    .trim()
    .replace(/^\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 30);
  const body = String(input.body ?? '').trim().slice(0, 4000);
  if (!shortcut) throw new GroupsError('invalid_shortcut');
  if (!body) throw new GroupsError('empty_message');
  return { shortcut, body };
}

export async function createQuickReply(ws: string, input: { shortcut?: string; body?: string }): Promise<QuickReply> {
  const { shortcut, body } = cleanQuickReply(input);
  const id = newId();
  const r = await getDb()
    .prepare('INSERT OR IGNORE INTO groups_quick_replies (id, user_id, shortcut, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, ws, shortcut, body, nowIso());
  if (r.changes === 0) throw new GroupsError('duplicate_shortcut', 409);
  return { id, shortcut, body };
}

export async function updateQuickReply(ws: string, id: string, input: { shortcut?: string; body?: string }): Promise<QuickReply> {
  const { shortcut, body } = cleanQuickReply(input);
  try {
    const r = await getDb().prepare('UPDATE groups_quick_replies SET shortcut = ?, body = ? WHERE id = ? AND user_id = ?').run(shortcut, body, id, ws);
    if (r.changes === 0) throw new GroupsError('not_found', 404);
  } catch (err) {
    if (err instanceof GroupsError) throw err;
    throw new GroupsError('duplicate_shortcut', 409);
  }
  return { id, shortcut, body };
}

export async function deleteQuickReply(ws: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM groups_quick_replies WHERE id = ? AND user_id = ?').run(id, ws)).changes > 0;
}

// ======================================================================
// Ajustes
// ======================================================================

export async function getSettings(ws: string): Promise<GroupsSettings> {
  const row = (await getDb().prepare('SELECT data FROM groups_settings WHERE user_id = ?').get(ws)) as { data: string } | undefined;
  return row ? normalizeSettings(parseJson(row.data, {})) : { ...DEFAULT_SETTINGS };
}

export async function updateSettings(ws: string, patch: Partial<GroupsSettings>): Promise<GroupsSettings> {
  const next = normalizeSettings({ ...(await getSettings(ws)), ...patch });
  await getDb()
    .prepare(
      `INSERT INTO groups_settings (user_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(ws, JSON.stringify(next), nowIso());
  return next;
}

// ======================================================================
// Personas del workspace (asignar)
// ======================================================================

export interface GroupsPerson {
  id: string;
  name: string;
  email: string;
}

/**
 * La gente del workspace: el dueño y los miembros de todos sus teams (los
 * mismos que acepta isWorkspacePerson). Única fuente para el select de
 * asignar, el filtro, los nombres en las filas, las líneas de sistema y el
 * round-robin: no depende del team activo de quien mira.
 */
export async function listPeople(ws: string): Promise<GroupsPerson[]> {
  const db = getDb();
  const owner = (await db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(ws)) as GroupsPerson | undefined;
  const rows = (await db
    .prepare(
      `SELECT DISTINCT u.id, u.name, u.email FROM team_members m JOIN teams t ON t.id = m.team_id JOIN users u ON u.id = m.user_id
       WHERE t.owner_id = ? AND m.role != 'guest' ORDER BY COALESCE(u.name, u.email)`,
    )
    .all(ws)) as GroupsPerson[];
  const people: GroupsPerson[] = owner ? [{ ...owner, name: owner.name ?? '' }] : [];
  for (const r of rows) if (!people.some((p) => p.id === r.id)) people.push({ ...r, name: r.name ?? '' });
  return people;
}

// ======================================================================
// CRM: chats vinculados a un registro
// ======================================================================

export interface CrmChatSummary {
  chat: ChatDto;
  messages: MessageDto[];
  openTickets: number;
}

/** Chats vinculados a un contacto o empresa, con sus últimos mensajes (timeline del registro). */
export async function chatsForCrmRecord(
  ws: string,
  kind: 'contact' | 'company',
  recordId: string,
  messagesPerChat = 5,
  viewer?: GroupsViewer,
): Promise<CrmChatSummary[]> {
  const col = kind === 'contact' ? 'crm_contact_id' : 'crm_company_id';
  const access = chatAccessSql(viewer, 'c');
  const rows = (await getDb()
    .prepare(`SELECT c.* FROM groups_chats c WHERE c.user_id = ? AND c.${col} = ?${access ? ` AND ${access.sql}` : ''} ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT 10`)
    .all(ws, recordId, ...(access?.args ?? []))
    .catch(() => [])) as ChatRow[];
  const labels = await labelsFor(rows.map((r) => r.id));
  const out: CrmChatSummary[] = [];
  for (const r of rows) {
    const msgs = (await getDb()
      .prepare(
        "SELECT * FROM groups_messages WHERE chat_id = ? AND direction IN ('in', 'out') ORDER BY created_at DESC, rowid DESC LIMIT ?",
      )
      .all(r.id, messagesPerChat)) as MessageRow[];
    const open = (await getDb()
      .prepare("SELECT COUNT(*) AS c FROM groups_tickets WHERE chat_id = ? AND status IN ('open', 'in_progress')")
      .get(r.id)) as { c: number };
    const messages = msgs.reverse().map(toMessageDto);
    // "@<dígitos>" → "@Nombre", como en la conversación.
    await withLinesMentions(r.number_id, messages, r.id).catch(() => null);
    out.push({ chat: toChatDto(r, labels.get(r.id) ?? []), messages, openTickets: Number(open.c) });
  }
  return out;
}

/**
 * CRM: tareas que nacieron de un chat de Lines (tienen fila en groups_tasks).
 *
 * El CRM se lee con su propia visibilidad (lib/crm-visibility.ts), que no es la de Lines. Desde el PR #512
 * una tarea nueva no copia el nombre del chat ni el texto del mensaje, pero las tareas anteriores sí lo
 * tienen, y el título que se precarga desde el mensaje queda si nadie lo cambia. Por eso se filtra al leer:
 * a quien no ve el chat (líneas que no le dieron, acceso por etiqueta, o sin la app Lines) la tarea le llega
 * con un marcador en lugar del título, sin notas, y la búsqueda no la encuentra por ese texto. Sigue viendo
 * que la tarea existe, su vencimiento, su responsable y su registro, y puede completarla o moverla.
 *
 * No se borra ni se migra nada: el texto queda en la base para quien sí ve el chat.
 *
 * El lector (`ChatReader`) se arma una vez por pedido. null = ve todos los chats sin máscara: no hay nada
 * que filtrar y no cuesta ninguna consulta. Server-only.
 */
import { getDb } from './db';
import type { TeamRole } from './teams';
import type { AppAccess } from './workspace';
import type { ProductKey } from './products';
import { chatAccessSql, groupsViewer, type GroupsViewer } from './groups-access';
import en from '@/messages/en/crm.json';
import es from '@/messages/es/crm.json';
import pt from '@/messages/pt/crm.json';

type Locale = 'en' | 'es' | 'pt';

const MARKERS: Record<Locale, string> = {
  en: en.tasks.privateChat,
  es: es.tasks.privateChat,
  pt: pt.tasks.privateChat,
};

/** El texto neutro que reemplaza el título de una tarea de un chat que quien lee no ve. */
export function privateChatMarker(locale: string | null | undefined): string {
  return MARKERS[cleanLocale(locale)];
}

function cleanLocale(locale: string | null | undefined): Locale {
  return locale === 'es' || locale === 'pt' ? locale : 'en';
}

export interface ChatReader {
  ws: string;
  /** Visibilidad de Lines de quien lee; null si no usa Lines (no ve ningún chat). */
  viewer: GroupsViewer | null;
  /** Idioma del marcador. */
  locale: Locale;
}

/**
 * El lector de una persona del workspace. null si ve todos los chats y sin teléfonos ocultos (dueño, admins
 * sin máscara): ahí no hay nada que tapar.
 */
export async function chatReaderFor(
  who: { ws: string; personId: string; role: TeamRole; apps?: AppAccess | string | null; blockedApps?: readonly ProductKey[] | null },
  locale: string | null | undefined,
): Promise<ChatReader | null> {
  const { userCanUseApp } = await import('./workspace');
  const usesLines = userCanUseApp({ role: who.role, apps: who.apps ?? '*', blockedApps: who.blockedApps ?? null }, 'groups');
  if (!usesLines) return { ws: who.ws, viewer: null, locale: cleanLocale(locale) };
  const viewer = await groupsViewer(who.ws, who.personId, who.role);
  if (!chatAccessSql(viewer) && !viewer.mask) return null;
  return { ws: who.ws, viewer, locale: cleanLocale(locale) };
}

/**
 * Un lector que no ve ningún chat: para lo que se guarda y después leen otros (el resumen con IA de un
 * registro se guarda una vez para todos), así nunca lleva el texto de una tarea de un chat.
 */
export function noChatReader(ws: string, locale: string | null | undefined = 'en'): ChatReader {
  return { ws, viewer: null, locale: cleanLocale(locale) };
}

/** El lector de la sesión (la persona que actúa, con sus apps en el workspace activo). */
export async function sessionChatReader(
  user: { id: string; role: TeamRole; actingUser?: { id: string } | null; apps?: AppAccess; blockedApps?: ProductKey[] },
  locale: string | null | undefined,
): Promise<ChatReader | null> {
  return chatReaderFor(
    { ws: user.id, personId: user.actingUser?.id ?? user.id, role: user.role, apps: user.apps, blockedApps: user.blockedApps },
    locale,
  );
}

/** El lector de una API key: actúa como la persona que la creó, con las apps que hoy tiene. */
export async function apiChatReader(auth: { user: { id: string }; personId: string; role: TeamRole }, locale?: string | null): Promise<ChatReader | null> {
  return personChatReader(auth.user.id, auth.personId, locale ?? 'en', auth.role);
}

/** El lector de una persona fuera de un pedido (avisos del cron). Si ya no es del workspace, no ve ningún chat. */
export async function personChatReader(ws: string, personId: string, locale: string | null | undefined, role?: TeamRole): Promise<ChatReader | null> {
  const { personAppAccess } = await import('./api-auth');
  const access = await personAppAccess(ws, personId);
  if (!access) return { ws, viewer: null, locale: cleanLocale(locale) };
  // Lines apagada para esa persona en Apps del workspace: tampoco ve el texto de sus chats.
  const { blockedAppsFor } = await import('./workspace-apps');
  const email = (await getDb().prepare('SELECT email FROM users WHERE id = ?').get(personId)) as { email: string | null } | undefined;
  const blockedApps = await blockedAppsFor({ ownerId: ws, personId, role: access.role, email: email?.email ?? null });
  const apps: AppAccess = access.apps === '*' ? '*' : (access.apps as ProductKey[]);
  return chatReaderFor({ ws, personId, role: role ?? access.role, apps, blockedApps }, locale);
}

/**
 * Condición SQL (sobre el alias de crm_activities) que es verdadera cuando la actividad salió de un chat
 * que el lector no ve. null si no oculta ninguna (ve todos los chats; con teléfonos ocultos solo se enmascara).
 */
export function chatHiddenSql(alias: string, reader: ChatReader | null | undefined): { sql: string; args: string[] } | null {
  if (!reader) return null;
  if (!reader.viewer) {
    return { sql: `EXISTS (SELECT 1 FROM groups_tasks zct WHERE zct.activity_id = ${alias}.id)`, args: [] };
  }
  // La misma regla que Lines (líneas y acceso por etiqueta), sobre el chat de origen.
  const access = chatAccessSql(reader.viewer, 'zcc');
  if (!access) return null;
  return {
    // Sin el chat (se borró) tampoco se ve: no hay forma de saber si quien lee lo veía.
    sql: `EXISTS (SELECT 1 FROM groups_tasks zct WHERE zct.activity_id = ${alias}.id
      AND NOT EXISTS (SELECT 1 FROM groups_chats zcc WHERE zcc.id = zct.chat_id AND zcc.user_id = zct.user_id AND ${access.sql}))`,
    args: access.args,
  };
}

/** De estos ids de actividades, los que salieron de un chat que el lector no ve. */
export async function hiddenChatTaskIds(ws: string, ids: string[], reader: ChatReader | null | undefined): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (!reader || !unique.length) return new Set();
  const hidden = chatHiddenSql('a', reader);
  if (!hidden) return new Set();
  const out = new Set<string>();
  for (let i = 0; i < unique.length; i += 400) {
    const part = unique.slice(i, i + 400);
    const rows = (await getDb()
      .prepare(`SELECT a.id FROM crm_activities a WHERE a.user_id = ? AND a.id IN (${part.map(() => '?').join(',')}) AND ${hidden.sql}`)
      .all(ws, ...part, ...hidden.args)) as Array<{ id: string }>;
    for (const r of rows) out.add(r.id);
  }
  return out;
}

/** De estos ids, los que salieron de algún chat de Lines (para enmascarar teléfonos). */
async function chatTaskIds(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 400) {
    const part = ids.slice(i, i + 400);
    const rows = (await getDb()
      .prepare(`SELECT activity_id FROM groups_tasks WHERE activity_id IN (${part.map(() => '?').join(',')})`)
      .all(...part)) as Array<{ activity_id: string }>;
    for (const r of rows) out.add(r.activity_id);
  }
  return out;
}

/** La fila tapada: el marcador como título, sin notas, y la marca `chat_private`. */
export function redactRow<T extends { subject: string; body: string }>(row: T, locale: string | null | undefined): T & { chat_private: 1 } {
  return { ...row, subject: privateChatMarker(locale), body: '', chat_private: 1 };
}

/**
 * Las filas como las ve el lector: las de chats que no ve, tapadas (redactRow); las de chats que ve, con los
 * teléfonos enmascarados si a esa persona se le ocultan. Sin lector, tal cual. Mismo orden.
 */
export async function redactChatTasks<T extends { id: string; subject: string; body: string }>(
  ws: string,
  rows: T[],
  reader: ChatReader | null | undefined,
): Promise<T[]> {
  if (!reader || !rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const hidden = await hiddenChatTaskIds(ws, ids, reader);
  let masked: Set<string> | null = null;
  let mask: ((s: string) => string) | null = null;
  if (reader.viewer?.mask && rows.some((r) => !hidden.has(r.id))) {
    masked = await chatTaskIds(ids.filter((id) => !hidden.has(id)));
    if (masked.size) mask = (await import('./groups-mask')).maskPhoneText;
  }
  return rows.map((r) => {
    if (hidden.has(r.id)) return redactRow(r, reader.locale);
    if (mask && masked?.has(r.id)) return { ...r, subject: mask(r.subject), body: mask(r.body) };
    return r;
  });
}

/** Una fila como la ve el lector (redactChatTasks de una). */
export async function redactChatTask<T extends { id: string; subject: string; body: string }>(
  ws: string,
  row: T,
  reader: ChatReader | null | undefined,
): Promise<T> {
  return (await redactChatTasks(ws, [row], reader))[0];
}

/** ¿La actividad salió de un chat que el lector no ve? (no puede reescribir un texto que no ve). */
export async function isChatHidden(ws: string, activityId: string, reader: ChatReader | null | undefined): Promise<boolean> {
  return (await hiddenChatTaskIds(ws, [activityId], reader)).has(activityId);
}

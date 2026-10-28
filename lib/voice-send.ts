/**
 * Voice: mandar la nota de una reunión a Slack y a Notion con las conexiones
 * que el workspace ya tiene (como las integraciones de Granola). Server-only.
 *
 * - Slack: la app de Slack del workspace (Track › Ajustes › Integraciones,
 *   lib/track-slack.ts). Se publica en un canal público; el bot tiene que
 *   estar en el canal. Con SLACK_FAKE=1 no sale nada (queda en el log).
 * - Notion: una credencial de tipo Notion guardada en Flow (un admin la
 *   carga en Flow › Credenciales). Crea una página hija de la página que
 *   elija la persona (la integración de Notion tiene que tener acceso).
 *   Con VOICE_NOTION_FAKE=1 (nunca en producción) no sale nada.
 * La transcripción nunca va: solo la nota.
 */
import { getDb } from './db';
import { getSlackConnection, slackCall, slackEscape } from './track-slack';
import { IntegrationSkip } from './track-integrations';
import { listCredentials, resolveCredential } from './flow-credentials';
import { meetingPlainText, type MeetingLabels } from './voice-integrations';
import type { VoiceSessionDetail } from './voice-types';

export class VoiceSendError extends Error {
  constructor(public code: 'slack_not_connected' | 'slack_failed' | 'notion_not_connected' | 'notion_failed' | 'notion_parent') {
    super(code);
  }
}

// ---------- Slack ----------

export async function slackChannelsForVoice(workspaceId: string): Promise<{ connected: boolean; channels: Array<{ id: string; name: string }> }> {
  if (!(await getSlackConnection(workspaceId))) return { connected: false, channels: [] };
  try {
    // Solo canales públicos: una nota no termina en un canal privado de otra gente.
    const out = await slackCall(workspaceId, 'conversations.list', { types: 'public_channel', exclude_archived: true, limit: 200 });
    const channels = ((out.channels as Array<{ id: string; name: string; is_private?: boolean }> | undefined) ?? [])
      .filter((c) => !c.is_private)
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { connected: true, channels };
  } catch {
    return { connected: true, channels: [] };
  }
}

/** Texto para Slack (mrkdwn): título en negrita, la nota y el link a la reunión compartida si hay. */
export function slackMeetingText(d: VoiceSessionDetail, labels: MeetingLabels, link: string | null): string {
  const body = meetingPlainText(d, labels);
  const title = `*${slackEscape(d.title || labels.fromVoice)}* (${d.startedAt.slice(0, 10)})`;
  return [title, slackEscape(body).slice(0, 35_000), link ? `<${link}|${slackEscape(labels.fromVoice)}>` : ''].filter(Boolean).join('\n\n');
}

export async function sendToSlack(args: {
  workspaceId: string;
  channelId: string;
  detail: VoiceSessionDetail;
  labels: MeetingLabels;
  link: string | null;
}): Promise<{ channel: string; ts: string }> {
  const { connected, channels } = await slackChannelsForVoice(args.workspaceId);
  if (!connected) throw new VoiceSendError('slack_not_connected');
  if (!channels.some((c) => c.id === args.channelId)) throw new VoiceSendError('slack_failed');
  try {
    const out = await slackCall(args.workspaceId, 'chat.postMessage', {
      channel: args.channelId,
      text: slackMeetingText(args.detail, args.labels, args.link),
      unfurl_links: false,
    });
    return { channel: String(out.channel ?? args.channelId), ts: String(out.ts ?? '') };
  } catch (err) {
    if (err instanceof IntegrationSkip) throw new VoiceSendError('slack_failed');
    throw new VoiceSendError('slack_failed');
  }
}

// ---------- Notion ----------

const NOTION_VERSION = '2022-06-28';

function notionFake(): boolean {
  return process.env.VOICE_NOTION_FAKE === '1' && process.env.VERCEL_ENV !== 'production';
}

const fakeStore = globalThis as unknown as { __zsVoiceNotion?: Array<{ parent: string; title: string; blocks: number }> };

/** Páginas creadas en el Notion falso (tests). */
export function fakeNotionPages(): Array<{ parent: string; title: string; blocks: number }> {
  return (fakeStore.__zsVoiceNotion ??= []);
}

/** "https://www.notion.so/Acme-1234…abcd" o el id con guiones → id de 32 caracteres. */
export function notionPageId(input: string): string | null {
  const m = /([0-9a-f]{32})(?:[?#].*)?$/i.exec(input.trim().replace(/-/g, ''));
  return m ? m[1].toLowerCase() : null;
}

export async function notionCredentialsForVoice(workspaceId: string): Promise<Array<{ id: string; name: string }>> {
  return (await listCredentials(workspaceId)).filter((c) => c.type === 'notion' || c.type === 'oauth_token').map((c) => ({ id: c.id, name: c.name }));
}

type Block = Record<string, unknown>;

const rich = (text: string) => [{ type: 'text', text: { content: text.slice(0, 1900) } }];

/** La nota como bloques de Notion: títulos, viñetas y casillas para los próximos pasos (hasta 100). */
export function notionBlocks(d: VoiceSessionDetail, labels: MeetingLabels): Block[] {
  const out: Block[] = [];
  const h = (text: string) => out.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: rich(text) } });
  const p = (text: string) => out.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rich(text) } });
  const li = (text: string) => out.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich(text) } });
  const todo = (text: string) => out.push({ object: 'block', type: 'to_do', to_do: { rich_text: rich(text), checked: false } });
  const e = d.enhanced;
  if (e) {
    if (e.summary) {
      h(labels.summary);
      p(e.summary);
    }
    for (const s of e.sections) {
      if (!s.points.length) continue;
      h(s.heading);
      for (const pt of s.points) li(pt.text);
    }
    if (e.decisions.length) {
      h(labels.decisions);
      for (const x of e.decisions) li(x);
    }
    if (e.actionItems.length) {
      h(labels.actionItems);
      for (const a of e.actionItems) todo(`${a.text}${a.owner || a.due ? ` (${[a.owner, a.due].filter(Boolean).join(', ')})` : ''}`);
    }
  } else if (d.myNotes.trim()) {
    h(labels.myNotes);
    for (const line of d.myNotes.split('\n').map((l) => l.trim()).filter(Boolean)) p(line);
  }
  return out.slice(0, 100);
}

export async function sendToNotion(args: {
  workspaceId: string;
  credentialId: string;
  parent: string;
  detail: VoiceSessionDetail;
  labels: MeetingLabels;
}): Promise<{ id: string; url: string | null }> {
  const parent = notionPageId(args.parent);
  if (!parent) throw new VoiceSendError('notion_parent');
  const cred = await resolveCredential(args.workspaceId, args.credentialId);
  if (!cred || (cred.type !== 'notion' && cred.type !== 'oauth_token')) throw new VoiceSendError('notion_not_connected');
  const token = cred.data.token ?? cred.data.accessToken;
  if (!token) throw new VoiceSendError('notion_not_connected');
  const title = (args.detail.title || args.labels.fromVoice).slice(0, 200);
  const children = notionBlocks(args.detail, args.labels);
  if (notionFake()) {
    fakeNotionPages().push({ parent, title, blocks: children.length });
    return { id: `fake-notion-${fakeNotionPages().length}`, url: `https://www.notion.so/fake-${fakeNotionPages().length}` };
  }
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'notion-version': NOTION_VERSION, 'content-type': 'application/json' },
    body: JSON.stringify({ parent: { page_id: parent }, properties: { title: { title: rich(title) } }, children }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res?.ok) {
    const body = (await res?.json().catch(() => null)) as { code?: string } | null;
    // Página que la integración no ve (no se compartió con ella) o que no existe.
    if (body?.code === 'object_not_found' || body?.code === 'validation_error') throw new VoiceSendError('notion_parent');
    throw new VoiceSendError('notion_failed');
  }
  const page = (await res.json().catch(() => ({}))) as { id?: string; url?: string };
  return { id: page.id ?? '', url: page.url ?? null };
}

/** ¿El workspace tiene con qué mandar? (para la UI). */
export async function voiceSendTargets(workspaceId: string): Promise<{ slack: boolean; notion: Array<{ id: string; name: string }> }> {
  const [slack, notion] = await Promise.all([
    getSlackConnection(workspaceId).then((c) => !!c).catch(() => false),
    notionCredentialsForVoice(workspaceId).catch(() => []),
  ]);
  return { slack, notion };
}

/** Link de la reunión compartida (si la persona la compartió); si no, nada. */
export async function shareLinkFor(sessionId: string, origin: string, locale: string): Promise<string | null> {
  const row = (await getDb().prepare('SELECT token FROM voice_shares WHERE session_id = ?').get(sessionId)) as { token: string } | undefined;
  return row ? `${origin}/${locale}/m/${row.token}` : null;
}

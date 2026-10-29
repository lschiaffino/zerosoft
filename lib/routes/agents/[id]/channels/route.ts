import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { agentError, agentRouteContext, canEditAgents } from '@/lib/agents-http';
import { recordAgentChange } from '@/lib/agents';
import { integrationsDto } from '@/lib/agents-integrations';
import { userCanUseApp } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export interface AgentChannelsDto {
  email: { inboundConfigured: boolean; widgets: Array<{ id: string; name: string; address: string | null }> };
  whatsapp: { groupsAccess: boolean; numbers: number; isDefault: boolean; otherDefault: boolean; assignedChats: number };
  voice: { configured: boolean; number: string | null; numbers: string[]; webhookUrl: string };
  slack: { connected: boolean; eventsUrl: string };
  meta: { connected: boolean; pageName: string | null; webhookUrl: string; verifyToken: string | null };
}

async function channelsFor(ctx: Exclude<Awaited<ReturnType<typeof agentRouteContext>>, { res: unknown }>): Promise<AgentChannelsDto> {
  const { user, row } = ctx;
  const db = getDb();
  const { inboundAddress, inboundDomain } = await import('@/lib/chat-email');
  const { appBase, voiceConfigured } = await import('@/lib/twilio-voice');
  const base = appBase();
  const widgets = (await db
    .prepare("SELECT id, name FROM chat_widgets WHERE user_id = ? AND bot_source = 'agent' AND agent_id = ? ORDER BY created_at")
    .all(user.id, row.id)) as Array<{ id: string; name: string }>;
  const groupsAccess = userCanUseApp(user, 'groups');
  let whatsapp: AgentChannelsDto['whatsapp'] = { groupsAccess, numbers: 0, isDefault: false, otherDefault: false, assignedChats: 0 };
  if (groupsAccess) {
    const { getSettings } = await import('@/lib/groups');
    const settings = await getSettings(user.id);
    const numbers = (await db.prepare('SELECT COUNT(*) AS c FROM groups_numbers WHERE user_id = ?').get(user.id)) as { c: number };
    const chats = (await db.prepare('SELECT COUNT(*) AS c FROM groups_chats WHERE user_id = ? AND agent_id = ?').get(user.id, row.id)) as { c: number };
    whatsapp = {
      groupsAccess,
      numbers: Number(numbers.c),
      isDefault: settings.defaultAgentId === row.id,
      otherDefault: Boolean(settings.defaultAgentId && settings.defaultAgentId !== row.id),
      assignedChats: Number(chats.c),
    };
  }
  const { voiceNumbersFor } = await import('@/lib/agents-voice');
  const numbers = voiceNumbersFor({ id: user.id, email: user.email });
  const integ = integrationsDto(row);
  const admin = canEditAgents(user);
  return {
    email: { inboundConfigured: Boolean(inboundDomain()), widgets: widgets.map((w) => ({ id: w.id, name: w.name, address: inboundAddress('inbox', w.id) })) },
    whatsapp,
    // Solo con números que el admin de la instancia asignó a este workspace.
    voice: { configured: voiceConfigured() && numbers.length > 0, number: row.voice_number ?? null, numbers, webhookUrl: `${base}/api/agents/voice` },
    slack: { connected: integ.slack.connected, eventsUrl: `${base}/api/agents/${row.id}/slack` },
    meta: { connected: integ.meta.connected, pageName: integ.meta.pageName, webhookUrl: `${base}/api/agents/${row.id}/meta`, verifyToken: admin ? integ.meta.verifyToken : null },
  };
}

/** Estado de los canales externos del agente (email, WhatsApp, teléfono, Slack, Messenger e Instagram). */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id);
  if ('res' in ctx) return ctx.res;
  return NextResponse.json({ channels: await channelsFor(ctx) });
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('whatsapp_default'), on: z.boolean() }),
  z.object({ action: z.literal('voice_number'), number: z.string().trim().max(20).nullable() }),
]);

/** Agente por defecto de WhatsApp (pide acceso a Groups) y número de teléfono. Solo admins. */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { admin: true });
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  const { user, row } = ctx;
  if (parsed.data.action === 'whatsapp_default') {
    // Cambia un ajuste de Groups: quien lo hace tiene que tener la app Groups en el workspace.
    if (!userCanUseApp(user, 'groups')) return agentError(403, 'groups_access');
    const { getSettings, updateSettings } = await import('@/lib/groups');
    const current = await getSettings(user.id);
    const next = parsed.data.on ? row.id : current.defaultAgentId === row.id ? null : current.defaultAgentId;
    await updateSettings(user.id, { defaultAgentId: next });
  } else {
    const { e164, numberBelongsToAccount, voiceConfigured } = await import('@/lib/twilio-voice');
    const raw = parsed.data.number;
    if (raw) {
      if (!voiceConfigured()) return agentError(400, 'voice_not_configured');
      const number = e164(raw);
      if (!number) return agentError(400, 'invalid_phone');
      const { voiceNumbersFor } = await import('@/lib/agents-voice');
      if (!voiceNumbersFor({ id: user.id, email: user.email }).includes(number)) return agentError(400, 'number_not_assigned');
      if (!(await numberBelongsToAccount(number))) return agentError(400, 'number_not_in_account');
      try {
        await getDb().prepare('UPDATE agents SET voice_number = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(number, new Date().toISOString(), row.id, user.id);
      } catch (err) {
        if (/UNIQUE/.test(String(err))) return agentError(409, 'number_taken');
        throw err;
      }
    } else {
      await getDb().prepare('UPDATE agents SET voice_number = NULL, updated_at = ? WHERE id = ? AND user_id = ?').run(new Date().toISOString(), row.id, user.id);
    }
    await recordAgentChange(user.id, row.id, ctx.personId, 'voice_changed', { number: raw ? 'set' : 'removed' });
  }
  const fresh = await agentRouteContext(id, { admin: true });
  if ('res' in fresh) return fresh.res;
  return NextResponse.json({ channels: await channelsFor(fresh) });
}

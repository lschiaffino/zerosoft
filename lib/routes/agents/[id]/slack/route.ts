import { after, NextRequest, NextResponse } from 'next/server';
import { getAgentRowById } from '@/lib/agents';
import { integrationSecrets, slackPost, verifySlackSignature } from '@/lib/agents-integrations';
import { claimChannelEvent, replyOnExternal, textWithUi } from '@/lib/agents-channels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

interface SlackEvent {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
}

/**
 * Events API de la app de Slack del dueño (Request URL de "Event
 * Subscriptions"). Firma verificada con su signing secret. El agente contesta
 * menciones (app_mention) y mensajes directos (message.im) en el mismo hilo.
 */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const raw = await req.text();
  const agent = await getAgentRowById(id);
  const slack = agent ? integrationSecrets(agent).slack : null;
  if (!agent || !slack?.signingSecret) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!verifySlackSignature(slack.signingSecret, req.headers.get('x-slack-request-timestamp'), raw, req.headers.get('x-slack-signature'))) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }
  let body: { type?: string; challenge?: string; event_id?: string; team_id?: string; event?: SlackEvent };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  if (body.type === 'url_verification') return NextResponse.json({ challenge: String(body.challenge ?? '') });
  // Slack reintenta si no contestamos en 3 s: el agente responde después.
  if (req.headers.get('x-slack-retry-num')) return NextResponse.json({ ok: true });
  const ev = body.event;
  if (body.type !== 'event_callback' || !ev || ev.bot_id || ev.subtype || !ev.channel || !ev.ts) return NextResponse.json({ ok: true });
  const isDm = ev.type === 'message' && ev.channel_type === 'im';
  if (ev.type !== 'app_mention' && !isDm) return NextResponse.json({ ok: true });
  if (slack.botUserId && ev.user === slack.botUserId) return NextResponse.json({ ok: true });
  if (!(await claimChannelEvent(agent.id, `slack:${body.event_id ?? ev.ts}`))) return NextResponse.json({ ok: true });
  const text = String(ev.text ?? '')
    .replace(/<@[A-Z0-9]+>/g, '')
    .trim();
  const thread = ev.thread_ts || ev.ts;
  const job = async () => {
    const reply = await replyOnExternal({
      agent,
      source: 'slack',
      externalRef: `slack:${body.team_id ?? ''}:${ev.channel}:${isDm ? 'dm' : thread}`,
      text,
    });
    if (!reply || reply.handedOff || !reply.text) return;
    await slackPost(slack.botToken, ev.channel!, await textWithUi(reply), isDm ? null : thread);
  };
  after(() => job().catch(() => {}));
  return NextResponse.json({ ok: true });
}

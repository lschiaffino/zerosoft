import { timingSafeEqual } from 'crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { getAgentRowById } from '@/lib/agents';
import { integrationSecrets, metaSend, verifyMetaSignature } from '@/lib/agents-integrations';
import { claimChannelEvent, replyOnExternal, textWithUi } from '@/lib/agents-channels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Verificación del webhook (Meta manda hub.verify_token y espera hub.challenge). */
export async function GET(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const agent = await getAgentRowById(id);
  const meta = agent ? integrationSecrets(agent).meta : null;
  const sp = req.nextUrl.searchParams;
  if (!meta || sp.get('hub.mode') !== 'subscribe' || !sameToken(sp.get('hub.verify_token') ?? '', meta.verifyToken)) {
    return new NextResponse('forbidden', { status: 403 });
  }
  return new NextResponse(String(sp.get('hub.challenge') ?? '').slice(0, 200), { status: 200, headers: { 'content-type': 'text/plain' } });
}

interface MetaMessaging {
  sender?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; quick_reply?: { payload?: string } };
}

/**
 * Mensajes de Messenger (object 'page') e Instagram (object 'instagram')
 * de la página del dueño. Firma X-Hub-Signature-256 con el app secret. El
 * agente contesta por la Send API; los botones van como quick replies.
 */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const raw = await req.text();
  const agent = await getAgentRowById(id);
  const meta = agent ? integrationSecrets(agent).meta : null;
  if (!agent || !meta?.appSecret) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!verifyMetaSignature(meta.appSecret, raw, req.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }
  let body: { object?: string; entry?: Array<{ messaging?: MetaMessaging[] }> };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const source = body.object === 'instagram' ? 'instagram' : body.object === 'page' ? 'messenger' : null;
  if (!source) return NextResponse.json({ ok: true });
  const jobs: Array<() => Promise<void>> = [];
  for (const entry of (body.entry ?? []).slice(0, 20)) {
    for (const m of (entry.messaging ?? []).slice(0, 20)) {
      const sender = m.sender?.id;
      const text = (m.message?.quick_reply?.payload ?? m.message?.text ?? '').trim();
      if (!sender || !m.message || m.message.is_echo || !text) continue;
      // Sin mid, la clave es el remitente y la hora del mensaje (un "sí" repetido después no se pierde).
      const key = m.message.mid ?? `${sender}:${m.timestamp ?? Date.now()}`;
      if (!(await claimChannelEvent(agent.id, `meta:${key}`))) continue;
      jobs.push(async () => {
        const reply = await replyOnExternal({ agent, source, externalRef: `${source}:${sender}`, text });
        if (!reply || reply.handedOff || !reply.text) return;
        if (reply.ui?.kind === 'buttons') await metaSend(meta.pageToken, sender, reply.text, reply.ui.options);
        else await metaSend(meta.pageToken, sender, await textWithUi(reply));
      });
    }
  }
  if (jobs.length) after(async () => {
    for (const j of jobs) await j().catch(() => {});
  });
  return NextResponse.json({ ok: true });
}

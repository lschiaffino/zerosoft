import { after, NextResponse } from 'next/server';
import { chatError, chatSession, collabError, readBody, type ChatSession } from '@/lib/chat-http';
import { campaignCap, describeAudience, deleteCampaign, getCampaign, processChatCampaigns, startCampaign, updateCampaign } from '@/lib/chat-campaigns';
import { recordChatAudit } from '@/lib/chat-audit';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function visible(s: ChatSession, id: string) {
  const campaign = await getCampaign(s.ws, id);
  return campaign && s.widgets.some((w) => w.id === campaign.widget_id) ? campaign : null;
}

/** La campaña y a cuántas personas le llegaría ahora. */
export async function GET(_req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession();
  if (s instanceof NextResponse) return s;
  const campaign = await visible(s, id);
  if (!campaign) return chatError(404, 'not_found');
  const info = await describeAudience(campaign.widget_id, campaign.audience);
  return NextResponse.json({ ...campaign, audience_size: info.size, excluded_imported: info.excludedImported, excluded_unsubscribed: info.excludedUnsubscribed, cap: await campaignCap(s.ws) });
}

export async function PATCH(req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  if (!(await visible(s, id))) return chatError(404, 'not_found');
  const body = await readBody(req);
  if (!body) return chatError(400, 'invalid_input');
  if (body.widget_id && !s.widgets.some((w) => w.id === body.widget_id)) return chatError(400, 'invalid_input');
  try {
    return NextResponse.json(await updateCampaign(s.ws, id, body));
  } catch (err) {
    return collabError(err);
  }
}

/** Enviar: { action: 'send' }. El primer lote sale ya; el resto, por el cron de cada minuto. */
export async function POST(req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  if (!(await visible(s, id))) return chatError(404, 'not_found');
  const body = await readBody(req);
  if (body?.action !== 'send') return chatError(400, 'invalid_input');
  try {
    const campaign = await startCampaign(s.ws, id);
    await recordChatAudit(s.ws, s.me, 'campaign.sent', { id, recipients: campaign.total });
    const origin = new URL(req.url).origin;
    after(() => processChatCampaigns({ limit: 40, origin, campaignId: id }).then(() => undefined));
    return NextResponse.json(campaign);
  } catch (err) {
    return collabError(err);
  }
}

export async function DELETE(_req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  if (!(await visible(s, id))) return chatError(404, 'not_found');
  await deleteCampaign(s.ws, id);
  return NextResponse.json({ ok: true });
}

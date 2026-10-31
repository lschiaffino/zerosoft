import { NextResponse } from 'next/server';
import { chatError, chatSession, collabError, readBody } from '@/lib/chat-http';
import { createCampaign, listCampaigns } from '@/lib/chat-campaigns';
import { recordChatAudit } from '@/lib/chat-audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const s = await chatSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ campaigns: await listCampaigns(s.ws, s.widgets.map((w) => w.id)) });
}

/** Mandar emails a toda una base es de admins, igual que el export masivo. */
export async function POST(req: Request) {
  const s = await chatSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const body = await readBody(req);
  if (!body) return chatError(400, 'invalid_input');
  if (!s.widgets.some((w) => w.id === body.widget_id)) return chatError(400, 'invalid_input');
  try {
    const campaign = await createCampaign(s.ws, s.me, body);
    await recordChatAudit(s.ws, s.me, 'campaign.created', { id: campaign.id, name: campaign.name });
    return NextResponse.json(campaign, { status: 201 });
  } catch (err) {
    return collabError(err);
  }
}

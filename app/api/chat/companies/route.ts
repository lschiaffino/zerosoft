import { NextResponse } from 'next/server';
import { chatSession, collabError, chatError, readBody } from '@/lib/chat-http';
import { createCompany, listCompanies } from '@/lib/chat-companies';

export const dynamic = 'force-dynamic';

export async function GET() {
  const s = await chatSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ companies: await listCompanies(s.ws) });
}

export async function POST(req: Request) {
  const s = await chatSession({ write: true });
  if (s instanceof NextResponse) return s;
  const body = await readBody(req);
  if (!body) return chatError(400, 'invalid_input');
  try {
    return NextResponse.json(await createCompany(s.ws, body), { status: 201 });
  } catch (err) {
    return collabError(err);
  }
}

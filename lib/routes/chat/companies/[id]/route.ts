import { NextResponse } from 'next/server';
import { chatError, chatSession, collabError, readBody } from '@/lib/chat-http';
import { deleteCompany, getCompany, updateCompany } from '@/lib/chat-companies';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession();
  if (s instanceof NextResponse) return s;
  const company = await getCompany(s.ws, id);
  return company ? NextResponse.json(company) : chatError(404, 'not_found');
}

export async function PATCH(req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession({ write: true });
  if (s instanceof NextResponse) return s;
  const body = await readBody(req);
  if (!body) return chatError(400, 'invalid_input');
  try {
    const company = await updateCompany(s.ws, id, body);
    return company ? NextResponse.json(company) : chatError(404, 'not_found');
  } catch (err) {
    return collabError(err);
  }
}

export async function DELETE(_req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession({ write: true });
  if (s instanceof NextResponse) return s;
  return (await deleteCompany(s.ws, id)) ? NextResponse.json({ ok: true }) : chatError(404, 'not_found');
}

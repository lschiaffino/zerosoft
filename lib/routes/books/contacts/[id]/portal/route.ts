import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { sendStatement, setPortal } from '@/lib/books-statements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** { action: 'enable' | 'revoke' | 'send', locale? } */
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    const id = (await params).id;
    const b = await readJson(req);
    if (b.action === 'send') return sendStatement(actor, id, b.locale ? String(b.locale) : 'en');
    return setPortal(actor, id, b.action === 'revoke' ? 'revoke' : 'enable');
  });
}

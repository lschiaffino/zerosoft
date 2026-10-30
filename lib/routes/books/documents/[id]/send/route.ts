import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { sendDocument } from '@/lib/books-integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => { const b = await readJson(req); return { doc: await sendDocument(actor, (await params).id, { to: b.to ? String(b.to) : undefined, message: b.message ? String(b.message) : undefined, locale: b.locale ? String(b.locale) : undefined }) }; });
}

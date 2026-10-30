import { NextRequest } from 'next/server';
import { handle } from '@/lib/books-http';
import { authorizeDocument } from '@/lib/books-einvoice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ doc: await authorizeDocument(actor, (await params).id) }));
}

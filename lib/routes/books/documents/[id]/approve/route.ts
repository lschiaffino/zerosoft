import { NextRequest } from 'next/server';
import { handle } from '@/lib/books-http';
import { approveDocument } from '@/lib/books-docs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ doc: await approveDocument(actor, (await params).id) }));
}

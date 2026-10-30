import { NextRequest } from 'next/server';
import { handle } from '@/lib/books-http';
import { extractReceipt } from '@/lib/books-purchasing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ extraction: await extractReceipt(actor, (await params).id) }));
}

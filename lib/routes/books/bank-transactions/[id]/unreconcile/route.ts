import { NextRequest } from 'next/server';
import { handle } from '@/lib/books-http';
import { unreconcile } from '@/lib/books-bank';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ transaction: await unreconcile(actor, (await params).id) }));
}

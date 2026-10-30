import { NextRequest } from 'next/server';
import { handle } from '@/lib/books-http';
import { postExpense } from '@/lib/books-purchasing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ expense: await postExpense(actor, (await params).id) }));
}

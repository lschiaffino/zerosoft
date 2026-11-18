import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { createOpeningBalances } from '@/lib/books-accounting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => createOpeningBalances(actor, (await readJson(req)) as Parameters<typeof createOpeningBalances>[1]), 201);
}

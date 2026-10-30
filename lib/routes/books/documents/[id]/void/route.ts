import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { voidDocument } from '@/lib/books-docs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ doc: await voidDocument(actor, (await params).id, String((await readJson(req)).reason ?? '')) }));
}

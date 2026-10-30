import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { setPublicLink } from '@/lib/books-docs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ doc: await setPublicLink(actor, (await params).id, (await readJson(req)).action === 'regenerate' ? 'regenerate' : 'revoke') }));
}

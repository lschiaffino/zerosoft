import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { depreciationPreview, rollbackDepreciation, runDepreciation } from '@/lib/books-accounting';
import { todayIso } from '@/lib/books-money';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => {
    need(actor, 'accounting.read');
    return { plan: await depreciationPreview(actor.ws, req.nextUrl.searchParams.get('through') ?? todayIso().slice(0, 7)) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => runDepreciation(actor, String((await readJson(req)).through ?? todayIso().slice(0, 7))));
}

export async function DELETE() {
  return handle(async ({ actor }) => rollbackDepreciation(actor));
}

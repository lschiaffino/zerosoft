import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { listTaxRates, saveTaxRate } from '@/lib/books';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handle(async ({ actor }) => ({ taxes: await listTaxRates(actor.ws, { includeArchived: req.nextUrl.searchParams.get('archived') === '1' }) }));
}

/** POST /api/books/taxes { name, code, rateBps, isDefault }. */
export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => {
    const b = await readJson(req);
    return { tax: await saveTaxRate(actor, { name: String(b.name ?? ''), code: String(b.code ?? ''), rateBps: Number(b.rateBps), isDefault: Boolean(b.isDefault) }) };
  }, 201);
}

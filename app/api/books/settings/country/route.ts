import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { resetCountry } from '@/lib/books';
import type { BooksCountry } from '@/lib/books-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/books/settings/country { country }: rearma plan de cuentas, impuestos y series (solo antes de emitir nada). */
export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => ({ settings: await resetCountry(actor, String((await readJson(req)).country ?? '') as BooksCountry) }));
}

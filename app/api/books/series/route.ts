import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { listSeries, saveSeries } from '@/lib/books';
import type { DocType } from '@/lib/books-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async ({ actor }) => ({ series: await listSeries(actor.ws) }));
}

/** POST /api/books/series { docType, name, letter, pointOfSale, nextNumber, isDefault }. */
export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => {
    const b = await readJson(req);
    return {
      series: await saveSeries(actor, {
        docType: String(b.docType ?? 'invoice') as DocType,
        name: String(b.name ?? ''),
        letter: String(b.letter ?? ''),
        pointOfSale: Number(b.pointOfSale ?? 1),
        nextNumber: b.nextNumber === undefined ? undefined : Number(b.nextNumber),
        isDefault: Boolean(b.isDefault),
      }),
    };
  }, 201);
}

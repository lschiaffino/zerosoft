import { NextRequest } from 'next/server';
import { handle, must, readJson } from '@/lib/books-http';
import { getSeries, saveSeries } from '@/lib/books';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    const id = (await params).id;
    const cur = must(await getSeries(actor.ws, id));
    const b = await readJson(req);
    return {
      series: await saveSeries(actor, {
        id,
        docType: cur.doc_type,
        name: b.name === undefined ? cur.name : String(b.name),
        letter: b.letter === undefined ? cur.letter : String(b.letter),
        pointOfSale: b.pointOfSale === undefined ? cur.point_of_sale : Number(b.pointOfSale),
        nextNumber: b.nextNumber === undefined ? undefined : Number(b.nextNumber),
        isDefault: b.isDefault === undefined ? undefined : Boolean(b.isDefault),
        archived: b.archived === undefined ? undefined : Boolean(b.archived),
      }),
    };
  });
}

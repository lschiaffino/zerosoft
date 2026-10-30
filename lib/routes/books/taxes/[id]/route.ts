import { NextRequest } from 'next/server';
import { handle, must, readJson } from '@/lib/books-http';
import { getTaxRate, saveTaxRate } from '@/lib/books';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => {
    const id = (await params).id;
    const cur = must(await getTaxRate(actor.ws, id));
    const b = await readJson(req);
    return {
      tax: await saveTaxRate(actor, {
        id,
        name: b.name === undefined ? cur.name : String(b.name),
        code: b.code === undefined ? cur.code : String(b.code),
        rateBps: b.rateBps === undefined ? cur.rate_bps : Number(b.rateBps),
        isDefault: b.isDefault === undefined ? undefined : Boolean(b.isDefault),
        archived: b.archived === undefined ? undefined : Boolean(b.archived),
      }),
    };
  });
}

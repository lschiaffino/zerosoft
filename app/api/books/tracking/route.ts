import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { listTracking, saveTrackingCategory, saveTrackingOption, type TrackingSlot } from '@/lib/books-accounting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async ({ actor }) => ({ categories: await listTracking(actor.ws) }));
}

/** Categoría ({ slot, name }) u opción ({ categoryId, id?, name?, archived? }). */
export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => {
    const b = await readJson(req);
    if (b.categoryId) return { categories: await saveTrackingOption(actor, { categoryId: String(b.categoryId), id: b.id ? String(b.id) : undefined, name: b.name !== undefined ? String(b.name) : undefined, archived: b.archived === undefined ? undefined : Boolean(b.archived) }) };
    return { categories: await saveTrackingCategory(actor, { slot: b.slot as TrackingSlot, name: String(b.name ?? '') }) };
  });
}

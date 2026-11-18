import { NextRequest } from 'next/server';
import { can } from '@/lib/books-roles';
import { handle, readJson } from '@/lib/books-http';
import { listBatches, recordBatchPayment, type BatchInput } from '@/lib/books-batch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async ({ actor }) => {
    const types = [...(can(actor.role, 'invoices.read') ? (['invoice'] as const) : []), ...(can(actor.role, 'bills.read') ? (['bill'] as const) : [])];
    return { batches: await listBatches(actor.ws, types) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => ({ batch: await recordBatchPayment(actor, (await readJson(req)) as unknown as BatchInput) }), 201);
}

import { NextRequest } from 'next/server';
import { handle } from '@/lib/books-http';
import { deletePayment } from '@/lib/books-docs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/books/payments/<id>: quita un cobro registrado a mano (revierte su asiento). */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async ({ actor }) => ({ doc: await deletePayment(actor, (await params).id) }));
}

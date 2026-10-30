import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { ensureBooks, listRoles, settingsDto, updateSettings } from '@/lib/books';
import { paymentsView } from '@/lib/books-payments';
import { einvoiceView } from '@/lib/books-einvoice';
import { listOwnerSpacePeople } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/books/settings: empresa, numeración y recordatorios; cobros, factura electrónica y roles solo para admins. */
export async function GET() {
  return handle(async ({ actor }) => {
    const s = await ensureBooks(actor.ws);
    const admin = actor.admin;
    const people = admin ? await listOwnerSpacePeople(actor.ws, { app: 'books' }).catch(() => []) : [];
    return {
      settings: settingsDto(s),
      role: actor.role,
      admin,
      payments: admin ? paymentsView(s) : null,
      einvoice: admin ? einvoiceView(s) : null,
      roles: admin ? await listRoles(actor.ws) : null,
      people: people.map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role })),
    };
  });
}

/** PATCH /api/books/settings: datos de la empresa, plazo, recordatorios, cierre, integraciones. */
export async function PATCH(req: NextRequest) {
  return handle(async ({ actor }) => ({ settings: await updateSettings(actor, await readJson(req)) }));
}

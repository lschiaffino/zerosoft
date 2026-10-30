import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { listRoles, setRole } from '@/lib/books';
import { BooksError } from '@/lib/books-schema';
import type { BooksRole } from '@/lib/books-roles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async ({ actor }) => {
    if (!actor.admin) throw new BooksError('forbidden', 403);
    return { roles: await listRoles(actor.ws) };
  });
}

/** PUT /api/books/settings/roles { personId, role }: accountant, sales o viewer (admins). */
export async function PUT(req: NextRequest) {
  return handle(async ({ actor }) => {
    const b = await readJson(req);
    await setRole(actor, String(b.personId ?? ''), String(b.role ?? '') as BooksRole);
    return { roles: await listRoles(actor.ws) };
  });
}

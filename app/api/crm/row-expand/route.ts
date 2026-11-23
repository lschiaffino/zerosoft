import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { sessionChatReader } from '@/lib/crm-chat-privacy';
import { crmError, guardRecord, notFound, unauthorized } from '@/lib/crm-http';
import { requestLocale } from '@/lib/request-locale';
import { rowExpansion } from '@/lib/crm-row-expand';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  type: z.enum(['contact', 'company', 'deal']),
  id: z.string().min(1).max(64),
});

const TABLES = { contact: 'crm_contacts', company: 'crm_companies', deal: 'crm_deals' } as const;

/**
 * La fila desplegada de un índice del CRM (C4): asociados y última actividad
 * del registro, solo lo que la persona ve (lib/crm-row-expand.ts). Un
 * registro de otro workspace o fuera de su alcance da 404, igual que uno que
 * no existe.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = querySchema.safeParse({ type: req.nextUrl.searchParams.get('type'), id: req.nextUrl.searchParams.get('id') });
  if (!parsed.success) return crmError(400, 'invalid_input');
  const { type, id } = parsed.data;
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, type, id, scope);
  if (hidden) return hidden;
  // Sin restricción de alcance (admins), guardRecord no mira el workspace: el registro tiene que ser de este.
  const exists = await getDb().prepare(`SELECT 1 AS ok FROM ${TABLES[type]} WHERE id = ? AND user_id = ?`).get(id, user.id);
  if (!exists) return notFound();
  const chatReader = await sessionChatReader(user, requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language')));
  return NextResponse.json(await rowExpansion(user.id, type, id, { scope, chatReader }));
}

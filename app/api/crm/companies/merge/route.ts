import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope, visibleIds } from '@/lib/crm-visibility';
import { maskPrivateRef, PRIVATE_REFS } from '@/lib/crm-record-scope';
import { hiddenFieldsFor, redactRow, sessionFieldViewer } from '@/lib/crm-field-perms';
import { mergeCompanies } from '@/lib/crm-company-merge';
import { contactMergeSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fusiona dropId en keepId; la descartada queda en la papelera (restaurable). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = contactMergeSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const { keepId, dropId } = parsed.data;
  if (keepId === dropId) return crmError(400, 'invalid_input');
  const scope = await sessionScope(user);
  if ((await visibleIds(user.id, 'crm_companies', [keepId, dropId], scope)).length < 2) return notFound();

  const res = await mergeCompanies(user.id, keepId, dropId, user.actingUser?.email ?? user.email);
  if (!res.ok) return res.reason === 'same' ? crmError(400, 'invalid_input') : notFound();
  // La fusión junta los campos propios de las dos: sin los que la persona tiene ocultos.
  // La empresa madre que queda puede ser una que la persona no ve: sale como privada.
  const shown = (await maskPrivateRef(user.id, res.company, [PRIVATE_REFS.parent()], scope)) ?? res.company;
  return NextResponse.json(redactRow(shown, await hiddenFieldsFor(sessionFieldViewer(user), 'companies')));
}

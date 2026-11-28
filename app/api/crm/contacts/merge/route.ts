import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope, visibleIds } from '@/lib/crm-visibility';
import { maskPrivateRef, PRIVATE_REFS } from '@/lib/crm-record-scope';
import { hiddenFieldsFor, redactRow, sessionFieldViewer } from '@/lib/crm-field-perms';
import { mergeContacts } from '@/lib/crm';
import { contactMergeSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = contactMergeSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const { keepId, dropId } = parsed.data;
  const scope = await sessionScope(user);
  if ((await visibleIds(user.id, 'crm_contacts', [keepId, dropId], scope)).length < (keepId === dropId ? 1 : 2)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (keepId === dropId) return crmError(400, 'invalid_input');

  const merged = await mergeContacts(user.id, keepId, dropId);
  if (!merged) return notFound();
  // La fusión junta los campos propios de los dos: sin los que la persona tiene ocultos. La empresa
  // principal puede quedar una del contacto que se borró que la persona no ve: sale como privada.
  const shown = (await maskPrivateRef(user.id, merged, [PRIVATE_REFS.company([])], scope)) ?? merged;
  return NextResponse.json(redactRow(shown, await hiddenFieldsFor(sessionFieldViewer(user), 'contacts')));
}

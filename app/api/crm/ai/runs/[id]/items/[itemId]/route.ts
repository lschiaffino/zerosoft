import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { invalidBody, unauthorized } from '@/lib/crm-http';
import { sessionScope } from '@/lib/crm-visibility';
import { itemUpdateSchema, updateItem } from '@/lib/crm-ai-agents';
import { aiErrorResponse } from '@/lib/crm-ai-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Editar el borrador (asunto/cuerpo) o descartar el ítem. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = itemUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    return NextResponse.json(await updateItem(user.id, id, itemId, parsed.data, await sessionScope(user)));
  } catch (err) {
    return aiErrorResponse(err);
  }
}

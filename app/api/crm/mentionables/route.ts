import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { unauthorized } from '@/lib/crm-http';
import { mentionablePeople } from '@/lib/crm-mention-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Personas que se pueden @mencionar en notas y comentarios (las del equipo
 * activo, como las que la ficha ya le pasa al timeline). Lo usa el composer
 * de la vista previa, que no carga la ficha.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const people = await mentionablePeople(user);
  return NextResponse.json({ people: people.map((p) => ({ id: p.id, name: p.name, email: p.email })) });
}

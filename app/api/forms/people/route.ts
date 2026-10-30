import { listOwnerSpacePeople } from '@/lib/workspace';
import { fJson, formsActor } from '@/lib/forms/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: personas del workspace con la app Forms (para compartir un form y elegir a quién avisar). */
export async function GET() {
  const a = await formsActor();
  if ('res' in a) return a.res;
  const people = await listOwnerSpacePeople(a.actor.ws, { app: 'forms' });
  return fJson({ people: people.map((p) => ({ id: p.id, name: p.name || p.email.split('@')[0], email: p.email, role: p.role })) });
}

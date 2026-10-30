import { designActor, designJson } from '@/lib/design-http';
import { designPeople } from '@/lib/design-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Gente del workspace que puede usar Design (para compartir con personas). */
export async function GET() {
  const s = await designActor();
  if ('res' in s) return s.res;
  return designJson({ people: await designPeople(s.user) });
}

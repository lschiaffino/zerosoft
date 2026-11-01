import { recActivity, recWorkspaceInsights } from '@/lib/rec-admin';
import { recActor, recFail, recJson } from '@/lib/rec-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Uso del workspace y registro de actividad de Rec: solo admins. */
export async function GET() {
  const s = await recActor();
  if ('res' in s) return s.res;
  try {
    return recJson({ insights: await recWorkspaceInsights(s.actor, 30), activity: await recActivity(s.actor) });
  } catch (err) {
    return recFail(err);
  }
}

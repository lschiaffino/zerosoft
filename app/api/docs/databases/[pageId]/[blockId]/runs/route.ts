import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { DbServerError, listAutomationRuns, loadDatabase } from '@/lib/docs-db-server';
import { docsError, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ pageId: string; blockId: string }> };

/** Últimas corridas de automatizaciones y botones de una base (quien puede editarla). */
export async function GET(_req: NextRequest, props: Params) {
  const { pageId, blockId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  try {
    await loadDatabase(user, pageId, blockId, { edit: true });
    return NextResponse.json({ rows: await listAutomationRuns(pageId, blockId) });
  } catch (err) {
    if (err instanceof DbServerError) return docsError(err.status, err.code);
    throw err;
  }
}

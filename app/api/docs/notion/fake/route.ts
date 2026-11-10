import { NextRequest, NextResponse } from 'next/server';
import { notionFakeAllowed } from '@/lib/notion-api-fake';
import { isNotionSyncFakeToken, notionSyncFakeCall } from '@/lib/notion-sync-fake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Solo e2e (NOTION_IMPORT_FAKE=1 con DEMO_MODE o NODE_ENV=test): edita el
 * Notion falso "como una persona en Notion", con la misma API. Fuera de eso
 * responde 404. Nunca toca un Notion real: solo tokens fake-notion-sync*.
 */
export async function POST(req: NextRequest) {
  if (!notionFakeAllowed()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { token?: unknown; method?: unknown; path?: unknown; body?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token : '';
  const method = typeof body?.method === 'string' ? body.method.toUpperCase() : 'GET';
  const path = typeof body?.path === 'string' ? body.path : '';
  if (!isNotionSyncFakeToken(token) || !path.startsWith('/') || !['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const res = await notionSyncFakeCall(token, method, path, body?.body);
  return NextResponse.json(res.data, { status: res.status });
}

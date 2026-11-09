import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId, userCanUseApp } from '@/lib/session';
import { connectNotion, exchangeNotionCode, NotionSyncError } from '@/lib/notion-sync';
import { logDocsAudit, requestIp } from '@/lib/docs-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'zs-notion-state';

/** Vuelta de Notion: valida el state, cambia el código por el token (cifrado) y arranca el import. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!userCanUseApp(user, 'docs') || !isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const code = sp.get('code');
  const state = sp.get('state');
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;
  const out = (result: string) => {
    const r = NextResponse.redirect(new URL(`/app/docs/settings?tab=integrations&notion=${result}`, req.url));
    r.cookies.delete(STATE_COOKIE);
    return r;
  };
  if (sp.get('error')) return out('denied');
  // El state ata la vuelta a este workspace y a esta persona (y a esta pestaña, por la cookie).
  if (!code || !state || !cookieState || state !== cookieState || !state.startsWith(`${user.id}.${realUserId(user)}.`)) return out('error');
  try {
    const token = await exchangeNotionCode(code);
    await connectNotion(user.id, realUserId(user), {
      kind: 'oauth',
      token: token.access_token,
      refreshToken: token.refresh_token ?? null,
      botId: token.bot_id ?? null,
      notionWorkspaceId: token.workspace_id ?? null,
      workspaceName: token.workspace_name ?? null,
    });
  } catch (e) {
    if (e instanceof NotionSyncError) return out('error');
    throw e;
  }
  await logDocsAudit({ workspaceId: user.id, actor: user.actingUser ?? user, action: 'settings.notion', detail: 'connected (oauth)', ip: requestIp(req.headers) });
  return out('connected');
}

import { NextRequest, NextResponse } from 'next/server';
import { withTalk } from '@/lib/talk-http';
import { exportTalk } from '@/lib/talk-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Export en JSON: ?scope=public (canales públicos, admins) o ?scope=mine (lo mío como miembro). */
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get('scope') === 'public' ? 'public' : 'mine';
  return withTalk(
    async ({ actor }) => {
      const data = await exportTalk(actor, scope);
      const day = data.exported_at.slice(0, 10);
      return new NextResponse(JSON.stringify(data, null, 2), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="talk-${scope}-${day}.json"`,
          'cache-control': 'no-store',
        },
      });
    },
    { write: 'export', limit: 10 },
  );
}

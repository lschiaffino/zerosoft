import { hookScript } from '@/lib/fleet/hook-script';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: el script del hook de Claude Code (lo baja el instalador). Público: no lleva nada de nadie. */
export async function GET() {
  return new Response(hookScript(), {
    headers: { 'content-type': 'text/x-shellscript; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' },
  });
}

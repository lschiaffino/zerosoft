import { NextRequest } from 'next/server';
import { installScript } from '@/lib/fleet/hook-script';
import { baseUrlOf } from '@/lib/fleet/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: el instalador del hook (curl … | sh -s -- zsf_…). Público: el token lo pone la persona en su máquina. */
export async function GET(req: NextRequest) {
  return new Response(installScript(baseUrlOf(req)), {
    headers: { 'content-type': 'text/x-shellscript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

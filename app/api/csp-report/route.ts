import { NextRequest, NextResponse } from 'next/server';
import { cspReportLines } from '@/lib/csp-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Avisos de la CSP de la app (lib/csp.ts, hoy Report-Only). Sin base de
 * datos: una línea por aviso en el log, con tope por instancia, para ver qué
 * bloquearía la política antes de hacerla obligatoria. Nada de la URL más
 * allá del path (ni query ni hash) llega al log.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
let windowStart = 0;
let logged = 0;

export async function POST(req: NextRequest) {
  const text = await req.text().catch(() => '');
  if (text.length > 64_000) return new NextResponse(null, { status: 413 });
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    logged = 0;
  }
  for (const line of cspReportLines(text)) {
    if (logged >= MAX_PER_WINDOW) break;
    logged += 1;
    console.warn(`csp-report ${line}`);
  }
  return new NextResponse(null, { status: 204 });
}

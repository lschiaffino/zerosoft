import { llmsFullTxt } from '@/lib/llms';

// Se arma en el build: sale de datos del repo (lib/llms.ts).
export const dynamic = 'force-static';

export function GET() {
  return new Response(llmsFullTxt(), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}

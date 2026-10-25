import { mcpHttpPost, mcpMethodNotAllowed } from '@/lib/track-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Igual que /api/mcp/track pero solo con las herramientas de lectura. */
export async function POST(req: Request) {
  return mcpHttpPost(req, true);
}

export async function GET() {
  return mcpMethodNotAllowed();
}

export async function DELETE() {
  return mcpMethodNotAllowed();
}

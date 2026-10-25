import { mcpHttpPost, mcpMethodNotAllowed } from '@/lib/track-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Servidor MCP de Track (Streamable HTTP). Ver lib/track-mcp.ts. */
export async function POST(req: Request) {
  return mcpHttpPost(req, false);
}

export async function GET() {
  return mcpMethodNotAllowed();
}

export async function DELETE() {
  return mcpMethodNotAllowed();
}

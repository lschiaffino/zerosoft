import { handleMcpPost, mcpMethodNotAllowed } from '@/lib/mcp/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// El tope de cada operación es OPERATION_TIMEOUT_MS; algunas rutas de la app ya tienen 60 s.
export const maxDuration = 60;

/** MCP unificado de zerosoft (Streamable HTTP, sin sesión). Ver docs/mcp.md. */
export async function POST(req: Request) {
  return handleMcpPost(req);
}

export async function GET() {
  return mcpMethodNotAllowed();
}

export async function DELETE() {
  return mcpMethodNotAllowed();
}

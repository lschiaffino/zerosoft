import { NextRequest, NextResponse } from 'next/server';
import { agentError, agentRouteContext } from '@/lib/agents-http';
import { addKnowledgeFile, AGENT_FILE_MAX_BYTES, KnowledgeError, listKnowledgeFiles } from '@/lib/agents-knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id);
  if ('res' in ctx) return ctx.res;
  return NextResponse.json({ files: await listKnowledgeFiles(id) });
}

/** Sube un archivo (multipart, campo "file"): se guarda el texto extraído. */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const ctx = await agentRouteContext(id, { edit: true });
  if ('res' in ctx) return ctx.res;
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > AGENT_FILE_MAX_BYTES + 64 * 1024) return agentError(413, 'file_too_large');
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return agentError(400, 'invalid_input');
  if (file.size > AGENT_FILE_MAX_BYTES) return agentError(413, 'file_too_large');
  try {
    const dto = await addKnowledgeFile(ctx.row, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, ctx.personId);
    return NextResponse.json({ file: dto }, { status: 201 });
  } catch (err) {
    if (err instanceof KnowledgeError) return agentError(err.status, err.code);
    throw err;
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { agentError, agentRouteContext } from '@/lib/agents-http';
import { addKnowledgeFile, AGENT_FILE_MAX_BYTES, KnowledgeError, listKnowledgeFiles } from '@/lib/agents-knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

async function readBodyCapped(req: NextRequest, cap: number): Promise<Uint8Array | 'too_large'> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return 'too_large';
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

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
  const cap = AGENT_FILE_MAX_BYTES + 64 * 1024;
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > cap) return agentError(413, 'file_too_large');
  // Sin content-length (o mentido): se lee el cuerpo con tope antes de parsearlo.
  const body = await readBodyCapped(req, cap);
  if (body === 'too_large') return agentError(413, 'file_too_large');
  const form = await new Request(req.url, { method: 'POST', headers: { 'content-type': req.headers.get('content-type') ?? '' }, body: new Blob([body as BlobPart]) })
    .formData()
    .catch(() => null);
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

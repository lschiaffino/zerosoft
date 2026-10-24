import { NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { getCurrentUser } from '@/lib/session';
import { buildZip, type ZipInput } from '@/lib/zip-writer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROOT = path.join(process.cwd(), 'extensions', 'chrome');

async function collect(dir: string, prefix: string, out: ZipInput[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    const name = `${prefix}${e.name}`;
    if (e.isDirectory()) await collect(full, `${name}/`, out);
    else if (e.isFile()) out.push({ name, data: await readFile(full) });
  }
}

/**
 * Descarga la extensión de Chrome para Gmail como zip (carpeta
 * zerosoft-crm/ adentro, lista para "Cargar descomprimida"). Requiere sesión.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const files: ZipInput[] = [];
  try {
    await collect(ROOT, 'zerosoft-crm/', files);
  } catch {
    return NextResponse.json({ error: 'not_available' }, { status: 404 });
  }
  if (!files.length) return NextResponse.json({ error: 'not_available' }, { status: 404 });
  const zip = buildZip(files);
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="zerosoft-crm-chrome.zip"',
      'content-length': String(zip.length),
      'cache-control': 'private, no-store',
    },
  });
}

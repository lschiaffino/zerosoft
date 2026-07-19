import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads', 'chat');

async function saveLocalFile(filename: string, buffer: Buffer): Promise<string> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const safeName = `${crypto.randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const filePath = path.join(UPLOADS_DIR, safeName);
  await writeFile(filePath, buffer);
  return `/uploads/chat/${safeName}`;
}

async function saveBlob(filename: string, buffer: Buffer): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await eval('require')('@vercel/blob');
    const blob = await mod.put(`chat/${crypto.randomUUID()}-${filename}`, buffer, {
      access: 'public',
      contentType: undefined,
    });
    return blob.url;
  } catch {
    return null;
  }
}

export async function saveChatFile(filename: string, buffer: Buffer): Promise<string> {
  const url = await saveBlob(filename, buffer);
  if (url) return url;
  return saveLocalFile(filename, buffer);
}

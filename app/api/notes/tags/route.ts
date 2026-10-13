import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listTags, noteOwner } from '@/lib/notes';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  return NextResponse.json({ tags: await listTags(noteOwner(user)) });
}

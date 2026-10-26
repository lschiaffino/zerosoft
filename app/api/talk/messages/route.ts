import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { getMessageDtos } from '@/lib/talk';

/** ?ids=a,b,c → esos mensajes (los que puedo leer). Lo usa el tiempo real para refrescar. */
export async function GET(req: NextRequest) {
  return withTalk(async ({ actor }) => {
    const ids = (req.nextUrl.searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
    return NextResponse.json({ messages: await getMessageDtos(actor, ids) });
  });
}

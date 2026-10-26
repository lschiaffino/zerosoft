import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { setPinned } from '@/lib/talk';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(async ({ actor }) => NextResponse.json(await setPinned(actor, id, true)), { write: 'pins', limit: 120 });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(async ({ actor }) => NextResponse.json(await setPinned(actor, id, false)), { write: 'pins', limit: 120 });
}

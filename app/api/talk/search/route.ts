import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { searchMessages } from '@/lib/talk-extras';

/** ?q= con modificadores (in:, from:, has:, is:, before:, after:, on:, during:). */
export async function GET(req: NextRequest) {
  return withTalk(async ({ actor }) => NextResponse.json(await searchMessages(actor, req.nextUrl.searchParams.get('q') ?? '')));
}

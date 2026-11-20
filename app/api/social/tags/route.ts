import { NextResponse } from 'next/server';
import { withSocial } from '@/lib/social-http';
import { socialTagSuggestions } from '@/lib/social-tags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** #hashtags y @menciones que el equipo ya usó (en lo que la persona ve), para sugerir en el compositor. */
export async function GET() {
  return withSocial(async ({ actor }) => NextResponse.json(await socialTagSuggestions(actor)));
}

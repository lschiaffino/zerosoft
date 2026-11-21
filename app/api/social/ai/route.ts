import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AiError } from '@/lib/ai';
import { readBody, withSocial } from '@/lib/social-http';
import { SOCIAL_AI_CHANGES, writeSocialPost } from '@/lib/social-ai';
import { SOCIAL_NETWORKS } from '@/lib/social-networks';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z
  .object({
    idea: z.string().trim().max(1000).optional(),
    text: z.string().max(5000).optional(),
    change: z.enum(SOCIAL_AI_CHANGES).optional(),
    networks: z.array(z.enum(SOCIAL_NETWORKS)).max(SOCIAL_NETWORKS.length).default([]),
    locale: z.enum(['en', 'es', 'pt']).default('en'),
  })
  .refine((b) => (b.change ? Boolean(b.text?.trim()) : Boolean(b.idea)), { message: 'idea or text+change' });

/** Escribir con IA en el compositor: una publicación desde una idea, o el texto cambiado. */
export async function POST(req: NextRequest) {
  return withSocial(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      try {
        const text = await writeSocialPost({ ws: actor.workspaceId, ...body });
        if (!text) return jsonError(502, 'empty_result');
        return NextResponse.json({ text });
      } catch (err) {
        // quota_exceeded ya es "límite de links" en social.errors: la de IA va como ai_quota.
        if (err instanceof AiError) {
          const code = err.code === 'quota_exceeded' ? 'ai_quota' : err.code;
          return NextResponse.json({ error: code }, { status: err.code === 'ai_disabled' ? 503 : 429 });
        }
        console.error('[social-ai] failed', err instanceof Error ? err.name : 'error');
        return jsonError(502, 'ai_failed');
      }
    },
    { write: 'ai', limit: 30 },
  );
}

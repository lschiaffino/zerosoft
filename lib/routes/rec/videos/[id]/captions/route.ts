import { NextRequest } from 'next/server';
import { z } from 'zod';
import { AiError } from '@/lib/ai';
import { getDb } from '@/lib/db';
import { recAudit } from '@/lib/rec-admin';
import { recAiForcedOff } from '@/lib/rec-ai-flags';
import { translateSegments } from '@/lib/rec-ai';
import { getManageableVideo, RecError } from '@/lib/rec';
import { recActor, recFail, recJson } from '@/lib/rec-http';
import { isCaptionLang, MAX_REC_CAPTION_TRACKS, MAX_REC_TRANSLATE_SEGMENTS, type RecSegment } from '@/lib/rec-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ lang: z.string().max(5) });

function langsOf(raw: string): string[] {
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

/** Traduce los subtítulos a un idioma. Solo quien administra el video: gasta la cuota de IA del workspace. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isCaptionLang(parsed.data.lang)) return recJson({ error: 'invalid_input' }, 400);
  const lang = parsed.data.lang;
  try {
    const v = await getManageableVideo(s.actor, id);
    const langs = langsOf(v.caption_langs);
    if (langs.includes(lang)) return recJson({ langs });
    if (langs.length >= MAX_REC_CAPTION_TRACKS) throw new RecError('too_many_caption_tracks');
    const segments = JSON.parse(v.transcript || '[]') as RecSegment[];
    if (!segments.length) throw new RecError('no_transcript');
    if (segments.length > MAX_REC_TRANSLATE_SEGMENTS) throw new RecError('transcript_too_long');
    if (process.env.RATE_LIMIT_DISABLED !== 'true') {
      const { rateLimit } = await import('@/lib/rate-limit');
      const r = await rateLimit(`rec:translate:${s.actor.ws}`, 30, 3600);
      if (!r.ok) throw new RecError('rate_limited', 429);
    }
    const forceOff = await recAiForcedOff();
    const translated = await translateSegments(v.workspace_id, segments, lang, { forceOff });
    await getDb()
      .prepare('INSERT OR REPLACE INTO rec_caption_tracks (video_id, lang, segments, created_by) VALUES (?, ?, ?, ?)')
      .run(v.id, lang, JSON.stringify(translated), s.actor.actor);
    const next = [...langs, lang];
    await getDb().prepare('UPDATE rec_videos SET caption_langs = ? WHERE id = ?').run(JSON.stringify(next), v.id);
    await recAudit(s.actor.ws, s.actor.actor, 'captions_translate', { video: v.id, lang });
    return recJson({ langs: next });
  } catch (err) {
    if (err instanceof AiError || err instanceof RecError) return recFail(err);
    // Falla del modelo o respuesta que no sirve: se puede reintentar.
    console.error('[rec] translate', err instanceof Error ? err.message : 'failed');
    return recJson({ error: 'ai_failed' }, 502);
  }
}

/** Saca una traducción. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const lang = req.nextUrl.searchParams.get('lang');
  if (!isCaptionLang(lang)) return recJson({ error: 'invalid_input' }, 400);
  try {
    const v = await getManageableVideo(s.actor, id);
    await getDb().prepare('DELETE FROM rec_caption_tracks WHERE video_id = ? AND lang = ?').run(v.id, lang);
    const next = langsOf(v.caption_langs).filter((l) => l !== lang);
    await getDb().prepare('UPDATE rec_videos SET caption_langs = ? WHERE id = ?').run(JSON.stringify(next), v.id);
    return recJson({ langs: next });
  } catch (err) {
    return recFail(err);
  }
}

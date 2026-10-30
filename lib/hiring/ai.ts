/**
 * Hiring: IA que ayuda (opcional, con la cuota de lib/ai.ts). Lee el resume
 * para completar campos y escribe un resumen del candidato. Nunca decide:
 * no rechaza, no ordena ni puntúa candidatos; eso lo hace una persona.
 * HIRING_AI_FAKE=1 (e2e, nunca en producción) responde sin modelo.
 */
import { z } from 'zod';
import { getDb } from '../db';
import { AiError, aiGenerateObject } from '../ai';
import { HiringError, type HiringActor } from './types';
import { nowIso, parseJson } from './core';
import { addEvent } from './events';
import { candidateDto, getCandidateRow, requireVisibleCandidate, type CandidateDto } from './candidates';

const parsedSchema = z.object({
  name: z.string().max(160).default(''),
  phone: z.string().max(40).default(''),
  location: z.string().max(120).default(''),
  headline: z.string().max(200).default(''),
  skills: z.array(z.string().max(60)).max(30).default([]),
  yearsExperience: z.number().min(0).max(70).nullable().default(null),
  education: z.array(z.string().max(200)).max(10).default([]),
  links: z.array(z.string().max(300)).max(10).default([]),
});

const summarySchema = z.object({ summary: z.string().max(2000) });

function fakeMode(): boolean {
  return process.env.HIRING_AI_FAKE === '1' && process.env.VERCEL_ENV !== 'production';
}

const INSTRUCTIONS =
  'You help a recruiter read a resume. Extract only what the resume says; leave a field empty when it is not there. Never judge, rank or recommend rejecting the candidate.';

export async function parseResume(actor: HiringActor, candidateId: string): Promise<CandidateDto> {
  const c = await requireVisibleCandidate(actor, candidateId);
  if (!c.resume_text.trim()) throw new HiringError('no_resume_text');
  let fields: z.infer<typeof parsedSchema>;
  if (fakeMode()) {
    const text = c.resume_text;
    fields = parsedSchema.parse({
      phone: text.match(/\+?\d[\d\s().-]{7,}\d/)?.[0]?.trim() ?? '',
      skills: [...new Set((text.match(/\b(TypeScript|React|SQL|Python|Go|Figma|Sales)\b/g) ?? []))],
      headline: text.split('\n').map((l) => l.trim()).filter(Boolean)[1]?.slice(0, 200) ?? '',
    });
  } else {
    try {
      const res = await aiGenerateObject({
        workspaceId: actor.ws,
        feature: 'hiring_parse',
        instructions: INSTRUCTIONS,
        prompt: `Resume:\n${c.resume_text.slice(0, 20_000)}`,
        schema: parsedSchema,
        schemaName: 'resume',
        maxOutputTokens: 800,
      });
      fields = parsedSchema.parse(res.object);
    } catch (err) {
      if (err instanceof AiError) throw new HiringError(err.code, err.code === 'ai_disabled' ? 503 : 429);
      throw new HiringError('ai_failed', 502);
    }
  }
  // Solo completa lo que está vacío: lo que escribió una persona no se pisa.
  await getDb()
    .prepare('UPDATE hiring_candidates SET phone = ?, location = ?, headline = ?, ai_fields = ?, updated_at = ? WHERE id = ?')
    .run(c.phone || fields.phone, c.location || fields.location, c.headline || fields.headline, JSON.stringify({ ...parseJson(c.ai_fields, {}), ...fields }), nowIso(), c.id);
  await addEvent(actor.ws, c.id, null, 'ai', actor.person, { action: 'parse' });
  return candidateDto((await getCandidateRow(actor.ws, c.id))!);
}

export async function summarizeCandidate(actor: HiringActor, candidateId: string, locale = 'en'): Promise<CandidateDto> {
  const c = await requireVisibleCandidate(actor, candidateId);
  if (!c.resume_text.trim() && !c.headline) throw new HiringError('no_resume_text');
  let summary: string;
  if (fakeMode()) {
    summary = `${c.name}: ${(c.headline || c.resume_text.split('\n').find((l) => l.trim()) || '').slice(0, 160)}`;
  } else {
    try {
      const lang = locale === 'es' ? 'Spanish' : locale === 'pt' ? 'Portuguese' : 'English';
      const res = await aiGenerateObject({
        workspaceId: actor.ws,
        feature: 'hiring_summary',
        instructions: `${INSTRUCTIONS} Write a neutral 3 to 5 sentence summary of experience and skills in ${lang}. No opinion on fit.`,
        prompt: `Name: ${c.name}\nHeadline: ${c.headline}\nResume:\n${c.resume_text.slice(0, 20_000)}`,
        schema: summarySchema,
        schemaName: 'summary',
        maxOutputTokens: 500,
      });
      summary = res.object.summary;
    } catch (err) {
      if (err instanceof AiError) throw new HiringError(err.code, err.code === 'ai_disabled' ? 503 : 429);
      throw new HiringError('ai_failed', 502);
    }
  }
  await getDb().prepare('UPDATE hiring_candidates SET ai_summary = ?, updated_at = ? WHERE id = ?').run(summary.slice(0, 2000), nowIso(), c.id);
  await addEvent(actor.ws, c.id, null, 'ai', actor.person, { action: 'summary' });
  return candidateDto((await getCandidateRow(actor.ws, c.id))!);
}

/**
 * Autocompletar propiedades de una base con IA (como el AI Autofill de
 * Notion): resumen, extraer un dato, traducir, clasificar en las opciones de
 * un select/multi-select o una instrucción propia. Usa solo el contenido de
 * cada fila (título, propiedades y cuerpo).
 *
 * Todo pasa por lib/ai.ts (cuota, rate limit, ai_usage). En e2e
 * (DOCS_AI_FAKE=1, nunca en un deploy de producción) responde un modelo
 * falso con resultados deterministas armados con los mismos datos; con la
 * cookie `docs_ai_fake=off` se comporta como sin IA (error ai_disabled).
 */
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { AiError, assertAiAvailable, assertAiQuota, recordAiUsage, resolveAiModel } from './ai';
import { fakeModel } from './crm-ai-fake';
import type { DbAiMode } from './docs-types';

export interface AutofillRowInput {
  id: string;
  title: string;
  properties: string;
  body: string;
}

export interface AutofillRequest {
  mode: DbAiMode;
  prompt?: string;
  language?: string;
  propName: string;
  /** classify: opciones posibles; multi: puede elegir varias. */
  options?: Array<{ id: string; name: string }>;
  multi?: boolean;
  rows: AutofillRowInput[];
}

/** id de fila → texto (o ids de opción para classify). */
export type AutofillResult = Record<string, string | string[]>;

async function fakeDisabledByCookie(): Promise<boolean> {
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get('docs_ai_fake')?.value === 'off';
  } catch {
    return false;
  }
}

export async function docsAiFakeActive(): Promise<boolean> {
  if (process.env.DOCS_AI_FAKE !== '1') return false;
  if (process.env.VERCEL_ENV === 'production') return false;
  return !(await fakeDisabledByCookie());
}

const LANGUAGES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  ja: 'Japanese',
  zh: 'Chinese',
};

export function languageName(code: string | undefined): string {
  if (!code) return 'English';
  return LANGUAGES[code.toLowerCase()] ?? code;
}

function words(text: string, n: number): string {
  return text.replace(/\s+/g, ' ').trim().split(' ').slice(0, n).join(' ');
}

/** Lo que devuelve el modelo falso (determinista, con los mismos datos que vería el real). */
export function fakeAutofill(req: AutofillRequest): Array<{ id: string; value: string; options: string[] }> {
  return req.rows.map((r) => {
    const text = `${r.title}\n${r.properties}\n${r.body}`;
    switch (req.mode) {
      case 'summary':
        return { id: r.id, value: words(r.body || r.title, 12), options: [] };
      case 'extract': {
        const email = /[^\s@]+@[^\s@]+\.[^\s@]+/.exec(text)?.[0];
        return { id: r.id, value: email ?? words(r.body || r.title, 6), options: [] };
      }
      case 'translate':
        return { id: r.id, value: `[${(req.language ?? 'en').toLowerCase()}] ${r.title}`, options: [] };
      case 'classify': {
        const lower = text.toLowerCase();
        const hits = (req.options ?? []).filter((o) => lower.includes(o.name.toLowerCase())).map((o) => o.name);
        const picked = hits.length ? (req.multi ? hits : hits.slice(0, 1)) : (req.options ?? []).slice(0, 1).map((o) => o.name);
        return { id: r.id, value: '', options: picked };
      }
      default:
        return { id: r.id, value: words(`${req.prompt ?? ''} ${r.title}`, 10), options: [] };
    }
  });
}

function instructionsFor(req: AutofillRequest): string {
  const base =
    'You fill one property of a database row for every row given. Use only the information in that row (title, properties and body). ' +
    'Never invent facts. If the row has nothing useful for the task, return an empty value. Keep each value short: plain text, no Markdown.';
  switch (req.mode) {
    case 'summary':
      return `${base}\nTask: write a one or two sentence summary of the row, in the same language as the row.`;
    case 'extract':
      return `${base}\nTask: extract this information from the row: "${req.prompt || 'the key information'}". Return only the extracted value, in the language of the row.`;
    case 'translate':
      return `${base}\nTask: translate the row's title (and the body if the title is empty) to ${languageName(req.language)}. Return only the translation.`;
    case 'classify':
      return `${base}\nTask: choose ${req.multi ? 'every option that applies' : 'the single best option'} for the property "${req.propName}" from this list, using the exact names: ${(req.options ?? []).map((o) => JSON.stringify(o.name)).join(', ')}. Put the chosen names in "options" and leave "value" empty.${req.prompt ? ` Extra guidance: ${req.prompt}` : ''}`;
    default:
      return `${base}\nTask (from the user): ${req.prompt || 'describe the row'}`;
  }
}

const schema = z.object({
  results: z.array(z.object({ id: z.string(), value: z.string(), options: z.array(z.string()) })),
});

/** Corre el autocompletado para las filas y devuelve el valor de cada una. */
export async function autofillRows(workspaceId: string, req: AutofillRequest): Promise<AutofillResult> {
  const fake = await docsAiFakeActive();
  let model;
  let modelId: string;
  if (fake) {
    await assertAiQuota(workspaceId);
    model = fakeModel(() => ({ text: JSON.stringify({ results: fakeAutofill(req) }) }));
    modelId = 'docs-fake';
  } else {
    if (process.env.DOCS_AI_FAKE === '1') throw new AiError('ai_disabled');
    await assertAiAvailable(workspaceId);
    ({ model, modelId } = resolveAiModel());
  }
  const prompt = req.rows
    .map((r) => `<row id="${r.id}">\nTitle: ${r.title}\nProperties:\n${r.properties}\nBody:\n${r.body.slice(0, 6000)}\n</row>`)
    .join('\n\n');
  const result = await generateText({
    model,
    instructions: instructionsFor(req),
    prompt,
    output: Output.object({ schema }),
    maxOutputTokens: 300 + req.rows.length * 160,
    temperature: 0.2,
    timeout: 60_000,
    maxRetries: 1,
  });
  await recordAiUsage({
    workspaceId,
    feature: 'docs_autofill',
    model: modelId,
    inputTokens: result.totalUsage?.inputTokens ?? 0,
    outputTokens: result.totalUsage?.outputTokens ?? 0,
  }).catch(() => {});
  const out: AutofillResult = {};
  const ids = new Set(req.rows.map((r) => r.id));
  const byName = new Map((req.options ?? []).map((o) => [o.name.trim().toLowerCase(), o.id]));
  for (const r of (result.output as z.infer<typeof schema>).results ?? []) {
    if (!ids.has(r.id)) continue;
    if (req.mode === 'classify') {
      const picked = r.options.map((n) => byName.get(n.trim().toLowerCase())).filter((x): x is string => Boolean(x));
      out[r.id] = req.multi ? [...new Set(picked)] : picked.slice(0, 1);
    } else {
      out[r.id] = r.value.trim().slice(0, 5000);
    }
  }
  return out;
}

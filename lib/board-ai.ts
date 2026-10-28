/**
 * Board: IA sobre la pizarra, todo por lib/ai.ts (cuota, rate limit y
 * ai_usage del workspace).
 *
 * - Texto a diagrama: el modelo escribe Mermaid y el editor lo convierte en
 *   formas de Excalidraw editables (el mismo conversor de "Mermaid a
 *   diagrama"), como el "Text to diagram" de Excalidraw+.
 * - Agrupar stickies: temas con los ids de cada sticky y un resumen, como el
 *   "cluster" de Miro; el editor los acomoda en columnas.
 * - Wireframe a código: la imagen de un frame dibujado pasa a una página HTML
 *   que el editor muestra en un iframe aislado (sin el origen de la app).
 *
 * En e2e (BOARD_AI_FAKE=1, nunca en producción) corre un modelo falso con la
 * misma cuota y registro; la cookie board_ai_fake=off simula la IA apagada.
 * Server-only.
 */
import { z } from 'zod';
import type { ModelMessage } from 'ai';
import { AiError, aiGenerateObject, aiGenerateText, assertAiQuota, recordAiUsage } from './ai';

async function fakeState(): Promise<'on' | 'off' | null> {
  if (process.env.BOARD_AI_FAKE !== '1' || process.env.VERCEL_ENV === 'production') return null;
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get('board_ai_fake')?.value === 'off' ? 'off' : 'on';
  } catch {
    return 'on';
  }
}

/** Corre `real` o, en e2e, `fake` con la cuota y el registro de uso igual que la IA de verdad. */
async function withFake<T>(ws: string, feature: string, fake: () => T, real: () => Promise<T>): Promise<T> {
  const state = await fakeState();
  if (state === 'off') throw new AiError('ai_disabled');
  if (state === 'on') {
    await assertAiQuota(ws);
    await recordAiUsage({ workspaceId: ws, feature, model: 'board-fake', inputTokens: 50, outputTokens: 50 });
    return fake();
  }
  return real();
}

// ---------- Texto a diagrama ----------

const MERMAID_START = /^(flowchart|graph|sequenceDiagram|classDiagram|erDiagram|stateDiagram(-v2)?|mindmap|gantt|pie|journey)\b/;

/** Saca los ``` y lo que no sea el diagrama; null si no parece Mermaid. */
export function cleanMermaid(raw: string): string | null {
  let s = raw.trim();
  const fence = s.match(/```(?:mermaid)?\s*\n([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const lines = s.split('\n');
  const start = lines.findIndex((l) => MERMAID_START.test(l.trim()));
  if (start < 0) return null;
  const out = lines.slice(start).join('\n').trim();
  return out.length > 0 && out.length <= 20_000 ? out : null;
}

const DIAGRAM_INSTRUCTIONS = `You turn a description into a Mermaid diagram for a whiteboard.
Rules:
- Answer with Mermaid code only, no explanations and no code fences.
- Prefer "flowchart TD" (or LR for timelines and pipelines). Use sequenceDiagram only for interactions between actors over time, and classDiagram only for data models.
- Keep labels short (max 6 words) and write them in the same language as the description.
- 3 to 25 nodes. Quote labels that contain punctuation: A["Sign up (free)"].
- Do not use click, style, classDef, linkStyle or HTML.`;

export async function aiTextToDiagram(ws: string, prompt: string): Promise<string> {
  const text = await withFake(
    ws,
    'board_diagram',
    () => fakeDiagram(prompt),
    async () => (await aiGenerateText({ workspaceId: ws, feature: 'board_diagram', instructions: DIAGRAM_INSTRUCTIONS, prompt, maxOutputTokens: 1500, temperature: 0.2 })).text,
  );
  const mermaid = cleanMermaid(text);
  if (!mermaid) throw new BoardAiError('ai_bad_output');
  return mermaid;
}

/** Diagrama falso de e2e: un paso por cada parte separada por coma o "then". */
export function fakeDiagram(prompt: string): string {
  const steps = prompt
    .split(/,|\bthen\b|\by luego\b|\be depois\b|->/i)
    .map((s) => s.replace(/["[\]{}()|<>]/g, '').trim())
    .filter(Boolean)
    .slice(0, 8);
  const nodes = (steps.length ? steps : ['Start', 'End']).map((s, i) => `  N${i}["${s.slice(0, 40)}"]`);
  const edges = nodes.slice(1).map((_, i) => `  N${i} --> N${i + 1}`);
  return ['flowchart LR', ...nodes, ...edges].join('\n');
}

export class BoardAiError extends Error {
  constructor(public code: 'ai_bad_output' | 'too_many_notes' | 'no_notes') {
    super(code);
    this.name = 'BoardAiError';
  }
}

// ---------- Agrupar stickies ----------

export interface StickyNote {
  id: string;
  text: string;
}

export interface StickyClusters {
  groups: Array<{ title: string; ids: string[] }>;
  summary: string;
}

const clusterSchema = z.object({
  groups: z
    .array(z.object({ title: z.string().min(1).max(60), ids: z.array(z.string().max(128)).min(1).max(200) }))
    .min(1)
    .max(12),
  summary: z.string().max(600),
});

const CLUSTER_INSTRUCTIONS = `You group whiteboard sticky notes by theme, like an affinity map after a brainstorm.
Rules:
- Every note id goes in exactly one group. Use only ids from the input.
- 2 to 8 groups, each with a short title (max 5 words) that names the theme.
- summary: two or three sentences with the main takeaways.
- Write titles and summary in the same language as the notes.`;

/** Deja cada id en un solo grupo, saca los inventados y suma los olvidados a "Otros". */
export function normalizeClusters(raw: StickyClusters, notes: StickyNote[], otherTitle: string): StickyClusters {
  const valid = new Set(notes.map((n) => n.id));
  const seen = new Set<string>();
  const groups: StickyClusters['groups'] = [];
  for (const g of raw.groups) {
    const ids: string[] = [];
    for (const id of g.ids) {
      if (!valid.has(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length) groups.push({ title: g.title.trim().slice(0, 60) || otherTitle, ids });
  }
  const rest = notes.filter((n) => !seen.has(n.id)).map((n) => n.id);
  if (rest.length) groups.push({ title: otherTitle, ids: rest });
  return { groups, summary: raw.summary.trim().slice(0, 600) };
}

/** Agrupado falso de e2e: por la primera palabra de cada nota. */
export function fakeClusters(notes: StickyNote[]): StickyClusters {
  const byWord = new Map<string, string[]>();
  for (const n of notes) {
    const word = (n.text.trim().split(/\s+/)[0] ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') || '?';
    byWord.set(word, [...(byWord.get(word) ?? []), n.id]);
  }
  return {
    groups: [...byWord.entries()].map(([w, ids]) => ({ title: w.charAt(0).toUpperCase() + w.slice(1), ids })),
    summary: `${notes.length} notes in ${byWord.size} groups.`,
  };
}

export async function aiClusterStickies(ws: string, notes: StickyNote[], otherTitle: string): Promise<StickyClusters> {
  if (notes.length < 2) throw new BoardAiError('no_notes');
  if (notes.length > 200) throw new BoardAiError('too_many_notes');
  const prompt = notes.map((n) => `${n.id}: ${n.text.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
  const raw = await withFake(
    ws,
    'board_cluster',
    () => fakeClusters(notes),
    async () =>
      (
        await aiGenerateObject({
          workspaceId: ws,
          feature: 'board_cluster',
          instructions: CLUSTER_INSTRUCTIONS,
          prompt,
          schema: clusterSchema,
          schemaName: 'clusters',
          maxOutputTokens: 3000,
          temperature: 0.2,
        })
      ).object,
  );
  return normalizeClusters(raw, notes, otherTitle);
}

// ---------- Wireframe a código ----------

const CODE_INSTRUCTIONS = `You turn a hand-drawn wireframe into a single self-contained HTML page.
Rules:
- Answer with the HTML document only, starting with <!DOCTYPE html>, no explanations and no code fences.
- Inline all CSS in a <style> tag. You may use a small inline <script> for interactions.
- Do not load anything from the network: no external scripts, stylesheets, fonts or images (use CSS shapes or inline SVG as placeholders).
- Follow the layout of the drawing and use the texts it contains.`;

/** Saca los ``` y se queda con el documento; null si no hay HTML. */
export function cleanHtml(raw: string): string | null {
  let s = raw.trim();
  const fence = s.match(/```(?:html)?\s*\n([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const at = s.search(/<!doctype html|<html/i);
  if (at < 0) return null;
  s = s.slice(at);
  return s.length <= 200_000 ? s : null;
}

export async function aiWireframeToCode(ws: string, imageDataUrl: string, texts: string[]): Promise<string> {
  const text = await withFake(
    ws,
    'board_code',
    () => `<!DOCTYPE html><html><head><style>body{font-family:system-ui;padding:24px}</style></head><body>${texts
      .map((t) => `<p>${t.replace(/[<>&"]/g, '')}</p>`)
      .join('') || '<p>Wireframe</p>'}</body></html>`,
    async () => {
      const messages: ModelMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'image', image: imageDataUrl },
            { type: 'text', text: texts.length ? `Texts in the drawing:\n${texts.join('\n')}` : 'Build the page from the drawing.' },
          ],
        },
      ];
      return (await aiGenerateText({ workspaceId: ws, feature: 'board_code', instructions: CODE_INSTRUCTIONS, messages, maxOutputTokens: 8000, timeoutMs: 90_000 })).text;
    },
  );
  const html = cleanHtml(text);
  if (!html) throw new BoardAiError('ai_bad_output');
  return html;
}

/**
 * Robots — IA. Server-only. Todo pasa por lib/ai.ts (cuota, rate limit y
 * ai_usage del workspace); con la IA apagada tira AiError('ai_disabled') y la
 * ruta responde el código para que la UI lo explique.
 *
 *  - buildRobot: arma un robot desde una URL y lo que se quiere sacar, con la
 *    lectura de la página (listas detectadas + HTML simplificado, ver
 *    lib/robots-detect.ts).
 *  - stepsFromDescription: pasos escritos en lenguaje natural → pasos.
 *  - suggestSelectorFix: selector nuevo para el paso que falló, desde el DOM
 *    capturado en la falla.
 *  - extractWithAi: paso ai_extract (texto de la página → filas con campos).
 *  - aiColumnValues: columna calculada con IA para cada fila.
 *
 * En e2e (ROBOTS_AI_FAKE=1, nunca en un deploy de producción) corre contra el
 * modelo falso de lib/crm-ai-fake.ts con respuestas deterministas; la cookie
 * robots_ai_fake=off hace que el request se comporte como sin IA.
 */
import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import { AiError, assertAiAvailable, assertAiQuota, recordAiUsage, resolveAiModel } from './ai';
import { fakeModel } from './crm-ai-fake';
import type { PageSnapshot } from './robots-detect';
import { validateSteps, type RobotStep } from './robots-schema';

export { AiError };

async function fakeState(): Promise<'on' | 'off' | null> {
  if (process.env.ROBOTS_AI_FAKE !== '1' || process.env.VERCEL_ENV === 'production') return null;
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get('robots_ai_fake')?.value === 'off' ? 'off' : 'on';
  } catch {
    // Fuera de un request (cron, cola): el fake sigue prendido.
    return 'on';
  }
}

async function robotsModel(ws: string, fake: () => unknown): Promise<{ model: LanguageModel; modelId: string }> {
  const state = await fakeState();
  if (state === 'on') {
    await assertAiQuota(ws);
    return { model: fakeModel(() => ({ text: JSON.stringify(fake()) })), modelId: 'robots-fake' };
  }
  if (state === 'off') throw new AiError('ai_disabled');
  await assertAiAvailable(ws);
  return resolveAiModel();
}

/** Tira AiError si la IA no está disponible para el workspace (antes de abrir una página de gusto). */
export async function assertRobotsAi(ws: string): Promise<void> {
  await robotsModel(ws, () => null);
}

async function robotsObject<T>(opts: {
  ws: string;
  feature: string;
  instructions: string;
  prompt: string;
  schema: z.ZodType<T>;
  fake: () => T;
  maxOutputTokens?: number;
}): Promise<T> {
  const { model, modelId } = await robotsModel(opts.ws, opts.fake);
  const result = await generateText({
    model,
    instructions: opts.instructions,
    prompt: opts.prompt,
    output: Output.object({ schema: opts.schema }),
    maxOutputTokens: opts.maxOutputTokens ?? 2000,
    temperature: 0,
    timeout: 60_000,
    maxRetries: 1,
  });
  await recordAiUsage({
    workspaceId: opts.ws,
    feature: opts.feature,
    model: modelId,
    inputTokens: result.totalUsage?.inputTokens ?? 0,
    outputTokens: result.totalUsage?.outputTokens ?? 0,
  }).catch(() => {});
  return result.output as T;
}

const varName = (v: string, fallback: string) => {
  const clean = v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return /^[A-Za-z_]/.test(clean) ? clean : clean ? `f_${clean}`.slice(0, 40) : fallback;
};

// ---------- Robot desde una URL ----------

const fieldOut = z.object({
  name: z.string().max(60),
  selector: z.string().max(500),
  attribute: z.string().max(60),
});

const buildOut = z.object({
  name: z.string().max(120),
  description: z.string().max(300),
  /** Índice de la lista detectada a usar (-1 = ninguna sirve). */
  list: z.number().int(),
  /** Selector de tarjeta si ninguna lista detectada sirve. */
  cardSelector: z.string().max(500),
  fields: z.array(fieldOut).max(20),
  /** next | load_more | scroll | none */
  pagination: z.string().max(20),
  nextSelector: z.string().max(500),
  nextText: z.string().max(100),
});

export interface BuiltRobot {
  name: string;
  description: string;
  steps: RobotStep[];
  /** Filas de muestra de la lista elegida (vista previa antes de crear el robot). */
  sample: Array<Record<string, string>>;
  columns: string[];
}

function snapshotPrompt(snap: PageSnapshot): string {
  const lists = snap.lists
    .map(
      (l, i) =>
        `List ${i}: card selector "${l.selector}" (${l.count} cards). Fields: ${l.fields
          .map((f) => `${f.name}=${f.selector || '(card)'}${f.attribute ? `@${f.attribute}` : ''}`)
          .join(', ')}. Sample row: ${JSON.stringify(l.sample[0] ?? {}).slice(0, 600)}`,
    )
    .join('\n');
  return [
    `URL: ${snap.url}`,
    `Title: ${snap.title}`,
    snap.next ? `Pagination control found: ${snap.next.mode} "${snap.next.text}" selector "${snap.next.selector}"` : 'No pagination control found.',
    '',
    'Repeated lists detected on the page (selectors verified in the browser):',
    lists || '(none)',
    '',
    'Simplified HTML of the page (truncated):',
    snap.html.slice(0, 30_000),
  ].join('\n');
}

/** Lista detectada → pasos de extract_list (con paginación si se detectó). */
function stepsFromList(
  url: string,
  cardSelector: string,
  fields: Array<{ name: string; selector: string; attribute: string }>,
  pagination: { mode: string; selector: string; text: string } | null,
): RobotStep[] {
  const seen = new Set<string>();
  const clean = fields
    .map((f, i) => ({ name: varName(f.name, `field${i + 1}`), selector: f.selector.trim().slice(0, 500), attribute: f.attribute.trim().slice(0, 60) }))
    .filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true)))
    .slice(0, 20);
  const list: Record<string, unknown> = {
    type: 'extract_list',
    selector: cardSelector,
    name: 'items',
    fields: clean.length ? clean : [{ name: 'text', selector: '', attribute: '' }],
    max: 100,
  };
  if (pagination && pagination.mode !== 'none' && (pagination.mode === 'scroll' || pagination.selector || pagination.text)) {
    list.paginateMode = pagination.mode === 'load_more' || pagination.mode === 'scroll' ? pagination.mode : 'next';
    if (pagination.selector) list.nextSelector = pagination.selector;
    if (pagination.text) list.nextText = pagination.text.slice(0, 200);
    list.maxPages = 5;
    list.pageWaitMs = 1000;
  }
  const raw = [{ type: 'goto', url }, { type: 'wait', ms: 0, selector: cardSelector }, list];
  const v = validateSteps(raw);
  return v.ok ? v.steps : (validateSteps([{ type: 'goto', url }]) as { ok: true; steps: RobotStep[] }).steps;
}

/** Sin IA o en el fake: la mejor lista detectada tal cual. */
export function robotFromDetection(url: string, snap: PageSnapshot): BuiltRobot | null {
  const best = snap.lists[0];
  if (!best) return null;
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // queda la URL
  }
  return {
    name: (snap.title || host).slice(0, 120),
    description: '',
    steps: stepsFromList(url, best.selector, best.fields, snap.next),
    sample: best.sample,
    columns: best.fields.map((f) => f.name),
  };
}

export async function buildRobot(ws: string, url: string, goal: string, snap: PageSnapshot, locale: string): Promise<BuiltRobot> {
  const out = await robotsObject({
    ws,
    feature: 'robots_builder',
    instructions: [
      'You build web scraping robots. Given a page snapshot and what the user wants, choose the repeated list that matches the goal',
      '(prefer one of the detected lists: their selectors are verified) and the fields (columns) to extract from each card.',
      'Field selectors are CSS selectors RELATIVE to the card ("" = the card itself); attribute is "" for visible text, or href/src/datetime/etc.',
      'Column names: short snake_case in English. If the user asks for something not in the detected fields, add a field with a selector from the HTML.',
      'pagination: "next" (a Next link/button), "load_more" (a Load more button), "scroll" (infinite scroll) or "none".',
      `Write name and description in the language with code "${locale}". Never invent selectors that are not in the HTML.`,
    ].join(' '),
    prompt: `What the user wants: ${goal.slice(0, 2000) || 'the main list on the page'}\n\n${snapshotPrompt(snap)}`,
    schema: buildOut,
    fake: () => {
      const best = snap.lists[0];
      return {
        name: snap.title || 'Robot',
        description: '',
        list: best ? 0 : -1,
        cardSelector: best?.selector ?? 'body',
        fields: best?.fields ?? [{ name: 'text', selector: '', attribute: '' }],
        pagination: snap.next?.mode ?? 'none',
        nextSelector: snap.next?.selector ?? '',
        nextText: snap.next?.text ?? '',
      };
    },
  });
  const picked = out.list >= 0 ? snap.lists[out.list] : undefined;
  const cardSelector = (out.cardSelector || picked?.selector || '').trim() || 'body';
  const fields = out.fields.length ? out.fields : (picked?.fields ?? []);
  const pagination = out.pagination && out.pagination !== 'none' ? { mode: out.pagination, selector: out.nextSelector, text: out.nextText } : null;
  // La muestra solo vale si la IA se quedó con una lista detectada y sus mismos campos.
  const sameFields = picked && fields.every((f) => picked.fields.some((p) => p.selector === f.selector && p.attribute === f.attribute));
  return {
    name: (out.name || snap.title || 'Robot').slice(0, 120),
    description: out.description.slice(0, 300),
    steps: stepsFromList(url, cardSelector, fields, pagination),
    sample: sameFields && picked ? picked.sample.map((row) => Object.fromEntries(fields.map((f) => [varName(f.name, 'field'), row[picked.fields.find((p) => p.selector === f.selector && p.attribute === f.attribute)?.name ?? ''] ?? '']))) : [],
    columns: fields.map((f, i) => varName(f.name, `field${i + 1}`)),
  };
}

// ---------- Pasos en lenguaje natural ----------

const nlStep = z.object({
  type: z.string().max(30),
  url: z.string().max(2000),
  selector: z.string().max(500),
  text: z.string().max(200),
  value: z.string().max(2000),
  key: z.string().max(40),
  name: z.string().max(40),
  ms: z.number().int(),
  mode: z.string().max(20),
  attribute: z.string().max(60),
  fields: z.array(fieldOut).max(20),
});
const nlOut = z.object({ steps: z.array(nlStep).max(30) });

const NL_TYPES = new Set(['goto', 'click', 'fill', 'select', 'press', 'wait', 'extract', 'extract_list', 'extract_table', 'screenshot', 'scroll', 'pdf']);

/** Pasos de la IA → pasos válidos del robot (solo los tipos permitidos, con los campos que usa cada uno). */
/** Saca referencias a credenciales ({{credentials.*}}) de un campo que no es el valor de un fill/select. */
const noCreds = (v: string): string => v.replace(/\{\{\s*credentials\.[^}]*\}\}/gi, '');

export function normalizeNlSteps(raw: Array<z.infer<typeof nlStep>>): RobotStep[] {
  const out: Record<string, unknown>[] = [];
  for (const s of raw) {
    if (!NL_TYPES.has(s.type)) continue;
    // La IA no puede meter una credencial en una URL, selector, texto o nombre:
    // sólo el valor de un fill/select referencia {{credentials.*}} (el login real).
    s.url = noCreds(s.url);
    s.selector = noCreds(s.selector);
    s.text = noCreds(s.text);
    s.name = noCreds(s.name);
    s.attribute = noCreds(s.attribute);
    s.key = noCreds(s.key);
    switch (s.type) {
      case 'goto':
        if (/^https?:\/\//i.test(s.url) || s.url.includes('{{')) out.push({ type: 'goto', url: s.url });
        break;
      case 'click':
        if (s.selector || s.text) out.push({ type: 'click', selector: s.selector, text: s.text });
        break;
      case 'fill':
      case 'select':
        if (s.selector) out.push({ type: s.type, selector: s.selector, value: s.value });
        break;
      case 'press':
        out.push({ type: 'press', key: /^[A-Za-z0-9+_ -]{1,40}$/.test(s.key) ? s.key : 'Enter', selector: s.selector });
        break;
      case 'wait':
        out.push({ type: 'wait', ms: Math.min(Math.max(s.ms || 0, 0), 30_000), selector: s.selector });
        break;
      case 'extract':
        if (s.selector)
          out.push({ type: 'extract', selector: s.selector, name: varName(s.name, 'value'), mode: ['text', 'attribute', 'all'].includes(s.mode) ? s.mode : 'text', attribute: s.attribute });
        break;
      case 'extract_list':
        if (s.selector)
          out.push({
            type: 'extract_list',
            selector: s.selector,
            name: varName(s.name, 'items'),
            fields: (s.fields.length ? s.fields : [{ name: 'text', selector: '', attribute: '' }]).map((f, i) => ({ name: varName(f.name, `field${i + 1}`), selector: f.selector, attribute: f.attribute })),
            max: 100,
          });
        break;
      case 'extract_table':
        out.push({ type: 'extract_table', selector: s.selector || 'table', name: varName(s.name, 'rows') });
        break;
      case 'screenshot':
      case 'pdf':
        out.push({ type: s.type, name: varName(s.name, s.type === 'pdf' ? 'pdf' : 'page') });
        break;
      case 'scroll':
        out.push({ type: 'scroll', selector: s.selector, y: 0 });
        break;
    }
  }
  // Paso a paso: los que no pasan la validación se descartan, no rompen el resto.
  const valid: RobotStep[] = [];
  for (const s of out) {
    const v = validateSteps([s]);
    if (v.ok) valid.push(v.steps[0]);
  }
  return valid;
}

export async function stepsFromDescription(ws: string, description: string, snap: PageSnapshot | null, inputs: string[]): Promise<RobotStep[]> {
  const out = await robotsObject({
    ws,
    feature: 'robots_steps',
    instructions: [
      'You turn a plain-language description of a browser task into robot steps.',
      'Step types: goto(url), click(selector or visible text), fill(selector, value), select(selector, value), press(key, selector optional),',
      'wait(ms or selector), extract(selector, name, mode text|attribute|all, attribute), extract_list(card selector, name, fields with relative selectors),',
      'extract_table(selector, name), screenshot(name), scroll(selector optional), pdf(name).',
      'Every step has all fields; use "" or 0 for the ones it does not use. Use the page HTML to pick real selectors; when unsure, click by visible text.',
      `Values can reference run inputs as {{inputs.name}}. Available inputs: ${inputs.join(', ') || '(none)'}.`,
      'Never put passwords in steps: use {{credentials.LOGIN.password}} and {{credentials.LOGIN.username}}.',
    ].join(' '),
    prompt: `Task: ${description.slice(0, 3000)}\n\n${snap ? snapshotPrompt(snap) : 'No page snapshot.'}`,
    schema: nlOut,
    maxOutputTokens: 3000,
    fake: () => {
      const empty = { url: '', selector: '', text: '', value: '', key: '', name: '', ms: 0, mode: '', attribute: '', fields: [] as Array<z.infer<typeof fieldOut>> };
      const url = /(https?:\/\/[^\s"')]+)/.exec(description)?.[1] ?? snap?.url ?? '';
      const steps: Array<z.infer<typeof nlStep>> = [];
      if (url) steps.push({ ...empty, type: 'goto', url });
      const best = snap?.lists[0];
      if (best) steps.push({ ...empty, type: 'extract_list', selector: best.selector, name: 'items', fields: best.fields });
      else steps.push({ ...empty, type: 'extract', selector: 'h1', name: 'heading', mode: 'text' });
      if (/screenshot|captura/i.test(description)) steps.push({ ...empty, type: 'screenshot', name: 'page' });
      return { steps };
    },
  });
  return normalizeNlSteps(out.steps);
}

// ---------- Arreglo de un paso que falló ----------

const fixOut = z.object({
  selector: z.string().max(500),
  text: z.string().max(200),
  reason: z.string().max(400),
});

export async function suggestSelectorFix(
  ws: string,
  step: Record<string, unknown>,
  failure: { error: string; url: string; dom?: string; title?: string },
  locale: string,
): Promise<{ selector: string; text: string; reason: string }> {
  const out = await robotsObject({
    ws,
    feature: 'robots_fix',
    instructions: [
      'A browser robot step failed because its CSS selector no longer matches the page.',
      'From the HTML captured when it failed, propose a new CSS selector for the same element (prefer ids, data-testid, name, aria-label, stable classes).',
      'If no selector is reliable, propose the visible text to click instead (text) and leave selector "".',
      `Explain the change in one short sentence in the language with code "${locale}".`,
    ].join(' '),
    prompt: `Step: ${JSON.stringify(step).slice(0, 2000)}\nError: ${failure.error}\nURL: ${failure.url}\nTitle: ${failure.title ?? ''}\nHTML when it failed:\n${(failure.dom ?? '').slice(0, 12_000)}`,
    schema: fixOut,
    maxOutputTokens: 400,
    fake: () => {
      const cls = /class="([A-Za-z][\w-]*)/.exec(failure.dom ?? '')?.[1];
      return { selector: cls ? `.${cls}` : 'body', text: '', reason: 'fake' };
    },
  });
  return { selector: out.selector.trim().slice(0, 500), text: out.text.trim().slice(0, 200), reason: out.reason.slice(0, 400) };
}

// ---------- Paso ai_extract ----------

export interface AiExtractCapture {
  __aiExtract: 1;
  instruction: string;
  fields: Array<{ name: string; description: string }>;
  url: string;
  text: string;
  links: string[][];
}

export function isAiExtractCapture(v: unknown): v is AiExtractCapture {
  return !!v && typeof v === 'object' && !Array.isArray(v) && (v as { __aiExtract?: unknown }).__aiExtract === 1;
}

export async function extractWithAi(ws: string, cap: AiExtractCapture): Promise<Array<Record<string, string>>> {
  const fields = cap.fields.slice(0, 20);
  if (!fields.length) return [];
  const rowSchema = z.object(Object.fromEntries(fields.map((f) => [f.name, z.string().max(2000)])) as Record<string, z.ZodString>);
  const out = await robotsObject({
    ws,
    feature: 'robots_ai_extract',
    instructions: [
      'You extract structured rows from the text of a web page. Return only what is in the text, never invent values.',
      'Use "" when a field is missing for a row. For links, use the absolute URLs from the link list.',
    ].join(' '),
    prompt: [
      `What to extract: ${cap.instruction}`,
      `Fields: ${fields.map((f) => `${f.name}${f.description ? ` (${f.description})` : ''}`).join(', ')}`,
      `Page: ${cap.url}`,
      '',
      'Page text:',
      cap.text.slice(0, 30_000),
      '',
      'Links (text → URL):',
      cap.links
        .slice(0, 300)
        .map((l) => `${l[0] ?? ''} → ${l[1] ?? ''}`)
        .join('\n')
        .slice(0, 15_000),
    ].join('\n'),
    schema: z.object({ rows: z.array(rowSchema).max(500) }),
    maxOutputTokens: 8000,
    fake: () => ({
      rows: cap.text
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((line) => Object.fromEntries(fields.map((f, i) => [f.name, i === 0 ? line.slice(0, 200) : '']))),
    }),
  });
  return (out.rows as Array<Record<string, string>>).slice(0, 500);
}

// ---------- Columnas con IA ----------

export async function aiColumnValues(ws: string, prompt: string, rows: Array<Record<string, unknown>>): Promise<string[]> {
  if (!rows.length) return [];
  const out = await robotsObject({
    ws,
    feature: 'robots_ai_column',
    instructions: [
      'You compute one new column for each row of a table scraped from the web.',
      'Answer with a short value per row (a word, a number, a category or a short phrase), in the same order and with exactly one value per row.',
      'Use only the row data; answer "" if it cannot be known.',
    ].join(' '),
    prompt: `Column: ${prompt}\n\nRows (JSON, one per line):\n${rows.map((r) => JSON.stringify(r).slice(0, 1500)).join('\n')}`,
    schema: z.object({ values: z.array(z.string().max(500)) }),
    maxOutputTokens: Math.min(8000, 60 * rows.length + 200),
    fake: () => ({ values: rows.map((r) => String(Object.values(r)[0] ?? '').length > 20 ? 'long' : 'short') }),
  });
  const values = out.values.slice(0, rows.length);
  while (values.length < rows.length) values.push('');
  return values;
}

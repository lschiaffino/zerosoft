/**
 * Robots — catálogo de pasos, validación (zod), límites y plantillas. Sin
 * dependencias de servidor: lo comparten la API, el runner y el editor.
 *
 * Un robot es una lista de pasos de navegador (goto, click, fill, extract…)
 * que se ejecuta en un Chromium aislado (ver lib/robots-runner.ts). Los textos
 * admiten plantillas {{inputs.x}}, {{vars.x}} y, dentro de un loop,
 * {{loop.item}} / {{loop.index}}. {{credentials.<name>.totp}} es el código
 * 2FA del momento de una credencial con secreto TOTP.
 */
import { z } from 'zod';
import { isValidCron, isValidTimezone } from './cron';

// ---------- Límites ----------

/** Pasos definidos (contando los anidados en loops). */
export const MAX_ROBOT_STEPS = 100;
/** Pasos dentro de un loop_over. */
export const MAX_LOOP_STEPS = 20;
/** Elementos que recorre un loop_over. */
export const MAX_LOOP_ITEMS = 50;
/** Acciones ejecutadas por corrida (loops incluidos). */
export const MAX_EXECUTED_STEPS = 500;
/** Navegaciones / pestañas por corrida. */
export const MAX_PAGES = 20;
/** Capturas por corrida. */
export const MAX_SCREENSHOTS = 5;
/**
 * Tiempo máximo de una corrida (segundos). Las rutas que corren robots en
 * forma sincrónica tienen maxDuration = 300 s: el resto queda para crear la
 * VM, el margen de corte (+45 s), subir capturas/archivos y registrar el uso.
 * Valores guardados mayores (antes el tope era 300) se acotan a este.
 */
export const MAX_TIMEOUT_SEC = 180;
export const DEFAULT_TIMEOUT_SEC = 120;
/** Variables de entrada por robot. */
export const MAX_INPUTS = 20;
/** Archivos (download / pdf) por corrida y tamaño máximo de cada uno. */
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Campos por fila de un extract_list. */
export const MAX_LIST_FIELDS = 20;
/** Páginas que recorre la paginación de extract_list / extract_table (la primera incluida). */
export const MAX_PAGINATE_PAGES = 20;
/** Filas que junta un extract_list / extract_table entre todas las páginas. */
export const MAX_LIST_ROWS = 1000;
/** Entradas de una corrida en lote (CSV en la app o API v1; una corrida por entrada). */
export const MAX_BULK_INPUTS = 1000;
/** Reintentos por paso. */
export const MAX_STEP_RETRIES = 5;
/** Intervalo mínimo de un schedule en minutos (el cron de robots corre cada 5). */
export const MIN_SCHEDULE_MINUTES = 5;
/** Selectores alternativos por paso (autorreparación: se prueban si el principal no aparece). */
export const MAX_FALLBACKS = 4;
/** Filas de la tabla acumulada por robot. */
export const MAX_DATASET_ROWS = 10_000;
/** Columnas con IA por robot y filas que procesa cada una por corrida. */
export const MAX_AI_COLUMNS = 5;
export const MAX_AI_COLUMN_ROWS = 100;
/** Envíos (CRM, Sheets, Airtable) por robot. */
export const MAX_DESTINATIONS = 5;
/** Texto de la página que lee un paso ai_extract (caracteres). */
export const MAX_AI_EXTRACT_CHARS = 30_000;
/** Fallas seguidas (schedule o Flow) que pausan el schedule. 0 = nunca. */
export const DEFAULT_PAUSE_AFTER = 3;
export const MAX_PAUSE_AFTER = 20;
/** Días que se guardan las corridas. 0 = el default del servidor (ROBOTS_RUN_RETENTION_DAYS). */
export const RETENTION_OPTIONS = [0, 7, 30, 90, 365] as const;

// ---------- Pasos ----------

export const STEP_TYPES = [
  'goto',
  'click',
  'fill',
  'select',
  'press',
  'wait',
  'extract',
  'extract_table',
  'extract_list',
  'screenshot',
  'scroll',
  'if_exists',
  'download',
  'upload',
  'pdf',
  'evaluate',
  'ai_extract',
  'loop_over',
] as const;
export type RobotStepType = (typeof STEP_TYPES)[number];

const varName = z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/, 'invalid_name');
const selector = z.string().trim().max(500);
const template = z.string().max(2000);

/**
 * Opciones de cualquier paso: reintentos (cantidad + espera entre intentos) y
 * seguir si falla (el error queda como advertencia y la corrida sigue).
 */
const retry = {
  retries: z.number().int().min(0).max(MAX_STEP_RETRIES).optional(),
  retryDelayMs: z.number().int().min(0).max(30_000).optional(),
  continueOnError: z.boolean().optional(),
};

/**
 * Autorreparación: selectores alternativos (los graba el grabador junto al
 * principal). Si el principal no aparece en la página, se prueban en orden y
 * el log de la corrida dice cuál sirvió.
 */
const heal = {
  fallbacks: z.array(z.string().trim().min(1).max(500)).max(MAX_FALLBACKS).optional(),
};

const gotoStep = z.object({ type: z.literal('goto'), url: template.min(1), ...retry });
const clickStep = z.object({
  type: z.literal('click'),
  selector: selector.optional().default(''),
  text: z.string().max(200).optional().default(''),
  ...heal,
  ...retry,
});
const fillStep = z.object({ type: z.literal('fill'), selector: selector.min(1), value: template.default(''), ...heal, ...retry });
const selectStep = z.object({ type: z.literal('select'), selector: selector.min(1), value: template.default(''), ...heal, ...retry });
const pressStep = z.object({
  type: z.literal('press'),
  key: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9+_ -]+$/),
  selector: selector.optional().default(''),
  ...heal,
  ...retry,
});
const waitStep = z.object({
  type: z.literal('wait'),
  ms: z.number().int().min(0).max(30_000).optional().default(0),
  selector: selector.optional().default(''),
  ...heal,
  ...retry,
});
const extractStep = z.object({
  type: z.literal('extract'),
  selector: selector.min(1),
  name: varName,
  mode: z.enum(['text', 'attribute', 'all']).default('text'),
  attribute: z.string().trim().max(60).optional().default(''),
  ...heal,
  ...retry,
});
/**
 * Paginación de extract_list / extract_table: después de leer la página hace
 * clic en "Siguiente" (selector o texto) y sigue hasta que el botón no está
 * (o está deshabilitado), la página no cambia o se llega a maxPages.
 */
const pagination = {
  /**
   * next: clic en Siguiente y leer cada página. load_more: clic en "Cargar
   * más" hasta que no esté y leer todo junto. scroll: bajar hasta el final
   * hasta que no aparezcan filas nuevas (scroll infinito).
   */
  paginateMode: z.enum(['next', 'load_more', 'scroll']).optional(),
  nextSelector: selector.optional(),
  nextText: z.string().max(200).optional(),
  maxPages: z.number().int().min(1).max(MAX_PAGINATE_PAGES).optional(),
  /** Espera después de cada clic en Siguiente (ms). */
  pageWaitMs: z.number().int().min(0).max(30_000).optional(),
};
const extractTableStep = z.object({ type: z.literal('extract_table'), selector: selector.min(1), name: varName, ...pagination, ...heal, ...retry });
/** Campo de cada fila: selector relativo a la tarjeta (vacío = la tarjeta) y texto o atributo. */
export const listFieldSchema = z.object({
  name: varName,
  selector: selector.optional().default(''),
  attribute: z.string().trim().max(60).optional().default(''),
});
export type RobotListField = z.infer<typeof listFieldSchema>;
/** Tarjetas que se repiten (selector) → filas con campos con nombre. */
const extractListStep = z.object({
  type: z.literal('extract_list'),
  selector: selector.min(1),
  name: varName,
  fields: z.array(listFieldSchema).min(1).max(MAX_LIST_FIELDS),
  /** Filas por página. */
  max: z.number().int().min(1).max(500).optional().default(100),
  ...pagination,
  ...heal,
  ...retry,
});
const screenshotStep = z.object({ type: z.literal('screenshot'), name: varName, ...retry });
const scrollStep = z.object({
  type: z.literal('scroll'),
  selector: selector.optional().default(''),
  /** Píxeles a bajar; 0 = hasta el final de la página. */
  y: z.number().int().min(0).max(100_000).optional().default(0),
  ...heal,
  ...retry,
});
/** Clic que dispara una descarga: el archivo va a Blob y {{vars.<name>.url}} queda con la URL. */
const downloadStep = z.object({
  type: z.literal('download'),
  selector: selector.optional().default(''),
  text: z.string().max(200).optional().default(''),
  name: varName,
  ...heal,
  ...retry,
});
/** Sube a un <input type="file"> un archivo bajado de una URL pública. */
const uploadStep = z.object({
  type: z.literal('upload'),
  selector: selector.min(1),
  url: template.min(1),
  filename: z.string().max(200).optional().default(''),
  ...retry,
});
/** La página actual como PDF (A4) en Blob: {{vars.<name>.url}}. */
const pdfStep = z.object({ type: z.literal('pdf'), name: varName, ...retry });
/** JS propio dentro de la página (cuerpo de una función async); el valor devuelto (JSON) queda en vars. */
const evaluateStep = z.object({
  type: z.literal('evaluate'),
  script: z.string().min(1).max(10_000),
  name: varName,
  ...retry,
});
/**
 * Extracción descrita con palabras: el paso lee el texto de la página (o de un
 * selector) y, al terminar la corrida, la IA lo convierte en filas con estos
 * campos. El resultado queda en la variable; los pasos siguientes de la misma
 * corrida no lo ven todavía.
 */
export const aiFieldSchema = z.object({
  name: varName,
  description: z.string().max(200).optional().default(''),
});
const aiExtractStep = z.object({
  type: z.literal('ai_extract'),
  instruction: z.string().trim().min(1).max(2000),
  name: varName,
  selector: selector.optional().default(''),
  fields: z.array(aiFieldSchema).min(1).max(MAX_LIST_FIELDS),
  ...retry,
});
const ifExistsStep = z.object({
  type: z.literal('if_exists'),
  selector: selector.optional().default(''),
  text: z.string().max(200).optional().default(''),
  /** Si NO existe: saltear N pasos, ir a un paso (solo hacia adelante), terminar o fallar. */
  onMissing: z.enum(['skip', 'goto', 'stop', 'fail']).default('skip'),
  count: z.number().int().min(1).max(MAX_ROBOT_STEPS).optional().default(1),
  /** Número de paso (1-based) al que saltar con onMissing = goto. */
  target: z.number().int().min(1).max(MAX_ROBOT_STEPS).optional().default(1),
});

const leafStep = z.discriminatedUnion('type', [
  gotoStep,
  clickStep,
  fillStep,
  selectStep,
  pressStep,
  waitStep,
  extractStep,
  extractTableStep,
  extractListStep,
  screenshotStep,
  scrollStep,
  ifExistsStep,
  downloadStep,
  uploadStep,
  pdfStep,
  evaluateStep,
  aiExtractStep,
]);

const loopStep = z.object({
  type: z.literal('loop_over'),
  /** Lista a recorrer: {{inputs.urls}} o {{vars.links}}. */
  list: template.min(1),
  max: z.number().int().min(1).max(MAX_LOOP_ITEMS).optional().default(10),
  steps: z.array(leafStep).max(MAX_LOOP_STEPS),
  /** Si un elemento falla, queda como advertencia y el loop pasa al siguiente. */
  continueOnItemError: z.boolean().optional(),
});

export const robotStepSchema = z.union([leafStep, loopStep]);
export type RobotStep = z.infer<typeof robotStepSchema>;
export type RobotLeafStep = z.infer<typeof leafStep>;

export const robotInputSchema = z.object({
  name: varName,
  label: z.string().max(80).optional().default(''),
  kind: z.enum(['text', 'list']).default('text'),
  default: z.string().max(5000).optional().default(''),
  required: z.boolean().optional().default(false),
});
export type RobotInputDef = z.infer<typeof robotInputSchema>;

export const robotScheduleSchema = z
  .object({
    mode: z.enum(['daily', 'interval', 'cron']),
    time: z.string().regex(/^\d{1,2}:\d{2}$/).optional().default('09:00'),
    timezone: z.string().max(60).optional().default('UTC'),
    every: z.number().int().min(1).max(1440).optional().default(24),
    unit: z.enum(['hours', 'minutes']).optional().default('hours'),
    /** Cron de 5 campos (mode = cron), en `timezone`. */
    cron: z.string().max(120).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.mode === 'interval') {
      if (s.unit === 'minutes' && s.every < MIN_SCHEDULE_MINUTES) ctx.addIssue({ code: 'custom', path: ['every'], message: 'min_interval' });
      if (s.unit === 'hours' && s.every > 168) ctx.addIssue({ code: 'custom', path: ['every'], message: 'max_interval' });
    }
    if (s.mode === 'cron' && !isValidCron(s.cron ?? '')) ctx.addIssue({ code: 'custom', path: ['cron'], message: 'invalid_cron' });
    if (s.mode !== 'interval' && !isValidTimezone(s.timezone)) ctx.addIssue({ code: 'custom', path: ['timezone'], message: 'invalid_timezone' });
  })
  .nullable();
export type RobotSchedule = z.infer<typeof robotScheduleSchema>;

export type RobotErrorCode =
  | 'invalid_steps'
  | 'too_many_steps'
  | 'invalid_inputs'
  | 'duplicate_input'
  | 'invalid_goto_target'
  | 'nested_loop';

/** Cantidad de pasos contando los anidados. */
export function countSteps(steps: readonly RobotStep[]): number {
  let n = 0;
  for (const s of steps) n += 1 + (s.type === 'loop_over' ? s.steps.length : 0);
  return n;
}

export type StepsValidation = { ok: true; steps: RobotStep[] } | { ok: false; error: RobotErrorCode; index?: number };

export function validateSteps(input: unknown): StepsValidation {
  if (!Array.isArray(input)) return { ok: false, error: 'invalid_steps' };
  if (input.length > MAX_ROBOT_STEPS) return { ok: false, error: 'too_many_steps' };
  const out: RobotStep[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as { type?: unknown; steps?: unknown } | null;
    if (raw && raw.type === 'loop_over' && Array.isArray(raw.steps)) {
      if (raw.steps.some((s) => (s as { type?: unknown } | null)?.type === 'loop_over')) {
        return { ok: false, error: 'nested_loop', index: i };
      }
    }
    const parsed = robotStepSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'invalid_steps', index: i };
    out.push(parsed.data);
  }
  if (countSteps(out) > MAX_ROBOT_STEPS) return { ok: false, error: 'too_many_steps' };
  // Campos de extract_list sin nombres repetidos (serían columnas pisadas).
  for (let i = 0; i < out.length; i++) {
    const list = out[i].type === 'loop_over' ? (out[i] as { steps: RobotLeafStep[] }).steps : [out[i] as RobotLeafStep];
    for (const s of list) {
      if (s.type === 'extract_list' && new Set(s.fields.map((f) => f.name)).size !== s.fields.length) {
        return { ok: false, error: 'invalid_steps', index: i };
      }
    }
  }
  // goto de if_exists: solo hacia adelante (sin ciclos) y dentro de la lista.
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (s.type === 'if_exists' && s.onMissing === 'goto' && (s.target <= i + 1 || s.target > out.length + 1)) {
      return { ok: false, error: 'invalid_goto_target', index: i };
    }
  }
  return { ok: true, steps: out };
}

export type InputsValidation = { ok: true; inputs: RobotInputDef[] } | { ok: false; error: RobotErrorCode };

export function validateInputDefs(input: unknown): InputsValidation {
  const parsed = z.array(robotInputSchema).max(MAX_INPUTS).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_inputs' };
  const names = new Set<string>();
  for (const d of parsed.data) {
    if (names.has(d.name)) return { ok: false, error: 'duplicate_input' };
    names.add(d.name);
  }
  return { ok: true, inputs: parsed.data };
}

/**
 * Valores de entrada de una corrida: aplica defaults, exige los requeridos y
 * convierte las listas (una por línea) en arrays. Ignora claves desconocidas.
 */
export function resolveInputs(
  defs: readonly RobotInputDef[],
  values: Record<string, unknown> | undefined,
): { ok: true; inputs: Record<string, unknown> } | { ok: false; error: 'missing_input'; name: string } {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const raw = values?.[d.name];
    let v: unknown = raw === undefined || raw === null || raw === '' ? d.default : raw;
    if (d.kind === 'list') {
      if (typeof v === 'string') {
        v = v
          .split(/\r?\n/)
          .map((x) => x.trim())
          .filter(Boolean);
      } else if (!Array.isArray(v)) {
        v = v === undefined || v === null ? [] : [v];
      }
      v = (v as unknown[]).slice(0, 500).map((x) => (typeof x === 'string' ? x.slice(0, 2000) : x));
      if (d.required && (v as unknown[]).length === 0) return { ok: false, error: 'missing_input', name: d.name };
    } else {
      v = typeof v === 'string' ? v.slice(0, 5000) : v === undefined || v === null ? '' : String(v).slice(0, 5000);
      if (d.required && !(v as string).trim()) return { ok: false, error: 'missing_input', name: d.name };
    }
    out[d.name] = v;
  }
  return { ok: true, inputs: out };
}

/** Paso nuevo con valores por defecto (editor). */
export function defaultStep(type: RobotStepType): RobotStep {
  switch (type) {
    case 'goto':
      return { type, url: 'https://' };
    case 'click':
      return { type, selector: '', text: '' };
    case 'fill':
    case 'select':
      return { type, selector: '', value: '' };
    case 'press':
      return { type, key: 'Enter', selector: '' };
    case 'wait':
      return { type, ms: 1000, selector: '' };
    case 'extract':
      return { type, selector: '', name: 'value', mode: 'text', attribute: '' };
    case 'extract_table':
      return { type, selector: 'table', name: 'rows' };
    case 'extract_list':
      return {
        type,
        selector: '.card',
        name: 'items',
        fields: [
          { name: 'title', selector: 'h2', attribute: '' },
          { name: 'link', selector: 'a', attribute: 'href' },
        ],
        max: 100,
      };
    case 'screenshot':
      return { type, name: 'page' };
    case 'scroll':
      return { type, selector: '', y: 0 };
    case 'if_exists':
      return { type, selector: '', text: '', onMissing: 'skip', count: 1, target: 1 };
    case 'download':
      return { type, selector: '', text: '', name: 'file' };
    case 'upload':
      return { type, selector: 'input[type="file"]', url: '', filename: '' };
    case 'pdf':
      return { type, name: 'pdf' };
    case 'evaluate':
      return { type, script: 'return document.title;', name: 'result' };
    case 'ai_extract':
      return {
        type,
        instruction: '',
        name: 'items',
        selector: '',
        fields: [
          { name: 'title', description: '' },
          { name: 'price', description: '' },
        ],
      };
    case 'loop_over':
      return { type, list: '{{inputs.urls}}', max: 10, steps: [] };
  }
}

// ---------- Ajustes del robot (tabla acumulada, IA, envíos, país) ----------

/** Campos del CRM que se pueden mapear desde una columna. */
export const CRM_CONTACT_FIELDS = ['email', 'firstName', 'lastName', 'phone', 'jobTitle', 'website', 'city', 'country'] as const;
export const CRM_COMPANY_FIELDS = ['name', 'domain', 'website', 'phone', 'industry', 'city', 'country'] as const;

const columnName = z.string().trim().max(60);
const destBase = {
  id: z.string().trim().min(1).max(40),
  enabled: z.boolean().optional().default(true),
  /** Variable de lista de la corrida ('' = la de la tabla acumulada). */
  variable: z.string().trim().max(40).optional().default(''),
};

/**
 * Envíos al terminar una corrida exitosa:
 * - crm: crea o actualiza contactos (por email) o empresas (por dominio).
 * - sheets: mantiene una hoja igual a la tabla acumulada (sync) o agrega las filas nuevas (append).
 * - airtable: crea o actualiza registros (por un campo clave) en una tabla.
 */
export const robotDestinationSchema = z.discriminatedUnion('kind', [
  z.object({
    ...destBase,
    kind: z.literal('crm'),
    object: z.enum(['contacts', 'companies']),
    mapping: z.record(columnName).default({}),
    /**
     * Qué hacer con un registro que ya existe (mismo email o dominio):
     * 'fill' (default) solo completa los campos vacíos, 'skip' no lo toca,
     * 'overwrite' pisa con lo del robot. Nunca pisa por defecto.
     */
    onExisting: z.enum(['fill', 'skip', 'overwrite']).optional().default('fill'),
  }),
  z.object({
    ...destBase,
    kind: z.literal('sheets'),
    credential: z.string().trim().min(1).max(100),
    spreadsheetId: z.string().trim().regex(/^[A-Za-z0-9_-]{10,200}$/),
    sheet: z.string().trim().min(1).max(100).default('Sheet1'),
    mode: z.enum(['sync', 'append']).default('sync'),
  }),
  z.object({
    ...destBase,
    kind: z.literal('airtable'),
    credential: z.string().trim().min(1).max(100),
    baseId: z.string().trim().regex(/^app[A-Za-z0-9]{8,30}$/),
    table: z.string().trim().min(1).max(100),
    /** Campo de Airtable que identifica la fila (upsert); vacío = solo crea. */
    mergeField: z.string().trim().max(100).optional().default(''),
  }),
]);
export type RobotDestination = z.infer<typeof robotDestinationSchema>;

export const robotAiColumnSchema = z.object({
  /** Variable de lista a la que se le agrega la columna. */
  variable: varName,
  name: varName,
  /** Qué calcular con cada fila: "Categoría del producto", "¿Es remoto? sí/no". */
  prompt: z.string().trim().min(1).max(1000),
});
export type RobotAiColumn = z.infer<typeof robotAiColumnSchema>;

export const robotSettingsSchema = z.object({
  /**
   * Tabla acumulada: junta las filas de una variable de lista entre corridas
   * (nuevas, cambiadas, que ya no aparecen). variable '' = la primera lista
   * de los pasos. keyFields vacío = la fila entera es la clave.
   */
  dataset: z
    .object({
      enabled: z.boolean().default(true),
      variable: z.string().trim().max(40).default(''),
      keyFields: z.array(varName).max(5).default([]),
    })
    .optional(),
  /** Email con el cambio (filas nuevas, quitadas y valores cambiados) cuando la salida cambia. */
  changeEmail: z
    .object({
      enabled: z.boolean().default(false),
      /** Vacío = quien creó el robot. */
      to: z.array(z.string().trim().email().max(200)).max(10).default([]),
    })
    .optional(),
  aiColumns: z.array(robotAiColumnSchema).max(MAX_AI_COLUMNS).optional(),
  /** País de la corrida (ISO 3166 alfa-2 en minúsculas, '' = el del runner). */
  country: z
    .string()
    .trim()
    .regex(/^([a-z]{2})?$/)
    .optional(),
  destinations: z.array(robotDestinationSchema).max(MAX_DESTINATIONS).optional(),
});
export type RobotSettings = z.infer<typeof robotSettingsSchema>;

/** Ajustes guardados (o pedidos) → válidos; lo inválido se descarta en vez de romper el robot. */
export function parseRobotSettings(raw: unknown): RobotSettings {
  const parsed = robotSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

/** Variables de lista que producen los pasos (extract_list, extract_table, extract all, ai_extract), en orden. */
export function listVariables(steps: readonly RobotStep[]): string[] {
  const out: string[] = [];
  const visit = (s: RobotLeafStep) => {
    if (s.type === 'extract_list' || s.type === 'extract_table' || s.type === 'ai_extract' || (s.type === 'extract' && s.mode === 'all')) {
      if (!out.includes(s.name)) out.push(s.name);
    }
  };
  for (const s of steps) {
    if (s.type === 'loop_over') s.steps.forEach(visit);
    else visit(s);
  }
  return out;
}

/** Variable de la tabla acumulada: la elegida o la primera lista de los pasos. null = apagada / sin listas. */
export function datasetVariable(steps: readonly RobotStep[], settings: RobotSettings): string | null {
  if (settings.dataset?.enabled === false) return null;
  const vars = listVariables(steps);
  const chosen = settings.dataset?.variable;
  if (chosen) return vars.includes(chosen) ? chosen : null;
  return vars[0] ?? null;
}

// ---------- Exportar / importar ----------

/** Archivo de un robot exportado (sin credenciales, sesiones ni corridas). */
export const robotExportSchema = z.object({
  zerosoftRobot: z.literal(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional().default(''),
  steps: z.unknown(),
  inputs: z.unknown().optional(),
  schedule: robotScheduleSchema.optional(),
  timeoutSec: z.number().int().min(10).max(300).optional(),
  settings: z.unknown().optional(),
});
export type RobotExport = z.infer<typeof robotExportSchema>;

// ---------- API ----------

export const robotCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  template: z.string().max(60).optional(),
  /** Pasos ya armados (constructor con IA). */
  steps: z.unknown().optional(),
  inputs: z.unknown().optional(),
  /** Robot exportado (archivo .json). */
  import: z.unknown().optional(),
});

export const robotUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(1000).optional(),
  steps: z.unknown().optional(),
  inputs: z.unknown().optional(),
  enabled: z.boolean().optional(),
  schedule: robotScheduleSchema.optional(),
  // Hasta 300 por compatibilidad con robots viejos; se acota a MAX_TIMEOUT_SEC al guardar.
  timeoutSec: z.number().int().min(10).max(300).optional(),
  /** Guardar cookies y localStorage entre corridas (cifrados). */
  persistSession: z.boolean().optional(),
  /** Email al dueño cuando falla una corrida automática (con tope de frecuencia). */
  failureAlerts: z.boolean().optional(),
  /** Fallas seguidas que pausan el schedule (0 = nunca). */
  pauseAfter: z.number().int().min(0).max(MAX_PAUSE_AFTER).optional(),
  retentionDays: z
    .number()
    .int()
    .refine((n) => (RETENTION_OPTIONS as readonly number[]).includes(n), 'invalid_retention')
    .optional(),
  settings: z.unknown().optional(),
});

export const robotRunSchema = z.object({
  inputs: z.record(z.unknown()).optional(),
});

/** API v1: correr un robot (wait = esperar el resultado en la misma respuesta). */
export const robotApiRunSchema = z.object({
  inputs: z.record(z.unknown()).optional(),
  wait: z.boolean().optional(),
});

/** API v1: un robot sobre muchas entradas (una corrida en cola por entrada). */
export const robotBulkSchema = z.object({
  inputs: z.array(z.record(z.unknown())).min(1).max(MAX_BULK_INPUTS),
});

// ---------- Plantillas ----------

export type RobotTemplateKey =
  | 'scrapeTable'
  | 'priceCheck'
  | 'fillForm'
  | 'screenshot'
  | 'monitorPage'
  | 'listAndDetails'
  | 'loginExtract'
  | 'hackerNews'
  | 'githubTrending'
  | 'githubReleases'
  | 'lobsters'
  | 'devTo'
  | 'remoteJobs'
  | 'booksCatalog'
  | 'infiniteScroll';

export type RobotTemplateCategory = 'start' | 'monitor' | 'sites';

export interface RobotTemplate {
  key: RobotTemplateKey;
  category: RobotTemplateCategory;
  /** Sitio para el que está armado (los genéricos no tienen). */
  site?: string;
  steps: RobotStep[];
  inputs: RobotInputDef[];
  schedule: RobotSchedule;
  settings?: RobotSettings;
}

export const TEMPLATE_CATEGORIES: readonly RobotTemplateCategory[] = ['start', 'monitor', 'sites'];

export const ROBOT_TEMPLATES: readonly RobotTemplate[] = [
  {
    key: 'scrapeTable',
    category: 'start',
    inputs: [{ name: 'url', label: 'Page URL', kind: 'text', default: 'https://en.wikipedia.org/wiki/List_of_countries_by_population_(United_Nations)', required: true }],
    schedule: null,
    steps: [
      { type: 'goto', url: '{{inputs.url}}' },
      { type: 'wait', ms: 0, selector: 'table' },
      { type: 'extract_table', selector: 'table', name: 'rows' },
    ],
  },
  {
    key: 'priceCheck',
    category: 'monitor',
    settings: { changeEmail: { enabled: true, to: [] } },
    inputs: [
      { name: 'url', label: 'Product URL', kind: 'text', default: 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html', required: true },
      { name: 'priceSelector', label: 'Price selector', kind: 'text', default: '.price_color', required: true },
    ],
    schedule: { mode: 'daily', time: '09:00', timezone: 'UTC', every: 24, unit: 'hours' },
    steps: [
      { type: 'goto', url: '{{inputs.url}}' },
      { type: 'extract', selector: 'h1', name: 'title', mode: 'text', attribute: '' },
      { type: 'extract', selector: '{{inputs.priceSelector}}', name: 'price', mode: 'text', attribute: '' },
    ],
  },
  {
    key: 'fillForm',
    category: 'start',
    inputs: [
      { name: 'url', label: 'Form URL', kind: 'text', default: 'https://httpbin.org/forms/post', required: true },
      { name: 'name', label: 'Name', kind: 'text', default: 'Ada Lovelace', required: false },
      { name: 'email', label: 'Email', kind: 'text', default: 'ada@example.com', required: false },
    ],
    schedule: null,
    steps: [
      { type: 'goto', url: '{{inputs.url}}' },
      { type: 'fill', selector: 'input[name="custname"]', value: '{{inputs.name}}' },
      { type: 'fill', selector: 'input[name="custemail"]', value: '{{inputs.email}}' },
      { type: 'click', selector: 'form button', text: 'Submit order' },
      { type: 'wait', ms: 1000, selector: '' },
      { type: 'extract', selector: 'body', name: 'response', mode: 'text', attribute: '' },
      { type: 'screenshot', name: 'result' },
    ],
  },
  {
    key: 'screenshot',
    category: 'start',
    inputs: [{ name: 'url', label: 'Page URL', kind: 'text', default: 'https://example.com', required: true }],
    schedule: null,
    steps: [
      { type: 'goto', url: '{{inputs.url}}' },
      { type: 'extract', selector: 'h1, p', name: 'heading', mode: 'text', attribute: '' },
      { type: 'screenshot', name: 'page' },
    ],
  },
  {
    key: 'monitorPage',
    category: 'monitor',
    settings: { changeEmail: { enabled: true, to: [] } },
    inputs: [
      { name: 'url', label: 'Page URL', kind: 'text', default: 'https://example.com', required: true },
      { name: 'selector', label: 'Part of the page to watch', kind: 'text', default: 'body', required: true },
    ],
    schedule: { mode: 'interval', time: '09:00', timezone: 'UTC', every: 1, unit: 'hours' },
    steps: [
      { type: 'goto', url: '{{inputs.url}}' },
      { type: 'extract', selector: '{{inputs.selector}}', name: 'content', mode: 'text', attribute: '' },
    ],
  },
  {
    key: 'listAndDetails',
    category: 'start',
    inputs: [{ name: 'url', label: 'List URL', kind: 'text', default: 'https://books.toscrape.com/', required: true }],
    schedule: null,
    steps: [
      { type: 'goto', url: '{{inputs.url}}' },
      {
        type: 'extract_list',
        selector: 'article.product_pod',
        name: 'items',
        fields: [
          { name: 'title', selector: 'h3 a', attribute: 'title' },
          { name: 'link', selector: 'h3 a', attribute: 'href' },
        ],
        max: 10,
      },
      {
        type: 'loop_over',
        list: '{{vars.items}}',
        max: 10,
        continueOnItemError: true,
        steps: [
          { type: 'goto', url: '{{loop.item.link}}' },
          { type: 'extract', selector: '.product_main .price_color', name: 'price', mode: 'text', attribute: '' },
          { type: 'extract', selector: '#product_description + p', name: 'description', mode: 'text', attribute: '', continueOnError: true },
        ],
      },
    ],
  },
  {
    key: 'loginExtract',
    category: 'start',
    inputs: [{ name: 'url', label: 'Login page', kind: 'text', default: 'https://quotes.toscrape.com/login', required: true }],
    schedule: null,
    steps: [
      { type: 'goto', url: '{{inputs.url}}' },
      { type: 'if_exists', selector: 'input[name="username"]', text: '', onMissing: 'skip', count: 3, target: 1 },
      { type: 'fill', selector: 'input[name="username"]', value: '{{credentials.LOGIN.username}}' },
      { type: 'fill', selector: 'input[name="password"]', value: '{{credentials.LOGIN.password}}' },
      { type: 'click', selector: 'input[type="submit"]', text: 'Login' },
      { type: 'wait', ms: 0, selector: '.quote' },
      {
        type: 'extract_list',
        selector: '.quote',
        name: 'items',
        fields: [
          { name: 'text', selector: '.text', attribute: '' },
          { name: 'author', selector: '.author', attribute: '' },
        ],
        max: 100,
      },
    ],
  },
  {
    key: 'hackerNews',
    category: 'sites',
    site: 'news.ycombinator.com',
    inputs: [],
    schedule: { mode: 'interval', time: '09:00', timezone: 'UTC', every: 1, unit: 'hours' },
    steps: [
      { type: 'goto', url: 'https://news.ycombinator.com/' },
      {
        type: 'extract_list',
        selector: 'tr.athing',
        name: 'stories',
        fields: [
          { name: 'rank', selector: '.rank', attribute: '' },
          { name: 'title', selector: '.titleline > a', attribute: '' },
          { name: 'link', selector: '.titleline > a', attribute: 'href' },
          { name: 'site', selector: '.sitestr', attribute: '' },
        ],
        max: 30,
        nextSelector: 'a.morelink',
        nextText: 'More',
        maxPages: 2,
        pageWaitMs: 1000,
      },
    ],
    settings: { dataset: { enabled: true, variable: 'stories', keyFields: ['link'] } },
  },
  {
    key: 'githubTrending',
    category: 'sites',
    site: 'github.com',
    inputs: [{ name: 'since', label: 'Period (daily, weekly, monthly)', kind: 'text', default: 'daily', required: false }],
    schedule: { mode: 'daily', time: '09:00', timezone: 'UTC', every: 24, unit: 'hours' },
    steps: [
      { type: 'goto', url: 'https://github.com/trending?since={{inputs.since | default: "daily"}}' },
      {
        type: 'extract_list',
        selector: 'article.Box-row',
        name: 'repos',
        fields: [
          { name: 'repo', selector: 'h2 a', attribute: '' },
          { name: 'link', selector: 'h2 a', attribute: 'href' },
          { name: 'description', selector: 'p', attribute: '' },
          { name: 'stars', selector: 'a[href$="/stargazers"]', attribute: '' },
          { name: 'gained', selector: 'span.float-sm-right', attribute: '' },
        ],
        max: 25,
      },
    ],
    settings: { dataset: { enabled: true, variable: 'repos', keyFields: ['link'] } },
  },
  {
    key: 'githubReleases',
    category: 'monitor',
    site: 'github.com',
    inputs: [{ name: 'repo', label: 'Repository (owner/name)', kind: 'text', default: 'vercel/next.js', required: true }],
    schedule: { mode: 'daily', time: '09:00', timezone: 'UTC', every: 24, unit: 'hours' },
    steps: [
      { type: 'goto', url: 'https://github.com/{{inputs.repo}}/releases' },
      {
        type: 'extract_list',
        selector: 'section',
        name: 'releases',
        fields: [
          { name: 'title', selector: 'h2', attribute: '' },
          { name: 'link', selector: 'a.Link--primary', attribute: 'href' },
          { name: 'date', selector: 'relative-time', attribute: 'datetime' },
        ],
        max: 10,
      },
    ],
    settings: { dataset: { enabled: true, variable: 'releases', keyFields: ['link'] }, changeEmail: { enabled: true, to: [] } },
  },
  {
    key: 'lobsters',
    category: 'sites',
    site: 'lobste.rs',
    inputs: [],
    schedule: null,
    steps: [
      { type: 'goto', url: 'https://lobste.rs/' },
      {
        type: 'extract_list',
        selector: 'li.story',
        name: 'stories',
        fields: [
          { name: 'title', selector: 'a.u-url', attribute: '' },
          { name: 'link', selector: 'a.u-url', attribute: 'href' },
          { name: 'tags', selector: '.tags', attribute: '' },
          { name: 'score', selector: '.upvoter', attribute: '' },
          { name: 'comments', selector: '.comments_label a', attribute: '' },
        ],
        max: 25,
      },
    ],
    settings: { dataset: { enabled: true, variable: 'stories', keyFields: ['link'] } },
  },
  {
    key: 'devTo',
    category: 'sites',
    site: 'dev.to',
    inputs: [{ name: 'tag', label: 'Tag', kind: 'text', default: 'javascript', required: true }],
    schedule: null,
    steps: [
      { type: 'goto', url: 'https://dev.to/t/{{inputs.tag | urlencode}}' },
      { type: 'wait', ms: 0, selector: '.crayons-story' },
      {
        type: 'extract_list',
        selector: '.crayons-story',
        name: 'posts',
        fields: [
          { name: 'title', selector: '.crayons-story__title a', attribute: '' },
          { name: 'link', selector: '.crayons-story__title a', attribute: 'href' },
          { name: 'date', selector: 'time', attribute: 'datetime' },
          { name: 'reactions', selector: '.aggregate_reactions_counter', attribute: '' },
        ],
        max: 30,
      },
    ],
    settings: { dataset: { enabled: true, variable: 'posts', keyFields: ['link'] } },
  },
  {
    key: 'remoteJobs',
    category: 'monitor',
    site: 'weworkremotely.com',
    inputs: [
      { name: 'url', label: 'Category page', kind: 'text', default: 'https://weworkremotely.com/categories/remote-programming-jobs', required: true },
    ],
    schedule: { mode: 'daily', time: '09:00', timezone: 'UTC', every: 24, unit: 'hours' },
    steps: [
      { type: 'goto', url: '{{inputs.url}}' },
      {
        type: 'extract_list',
        selector: 'li.new-listing-container',
        name: 'jobs',
        fields: [
          { name: 'title', selector: '.new-listing__header__title', attribute: '' },
          { name: 'company', selector: '.new-listing__company-name', attribute: '' },
          { name: 'region', selector: '.new-listing__company-headquarters', attribute: '' },
          { name: 'link', selector: 'a[href*="/remote-jobs/"]', attribute: 'href' },
        ],
        max: 100,
      },
    ],
    settings: { dataset: { enabled: true, variable: 'jobs', keyFields: ['link'] }, changeEmail: { enabled: true, to: [] } },
  },
  {
    key: 'booksCatalog',
    category: 'sites',
    site: 'books.toscrape.com',
    inputs: [],
    schedule: null,
    steps: [
      { type: 'goto', url: 'https://books.toscrape.com/' },
      {
        type: 'extract_list',
        selector: 'article.product_pod',
        name: 'books',
        fields: [
          { name: 'title', selector: 'h3 a', attribute: 'title' },
          { name: 'price', selector: '.price_color', attribute: '' },
          { name: 'stock', selector: '.availability', attribute: '' },
          { name: 'link', selector: 'h3 a', attribute: 'href' },
        ],
        max: 20,
        nextSelector: 'li.next a',
        nextText: 'next',
        maxPages: 3,
        pageWaitMs: 500,
      },
    ],
    settings: { dataset: { enabled: true, variable: 'books', keyFields: ['link'] } },
  },
  {
    key: 'infiniteScroll',
    category: 'sites',
    site: 'quotes.toscrape.com',
    inputs: [],
    schedule: null,
    steps: [
      { type: 'goto', url: 'https://quotes.toscrape.com/scroll' },
      { type: 'wait', ms: 0, selector: '.quote' },
      {
        type: 'extract_list',
        selector: '.quote',
        name: 'quotes',
        fields: [
          { name: 'text', selector: '.text', attribute: '' },
          { name: 'author', selector: '.author', attribute: '' },
        ],
        max: 100,
        paginateMode: 'scroll',
        maxPages: 5,
        pageWaitMs: 1000,
      },
    ],
  },
];

/**
 * Track — import: modelo normalizado y mapeo de columnas. Puro (sin DB): lo
 * usan el servidor (convierte la fuente) y el navegador (sugiere el mapeo de
 * un CSV antes de mandarlo).
 *
 * Todas las fuentes (Linear por API o CSV, Jira CSV, GitHub Issues y CSV
 * genérico) terminan en NormalizedIssue: título, descripción en Markdown,
 * status (nombre + categoría), prioridad, responsable por email o nombre,
 * labels, estimación, cycle, milestone, padre y comentarios.
 */
import { parseCsv } from './csv-parse';

export const TRACK_IMPORT_SOURCES = ['linear', 'jira', 'github', 'csv'] as const;
export type TrackImportSource = (typeof TRACK_IMPORT_SOURCES)[number];

export type ImportStatusCategory = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
export type ImportPriority = 'urgent' | 'high' | 'medium' | 'low';

export interface NormalizedComment {
  extId: string;
  authorEmail?: string | null;
  authorName?: string | null;
  body: string;
  createdAt?: string | null;
}

export interface NormalizedIssue {
  /** Id estable en la fuente (identifier de Linear, key de Jira, owner/repo#n). */
  extId: string;
  /** Identificador original para mostrar (ENG-12, PROJ-3, #45). */
  key?: string | null;
  project: { extId: string; name: string; key?: string | null; description?: string | null };
  title: string;
  description: string;
  status: { name: string | null; category: ImportStatusCategory; color?: string | null };
  priority: ImportPriority;
  assignee?: { email?: string | null; name?: string | null } | null;
  estimate?: number | null;
  labels: Array<{ name: string; color?: string | null }>;
  cycle?: { extId: string; name: string; startAt: string; endAt: string } | null;
  milestone?: { extId: string; name: string; targetDate?: string | null } | null;
  parentExtId?: string | null;
  createdAt?: string | null;
  dueDate?: string | null;
  comments: NormalizedComment[];
}

/** Topes del import (por job). */
export const TRACK_IMPORT_MAX_ISSUES = 20_000;
export const TRACK_IMPORT_MAX_CSV_BYTES = 4 * 1024 * 1024;
const TITLE_MAX = 500;
const TEXT_MAX = 5000;
const LABELS_MAX = 10;

// ---------- Normalización de valores ----------

/** Prioridad de Linear (0 a 4), de Jira (Highest…Lowest) o texto libre. */
export function normalizePriority(raw: unknown): ImportPriority {
  if (typeof raw === 'number' || (typeof raw === 'string' && /^\s*\d+\s*$/.test(raw))) {
    const n = Number(raw);
    return n === 1 ? 'urgent' : n === 2 ? 'high' : n === 4 ? 'low' : 'medium';
  }
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return 'medium';
  if (/urgent|blocker|critical|highest|^p0\b|urgente|cr[ií]tic/.test(v)) return 'urgent';
  if (/^high|^p1\b|^alta|^alto/.test(v)) return 'high';
  if (/low|lowest|minor|trivial|^p[34]\b|^baja|^baixa/.test(v)) return 'low';
  return 'medium';
}

/** Tipo de estado de Linear (backlog, unstarted, started, completed, canceled, triage). */
export function linearStateCategory(type: string | null | undefined): ImportStatusCategory | null {
  switch (type) {
    case 'backlog':
    case 'triage':
      return 'backlog';
    case 'unstarted':
      return 'todo';
    case 'started':
      return 'in_progress';
    case 'completed':
      return 'done';
    case 'canceled':
      return 'cancelled';
    default:
      return null;
  }
}

/** Categoría por el nombre del status (Jira, CSV): "In Review" → in_progress. */
export function statusCategoryFromName(name: string | null | undefined): ImportStatusCategory {
  const v = String(name ?? '').trim().toLowerCase();
  if (/cancel|won'?t|duplicate|rejected|declined|invalid|not planned|descartad|cancelad/.test(v)) return 'cancelled';
  if (/done|closed|resolved|complete|shipped|released|merged|fixed|hecho|terminad|cerrad|feito|conclu/.test(v)) return 'done';
  if (/progress|doing|review|started|\bqa\b|testing|develop|curso|andamento|revis/.test(v)) return 'in_progress';
  if (/backlog|icebox|triage|someday|later/.test(v)) return 'backlog';
  return 'todo';
}

/** Fecha de la fuente → ISO (o null). Entiende ISO, "2024-01-15 10:00" y "15/Jan/24 10:00 AM" de Jira. */
export function normalizeDate(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const jira = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?$/i.exec(v);
  if (jira) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const m = months.indexOf(jira[2].toLowerCase());
    if (m === -1) return null;
    const year = Number(jira[3]) < 100 ? 2000 + Number(jira[3]) : Number(jira[3]);
    let hour = Number(jira[4] ?? 0);
    if (jira[6]?.toUpperCase() === 'PM' && hour < 12) hour += 12;
    if (jira[6]?.toUpperCase() === 'AM' && hour === 12) hour = 0;
    return new Date(Date.UTC(year, m, Number(jira[1]), hour, Number(jira[5] ?? 0))).toISOString();
  }
  const isoish = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(v) ? v.replace(' ', 'T') + (v.length > 10 ? 'Z' : '') : v;
  const t = Date.parse(isoish);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const year = d.getUTCFullYear();
  return year < 1970 || year > 2200 ? null : d.toISOString();
}

/** Solo la fecha (YYYY-MM-DD) para vencimientos. */
export function normalizeDay(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return normalizeDate(v)?.slice(0, 10) ?? null;
}

export function normalizeEstimate(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.round(n), 1000);
}

export function safeImportColor(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  const hex = v.startsWith('#') ? v : `#${v}`;
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? hex.toLowerCase() : null;
}

export function clip(text: unknown, max: number): string {
  const v = String(text ?? '');
  return v.length > max ? v.slice(0, max) : v;
}

/** Prefijo de un identificador ("ENG-12" → "ENG"), si tiene esa forma. */
export function keyPrefix(id: string | null | undefined): string | null {
  const m = /^([A-Za-z][A-Za-z0-9]{0,9})-\d+$/.exec(String(id ?? '').trim());
  return m ? m[1].toUpperCase() : null;
}

function dedupeLabels(labels: Array<{ name: string; color?: string | null }>): Array<{ name: string; color?: string | null }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; color?: string | null }> = [];
  for (const l of labels) {
    const name = clip(l.name.trim(), 50);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, color: l.color ?? null });
    if (out.length >= LABELS_MAX) break;
  }
  return out;
}

/** Recorta y limpia un issue normalizado (lo llama cada fuente antes de guardarlo). */
export function finishIssue(issue: NormalizedIssue): NormalizedIssue {
  return {
    ...issue,
    title: clip(issue.title.replace(/\s+/g, ' ').trim(), TITLE_MAX),
    description: clip(issue.description.trim(), TEXT_MAX),
    labels: dedupeLabels(issue.labels),
    project: { ...issue.project, name: clip(issue.project.name.trim(), 200) || 'Imported' },
    status: { ...issue.status, name: issue.status.name ? clip(issue.status.name.trim(), 200) : null },
    comments: issue.comments
      .map((c) => ({ ...c, body: clip(c.body.trim(), TEXT_MAX) }))
      .filter((c) => c.body),
  };
}

// ---------- CSV ----------

export const CSV_FIELDS = [
  'id',
  'title',
  'description',
  'status',
  'priority',
  'assignee',
  'labels',
  'estimate',
  'dueDate',
  'createdAt',
  'project',
  'cycle',
  'cycleStart',
  'cycleEnd',
  'milestone',
  'parent',
  'type',
  'comments',
] as const;
export type CsvField = (typeof CSV_FIELDS)[number];
/** Campo → nombre de la columna del CSV (las columnas repetidas, como Labels de Jira, se juntan). */
export type CsvMapping = Partial<Record<CsvField, string>>;

export type CsvPreset = 'linear' | 'jira' | 'csv';

/** Encabezados conocidos por preset (en minúsculas), en orden de preferencia. */
const PRESET_HEADERS: Record<CsvPreset, Partial<Record<CsvField, string[]>>> = {
  linear: {
    id: ['id'],
    title: ['title'],
    description: ['description'],
    status: ['status'],
    priority: ['priority'],
    assignee: ['assignee'],
    labels: ['labels'],
    estimate: ['estimate'],
    dueDate: ['due date'],
    createdAt: ['created'],
    project: ['team'],
    cycle: ['cycle name', 'cycle number'],
    cycleStart: ['cycle start'],
    cycleEnd: ['cycle end'],
    milestone: ['project'],
    parent: ['parent issue'],
  },
  jira: {
    id: ['issue key'],
    title: ['summary'],
    description: ['description'],
    status: ['status'],
    priority: ['priority'],
    assignee: ['assignee'],
    labels: ['labels'],
    estimate: ['custom field (story points)', 'story points', 'custom field (story point estimate)'],
    dueDate: ['due date'],
    createdAt: ['created'],
    project: ['project name'],
    milestone: ['fix version/s', 'fix versions'],
    parent: ['parent', 'parent key', 'parent id'],
    type: ['issue type'],
    comments: ['comment'],
  },
  csv: {
    id: ['id', 'key', 'identifier', 'issue id', 'number'],
    title: ['title', 'name', 'summary', 'subject', 'task', 'título', 'titulo', 'nombre'],
    description: ['description', 'body', 'details', 'notes', 'descripción', 'descripcion'],
    status: ['status', 'state', 'estado'],
    priority: ['priority', 'prioridad', 'prioridade'],
    assignee: ['assignee', 'assigned to', 'owner', 'responsable', 'responsável'],
    labels: ['labels', 'tags', 'label', 'tag', 'etiquetas'],
    estimate: ['estimate', 'points', 'story points', 'estimación'],
    dueDate: ['due date', 'due', 'deadline', 'vencimiento'],
    createdAt: ['created', 'created at', 'created_at', 'date', 'creado'],
    project: ['project', 'team', 'proyecto'],
    cycle: ['cycle', 'sprint', 'iteration'],
    milestone: ['milestone', 'version', 'release'],
    parent: ['parent', 'parent id'],
    type: ['type', 'issue type', 'tipo'],
    comments: ['comments', 'comment'],
  },
};

/** Distingue Linear o Jira por sus encabezados (para preseleccionar). */
export function detectCsvPreset(headers: string[]): CsvPreset {
  const h = new Set(headers.map((x) => x.trim().toLowerCase()));
  if (h.has('issue key') && h.has('summary')) return 'jira';
  if (h.has('id') && h.has('title') && h.has('team') && (h.has('cycle number') || h.has('project id') || h.has('status'))) return 'linear';
  return 'csv';
}

export function suggestMapping(headers: string[], preset: CsvPreset): CsvMapping {
  const lower = headers.map((x) => x.trim().toLowerCase());
  const out: CsvMapping = {};
  for (const field of CSV_FIELDS) {
    const wanted = PRESET_HEADERS[preset][field] ?? PRESET_HEADERS.csv[field] ?? [];
    const idx = wanted.map((w) => lower.indexOf(w)).find((i) => i !== -1);
    if (idx !== undefined) out[field] = headers[idx];
  }
  return out;
}

/** Encabezados y unas filas de muestra (el navegador lo usa para el mapeo). */
export function csvHeaderSample(text: string, sampleRows = 3): { headers: string[]; sample: string[][]; rows: number } {
  const rows = parseCsv(text);
  const [headers = [], ...rest] = rows;
  return { headers: headers.map((h) => h.trim()), sample: rest.slice(0, sampleRows), rows: rest.length };
}

/** Comentario de Jira en CSV: "15/Jan/24 10:00 AM;autor;texto". */
function parseJiraComment(raw: string): { createdAt: string | null; author: string | null; body: string } {
  const m = /^([^;]{6,30});([^;]*);([\s\S]*)$/.exec(raw);
  if (m && normalizeDate(m[1])) return { createdAt: normalizeDate(m[1]), author: m[2].trim() || null, body: m[3] };
  return { createdAt: null, author: null, body: raw };
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Hash corto y estable (filas de CSV sin columna de id). */
export function stableHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

export interface CsvToIssuesOptions {
  /** linear | jira | csv: define el prefijo de los ids externos. */
  source: 'linear' | 'jira' | 'csv';
  /** Nombre del proyecto cuando el CSV no trae columna de proyecto. */
  defaultProject?: string;
}

/**
 * Filas del CSV → issues normalizados según el mapeo. Las filas sin título se
 * saltean. Las columnas repetidas (Labels, Comment y Sprint de Jira) se juntan.
 */
export function csvToIssues(text: string, mapping: CsvMapping, opts: CsvToIssuesOptions): NormalizedIssue[] {
  const [header = [], ...rows] = parseCsv(text);
  const names = header.map((h) => h.trim());
  const cols = (field: CsvField): number[] => {
    const name = mapping[field];
    if (!name) return [];
    return names.map((n, i) => (n === name ? i : -1)).filter((i) => i !== -1);
  };
  const colsOf = Object.fromEntries(CSV_FIELDS.map((f) => [f, cols(f)])) as Record<CsvField, number[]>;
  const first = (row: string[], field: CsvField): string => {
    for (const i of colsOf[field]) {
      const v = (row[i] ?? '').trim();
      if (v) return v;
    }
    return '';
  };
  const all = (row: string[], field: CsvField): string[] => colsOf[field].map((i) => (row[i] ?? '').trim()).filter(Boolean);

  const out: NormalizedIssue[] = [];
  for (const row of rows.slice(0, TRACK_IMPORT_MAX_ISSUES)) {
    const title = first(row, 'title');
    if (!title) continue;
    const id = first(row, 'id');
    const createdAt = normalizeDate(first(row, 'createdAt'));
    const extId = id || `row:${stableHash(`${title}|${createdAt ?? ''}|${first(row, 'description').slice(0, 200)}`)}`;
    const projectName = first(row, 'project') || opts.defaultProject || 'Imported';
    const key = keyPrefix(id);

    const statusName = first(row, 'status') || null;
    const labelValues = colsOf.labels.length > 1 ? all(row, 'labels') : splitList(first(row, 'labels'));
    const type = first(row, 'type');
    const labels = [...labelValues, ...(type ? [type] : [])].map((name) => ({ name }));

    const cycleName = first(row, 'cycle');
    const cycleStart = normalizeDay(first(row, 'cycleStart'));
    const cycleEnd = normalizeDay(first(row, 'cycleEnd'));
    const cycle =
      cycleName && cycleStart && cycleEnd
        ? { extId: `${projectName}:${cycleName}`, name: /^\d+$/.test(cycleName) ? `Cycle ${cycleName}` : cycleName, startAt: cycleStart, endAt: cycleEnd }
        : null;
    // Un sprint sin fechas (Jira) queda como label: un cycle necesita inicio y fin.
    if (cycleName && !cycle) labels.push({ name: cycleName });

    const milestoneName = first(row, 'milestone');
    const assigneeRaw = first(row, 'assignee');
    const comments = all(row, 'comments').map((raw, i) => {
      const c = opts.source === 'jira' ? parseJiraComment(raw) : { createdAt: null, author: null, body: raw };
      return {
        extId: `${extId}#${i}`,
        authorEmail: c.author?.includes('@') ? c.author : null,
        authorName: c.author && !c.author.includes('@') ? c.author : null,
        body: c.body,
        createdAt: c.createdAt,
      };
    });

    out.push(
      finishIssue({
        extId,
        key: id || null,
        project: { extId: `name:${projectName.toLowerCase()}`, name: projectName, key },
        title,
        description: first(row, 'description'),
        status: { name: statusName, category: statusCategoryFromName(statusName) },
        priority: normalizePriority(first(row, 'priority')),
        assignee: assigneeRaw
          ? assigneeRaw.includes('@')
            ? { email: assigneeRaw.toLowerCase(), name: null }
            : { email: null, name: assigneeRaw }
          : null,
        estimate: normalizeEstimate(first(row, 'estimate')),
        labels,
        cycle,
        milestone: milestoneName ? { extId: `${projectName}:${milestoneName}`, name: clip(milestoneName, 200), targetDate: null } : null,
        parentExtId: first(row, 'parent') || null,
        createdAt,
        dueDate: normalizeDay(first(row, 'dueDate')),
        comments,
      }),
    );
  }
  return out;
}

// ---------- Export ----------

export const EXPORT_COLUMNS = [
  'ID',
  'Title',
  'Description',
  'Status',
  'Priority',
  'Assignee',
  'Labels',
  'Estimate',
  'Cycle',
  'Milestone',
  'Parent',
  'Due date',
  'Created',
  'Updated',
  'Project',
] as const;

/**
 * Celda CSV con comillas cuando hace falta. Neutraliza fórmulas para
 * planillas (=, +, @ y un "-" pegado a texto); "- item" de Markdown queda igual.
 */
export function csvCell(value: unknown): string {
  let v = String(value ?? '');
  if (/^(?:[=+@\t\r]|-(?=[^\s\d]))/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(header: readonly string[], rows: unknown[][]): string {
  return [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n';
}

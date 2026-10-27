/**
 * Importadores: el runner que avanza un job por pasos con presupuesto de
 * tiempo. Lo llaman la pestaña abierta (POST /api/import/jobs/<id>/run, en
 * loop mientras se mira el progreso, con un presupuesto corto) y el cron de
 * cada minuto (si se cerró la pestaña o no entró en un request). El claim por
 * locked_until evita que dos corridas trabajen el mismo job a la vez; cada
 * tanda guarda su avance antes de seguir, así un corte retoma desde la última
 * tanda (y la escritura es idempotente por los ids externos).
 *
 * Entre tandas se cede el event loop y se relee el job: en un servidor propio
 * (SQLite local) una corrida larga sin pausas frenaba los demás requests, y
 * cancelar tiene efecto en la tanda siguiente.
 */
import {
  appendImportItems,
  claimImportJob,
  deleteImportItems,
  getImportJob,
  ImportError,
  ImportRetryError,
  jobView,
  listImportItems,
  listRunnableImportJobs,
  releaseImportJob,
  updateImportJob,
  type ImportJob,
  type ImportJobView,
  type StagedItem,
} from './import-jobs';
import { getDb } from './db';
import type { FetchStepResult } from './track-import-sources';
import { fetchGithubStep, fetchLinearStep } from './track-import-sources';
import { fetchAsanaStep, fetchJiraStep, fetchShortcutStep } from './track-import-sources-more';
import { csvToIssues, TRACK_IMPORT_MAX_ISSUES, type CsvMapping } from './track-import-map';
import { emptyTrackReport, trackPreview, trackWriteStep, TRACK_WRITE_STAGES, type TrackImportReport } from './track-import';
import { calFetchStep, calPreview, calWriteStep, emptyCalReport, type CalImportReport } from './cal-import';
import { cleanupNotionPayload, emptyNotionReport, notionFetchStep, notionPreview, notionWriteStep, NOTION_MAX_PAGES, type NotionImportReport } from './docs-notion-import';

export interface ImportAdapter {
  fetchStep(job: ImportJob): Promise<FetchStepResult>;
  preview(job: ImportJob, items: StagedItem[]): Promise<Record<string, unknown>>;
  writeStages: readonly string[];
  chunkSize: number;
  emptyReport(): Record<string, unknown>;
  writeStep(job: ImportJob, stage: string, items: StagedItem[], report: Record<string, unknown>): Promise<void>;
  maxItems?: number;
  /** El payload (zip) hace falta también al escribir. */
  keepPayload?: boolean;
  cleanup?(job: ImportJob): Promise<void>;
}

const csvSource = (preset: 'linear' | 'jira' | 'csv') => async (job: ImportJob): Promise<FetchStepResult> => {
  const text = job.payload ?? '';
  const mapping = (job.options.mapping ?? {}) as CsvMapping;
  if (!mapping.title) throw new ImportError('csv_no_title');
  const issues = csvToIssues(text, mapping, { source: preset, defaultProject: String(job.options.projectName ?? '') || undefined });
  if (issues.length === 0) throw new ImportError('csv_empty');
  return { items: issues.map((data) => ({ kind: 'issue', data })), cursor: {}, done: true };
};

const trackAdapter = (fetchStep: ImportAdapter['fetchStep']): ImportAdapter => ({
  fetchStep,
  preview: (job, items) => trackPreview(job, items),
  writeStages: TRACK_WRITE_STAGES,
  chunkSize: 50,
  emptyReport: emptyTrackReport,
  writeStep: (job, stage, items, report) => trackWriteStep(job, stage, items, report as TrackImportReport),
  maxItems: TRACK_IMPORT_MAX_ISSUES * 3,
});

/** Docs: un solo lector para los exports de Notion, Confluence, Google Docs, Word, Evernote y archivos sueltos. */
const docsAdapter: ImportAdapter = {
  fetchStep: (job) => notionFetchStep(job),
  preview: (job, items) => notionPreview(job, items),
  writeStages: ['pages'],
  chunkSize: 10,
  emptyReport: emptyNotionReport,
  writeStep: (job, _stage, items, report) => notionWriteStep(job, items, report as NotionImportReport),
  maxItems: NOTION_MAX_PAGES,
  keepPayload: true,
  cleanup: (job) => cleanupNotionPayload(job),
};

const ADAPTERS: Record<string, ImportAdapter> = {
  'track:linear': trackAdapter((job) => fetchLinearStep(job.secret, job.cursor)),
  'track:github': trackAdapter((job) => fetchGithubStep(job.secret, String(job.options.repo ?? ''), job.cursor)),
  'track:jira': trackAdapter((job) => fetchJiraStep(job.secret, String(job.options.site ?? ''), String(job.options.query ?? ''), job.cursor)),
  'track:asana': trackAdapter((job) => fetchAsanaStep(job.secret, String(job.options.project ?? ''), job.cursor)),
  'track:shortcut': trackAdapter((job) => fetchShortcutStep(job.secret, String(job.options.query ?? ''), job.cursor)),
  'track:linear_csv': trackAdapter(csvSource('linear')),
  'track:jira_csv': trackAdapter(csvSource('jira')),
  'track:csv': trackAdapter(csvSource('csv')),
  'cal:calendly': {
    fetchStep: (job) => calFetchStep(job),
    preview: (job, items) => calPreview(job, items),
    writeStages: ['write'],
    chunkSize: 25,
    emptyReport: emptyCalReport,
    writeStep: (job, _stage, items, report) => calWriteStep(job, items, report as CalImportReport),
  },
  'docs:notion': docsAdapter,
  'docs:confluence': docsAdapter,
  'docs:gdocs': docsAdapter,
  'docs:word': docsAdapter,
  'docs:evernote': docsAdapter,
  'docs:files': docsAdapter,
};

export function importAdapter(app: string, source: string): ImportAdapter | null {
  return ADAPTERS[`${app}:${source}`] ?? null;
}

export function isImportSource(app: string, source: string): boolean {
  return importAdapter(app, source) !== null;
}

async function closeJob(job: ImportJob, status: 'done' | 'failed' | 'cancelled', patch: { report?: Record<string, unknown>; error?: string } = {}) {
  const adapter = importAdapter(job.app, job.source);
  await adapter?.cleanup?.(job).catch(() => undefined);
  await deleteImportItems(job.id);
  await updateImportJob(job.id, {
    status,
    secret: null,
    payload: null,
    finished: true,
    lockedUntil: null,
    ...(patch.report ? { report: patch.report } : {}),
    ...(patch.error ? { error: patch.error } : {}),
  });
}

/**
 * Avanza el job hasta agotar el presupuesto. Devuelve el estado para la UI
 * (o null si no existe). Si otra corrida lo tiene tomado, solo lo lee.
 */
/** Presupuesto de un POST .../run: corto, para no frenar el servidor ni hacer esperar a cancelar. */
export const REQUEST_IMPORT_BUDGET_MS = 4_000;

/** Cede el event loop entre tandas (los otros requests entran). */
export const yieldToServer = () => new Promise<void>((r) => setImmediate(r));

export async function runImportJob(id: string, budgetMs = REQUEST_IMPORT_BUDGET_MS): Promise<ImportJobView | null> {
  const start = Date.now();
  if (!(await claimImportJob(id, budgetMs + 90_000))) {
    const job = await getImportJob(id);
    return job ? jobView(job) : null;
  }
  let retryUntil: string | null = null;
  try {
    for (let step = 0; Date.now() - start < budgetMs; step++) {
      if (step > 0) await yieldToServer();
      // Se relee en cada tanda: si se canceló, el estado ya no es fetching/importing y se corta acá.
      const job = await getImportJob(id);
      if (!job) return null;
      const adapter = importAdapter(job.app, job.source);
      if (!adapter) throw new ImportError('invalid_source');

      if (job.status === 'fetching') {
        const res = await adapter.fetchStep(job);
        const room = adapter.maxItems ? Math.max(0, adapter.maxItems - job.total) : res.items.length;
        const items = res.items.slice(0, room);
        const total = job.total + (await appendImportItems(id, job.total, items));
        const truncated = res.items.length > items.length;
        if (res.done || truncated) {
          const preview = { ...(await adapter.preview(job, await listImportItems(id))), truncated };
          // El token ya no hace falta: se borra antes de la vista previa.
          await updateImportJob(id, {
            status: 'preview',
            cursor: {},
            total,
            processed: 0,
            preview,
            secret: null,
            ...(adapter.keepPayload ? {} : { payload: null }),
            onlyIf: 'fetching',
          });
          break;
        }
        await updateImportJob(id, { cursor: res.cursor, total, onlyIf: 'fetching' });
        continue;
      }

      if (job.status === 'importing') {
        const stage = job.stage || adapter.writeStages[0];
        const report = (job.report ?? adapter.emptyReport()) as Record<string, unknown>;
        const items = await listImportItems(id, job.processed, adapter.chunkSize);
        if (items.length > 0) {
          await adapter.writeStep(job, stage, items, report);
          await updateImportJob(id, { stage, processed: job.processed + items.length, report, onlyIf: 'importing' });
          continue;
        }
        const next = adapter.writeStages[adapter.writeStages.indexOf(stage) + 1];
        if (next) {
          await updateImportJob(id, { stage: next, processed: 0, onlyIf: 'importing' });
          continue;
        }
        await closeJob(job, 'done', { report });
        break;
      }
      break;
    }
  } catch (err) {
    if (err instanceof ImportRetryError) {
      retryUntil = new Date(Date.now() + err.ms).toISOString();
    } else {
      const job = await getImportJob(id);
      // Solo el código: el mensaje de un error de terceros podría traer datos de la cuenta.
      if (!(err instanceof ImportError)) console.error('[import] job failed', id, err instanceof Error ? err.name : 'error');
      // Cancelado mientras corría la tanda: queda cancelado.
      if (job && (job.status === 'fetching' || job.status === 'importing')) {
        await closeJob(job, 'failed', { error: err instanceof ImportError ? err.code : 'internal_error' });
      }
    }
  } finally {
    await releaseImportJob(id, retryUntil);
  }
  const job = await getImportJob(id);
  return job ? jobView(job) : null;
}

/** Confirmar la vista previa: arranca la escritura. */
export async function startImportJob(job: ImportJob): Promise<boolean> {
  const adapter = importAdapter(job.app, job.source);
  if (!adapter || job.status !== 'preview') return false;
  const res = await getDb()
    .prepare(`UPDATE import_jobs SET status = 'importing', stage = ?, processed = 0, report = ?, updated_at = ? WHERE id = ? AND status = 'preview'`)
    .run(adapter.writeStages[0], JSON.stringify(adapter.emptyReport()), new Date().toISOString(), job.id);
  return res.changes > 0;
}

export async function cancelImportJob(job: ImportJob): Promise<void> {
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return;
  await closeJob(job, 'cancelled', job.report ? { report: job.report } : {});
}

/** Vistas previas o subidas abandonadas: se cancelan (y se borra lo subido) a las 24 h. */
export async function expireStaleImportJobs(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const rows = (await getDb()
    .prepare(`SELECT id FROM import_jobs WHERE status IN ('uploading', 'preview') AND updated_at < ? LIMIT 50`)
    .all(cutoff)) as Array<{ id: string }>;
  for (const r of rows) {
    const job = await getImportJob(r.id);
    if (job) await closeJob(job, 'cancelled');
  }
  return rows.length;
}

/** Cron: empuja los jobs pendientes que nadie tiene tomado. */
export async function processImportJobs(opts: { budgetMs?: number } = {}): Promise<{ ran: number; expired: number }> {
  const start = Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const expired = await expireStaleImportJobs().catch(() => 0);
  let ran = 0;
  for (const id of await listRunnableImportJobs(5)) {
    const left = budget - (Date.now() - start);
    if (left < 2_000) break;
    await runImportJob(id, left);
    ran += 1;
  }
  return { ran, expired };
}

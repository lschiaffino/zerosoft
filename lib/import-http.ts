/**
 * Importadores — validación de lo que llega a /api/import/jobs y acceso a un
 * job desde las rutas. Track y Cal piden admin del workspace (crean proyectos,
 * status, horarios y tipos de evento para todos); Docs, cualquier miembro.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, type SessionUser } from './session';
import { userCanUseApp } from './workspace';
import { getWorkspaceImportJob, type ImportApp, type ImportJob } from './import-jobs';
import { CSV_FIELDS, TRACK_IMPORT_MAX_CSV_BYTES } from './track-import-map';
import { GITHUB_REPO_RE } from './track-import-sources';
import { asanaProjectGid, normalizeJiraSite } from './track-import-sources-more';
import { NOTION_MAX_ZIP_BYTES } from './docs-notion-import';

export function importError(status: number, code: string): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

export function needsAdmin(app: ImportApp): boolean {
  return app !== 'docs';
}

const token = z.string().trim().min(8).max(500);
const mapping = z.record(z.enum(CSV_FIELDS), z.string().max(200)).refine((m) => Boolean(m.title), { message: 'csv_no_title' });

function csvSchema<S extends 'linear_csv' | 'jira_csv' | 'csv'>(source: S) {
  return z.object({
    app: z.literal('track'),
    source: z.literal(source),
    csv: z.string().min(1).max(TRACK_IMPORT_MAX_CSV_BYTES),
    mapping,
    projectName: z.string().trim().max(200).optional(),
    target: z.string().min(1).max(64),
  });
}

export const importCreateSchema = z.discriminatedUnion('source', [
  z.object({ app: z.literal('track'), source: z.literal('linear'), token, target: z.string().min(1).max(64) }),
  z.object({
    app: z.literal('track'),
    source: z.literal('github'),
    token,
    repo: z
      .string()
      .trim()
      .transform((r) => r.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, ''))
      .refine((r) => GITHUB_REPO_RE.test(r), { message: 'invalid_repo' }),
    target: z.string().min(1).max(64),
  }),
  z.object({
    app: z.literal('track'),
    source: z.literal('jira'),
    /** https://<sitio>.atlassian.net */
    site: z
      .string()
      .trim()
      .max(200)
      .refine((s) => normalizeJiraSite(s) !== null, { message: 'invalid_site' })
      .transform((s) => normalizeJiraSite(s) as string),
    email: z.string().trim().email().max(200),
    token,
    /** Clave de proyecto (ENG) o una JQL. */
    query: z.string().trim().min(1).max(1000),
    target: z.string().min(1).max(64),
  }),
  z.object({
    app: z.literal('track'),
    source: z.literal('asana'),
    token,
    /** URL o gid del proyecto. */
    project: z
      .string()
      .trim()
      .max(500)
      .refine((p) => asanaProjectGid(p) !== null, { message: 'invalid_project' })
      .transform((p) => asanaProjectGid(p) as string),
    target: z.string().min(1).max(64),
  }),
  z.object({
    app: z.literal('track'),
    source: z.literal('shortcut'),
    token,
    /** Búsqueda de Shortcut (vacía = todas las stories no archivadas). */
    query: z.string().trim().max(500).optional(),
    target: z.string().min(1).max(64),
  }),
  csvSchema('linear_csv'),
  csvSchema('jira_csv'),
  csvSchema('csv'),
  z.object({ app: z.literal('cal'), source: z.literal('calendly'), token, includeBookings: z.boolean().optional() }),
  z.object({
    app: z.literal('docs'),
    /** De dónde viene el zip (todos usan el mismo lector: Markdown, CSV, HTML, .docx, .txt y .enex). */
    source: z.enum(['notion', 'confluence', 'gdocs', 'word', 'evernote', 'files']),
    /** Teamspace de destino (null o ausente: el workspace). */
    teamspace_id: z.string().min(1).max(64).nullable().optional(),
    /** Subida directa a Blob ya hecha… */
    blobUrl: z.string().max(2048).optional(),
    /** …o subida por partes a disco (sin Blob): el tamaño total. */
    size: z.number().int().min(1).max(NOTION_MAX_ZIP_BYTES).optional(),
  }),
]);

export type ImportCreatePayload = z.infer<typeof importCreateSchema>;

/** Código de error del zod (invalid_repo, csv_no_title o invalid_input). */
export function importZodCode(error: z.ZodError): string {
  const msg = error.issues.find((i) => ['invalid_repo', 'csv_no_title', 'invalid_site', 'invalid_project'].includes(i.message))?.message;
  if (msg) return msg;
  if (error.issues.some((i) => i.path[0] === 'csv' && i.code === 'too_big')) return 'file_too_large';
  return 'invalid_input';
}

/** Usuario con acceso a la app del import (o la respuesta de error). */
export async function importUser(app: ImportApp): Promise<SessionUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return importError(401, 'unauthorized');
  if (needsAdmin(app) && !isWorkspaceAdmin(user)) return importError(403, 'forbidden');
  // Acceso por app del workspace (Track, Cal, Docs).
  if (!userCanUseApp(user, app)) return importError(403, 'forbidden');
  return user;
}

/** Job del workspace de quien pide, con el mismo chequeo de rol. */
export async function importJobFor(id: string): Promise<{ user: SessionUser; job: ImportJob } | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return importError(401, 'unauthorized');
  const job = await getWorkspaceImportJob(user.id, id);
  if (!job) return importError(404, 'not_found');
  if (needsAdmin(job.app) && !isWorkspaceAdmin(user)) return importError(403, 'forbidden');
  if (!userCanUseApp(user, job.app)) return importError(403, 'forbidden');
  return { user, job };
}

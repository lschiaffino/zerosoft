import { NextRequest, NextResponse } from 'next/server';
import { realUserId } from '@/lib/session';
import { limitByIp } from '@/lib/rate-limit';
import { requestLocale } from '@/lib/request-locale';
import { createImportJob, jobView, listImportJobs, updateImportJob, type ImportApp } from '@/lib/import-jobs';
import { runImportJob } from '@/lib/import-runner';
import { importCreateSchema, importError, importUser, importZodCode } from '@/lib/import-http';
import { isImportBlobUrl, localZipRef } from '@/lib/docs-notion-import';
import { canAccessTrackProject, getProject } from '@/lib/track-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const APPS: ImportApp[] = ['track', 'cal', 'docs'];

/** Últimos imports de la app en el workspace (para retomar uno en curso). */
export async function GET(req: NextRequest) {
  const app = req.nextUrl.searchParams.get('app') as ImportApp;
  if (!APPS.includes(app)) return importError(400, 'invalid_input');
  const user = await importUser(app);
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ jobs: await listImportJobs(user.id, app) });
}

/**
 * Crea un import y corre el primer tramo de la lectura (una fuente chica ya
 * vuelve con la vista previa). El token de la fuente se guarda cifrado solo
 * hasta terminar de leerla.
 */
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'import-jobs', 30, 600);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { app?: ImportApp } | null;
  if (!body || !APPS.includes(body.app as ImportApp)) return importError(400, 'invalid_input');
  const user = await importUser(body.app as ImportApp);
  if (user instanceof NextResponse) return user;

  const parsed = importCreateSchema.safeParse(body);
  if (!parsed.success) return importError(400, importZodCode(parsed.error));
  const input = parsed.data;
  const base = {
    workspaceId: user.id,
    teamId: user.team?.id ?? null,
    userId: realUserId(user),
    app: input.app,
    source: input.source,
    locale: requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language')),
  };

  let job;
  if (input.app === 'track') {
    if (input.target !== 'new') {
      const project = await getProject(input.target);
      if (!project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) return importError(404, 'project_not_found');
    }
    if (input.source === 'linear') {
      job = await createImportJob({ ...base, secret: input.token, options: { target: input.target } });
    } else if (input.source === 'github') {
      job = await createImportJob({ ...base, secret: input.token, options: { target: input.target, repo: input.repo } });
    } else if (input.source === 'jira') {
      // Basic auth de Jira: el secreto es "email:token" (cifrado como los demás).
      job = await createImportJob({
        ...base,
        secret: `${input.email}:${input.token}`,
        options: { target: input.target, site: input.site, query: input.query },
      });
    } else if (input.source === 'asana') {
      job = await createImportJob({ ...base, secret: input.token, options: { target: input.target, project: input.project } });
    } else if (input.source === 'shortcut') {
      job = await createImportJob({ ...base, secret: input.token, options: { target: input.target, query: input.query ?? '' } });
    } else {
      job = await createImportJob({
        ...base,
        payload: input.csv,
        options: { target: input.target, mapping: input.mapping, projectName: input.projectName ?? '' },
      });
    }
  } else if (input.app === 'cal') {
    job = await createImportJob({ ...base, secret: input.token, options: { includeBookings: input.includeBookings === true } });
  } else {
    if (input.blobUrl) {
      if (!isImportBlobUrl(input.blobUrl)) return importError(400, 'invalid_upload');
      job = await createImportJob({ ...base, payload: `blob:${input.blobUrl}` });
    } else if (input.size) {
      // Sin Blob en Vercel no hay disco donde juntar las partes.
      if (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN) return importError(503, 'storage_unavailable');
      job = await createImportJob({ ...base, status: 'uploading', options: { size: input.size } });
      await updateImportJob(job.id, { payload: localZipRef(job.id) });
      return NextResponse.json({ job: jobView(job) }, { status: 201 });
    } else {
      return importError(400, 'invalid_input');
    }
  }

  const view = await runImportJob(job.id, 8_000);
  return NextResponse.json({ job: view }, { status: 201 });
}

/**
 * Hiring: la página de empleos pública (/careers/<handle>), con la marca del
 * workspace (nombre, logo y color), el detalle de cada puesto con JSON-LD de
 * JobPosting (Google for Jobs) y el sitemap. Server-only.
 */
import { getDb } from '../db';
import { getWorkspace } from '../workspace';
import { getWorkspaceBrand } from '../calendar';
import { appBase, jobDto, parseJson, type JobDto, type JobRow, type SettingsRow } from './core';
import type { Question } from './types';

export interface PublicCareers {
  settings: SettingsRow;
  company: string;
  logoUrl: string | null;
  color: string;
  locale: string;
}

/** Ajustes publicados de un handle (null si no existe o está despublicada). */
export async function publishedCareers(handle: string): Promise<PublicCareers | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(handle)) return null;
  const s = (await getDb().prepare('SELECT * FROM hiring_settings WHERE handle = ? AND published = 1').get(handle.toLowerCase())) as SettingsRow | undefined;
  if (!s) return null;
  const [team, brand] = await Promise.all([getWorkspace(s.workspace_id).catch(() => null), getWorkspaceBrand(s.workspace_id).catch(() => null)]);
  return {
    settings: s,
    company: s.company || team?.name || brand?.name || '',
    logoUrl: team?.logo_url && /^(https:\/\/|\/)/.test(team.logo_url) ? team.logo_url : (brand?.logoUrl ?? null),
    color: s.color ?? brand?.color ?? '#111111',
    locale: s.locale,
  };
}

export type PublicJob = Omit<JobDto, 'questions' | 'salaryMin' | 'salaryMax'> & { questions: Question[]; salaryMin: number | null; salaryMax: number | null };

/** Puesto publicado como lo ve un candidato: sin el salario si está oculto, sin datos internos. */
function publicJob(row: JobRow): PublicJob {
  const dto = jobDto(row);
  const hidden = !dto.salaryPublic;
  return { ...dto, salaryMin: hidden ? null : dto.salaryMin, salaryMax: hidden ? null : dto.salaryMax, questions: parseJson<Question[]>(row.questions, []) };
}

export async function publishedJobs(ws: string): Promise<PublicJob[]> {
  const rows = (await getDb().prepare("SELECT * FROM hiring_jobs WHERE workspace_id = ? AND status = 'published' ORDER BY department, title").all(ws)) as JobRow[];
  return rows.map(publicJob);
}

export async function publishedJob(ws: string, slug: string): Promise<PublicJob | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) return null;
  const row = (await getDb().prepare("SELECT * FROM hiring_jobs WHERE workspace_id = ? AND slug = ? AND status = 'published'").get(ws, slug)) as JobRow | undefined;
  return row ? publicJob(row) : null;
}

const EMPLOYMENT: Record<string, string> = { full_time: 'FULL_TIME', part_time: 'PART_TIME', contract: 'CONTRACTOR', temporary: 'TEMPORARY', internship: 'INTERN' };
const UNIT: Record<string, string> = { year: 'YEAR', month: 'MONTH', hour: 'HOUR' };

export function jobUrl(handle: string, slug: string): string {
  return `${appBase()}/careers/${handle}/${slug}`;
}

/** JSON-LD JobPosting (https://developers.google.com/search/docs/appearance/structured-data/job-posting). */
export function jobPostingJsonLd(c: PublicCareers, job: PublicJob, descriptionHtml: string): Record<string, unknown> {
  const posted = (job.publishedAt ?? job.createdAt).slice(0, 10);
  const valid = new Date(Date.parse(job.publishedAt ?? job.createdAt) + 180 * 86_400_000).toISOString().slice(0, 10);
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: descriptionHtml,
    datePosted: posted,
    validThrough: valid,
    employmentType: EMPLOYMENT[job.employmentType] ?? 'FULL_TIME',
    hiringOrganization: { '@type': 'Organization', name: c.company, ...(c.logoUrl ? { logo: c.logoUrl.startsWith('/') ? `${appBase()}${c.logoUrl}` : c.logoUrl } : {}) },
    identifier: { '@type': 'PropertyValue', name: c.company, value: job.id },
    url: jobUrl(c.settings.handle, job.slug),
    directApply: true,
  };
  if (job.workplace === 'remote') {
    ld.jobLocationType = 'TELECOMMUTE';
    if (job.location) ld.applicantLocationRequirements = { '@type': 'Country', name: job.location };
  } else if (job.location) {
    ld.jobLocation = { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: job.location } };
  }
  if (job.salaryPublic && (job.salaryMin != null || job.salaryMax != null)) {
    ld.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: job.salaryCurrency,
      value: {
        '@type': 'QuantitativeValue',
        ...(job.salaryMin != null ? { minValue: job.salaryMin } : {}),
        ...(job.salaryMax != null ? { maxValue: job.salaryMax } : {}),
        unitText: UNIT[job.salaryPeriod] ?? 'YEAR',
      },
    };
  }
  return ld;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function careersSitemap(handle: string): Promise<string | null> {
  const c = await publishedCareers(handle);
  if (!c) return null;
  const jobs = await publishedJobs(c.settings.workspace_id);
  const urls = [
    `<url><loc>${xmlEscape(`${appBase()}/careers/${c.settings.handle}`)}</loc></url>`,
    ...jobs.map((j) => `<url><loc>${xmlEscape(jobUrl(c.settings.handle, j.slug))}</loc><lastmod>${j.updatedAt.slice(0, 10)}</lastmod></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>\n`;
}

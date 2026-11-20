/**
 * Hiring: cada informe de la página de Informes en CSV, con lo mismo que se
 * ve (período, puesto y solo las postulaciones visibles para la persona).
 * Sin imports de servidor: lo arma el navegador con el informe ya cargado.
 */
import { toCsv } from '../hr-csv';
import type { HiringReport } from './reports';

export const REPORT_SECTIONS = ['funnel', 'sources', 'reasons', 'jobs'] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

export interface ReportCsvLabels {
  /** Encabezados de columna por informe, en el idioma de la persona. */
  headers: Record<ReportSection, string[]>;
  source: (key: string) => string;
  reason: (raw: string) => string;
}

export function reportRows(report: HiringReport, section: ReportSection, l: ReportCsvLabels): unknown[][] {
  const head = l.headers[section];
  switch (section) {
    case 'funnel':
      return [head, ...report.funnel.map((f) => [f.label, f.reached, f.rate == null ? '' : f.rate])];
    case 'sources':
      return [head, ...report.sources.map((s) => [l.source(s.source), s.applications, s.interviews, s.hires])];
    case 'reasons':
      return [head, ...report.rejectReasons.map((r) => [l.reason(r.reason), r.count])];
    case 'jobs':
      return [head, ...report.openJobs.map((j) => [j.title, j.daysOpen, j.active, j.total])];
  }
}

export function reportCsv(report: HiringReport, section: ReportSection, l: ReportCsvLabels): string {
  return toCsv(reportRows(report, section, l));
}

/** hiring-sources-90d.csv (con el puesto, si hay uno elegido). */
export function reportFileName(report: Pick<HiringReport, 'days' | 'jobId'>, section: ReportSection): string {
  return `hiring-${section}-${report.days}d${report.jobId ? `-${report.jobId}` : ''}.csv`;
}

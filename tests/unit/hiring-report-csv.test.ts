import { describe, expect, it } from 'vitest';
import { reportCsv, reportFileName, type ReportCsvLabels } from '@/lib/hiring/report-csv';
import type { HiringReport } from '@/lib/hiring/reports';

const report: HiringReport = {
  days: 90,
  jobId: null,
  timeToHire: { hires: 1, avgDays: 12, medianDays: 12 },
  funnel: [
    { key: 'applied', label: 'Applied', reached: 10, rate: null },
    { key: 'interview', label: 'Interview', reached: 4, rate: 40 },
  ],
  sources: [{ source: 'linkedin', applications: 6, interviews: 2, hires: 1 }],
  openJobs: [{ id: 'job_1', title: '=HYPERLINK("x")', daysOpen: 3, active: 2, total: 5 }],
  rejectReasons: [
    { reason: 'knockout', count: 2 },
    { reason: '', count: 1 },
    { reason: 'Salary, too high', count: 3 },
  ],
};

const labels: ReportCsvLabels = {
  headers: { funnel: ['Stage', 'Reached', 'Conversion'], sources: ['Source', 'Applications', 'Interviews', 'Hires'], reasons: ['Reason', 'Total'], jobs: ['Job', 'Days open', 'Active', 'Total'] },
  source: (k) => (k === 'linkedin' ? 'LinkedIn' : k),
  reason: (r) => (r === 'knockout' ? 'Knock-out' : r || 'No reason'),
};

describe('informes de Hiring en CSV', () => {
  it('cada informe con sus columnas, etiquetas traducidas y celdas a salvo', () => {
    expect(reportCsv(report, 'funnel', labels)).toBe('Stage,Reached,Conversion\nApplied,10,\nInterview,4,40\n');
    expect(reportCsv(report, 'sources', labels)).toBe('Source,Applications,Interviews,Hires\nLinkedIn,6,2,1\n');
    expect(reportCsv(report, 'reasons', labels)).toBe('Reason,Total\nKnock-out,2\nNo reason,1\n"Salary, too high",3\n');
    // Un título que empieza con = no queda como fórmula al abrirlo en una planilla.
    expect(reportCsv(report, 'jobs', labels).split('\n')[1].startsWith("\"'=")).toBe(true);
  });
  it('el nombre lleva el informe, el período y el puesto', () => {
    expect(reportFileName(report, 'sources')).toBe('hiring-sources-90d.csv');
    expect(reportFileName({ days: 30, jobId: 'job_1' }, 'jobs')).toBe('hiring-jobs-30d-job_1.csv');
  });
});

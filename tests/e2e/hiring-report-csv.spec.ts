import fs from 'fs';
import { expect, test } from '@playwright/test';

/** Informes de Hiring: el embudo se baja en CSV con lo que muestra la página. */
test('Hiring: informe en CSV', async ({ page, request }) => {
  const uid = Math.random().toString(36).slice(2, 8);
  const created = (await (await request.post('/api/hiring/jobs', { data: { title: `Csv ${uid}`, template: 'customer-support' } })).json()) as { job: { id: string } };
  expect((await request.post('/api/hiring/applications', { data: { jobId: created.job.id, name: `Csv ${uid}`, email: `csv-${uid}@example.com` } })).status()).toBe(201);

  await page.goto(`/en/app/hiring/reports?days=30&job=${created.job.id}`, { waitUntil: 'networkidle' });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('hr-report-csv-funnel').click()]);
  expect(download.suggestedFilename()).toBe(`hiring-funnel-30d-${created.job.id}.csv`);
  const text = fs.readFileSync((await download.path())!, 'utf8').replace(/^﻿/, '');
  const lines = text.trim().split('\n');
  expect(lines.length).toBeGreaterThan(1);
  // La primera etapa cuenta la postulación cargada.
  expect(lines[1].split(',')[1]).toBe('1');
});

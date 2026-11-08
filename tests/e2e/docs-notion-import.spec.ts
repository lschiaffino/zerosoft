import { expect, test } from '@playwright/test';
import { buildZip } from '../../lib/zip-reader';

/**
 * Migrar de Notion sin dolor: un export "Markdown & CSV" como los reales
 * (carpeta envoltorio, ids de 32 hex, CSV y _all.csv con BOM, filas con sus
 * propiedades, relación entre bases, rango de fechas, toggles, imagen,
 * links internos, basura de macOS) entra por la pantalla de importar con
 * vista previa, progreso y resumen, y reimportarlo no duplica nada.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const enc = (s: string) => encodeURIComponent(s);

function exportZip(tag: string) {
  const id = (c: string) => (tag + c).padEnd(32, c).replace(/[^0-9a-f]/g, 'a').slice(0, 32);
  const wiki = `Wiki ${tag} ${id('1')}`;
  const eng = `Engineering ${id('2')}`;
  const tasks = `Tasks ${tag} ${id('3')}`;
  const proj = `Projects ${tag} ${id('4')}`;
  const pMig = `Docs Migration ${id('5')}`;
  const pWeb = `Website ${id('6')}`;
  const rel = (p: string) => `${p.split(' ').slice(0, -1).join(' ')} (../${enc(proj)}/${enc(p)}.md)`;
  const csv = [
    'Name,Status,Due,Project,Done',
    `Ship importer,In progress,"November 10, 2026","${rel(pMig)}",No`,
    `Fix lists,Done,"November 3, 2026 → November 5, 2026","${rel(pMig)}, ${rel(pWeb)}",Yes`,
  ].join('\n');
  const root = 'Private & Shared';
  const files = [
    {
      name: `${root}/${wiki}.md`,
      deflate: true,
      data: [
        `# Wiki ${tag}`,
        '',
        `Start with [Engineering](${enc(wiki)}/${enc(eng)}.md).`,
        '',
        '## Lists',
        '',
        '- One',
        '    - Nested',
        '1. First',
        '2. Second',
        '- [x] Done task',
        '',
        '<details>',
        '<summary>More</summary>',
        '',
        'Hidden text',
        '',
        '</details>',
        '',
        `![office.png](${enc(wiki)}/office.png)`,
      ].join('\n'),
    },
    { name: `${root}/${wiki}/office.png`, data: PNG },
    { name: `${root}/${wiki}/${eng}.md`, data: `# Engineering\n\nSee [Tasks](${enc(eng)}/${enc(tasks)}.csv) and go back to [Wiki](../${enc(wiki)}.md).\n` },
    { name: `${root}/${wiki}/${eng}/${tasks}.csv`, data: `﻿${csv.split('\n').slice(0, 2).join('\n')}\n` },
    { name: `${root}/${wiki}/${eng}/${tasks}_all.csv`, data: `﻿${csv}\n` },
    { name: `${root}/${wiki}/${eng}/${tasks}/Ship importer ${id('7')}.md`, data: '# Ship importer\n\nStatus: In progress\n\nBody of the task.\n' },
    { name: `${root}/${wiki}/${proj}.csv`, data: '﻿Name,Lead\nDocs Migration,Ana\nWebsite,Leo\n' },
    { name: `${root}/${wiki}/${proj}/${pMig}.md`, data: '# Docs Migration\n\nLead: Ana\n' },
    { name: `${root}/${wiki}/${proj}/${pWeb}.md`, data: '# Website\n\nLead: Leo\n' },
    { name: '__MACOSX/._junk', data: 'x' },
    { name: `${root}/.DS_Store`, data: 'x' },
  ];
  return { zip: buildZip(files), wikiTitle: `Wiki ${tag}`, tasksTitle: `Tasks ${tag}`, projTitle: `Projects ${tag}` };
}

test('Notion: export real con árbol, relación entre bases, toggles e imagen; reimportar no duplica', async ({ page, request }) => {
  test.setTimeout(180_000);
  const tag = uid();
  const { zip, wikiTitle, tasksTitle, projTitle } = exportZip(tag);
  const upload = async () => {
    await page.goto('/en/app/docs/import', { waitUntil: 'networkidle' });
    await page.getByLabel('Export file (.zip)').setInputFiles({ name: 'Export-notion.zip', mimeType: 'application/zip', buffer: zip });
    await page.getByRole('button', { name: 'Upload and preview' }).click();
    const preview = page.getByTestId('notion-import-preview');
    await expect(preview).toBeVisible({ timeout: 60_000 });
    return preview;
  };

  const preview = await upload();
  // La carpeta envoltorio y la basura de macOS no son páginas; las filas no se listan como páginas.
  await expect(preview.getByText(wikiTitle)).toBeVisible();
  await expect(preview.getByText('Private & Shared')).toHaveCount(0);
  await expect(preview.getByText('Ship importer')).toHaveCount(0);
  await preview.getByRole('button', { name: /^Import \d+ pages and 2 databases$/ }).click();
  const done = page.getByTestId('notion-import-done');
  await expect(done).toBeVisible({ timeout: 90_000 });
  await expect(done).toContainText('2 databases');

  await done.getByRole('link', { name: `Open ${wikiTitle}` }).click();
  await expect(page).toHaveURL(/\/app\/docs\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  // Árbol en el sidebar: Engineering cuelga de la wiki y la base de Engineering.
  const side = page.getByRole('navigation', { name: 'Docs' });
  await expect(side.getByRole('link', { name: wikiTitle })).toBeVisible();
  await expect(side.getByRole('link', { name: 'Engineering' }).first()).toBeVisible();
  // Contenido: link interno, listas anidadas, tarea hecha, toggle con su hijo e imagen subida.
  await expect(page.locator('a[data-page]', { hasText: 'Engineering' }).first()).toBeVisible();
  await expect(page.locator('.docs-editable.docs-bulleted_list_item', { hasText: 'Nested' })).toHaveAttribute('data-depth', '1');
  await expect(page.locator('.docs-block-todo .docs-check')).toBeChecked();
  await expect(page.locator('.docs-block-toggle')).toContainText('More');
  await expect(page.locator('.docs-blocks img').first()).toBeVisible();

  // La base Tasks: relación con Projects (nombres de sus filas) y rango de fechas con su fin.
  const found = (await (await request.get(`/api/docs/search?q=${encodeURIComponent(tasksTitle)}`)).json()) as { rows: Array<{ id: string; title: string }> };
  const tasksPage = found.rows.find((r) => r.title === tasksTitle)!;
  const { content } = (await (await request.get(`/api/docs/pages/${tasksPage.id}`)).json()) as {
    content: Array<{ db: { properties: Array<{ id: string; name: string; type: string; relation?: { page_id: string } }>; rows: Array<{ values: Record<string, unknown> }> } }>;
  };
  const props = content[0].db.properties;
  expect(props.map((p) => `${p.name}:${p.type}`)).toEqual(['Name:title', 'Status:status', 'Due:date', 'Due (end):date', 'Project:relation', 'Done:checkbox']);
  const projFound = (await (await request.get(`/api/docs/search?q=${encodeURIComponent(projTitle)}`)).json()) as { rows: Array<{ id: string; title: string }> };
  expect(props.find((p) => p.name === 'Project')!.relation!.page_id).toBe(projFound.rows.find((r) => r.title === projTitle)!.id);
  await page.goto(`/en/app/docs/${tasksPage.id}`, { waitUntil: 'networkidle' });
  const fix = page.locator('.docs-db-tr', { hasText: 'Fix lists' });
  await expect(fix).toContainText('Docs Migration');
  await expect(fix).toContainText('Website');

  // Reimportar el mismo export: todo figura como ya importado y no se duplica.
  const again = await upload();
  await expect(again).toContainText(/already imported|imported before/i);
  await again.getByRole('button', { name: /^Import/ }).first().click();
  await expect(page.getByTestId('notion-import-done')).toBeVisible({ timeout: 90_000 });
  const after = (await (await request.get(`/api/docs/search?q=${encodeURIComponent(wikiTitle)}`)).json()) as { rows: Array<{ title: string }> };
  expect(after.rows.filter((r) => r.title === wikiTitle)).toHaveLength(1);
});

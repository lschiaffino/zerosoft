import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import type { BiViewer } from '@/lib/bi/access';
import { BI_EXPORT_MAX_ROWS, exportFilename, exportResult, isExportFormat, toCsv, toJson } from '@/lib/bi/export';
import { BI_MAX_ROWS, runQuery } from '@/lib/bi/run';
import { buildXlsx, columnLetter, excelSerial, sheetName, xmlText } from '@/lib/xlsx-writer';
import { bufferSource, listZipEntries, readZipEntry } from '@/lib/zip-reader';
import type { BiResult } from '@/lib/bi/types';

const result: Pick<BiResult, 'columns' | 'rows'> = {
  columns: [
    { name: 'name', type: 'text' },
    { name: 'total', type: 'number' },
    { name: 'day', type: 'date' },
  ],
  rows: [
    ['Ana, "la jefa"', 1200.5, '2026-01-05'],
    ['=HYPERLINK("x")', -5, '2026-01-05 10:30:00'],
    [null, 0, null],
  ],
};

async function xlsxParts(bytes: Uint8Array): Promise<Map<string, string>> {
  const src = bufferSource(Buffer.from(bytes));
  const out = new Map<string, string>();
  for (const e of await listZipEntries(src)) out.set(e.name, (await readZipEntry(src, e, 5_000_000)).toString('utf8'));
  return out;
}

describe('xlsx', () => {
  it('letras de columna, nombres de hoja y XML limpio', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(sheetName('Ventas: [2026] / mes')).toBe('Ventas 2026 mes');
    expect(sheetName('   ')).toBe('Sheet1');
    expect(sheetName('x'.repeat(40))).toHaveLength(31);
    expect(xmlText('a<b>&"c"\u0001')).toBe('a&lt;b&gt;&amp;&quot;c&quot;');
  });

  it('fechas ISO a número de serie de Excel, sin cambiar de zona', () => {
    expect(excelSerial('1970-01-01')).toEqual({ serial: 25569, hasTime: false });
    expect(excelSerial('2026-01-05')?.serial).toBe(46027);
    expect(excelSerial('2026-01-05 12:00:00')).toEqual({ serial: 46027.5, hasTime: true });
    expect(excelSerial('2026-02-30')).toBeNull();
    expect(excelSerial('hola')).toBeNull();
  });

  it('arma un zip con las partes de una planilla; texto inline, nunca fórmula', async () => {
    const parts = await xlsxParts(buildXlsx({ name: 'Ventas', header: ['name', 'total', 'day'], rows: result.rows as never, dateColumns: [2] }));
    expect([...parts.keys()].sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    expect(parts.get('xl/workbook.xml')).toContain('<sheet name="Ventas"');
    const sheet = parts.get('xl/worksheets/sheet1.xml')!;
    // Encabezado en negrita y fijo.
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1">');
    expect(sheet).toContain('state="frozen"');
    // Números como números, fechas con formato de fecha (s=2) o fecha y hora (s=3).
    expect(sheet).toContain('<c r="B2"><v>1200.5</v></c>');
    expect(sheet).toContain('<c r="C2" s="2"><v>46027</v></c>');
    expect(sheet).toContain('<c r="C3" s="3"><v>46027.4375</v></c>');
    // Un texto que empieza con = queda como texto escapado, sin <f>.
    expect(sheet).toContain('=HYPERLINK(&quot;x&quot;)');
    expect(sheet).not.toContain('<f>');
    // Celdas vacías no se escriben.
    expect(sheet).not.toContain('r="A4"');
  });
});

describe('export de resultados', () => {
  it('CSV con comillas, sin fórmulas y con negativos como números', () => {
    const lines = toCsv(result).split('\n');
    expect(lines[0]).toBe('name,total,day');
    expect(lines[1]).toBe('"Ana, ""la jefa""",1200.5,2026-01-05');
    expect(lines[2]).toBe(`"'=HYPERLINK(""x"")",-5,2026-01-05 10:30:00`);
    expect(lines[3]).toBe(',0,');
  });

  it('JSON como lista de objetos', () => {
    expect(JSON.parse(toJson(result))).toEqual([
      { name: 'Ana, "la jefa"', total: 1200.5, day: '2026-01-05' },
      { name: '=HYPERLINK("x")', total: -5, day: '2026-01-05 10:30:00' },
      { name: null, total: 0, day: null },
    ]);
  });

  it('nombre de archivo, tipo y BOM del CSV', () => {
    expect(exportFilename('Ventas por mes: ñandú/2026', 'xlsx')).toBe('Ventas-por-mes-nandu-2026.xlsx');
    expect(exportFilename(undefined, 'csv')).toBe('results.csv');
    expect(exportFilename('"; rm', 'json')).toBe('rm.json');
    const csv = exportResult(result, 'csv', 'x');
    expect(csv.mime).toMatch(/^text\/csv/);
    expect((csv.body as string).charCodeAt(0)).toBe(0xfeff);
    expect(exportResult(result, 'xlsx').mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(isExportFormat('xlsx')).toBe(true);
    expect(isExportFormat('pdf')).toBe(false);
  });
});

describe('descarga con más filas que la pantalla', () => {
  const WS = 'bi-export-owner';
  const owner: BiViewer = { workspaceId: WS, personId: WS, role: 'owner', apps: '*' };
  const N = BI_MAX_ROWS + 30;

  beforeAll(async () => {
    await upsertUser({ id: WS, email: `${WS}@test.local`, name: WS });
    await getDb()
      .prepare(
        `INSERT OR IGNORE INTO crm_contacts (id, user_id, first_name, last_name, email, created_at)
         WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
         SELECT 'bix-' || i, ?, 'P' || i, '', 'p' || i || '@x.test', '2026-01-05 10:00:00' FROM n`,
      )
      .run(N, WS);
  });

  it('en pantalla se corta en el tope; la descarga trae todas y no usa la caché', async () => {
    const q = { kind: 'sql' as const, sql: 'SELECT id FROM contacts', params: [] };
    const screen = await runQuery(owner, 'zerosoft', q, { fresh: true });
    expect(screen.rows).toHaveLength(BI_MAX_ROWS);
    expect(screen.truncated).toBe(true);
    const full = await runQuery(owner, 'zerosoft', q, { maxRows: BI_EXPORT_MAX_ROWS });
    expect(full.rows).toHaveLength(N);
    expect(full.truncated).toBe(false);
    expect(full.cached).toBe(false);
    // La descarga no pisó la caché de la pantalla.
    const again = await runQuery(owner, 'zerosoft', q);
    expect(again.cached).toBe(true);
    expect(again.rows).toHaveLength(BI_MAX_ROWS);
  });
});

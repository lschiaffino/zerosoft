/**
 * Planilla .xlsx mínima, sin dependencias y sin Node: una hoja con fila de
 * encabezado (en negrita y fija al bajar), números como números, fechas como
 * fechas de Excel y el resto como texto. Las celdas de texto van "inline"
 * (sin tabla de strings compartidos) y nunca como fórmula, así un valor que
 * empieza con "=" no se ejecuta al abrir el archivo. El zip va sin comprimir
 * (STORE): lo abren Excel, Numbers, LibreOffice y Google Sheets.
 */
import { crc32 } from './crc32';

export type XlsxCell = string | number | boolean | Date | null | undefined;

export interface XlsxSheet {
  /** Nombre de la hoja (se limpia: hasta 31 caracteres, sin []:*?/\). */
  name: string;
  header: string[];
  rows: XlsxCell[][];
  /** Índices de columnas con fechas ISO en texto ("2026-11-28" o con hora) para guardarlas como fecha. */
  dateColumns?: number[];
}

const MAX_SHEET_NAME = 31;
/** Excel admite hasta 32.767 caracteres por celda. */
const MAX_CELL = 32_767;

export function sheetName(raw: string): string {
  const clean = raw.replace(/[[\]:*?/\\\u0000-\u001f]/g, ' ').replace(/^'+|'+$/g, '').replace(/\s+/g, ' ').trim();
  return clean.slice(0, MAX_SHEET_NAME).trim() || 'Sheet1';
}

/** "A", "B", ..., "Z", "AA"... para el índice de columna (desde 0). */
export function columnLetter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Texto apto para XML 1.0: escapa y saca los caracteres de control que Excel rechaza. */
export function xmlText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Fecha ISO → número de serie de Excel (días desde 1899-12-30), o null si no es una fecha. */
export function excelSerial(v: string | Date): { serial: number; hasTime: boolean } | null {
  if (v instanceof Date) {
    const ms = v.getTime();
    return Number.isFinite(ms) ? { serial: ms / 86_400_000 + 25_569, hasTime: ms % 86_400_000 !== 0 } : null;
  }
  const m = ISO_DATE.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', se = '0'] = m;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  if (!Number.isFinite(ms) || new Date(ms).getUTCDate() !== +d) return null;
  // Las fechas de la consulta se muestran tal cual vienen: sin pasar a otra zona.
  const hasTime = +h !== 0 || +mi !== 0 || +se !== 0;
  return { serial: ms / 86_400_000 + 25_569, hasTime };
}

/** Estilos: 0 normal, 1 encabezado en negrita, 2 fecha, 3 fecha y hora. */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function cellXml(ref: string, v: XlsxCell, asDate: boolean, header = false): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : '';
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
  if (v instanceof Date || (asDate && !header)) {
    const d = excelSerial(v);
    if (d) return `<c r="${ref}" s="${d.hasTime ? 3 : 2}"><v>${d.serial}</v></c>`;
  }
  const text = String(v).slice(0, MAX_CELL);
  return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const dates = new Set(sheet.dateColumns ?? []);
  const width = Math.max(sheet.header.length, ...sheet.rows.map((r) => r.length), 1);
  const widths = Array.from({ length: width }, (_, i) => {
    let w = String(sheet.header[i] ?? '').length;
    for (const r of sheet.rows.slice(0, 200)) w = Math.max(w, dates.has(i) ? 16 : String(r[i] ?? '').length);
    return Math.min(60, Math.max(8, w + 2));
  });
  const rows: string[] = [];
  rows.push(`<row r="1">${sheet.header.map((h, i) => cellXml(`${columnLetter(i)}1`, h, false, true)).join('')}</row>`);
  sheet.rows.forEach((r, ri) => {
    const n = ri + 2;
    rows.push(`<row r="${n}">${r.map((v, i) => cellXml(`${columnLetter(i)}${n}`, v, dates.has(i))).join('')}</row>`);
  });
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rows.join('')}</sheetData></worksheet>`
  );
}

function storeZip(files: Array<{ name: string; data: string }>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.data);
    const crc = crc32(data);
    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(12, 0x5c21, true); // 2026-01-01: archivo reproducible
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    parts.push(local, name, data);
    const c = new Uint8Array(46);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(14, 0x5c21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.push(c, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of all) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

/** Arma el .xlsx con una hoja. */
export function buildXlsx(sheet: XlsxSheet): Uint8Array {
  const name = xmlText(sheetName(sheet.name));
  return storeZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(sheet) },
  ]);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

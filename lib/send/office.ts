/**
 * Send: PowerPoint (.pptx) a imágenes, sin LibreOffice. Server-only.
 *
 * Dibuja lo que un .pptx declara: fondos, imágenes, rectángulos y elipses con
 * relleno, tablas y texto con su tamaño, color, alineación y viñetas, heredando
 * posiciones de la plantilla y del patrón. No dibuja gráficos, SmartArt, degradados
 * ni efectos, y usa una sola familia de letra: quien sube lo ve en la vista previa
 * antes de compartir, con un aviso. Para una copia exacta, exportar a PDF.
 */
import path from 'path';
import { bufferSource, listZipEntries, readZipEntry, type ZipEntry, type ZipSource } from '../zip-reader';
import { SendError } from './types';
import { canvas, type RenderedPage } from './render';

type Canvas = typeof import('@napi-rs/canvas');
type Ctx = ReturnType<ReturnType<Canvas['createCanvas']>['getContext']>;

const PART_MAX = 32 * 1024 * 1024;
const WIDTH = 1600;
const EMU_PER_PT = 12700;

// ---------- XML mínimo ----------

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  kids: XmlNode[];
  text: string;
}

function decode(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

/** Parser chico para OOXML: etiquetas, atributos y texto. Sin DTD ni entidades externas. */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, kids: [], text: '' };
  const stack = [root];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[6] !== undefined) {
      top.text += decode(m[6]);
    } else if (m[5] !== undefined) {
      top.text += m[5];
    } else if (m[2]) {
      if (m[1]) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs: Record<string, string> = {};
      const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = ar.exec(m[3]))) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
      const node: XmlNode = { tag: m[2], attrs, kids: [], text: '' };
      top.kids.push(node);
      if (!m[4]) stack.push(node);
    }
    if (stack.length > 200) throw new SendError('office_invalid', 422);
  }
  return root;
}

export const kid = (n: XmlNode | undefined, tag: string): XmlNode | undefined => n?.kids.find((k) => k.tag === tag);
export const kids = (n: XmlNode | undefined, tag: string): XmlNode[] => n?.kids.filter((k) => k.tag === tag) ?? [];
function deep(n: XmlNode | undefined, ...tags: string[]): XmlNode | undefined {
  let cur = n;
  for (const t of tags) cur = kid(cur, t);
  return cur;
}

// ---------- Paquete ----------

interface Pkg {
  src: ZipSource;
  entries: Map<string, ZipEntry>;
}

async function readPart(p: Pkg, name: string): Promise<Buffer | null> {
  const e = p.entries.get(name);
  if (!e) return null;
  return readZipEntry(p.src, e, PART_MAX).catch(() => null);
}

async function readXml(p: Pkg, name: string): Promise<XmlNode | null> {
  const b = await readPart(p, name);
  return b ? parseXml(b.toString('utf8')) : null;
}

async function rels(p: Pkg, part: string): Promise<Map<string, { target: string; type: string }>> {
  const dir = path.posix.dirname(part);
  const file = `${dir}/_rels/${path.posix.basename(part)}.rels`;
  const xml = await readXml(p, file);
  const out = new Map<string, { target: string; type: string }>();
  for (const r of kids(kid(xml ?? undefined, 'Relationships'), 'Relationship')) {
    const t = r.attrs.Target ?? '';
    if (r.attrs.TargetMode === 'External') continue;
    const target = t.startsWith('/') ? t.slice(1) : path.posix.normalize(`${dir}/${t}`);
    out.set(r.attrs.Id, { target, type: r.attrs.Type ?? '' });
  }
  return out;
}

// ---------- Tema y colores ----------

type Theme = Record<string, string>;
const DEFAULT_THEME: Theme = { dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72' };

function themeFrom(xml: XmlNode | null): Theme {
  const out = { ...DEFAULT_THEME };
  const scheme = deep(xml ?? undefined, 'a:theme', 'a:themeElements', 'a:clrScheme');
  for (const k of scheme?.kids ?? []) {
    const name = k.tag.replace('a:', '');
    const c = kid(k, 'a:srgbClr')?.attrs.val ?? kid(k, 'a:sysClr')?.attrs.lastClr;
    if (c) out[name] = c;
  }
  return out;
}

function applyLum(hex: string, node: XmlNode): string {
  let r = parseInt(hex.slice(0, 2), 16);
  let g = parseInt(hex.slice(2, 4), 16);
  let b = parseInt(hex.slice(4, 6), 16);
  for (const m of node.kids) {
    const v = Number(m.attrs.val) / 100000;
    if (!Number.isFinite(v)) continue;
    if (m.tag === 'a:lumMod') [r, g, b] = [r * v, g * v, b * v];
    if (m.tag === 'a:lumOff') [r, g, b] = [r + 255 * v, g + 255 * v, b + 255 * v];
  }
  const h = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `${h(r)}${h(g)}${h(b)}`;
}

function colorOf(fill: XmlNode | undefined, theme: Theme): string | null {
  if (!fill) return null;
  const s = kid(fill, 'a:srgbClr');
  if (s?.attrs.val) return `#${applyLum(s.attrs.val, s)}`;
  const t = kid(fill, 'a:schemeClr');
  if (t?.attrs.val) {
    const map: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
    return `#${applyLum(theme[map[t.attrs.val] ?? t.attrs.val] ?? '000000', t)}`;
  }
  return null;
}

// ---------- Dibujo ----------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Xform {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
}

interface SlideCtx {
  c: Canvas;
  ctx: Ctx;
  pkg: Pkg;
  theme: Theme;
  scale: number;
  rel: Map<string, { target: string; type: string }>;
  images: Map<string, unknown>;
}

function boxOf(xfrm: XmlNode | undefined): Box | null {
  const off = kid(xfrm, 'a:off');
  const ext = kid(xfrm, 'a:ext');
  if (!off || !ext) return null;
  return { x: Number(off.attrs.x), y: Number(off.attrs.y), w: Number(ext.attrs.cx), h: Number(ext.attrs.cy) };
}

function place(b: Box, t: Xform, scale: number): Box {
  return { x: (b.x * t.sx + t.ox) * scale, y: (b.y * t.sy + t.oy) * scale, w: b.w * t.sx * scale, h: b.h * t.sy * scale };
}

interface Run {
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
  underline: boolean;
}

interface Para {
  runs: Run[];
  align: string;
  level: number;
  bullet: string;
  spaceAfter: number;
}

interface TextDefaults {
  size: number;
  color: string;
  bullet: boolean;
  bold: boolean;
  align: string;
}

const TYPE_DEFAULTS: Record<string, Partial<TextDefaults>> = {
  title: { size: 44, bullet: false },
  ctrTitle: { size: 60, bullet: false, align: 'ctr' },
  subTitle: { size: 24, bullet: false, align: 'ctr' },
  body: { size: 28, bullet: true },
  obj: { size: 28, bullet: true },
  ftr: { size: 12, bullet: false },
  dt: { size: 12, bullet: false },
  sldNum: { size: 12, bullet: false },
};

function parasOf(tx: XmlNode | undefined, def: TextDefaults, theme: Theme, fontScale: number): Para[] {
  const out: Para[] = [];
  for (const p of kids(tx, 'a:p')) {
    const ppr = kid(p, 'a:pPr');
    const level = Number(ppr?.attrs.lvl ?? 0) || 0;
    const noBullet = !!kid(ppr, 'a:buNone');
    const char = kid(ppr, 'a:buChar')?.attrs.char;
    const bullet = noBullet ? '' : (char ?? (kid(ppr, 'a:buAutoNum') ? '•' : def.bullet ? '•' : ''));
    const runs: Run[] = [];
    for (const r of p.kids) {
      if (r.tag === 'a:br') {
        runs.push({ text: '\n', size: def.size, bold: false, italic: false, color: def.color, underline: false });
        continue;
      }
      if (r.tag !== 'a:r' && r.tag !== 'a:fld') continue;
      const rpr = kid(r, 'a:rPr');
      const size = rpr?.attrs.sz ? Number(rpr.attrs.sz) / 100 : Math.max(10, def.size - level * 4);
      runs.push({
        text: kid(r, 'a:t')?.text ?? '',
        size: size * fontScale,
        bold: rpr?.attrs.b === '1' || (rpr?.attrs.b === undefined && def.bold),
        italic: rpr?.attrs.i === '1',
        underline: !!rpr?.attrs.u && rpr.attrs.u !== 'none',
        color: colorOf(kid(rpr, 'a:solidFill'), theme) ?? def.color,
      });
    }
    out.push({ runs, align: ppr?.attrs.algn ?? def.align, level, bullet: runs.some((r) => r.text.trim()) ? bullet : '', spaceAfter: 0.4 });
  }
  return out;
}

interface Line {
  words: Array<{ text: string; run: Run; width: number }>;
  width: number;
  height: number;
}

function fontOf(r: Run, px: number): string {
  return `${r.italic ? 'italic ' : ''}${r.bold ? 'bold ' : ''}${px}px SendSans`;
}

function layout(ctx: Ctx, para: Para, maxWidth: number, ptToPx: number): Line[] {
  const lines: Line[] = [];
  let line: Line = { words: [], width: 0, height: 0 };
  const push = () => {
    lines.push(line);
    line = { words: [], width: 0, height: 0 };
  };
  for (const r of para.runs) {
    const px = r.size * ptToPx;
    ctx.font = fontOf(r, px);
    if (r.text === '\n') {
      line.height = Math.max(line.height, px * 1.2);
      push();
      continue;
    }
    for (const piece of r.text.split(/(\s+)/)) {
      if (!piece) continue;
      const width = ctx.measureText(piece).width;
      if (line.width + width > maxWidth && line.words.length && piece.trim()) push();
      if (!line.words.length && !piece.trim()) continue;
      line.words.push({ text: piece, run: r, width });
      line.width += width;
      line.height = Math.max(line.height, px * 1.2);
    }
  }
  if (line.words.length || !lines.length) {
    line.height = line.height || para.runs[0]?.size * ptToPx * 1.2 || 18 * ptToPx;
    push();
  }
  return lines;
}

function drawText(ctx: Ctx, tx: XmlNode | undefined, box: Box, def: TextDefaults, s: SlideCtx): void {
  const body = kid(tx, 'a:bodyPr');
  const fontScale = Number(kid(body, 'a:normAutofit')?.attrs.fontScale ?? 100000) / 100000 || 1;
  const paras = parasOf(tx, def, s.theme, fontScale);
  if (!paras.length) return;
  const ptToPx = s.scale * EMU_PER_PT;
  const inset = { l: Number(body?.attrs.lIns ?? 91440) * s.scale, t: Number(body?.attrs.tIns ?? 45720) * s.scale, r: Number(body?.attrs.rIns ?? 91440) * s.scale, b: Number(body?.attrs.bIns ?? 45720) * s.scale };
  const inner = box.w - inset.l - inset.r;
  const rows: Array<{ line: Line; para: Para; first: boolean; indent: number }> = [];
  for (const p of paras) {
    const indent = (p.level * 28 + (p.bullet ? 22 : 0)) * ptToPx;
    layout(ctx, p, Math.max(10, inner - indent), ptToPx).forEach((line, i) => rows.push({ line, para: p, first: i === 0, indent }));
  }
  const total = rows.reduce((n, r) => n + r.line.height + (r.first ? r.line.height * 0.15 : 0), 0);
  const anchor = body?.attrs.anchor ?? 't';
  let y = box.y + inset.t;
  if (anchor === 'ctr') y = box.y + (box.h - total) / 2;
  if (anchor === 'b') y = box.y + box.h - inset.b - total;
  ctx.textBaseline = 'alphabetic';
  for (const { line, para, first, indent } of rows) {
    if (first) y += line.height * 0.15;
    const baseline = y + line.height * 0.8;
    let x = box.x + inset.l + indent;
    const room = inner - indent;
    if (para.align === 'ctr') x += Math.max(0, (room - line.width) / 2);
    if (para.align === 'r') x += Math.max(0, room - line.width);
    if (first && para.bullet) {
      const r0 = line.words[0]?.run;
      if (r0) {
        ctx.font = fontOf(r0, r0.size * ptToPx);
        ctx.fillStyle = r0.color;
        ctx.fillText(para.bullet, x - 22 * ptToPx, baseline);
      }
    }
    for (const w of line.words) {
      const px = w.run.size * ptToPx;
      ctx.font = fontOf(w.run, px);
      ctx.fillStyle = w.run.color;
      ctx.fillText(w.text, x, baseline);
      if (w.run.underline && w.text.trim()) ctx.fillRect(x, baseline + px * 0.1, w.width, Math.max(1, px * 0.05));
      x += w.width;
    }
    y += line.height;
  }
}

async function loadImageFor(s: SlideCtx, rid: string | undefined): Promise<unknown | null> {
  if (!rid) return null;
  const target = s.rel.get(rid)?.target;
  if (!target || !/\.(png|jpe?g|gif|webp)$/i.test(target)) return null;
  if (s.images.has(target)) return s.images.get(target) ?? null;
  const bytes = await readPart(s.pkg, target);
  let img: unknown = null;
  if (bytes) img = await s.c.loadImage(bytes).catch(() => null);
  s.images.set(target, img);
  return img;
}

interface Placeholder {
  box: Box | null;
  type: string;
}

function shapePh(n: XmlNode): { type: string; idx: string } | null {
  const ph = deep(n, 'p:nvSpPr', 'p:nvPr', 'p:ph') ?? deep(n, 'p:nvPicPr', 'p:nvPr', 'p:ph');
  return ph ? { type: ph.attrs.type ?? 'obj', idx: ph.attrs.idx ?? '' } : null;
}

function indexPlaceholders(tree: XmlNode | undefined): Placeholder[] & { idx?: Map<string, Placeholder> } {
  const out: Placeholder[] & { idx?: Map<string, Placeholder> } = [];
  out.idx = new Map();
  for (const n of tree?.kids ?? []) {
    if (n.tag !== 'p:sp') continue;
    const ph = shapePh(n);
    if (!ph) continue;
    const p = { box: boxOf(deep(n, 'p:spPr', 'a:xfrm')), type: ph.type };
    out.push(p);
    if (ph.idx) out.idx.set(ph.idx, p);
  }
  return out;
}

async function drawTree(tree: XmlNode | undefined, s: SlideCtx, t: Xform, layouts: Array<ReturnType<typeof indexPlaceholders>>, skipPlaceholders: boolean): Promise<void> {
  for (const n of tree?.kids ?? []) {
    if (n.tag === 'p:grpSp') {
      const x = deep(n, 'p:grpSpPr', 'a:xfrm');
      const b = boxOf(x);
      const chOff = kid(x, 'a:chOff');
      const chExt = kid(x, 'a:chExt');
      if (b && chOff && chExt && Number(chExt.attrs.cx) && Number(chExt.attrs.cy)) {
        const sx = b.w / Number(chExt.attrs.cx);
        const sy = b.h / Number(chExt.attrs.cy);
        await drawTree(n, s, { sx: t.sx * sx, sy: t.sy * sy, ox: t.ox + t.sx * (b.x - Number(chOff.attrs.x) * sx), oy: t.oy + t.sy * (b.y - Number(chOff.attrs.y) * sy) }, layouts, skipPlaceholders);
      }
      continue;
    }
    if (n.tag === 'p:pic') {
      if (skipPlaceholders && shapePh(n)) continue;
      const b = boxOf(deep(n, 'p:spPr', 'a:xfrm'));
      const img = await loadImageFor(s, deep(n, 'p:blipFill', 'a:blip')?.attrs['r:embed']);
      if (b && img) {
        const p = place(b, t, s.scale);
        s.ctx.drawImage(img as never, p.x, p.y, p.w, p.h);
      }
      continue;
    }
    if (n.tag === 'p:graphicFrame') {
      const tbl = deep(n, 'a:graphic', 'a:graphicData', 'a:tbl');
      const b = boxOf(kid(n, 'p:xfrm'));
      if (tbl && b) drawTable(tbl, place(b, t, s.scale), s);
      continue;
    }
    if (n.tag !== 'p:sp') continue;
    const ph = shapePh(n);
    if (skipPlaceholders && ph) continue;
    const sppr = kid(n, 'p:spPr');
    let box = boxOf(kid(sppr, 'a:xfrm'));
    if (!box && ph) {
      for (const l of layouts) {
        const hit = (ph.idx && l.idx?.get(ph.idx)) || l.find((x) => x.type === ph.type) || (ph.type === 'ctrTitle' ? l.find((x) => x.type === 'title') : undefined) || (ph.type === 'subTitle' ? l.find((x) => x.type === 'body') : undefined);
        if (hit?.box) {
          box = hit.box;
          break;
        }
      }
    }
    if (!box) continue;
    const p = place(box, t, s.scale);
    const geom = kid(sppr, 'a:prstGeom')?.attrs.prst ?? 'rect';
    const fill = colorOf(kid(sppr, 'a:solidFill'), s.theme);
    const lineNode = kid(sppr, 'a:ln');
    const line = colorOf(kid(lineNode, 'a:solidFill'), s.theme);
    const ctx = s.ctx;
    if (fill || line) {
      ctx.beginPath();
      if (geom === 'ellipse') ctx.ellipse(p.x + p.w / 2, p.y + p.h / 2, Math.abs(p.w / 2), Math.abs(p.h / 2), 0, 0, Math.PI * 2);
      else ctx.rect(p.x, p.y, p.w, p.h);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (line) {
        ctx.strokeStyle = line;
        ctx.lineWidth = Math.max(1, (Number(lineNode?.attrs.w ?? 9525) * s.scale) || 1);
        ctx.stroke();
      }
    }
    const typeDef = TYPE_DEFAULTS[ph?.type ?? ''] ?? {};
    drawText(ctx, kid(n, 'p:txBody'), p, { size: typeDef.size ?? 18, color: `#${s.theme.dk1}`, bullet: typeDef.bullet ?? false, bold: false, align: typeDef.align ?? 'l' }, s);
  }
}

function drawTable(tbl: XmlNode, box: Box, s: SlideCtx): void {
  const cols = kids(kid(tbl, 'a:tblGrid'), 'a:gridCol').map((c) => Number(c.attrs.w) * s.scale);
  const ctx = s.ctx;
  let y = box.y;
  for (const tr of kids(tbl, 'a:tr')) {
    const h = Number(tr.attrs.h) * s.scale;
    let x = box.x;
    kids(tr, 'a:tc').forEach((tc, i) => {
      const w = cols[i] ?? 0;
      const tcpr = kid(tc, 'a:tcPr');
      const fill = colorOf(kid(tcpr, 'a:solidFill'), s.theme);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, w, h);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
      drawText(ctx, kid(tc, 'a:txBody'), { x, y, w, h }, { size: 16, color: `#${s.theme.dk1}`, bullet: false, bold: false, align: 'l' }, s);
      x += w;
    });
    y += h;
  }
}

function solidBg(cSld: XmlNode | undefined, theme: Theme): { color: string | null; blip: string | null } {
  const bgPr = deep(cSld, 'p:bg', 'p:bgPr');
  if (bgPr) return { color: colorOf(kid(bgPr, 'a:solidFill'), theme), blip: deep(bgPr, 'a:blipFill', 'a:blip')?.attrs['r:embed'] ?? null };
  return { color: null, blip: null };
}

/**
 * Dibuja las diapositivas después de `skip` hasta `deadline`, entregándolas de a una.
 * Devuelve cuántas tiene el archivo: quien llama sigue en el pedido siguiente.
 */
export async function pptxToImages(bytes: Buffer, opts: { skip?: number; deadline?: number; onPage?: (page: RenderedPage) => Promise<void> } = {}): Promise<number> {
  const c = await canvas();
  const src = bufferSource(bytes);
  let list: ZipEntry[];
  try {
    list = await listZipEntries(src);
  } catch {
    throw new SendError('office_invalid', 422);
  }
  const pkg: Pkg = { src, entries: new Map(list.map((e) => [e.name, e])) };
  const pres = await readXml(pkg, 'ppt/presentation.xml');
  const presNode = kid(pres ?? undefined, 'p:presentation');
  if (!presNode) throw new SendError('office_invalid', 422);
  const size = kid(presNode, 'p:sldSz');
  const cx = Number(size?.attrs.cx) || 12192000;
  const cy = Number(size?.attrs.cy) || 6858000;
  const presRels = await rels(pkg, 'ppt/presentation.xml');
  const ids = kids(kid(presNode, 'p:sldIdLst'), 'p:sldId').map((n) => n.attrs['r:id']);
  const scale = WIDTH / cx;
  const height = Math.round(cy * scale);
  let pageNo = 0;
  const visible: Array<{ part: string; node: XmlNode }> = [];
  for (const rid of ids) {
    const part = presRels.get(rid)?.target;
    if (!part) continue;
    const slide = await readXml(pkg, part);
    const node = kid(slide ?? undefined, 'p:sld');
    if (node && node.attrs.show !== '0') visible.push({ part, node });
  }
  for (const { part, node } of visible) {
    pageNo++;
    if (pageNo <= (opts.skip ?? 0)) continue;
    if (opts.deadline && Date.now() > opts.deadline) break;
    const slideRels = await rels(pkg, part);
    const layoutPart = [...slideRels.values()].find((r) => r.type.endsWith('/slideLayout'))?.target;
    const layout = layoutPart ? await readXml(pkg, layoutPart) : null;
    const layoutNode = kid(layout ?? undefined, 'p:sldLayout');
    const layoutRels = layoutPart ? await rels(pkg, layoutPart) : new Map<string, { target: string; type: string }>();
    const masterPart = [...layoutRels.values()].find((r) => r.type.endsWith('/slideMaster'))?.target;
    const master = masterPart ? await readXml(pkg, masterPart) : null;
    const masterNode = kid(master ?? undefined, 'p:sldMaster');
    const masterRels = masterPart ? await rels(pkg, masterPart) : new Map<string, { target: string; type: string }>();
    const themePart = [...masterRels.values()].find((r) => r.type.endsWith('/theme'))?.target;
    const theme = themeFrom(themePart ? await readXml(pkg, themePart) : null);
    const cv = c.createCanvas(WIDTH, height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, WIDTH, height);
    const images = new Map<string, unknown>();
    const base = { c, ctx, pkg, theme, scale, images };
    const t: Xform = { sx: 1, sy: 1, ox: 0, oy: 0 };
    const trees = [deep(masterNode, 'p:cSld', 'p:spTree'), deep(layoutNode, 'p:cSld', 'p:spTree')];
    // Fondo: el de la diapositiva, o el de la plantilla, o el del patrón.
    for (const [cs, rl] of [
      [kid(node, 'p:cSld'), slideRels],
      [kid(layoutNode, 'p:cSld'), layoutRels],
      [kid(masterNode, 'p:cSld'), masterRels],
    ] as const) {
      const bg = solidBg(cs, theme);
      if (bg.color || bg.blip) {
        if (bg.color) {
          ctx.fillStyle = bg.color;
          ctx.fillRect(0, 0, WIDTH, height);
        }
        const img = await loadImageFor({ ...base, rel: rl }, bg.blip ?? undefined);
        if (img) ctx.drawImage(img as never, 0, 0, WIDTH, height);
        break;
      }
    }
    const layouts = [indexPlaceholders(trees[1]), indexPlaceholders(trees[0])];
    await drawTree(trees[0], { ...base, rel: masterRels }, t, [], true);
    await drawTree(trees[1], { ...base, rel: layoutRels }, t, [], true);
    await drawTree(deep(node, 'p:cSld', 'p:spTree'), { ...base, rel: slideRels }, t, layouts, false);
    await opts.onPage?.({ page: pageNo, bytes: await cv.encode('webp', 84), width: WIDTH, height });
  }
  return visible.length;
}

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { getDb, upsertUser } from '@/lib/db';
import {
  alignDeltas,
  blankDoc,
  bounds,
  clampCrop,
  cloneDoc,
  coverCrop,
  distributeDeltas,
  docFileIds,
  docSearchText,
  expandGroups,
  parseDoc,
  reorder,
  resizeBox,
  resizeDoc,
  resizeImageSide,
  rotationFromPointer,
  shapePath,
  snapMove,
  SHAPES,
  wrapText,
  zoomCrop,
  type DesignDoc,
  type DesignElement,
  type ImageEl,
  type TextEl,
} from '@/lib/design-model';
import { DESIGN_TEMPLATES, templateDoc } from '@/lib/design-templates';
import { DESIGN_ICONS } from '@/lib/design-icons';
import { can, resolveAccess } from '@/lib/design-access';
import { exportFileName, exportPlan, MAX_EXPORT_SIDE } from '@/lib/design-export';
import { buildImagePdf } from '@/lib/pdf-images';
import { imageDimensions, sniffDesignImage } from '@/lib/design-image';
import { makeGrid, makeImage, fillFrame } from '@/lib/design-factories';
import { cleanOutput, magicInstructions } from '@/lib/design-ai';
import { scopesForApps, SCOPE_APP } from '@/lib/api-scopes';
import { appFromPath } from '@/lib/workspace';
import {
  addComment,
  canReadFile,
  createDesign,
  createFolder,
  deleteFolder,
  getBrandKit,
  getDesign,
  getFileRow,
  getPublicDesign,
  getShare,
  heartbeat,
  listComments,
  listDesigns,
  markOpened,
  moveDesign,
  purgeDesign,
  renameDesign,
  restoreDesign,
  saveAsTemplate,
  saveBrandKit,
  saveDesignDoc,
  saveDesignFile,
  searchDesigns,
  setStar,
  trashDesign,
  updateComment,
  updateShare,
  DesignError,
  type DesignActor,
} from '@/lib/design';

const text = (over: Partial<TextEl> = {}): TextEl => ({
  id: 'e1',
  type: 'text',
  x: 10,
  y: 10,
  w: 200,
  h: 40,
  rotation: 0,
  opacity: 1,
  text: 'Hello',
  font: 'inter',
  size: 32,
  weight: 400,
  color: '#111111',
  align: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  ...over,
});

const image = (over: Partial<ImageEl> = {}): ImageEl => ({
  id: 'i1',
  type: 'image',
  x: 0,
  y: 0,
  w: 200,
  h: 100,
  rotation: 0,
  opacity: 1,
  src: 'f_abcdefgh',
  natW: 400,
  natH: 200,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  mask: 'none',
  ...over,
});

// ---------- Modelo ----------

describe('design model', () => {
  it('accepts a valid doc and rejects bad colors, duplicate ids and empty docs', () => {
    const doc: DesignDoc = { v: 1, width: 1080, height: 1080, pages: [{ id: 'p1', background: { color: '#ffffff', image: null }, elements: [text()] }] };
    expect(parseDoc(doc)).not.toBeNull();
    expect(parseDoc({ ...doc, pages: [] })).toBeNull();
    expect(parseDoc({ ...doc, width: 9 })).toBeNull();
    const badColor = structuredClone(doc);
    (badColor.pages[0].elements[0] as TextEl).color = 'url(javascript:alert(1))';
    expect(parseDoc(badColor)).toBeNull();
    const dup = structuredClone(doc);
    dup.pages[0].elements.push(text());
    expect(parseDoc(dup)).toBeNull();
    // Imágenes solo por id de archivo propio, nunca URLs.
    const url = structuredClone(doc);
    url.pages[0].elements = [image({ src: 'https://evil.example/x.png' })];
    expect(parseDoc(url)).toBeNull();
  });

  it('wraps text by words, breaks long words and keeps line breaks', () => {
    const measure = (s: string) => s.length * 10;
    expect(wrapText('one two three', 70, measure)).toEqual(['one two', 'three']);
    expect(wrapText('a\nb', 500, measure)).toEqual(['a', 'b']);
    expect(wrapText('abcdefghij', 40, measure)).toEqual(['abcd', 'efgh', 'ij']);
    // El espaciado entre letras cuenta para el ancho.
    expect(wrapText('ab ab', 50, measure, 0)).toEqual(['ab ab']);
    expect(wrapText('ab ab', 50, measure, 5)).toEqual(['ab', 'ab']);
  });

  it('draws every shape as a closed path', () => {
    for (const s of SHAPES) {
      const d = shapePath(s, 100, 50, 10);
      expect(d.startsWith('M')).toBe(true);
      expect(d.trim().endsWith('Z')).toBe(true);
    }
  });

  it('resizes from a corner keeping the opposite corner fixed, also when rotated', () => {
    const el = { x: 0, y: 0, w: 100, h: 50, rotation: 0 };
    expect(resizeBox(el, { sx: 1, sy: 1 }, 20, 10)).toEqual({ x: 0, y: 0, w: 120, h: 60 });
    expect(resizeBox(el, { sx: -1, sy: 0 }, -10, 0)).toEqual({ x: -10, y: 0, w: 110, h: 50 });
    const keep = resizeBox(el, { sx: 1, sy: 1 }, 100, 0, { keepAspect: true });
    expect(keep.w / keep.h).toBeCloseTo(2);
    // Rotado 90°: arrastrar la manija derecha hacia abajo agranda el ancho.
    const rot = { x: 0, y: 0, w: 100, h: 50, rotation: 90 };
    const r = resizeBox(rot, { sx: 1, sy: 0 }, 0, 20);
    expect(r.w).toBeCloseTo(120);
    expect(r.h).toBeCloseTo(50);
    // El borde izquierdo (en local) no se mueve: el centro baja 10.
    expect(r.y + r.h / 2).toBeCloseTo(35);
  });

  it('side handles on an image change the crop instead of stretching it', () => {
    const el = image({ w: 200, h: 100, natW: 400, natH: 200, crop: { x: 0, y: 0, w: 0.5, h: 1 } });
    const next = resizeImageSide({ ...el, w: 100 }, { sx: 1, sy: 0 }, 50, 0);
    expect(next.w).toBeCloseTo(150);
    expect(next.crop.w).toBeCloseTo(0.75);
    // No pasa del borde de la foto.
    const max = resizeImageSide({ ...el, w: 100 }, { sx: 1, sy: 0 }, 500, 0);
    expect(max.crop.w).toBeCloseTo(1);
    expect(max.w).toBeCloseTo(200);
  });

  it('snaps edges and centers to the page and other elements', () => {
    const page = { w: 1000, h: 1000 };
    const s = snapMove({ x: 497, y: 100, w: 10, h: 10 }, [], page, 6);
    expect(s.dx).toBe(-2);
    expect(s.guides.some((g) => g.axis === 'x' && g.pos === 500)).toBe(true);
    const t = snapMove({ x: 104, y: 300, w: 50, h: 50 }, [{ x: 0, y: 0, w: 100, h: 100 }], page, 6);
    expect(t.dx).toBe(-4);
    expect(snapMove({ x: 300, y: 300, w: 10, h: 10 }, [], page, 6)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('aligns to the page (one) or the selection (many) and distributes evenly', () => {
    expect(alignDeltas([{ x: 10, y: 10, w: 100, h: 100 }], 'hcenter', { w: 1000, h: 1000 })).toEqual([{ x: 440, y: 0 }]);
    const many = alignDeltas(
      [
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 50, y: 30, w: 10, h: 10 },
      ],
      'top',
      { w: 1000, h: 1000 },
    );
    expect(many[1]).toEqual({ x: 0, y: -30 });
    const d = distributeDeltas(
      [
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 15, y: 0, w: 10, h: 10 },
        { x: 100, y: 0, w: 10, h: 10 },
      ],
      'x',
    );
    // Total 110, cajas 30: espacio 40 → la del medio va a x=50.
    expect(d[1].x).toBeCloseTo(35);
    expect(d[0].x).toBe(0);
    expect(d[2].x).toBe(0);
  });

  it('reorders layers keeping relative order and expands groups', () => {
    const els = ['a', 'b', 'c', 'd'].map((id) => ({ ...text(), id }) as DesignElement);
    expect(reorder(els, new Set(['a']), 'front').map((e) => e.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(reorder(els, new Set(['d']), 'back').map((e) => e.id)).toEqual(['d', 'a', 'b', 'c']);
    expect(reorder(els, new Set(['b']), 'forward').map((e) => e.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(reorder(els, new Set(['c']), 'backward').map((e) => e.id)).toEqual(['a', 'c', 'b', 'd']);
    const grouped = els.map((e) => (e.id === 'b' || e.id === 'c' ? { ...e, groupId: 'g1' } : e));
    expect([...expandGroups(grouped, ['b'])].sort()).toEqual(['b', 'c']);
  });

  it('computes bounds of rotated elements and rotation from the pointer', () => {
    const b = bounds({ x: 0, y: 0, w: 100, h: 20, rotation: 90 });
    expect(b.w).toBeCloseTo(20);
    expect(b.h).toBeCloseTo(100);
    expect(rotationFromPointer({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90);
    expect(rotationFromPointer({ x: 0, y: 0 }, { x: 10, y: 1 }, true)).toBe(90);
  });

  it('crops images as cover, zooms and clamps crops', () => {
    const c = coverCrop(400, 200, 100, 100);
    expect(c.w).toBeCloseTo(0.5);
    expect(c.x).toBeCloseTo(0.25);
    const z = zoomCrop({ x: 0, y: 0, w: 1, h: 1 }, 2);
    expect(z.w).toBeCloseTo(0.5);
    expect(z.x).toBeCloseTo(0.25);
    expect(clampCrop({ x: 0.9, y: -1, w: 0.5, h: 2 })).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
  });

  it('resizes a doc into another size, scaling and centering content', () => {
    const doc: DesignDoc = { v: 1, width: 100, height: 100, pages: [{ id: 'p1', background: { color: '#fff', image: null }, elements: [text({ x: 0, y: 0, w: 100, h: 20, size: 10 })] }] };
    const r = resizeDoc(doc, 200, 100);
    const el = r.pages[0].elements[0] as TextEl;
    expect(r.width).toBe(200);
    expect(el.x).toBeCloseTo(50);
    expect(el.size).toBeCloseTo(10);
    expect(el.id).not.toBe('e1');
  });

  it('builds grids as grouped frames inside the page and fills frames as cover', () => {
    const cells = makeGrid({ width: 1000, height: 500 }, '2x2');
    expect(cells).toHaveLength(4);
    expect(new Set(cells.map((c) => c.groupId)).size).toBe(1);
    for (const c of cells) expect(c.x + c.w).toBeLessThanOrEqual(1000);
    const filled = fillFrame(cells[0], { id: 'f_photo123', width: 400, height: 400 });
    expect(filled.src).toBe('f_photo123');
    expect(Math.max(filled.crop.w, filled.crop.h)).toBeCloseTo(1);
    const img = makeImage({ width: 1000, height: 1000 }, { id: 'f_big12345', width: 4000, height: 2000 });
    expect(img.w).toBeLessThanOrEqual(600);
  });

  it('lists text for search and the files a doc uses', () => {
    const doc: DesignDoc = {
      v: 1,
      width: 100,
      height: 100,
      pages: [{ id: 'p1', background: { color: '#fff', image: 'f_backgrnd1' }, elements: [text({ text: 'Big sale' }), image({ src: 'f_photo1234' })] }],
    };
    expect(docSearchText(doc)).toContain('Big sale');
    expect(docFileIds(doc).sort()).toEqual(['f_backgrnd1', 'f_photo1234']);
  });
});

describe('design templates and icons', () => {
  it('has 20 valid templates with unique ids in three languages', () => {
    expect(DESIGN_TEMPLATES).toHaveLength(20);
    expect(new Set(DESIGN_TEMPLATES.map((t) => t.id)).size).toBe(20);
    for (const t of DESIGN_TEMPLATES) {
      for (const lang of ['en', 'es', 'pt']) {
        const doc = templateDoc(t, lang);
        expect(parseDoc(doc), `${t.id} ${lang}`).not.toBeNull();
        // Sin imágenes de terceros: solo marcos vacíos.
        expect(docFileIds(doc)).toEqual([]);
        for (const p of doc.pages) for (const el of p.elements) if (el.type === 'icon') expect(DESIGN_ICONS[el.icon], el.icon).toBeTruthy();
      }
    }
    // Cubre todos los tamaños.
    expect(new Set(DESIGN_TEMPLATES.map((t) => t.preset)).size).toBe(6);
  });

  it('gives each template copy fresh ids', () => {
    const t = DESIGN_TEMPLATES[0];
    const a = templateDoc(t, 'en');
    const b = cloneDoc(a);
    expect(a.pages[0].id).not.toBe(b.pages[0].id);
    expect(a.pages[0].elements[0].id).not.toBe(b.pages[0].elements[0].id);
  });
});

// ---------- Permisos ----------

describe('design access', () => {
  const owner = { personId: 'u-owner', admin: false };
  const mate = { personId: 'u-mate', admin: false };
  const admin = { personId: 'u-admin', admin: true };
  const row = (over: Partial<{ created_by: string; workspace_access: string; is_template: number }> = {}) => ({ created_by: 'u-owner', workspace_access: 'none', is_template: 0, ...over });

  it('is private by default (admins included)', () => {
    expect(resolveAccess(owner, row(), null)).toBe('owner');
    expect(resolveAccess(mate, row(), null)).toBeNull();
    expect(resolveAccess(admin, row(), null)).toBeNull();
  });

  it('takes the highest of workspace access and the person role', () => {
    expect(resolveAccess(mate, row({ workspace_access: 'view' }), null)).toBe('view');
    expect(resolveAccess(mate, row({ workspace_access: 'view' }), 'edit')).toBe('edit');
    expect(resolveAccess(mate, row({ workspace_access: 'edit' }), 'view')).toBe('edit');
    expect(resolveAccess(mate, row(), 'view')).toBe('view');
  });

  it('lets everyone use workspace templates and admins edit them', () => {
    expect(resolveAccess(mate, row({ is_template: 1 }), null)).toBe('view');
    expect(resolveAccess(admin, row({ is_template: 1 }), null)).toBe('edit');
    expect(can('edit', 'delete', { admin: true, isTemplate: true })).toBe(true);
    expect(can('edit', 'delete', { admin: true, isTemplate: false })).toBe(false);
  });

  it('maps actions to access levels', () => {
    expect(can('view', 'comment')).toBe(true);
    expect(can('view', 'edit')).toBe(false);
    expect(can('view', 'share')).toBe(false);
    expect(can('edit', 'share')).toBe(true);
    expect(can('edit', 'delete')).toBe(false);
    expect(can('owner', 'delete')).toBe(true);
    expect(can(null, 'view')).toBe(false);
  });

  it('respects per-app access for the API and the scopes', () => {
    expect(appFromPath('/api/design/designs')).toBe('design');
    expect(appFromPath('/es/app/design/abc')).toBe('design');
    expect(SCOPE_APP.design).toBe('design');
    expect(scopesForApps(['design:read', 'crm:read'], ['crm'])).toEqual(['crm:read']);
    expect(scopesForApps(['design:read'], ['design'])).toEqual(['design:read']);
  });
});

// ---------- Export ----------

describe('design export', () => {
  it('names files safely', () => {
    expect(exportFileName('Summer sale!', 'png')).toBe('summer-sale.png');
    expect(exportFileName('Liquidación de verano', 'jpg', 2)).toBe('liquidacion-de-verano-2.jpg');
    expect(exportFileName('***', 'pdf')).toBe('design.pdf');
  });

  it('plans pages, scale and transparency', () => {
    const doc = { width: 1080, height: 1080, pages: [1, 2, 3] };
    expect(exportPlan(doc, { format: 'png', which: 'current', current: 1, scale: 2, transparent: true })).toMatchObject({ pages: [1], scale: 2, transparent: true, width: 2160 });
    expect(exportPlan(doc, { format: 'jpg', which: 'all', current: 0, scale: 1, transparent: true })).toMatchObject({ pages: [0, 1, 2], transparent: false });
    expect(exportPlan(doc, { format: 'pdf', which: 'all', current: 0, scale: 7 }).scale).toBe(1);
    const big = exportPlan({ width: 8000, height: 4000, pages: [1] }, { format: 'png', which: 'current', current: 0, scale: 3 });
    expect(big.width).toBeLessThanOrEqual(MAX_EXPORT_SIDE);
  });

  it('builds a multi-page PDF from JPEG pages', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x02, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
    const pdf = new TextDecoder('latin1').decode(buildImagePdf([{ jpeg, width: 2, height: 2 }, { jpeg, width: 2, height: 2 }], 'Deck'));
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toContain('/Count 2');
  });

  it('reads image type and size from the bytes, never from the name', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
    png.set([0, 0, 1, 0, 0, 0, 0, 0x80], 16);
    expect(sniffDesignImage(png)).toBe('image/png');
    expect(imageDimensions(png, 'image/png')).toEqual({ width: 256, height: 128 });
    expect(sniffDesignImage(new TextEncoder().encode('<svg onload="x"></svg>'))).toBeNull();
    const gif = new TextEncoder().encode('GIF89a\x0a\x00\x05\x00');
    expect(sniffDesignImage(gif)).toBe('image/gif');
    expect(imageDimensions(gif, 'image/gif')).toEqual({ width: 10, height: 5 });
  });
});

describe('design AI', () => {
  it('asks for short copy in the right language and cleans the answer', () => {
    expect(magicInstructions('write', 'es')).toContain('Spanish');
    expect(magicInstructions('shorter', 'es')).toContain('same language');
    expect(cleanOutput('"**Hola**"')).toBe('Hola');
  });
});

// ---------- Servidor (base real) ----------

const PNG = (() => {
  const b = new Uint8Array(32);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 2]);
  return b;
})();

describe('design server', () => {
  let uploads = '';
  const owner: DesignActor = { ws: 'dz-owner', personId: 'dz-owner', admin: true, name: 'Owner' };
  const mate: DesignActor = { ws: 'dz-owner', personId: 'dz-mate', admin: false, name: 'Mate' };
  const other: DesignActor = { ws: 'dz-other', personId: 'dz-other', admin: true, name: 'Other' };
  // Admin del mismo workspace que no creó el diseño.
  const boss: DesignActor = { ws: 'dz-owner', personId: 'dz-boss', admin: true, name: 'Boss' };

  beforeAll(async () => {
    uploads = await mkdtemp(path.join(os.tmpdir(), 'design-up-'));
    vi.stubEnv('UPLOADS_DIR', uploads);
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    await upsertUser({ id: 'dz-owner', email: 'dz-owner@test.local', name: 'Owner' });
    await upsertUser({ id: 'dz-mate', email: 'dz-mate@test.local', name: 'Mate' });
    await upsertUser({ id: 'dz-other', email: 'dz-other@test.local', name: 'Other' });
    await upsertUser({ id: 'dz-boss', email: 'dz-boss@test.local', name: 'Boss' });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it('creates blank and template designs, private to the creator', async () => {
    const blank = await createDesign(owner, { width: 1080, height: 1080, name: 'Blank' });
    const fromTpl = await createDesign(owner, { template: 'ig-sale', locale: 'es' });
    const d = await getDesign(owner, fromTpl);
    expect(d?.name).toBe('Liquidación de verano');
    expect(d?.doc.pages[0].elements.length).toBeGreaterThan(3);
    expect(await getDesign(mate, blank)).toBeNull();
    expect(await getDesign(other, blank)).toBeNull();
    await expect(createDesign(owner, { template: 'nope' })).rejects.toBeInstanceOf(DesignError);
    const mine = await listDesigns(owner, { view: 'mine' });
    expect(mine.map((x) => x.id)).toEqual(expect.arrayContaining([blank, fromTpl]));
  });

  it('saves with versions and rejects a stale save (409)', async () => {
    const id = await createDesign(owner, { width: 500, height: 500, name: 'Versioned' });
    const d = (await getDesign(owner, id))!;
    const next = { ...d.doc, pages: [{ ...d.doc.pages[0], elements: [text({ text: 'Launch day' })] }] };
    const ok = await saveDesignDoc(owner, id, next, d.version, 'data:image/jpeg;base64,AAAA');
    expect(ok.ok).toBe(true);
    const stale = await saveDesignDoc(owner, id, next, d.version);
    expect(stale.ok).toBe(false);
    await expect(saveDesignDoc(owner, id, { v: 1, width: 1, height: 1, pages: [] }, d.version + 1)).rejects.toBeInstanceOf(DesignError);
    expect((await searchDesigns(owner, 'Launch day')).some((r) => r.id === id)).toBe(true);
    expect((await listDesigns(owner, { view: 'mine', q: 'launch' }))[0]?.thumb).toBe('data:image/jpeg;base64,AAAA');
  });

  it('shares with the workspace and with people, and only editors can edit', async () => {
    const id = await createDesign(owner, { width: 500, height: 500, name: 'Shared' });
    await updateShare(owner, id, { workspaceAccess: 'view' }, new Set(['dz-mate']));
    expect((await getDesign(mate, id))?.access).toBe('view');
    await expect(renameDesign(mate, id, 'Nope')).rejects.toMatchObject({ code: 'forbidden' });
    const { added } = await updateShare(owner, id, { members: [{ userId: 'dz-mate', role: 'edit' }, { userId: 'dz-stranger', role: 'edit' }] }, new Set(['dz-mate']));
    expect(added).toEqual(['dz-mate']);
    expect((await getDesign(mate, id))?.access).toBe('edit');
    await renameDesign(mate, id, 'Renamed by mate');
    expect((await getShare(owner, id)).members.map((m) => m.userId)).toEqual(['dz-mate']);
    // Otro workspace nunca lo ve.
    expect(await getDesign(other, id)).toBeNull();
    expect((await listDesigns(mate, { view: 'shared' })).some((x) => x.id === id)).toBe(true);
    // Editar no deja borrar.
    await expect(trashDesign(mate, id)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('publishes a revocable, read-only public link', async () => {
    const id = await createDesign(owner, { width: 500, height: 500, name: 'Public' });
    await updateShare(owner, id, { link: 'on' }, new Set());
    const token = (await getShare(owner, id)).token!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect((await getPublicDesign(token))?.row.id).toBe(id);
    await updateShare(owner, id, { link: 'reset' }, new Set());
    const token2 = (await getShare(owner, id)).token!;
    expect(token2).not.toBe(token);
    expect(await getPublicDesign(token)).toBeNull();
    await updateShare(owner, id, { link: 'off' }, new Set());
    expect(await getPublicDesign(token2)).toBeNull();
  });

  it('lets editors share, but only the creator and admins turn the public link on or off', async () => {
    const id = await createDesign(mate, { width: 500, height: 500, name: 'Mate link' });
    await updateShare(mate, id, { members: [{ userId: 'dz-boss', role: 'edit' }] }, new Set(['dz-boss']));
    // Un editor que no es admin comparte con personas, pero no prende el link.
    const editor: DesignActor = { ws: 'dz-owner', personId: 'dz-editor', admin: false, name: 'Editor' };
    await updateShare(mate, id, { members: [{ userId: 'dz-boss', role: 'edit' }, { userId: 'dz-editor', role: 'edit' }] }, new Set(['dz-boss', 'dz-editor']));
    expect((await getShare(editor, id)).canShare).toBe(true);
    expect((await getShare(editor, id)).canLink).toBe(false);
    await updateShare(editor, id, { workspaceAccess: 'view' }, new Set());
    await expect(updateShare(editor, id, { link: 'on' }, new Set())).rejects.toMatchObject({ code: 'forbidden' });
    expect((await getShare(mate, id)).token).toBeNull();
    // El admin con edición sí; quien lo creó también.
    expect((await getShare(boss, id)).canLink).toBe(true);
    await updateShare(boss, id, { link: 'on' }, new Set());
    expect((await getShare(mate, id)).token).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    await updateShare(mate, id, { link: 'off' }, new Set());
    expect((await getShare(mate, id)).token).toBeNull();
  });

  it('serves an image to whoever uploaded it, to people who see a design using it, or to its public link', async () => {
    const file = await saveDesignFile(owner, { bytes: PNG, name: 'logo.png' });
    expect(file).toMatchObject({ width: 4, height: 2 });
    await expect(saveDesignFile(owner, { bytes: new TextEncoder().encode('<svg/>'), name: 'x.svg' })).rejects.toMatchObject({ code: 'file_type_not_allowed' });
    const row = (await getFileRow(file.id))!;
    expect(await canReadFile(row, { actor: owner, token: null })).toBe(true);
    // Otra persona del workspace (ni un admin) no la ve mientras ningún diseño que vea la use.
    expect(await canReadFile(row, { actor: mate, token: null })).toBe(false);
    expect(await canReadFile(row, { actor: boss, token: null })).toBe(false);
    expect(await canReadFile(row, { actor: other, token: null })).toBe(false);
    const id = await createDesign(owner, { width: 500, height: 500, name: 'With image' });
    const d = (await getDesign(owner, id))!;
    await saveDesignDoc(owner, id, { ...d.doc, pages: [{ ...d.doc.pages[0], elements: [image({ src: file.id })] }] }, d.version);
    // Privado: sigue sin verla.
    expect(await canReadFile(row, { actor: mate, token: null })).toBe(false);
    await updateShare(owner, id, { workspaceAccess: 'view' }, new Set());
    expect(await canReadFile(row, { actor: mate, token: null })).toBe(true);
    // En la papelera deja de contar.
    await trashDesign(owner, id);
    expect(await canReadFile(row, { actor: mate, token: null })).toBe(false);
    await restoreDesign(owner, id);
    await updateShare(owner, id, { link: 'on' }, new Set());
    const token = (await getShare(owner, id)).token!;
    expect(await canReadFile(row, { actor: null, token })).toBe(true);
    await updateShare(owner, id, { link: 'off' }, new Set());
    expect(await canReadFile(row, { actor: null, token })).toBe(false);
  });

  it('does not let a design pick up images the editor cannot see', async () => {
    const secret = await saveDesignFile(owner, { bytes: PNG, name: 'secret.png' });
    const mine = await createDesign(mate, { width: 500, height: 500, name: 'Thief' });
    const d = (await getDesign(mate, mine))!;
    const withSecret = { ...d.doc, pages: [{ ...d.doc.pages[0], elements: [image({ src: secret.id })] }] };
    await expect(saveDesignDoc(mate, mine, withSecret, d.version)).rejects.toMatchObject({ code: 'forbidden' });
    expect(await canReadFile((await getFileRow(secret.id))!, { actor: mate, token: null })).toBe(false);
    // Una imagen que ya usa un diseño compartido con edición se queda al guardar.
    const shared = await createDesign(owner, { width: 500, height: 500, name: 'Shared image' });
    const s0 = (await getDesign(owner, shared))!;
    const r0 = await saveDesignDoc(owner, shared, { ...s0.doc, pages: [{ ...s0.doc.pages[0], elements: [image({ src: secret.id })] }] }, s0.version);
    await updateShare(owner, shared, { members: [{ userId: 'dz-mate', role: 'edit' }] }, new Set(['dz-mate']));
    const s1 = (await getDesign(mate, shared))!;
    expect(r0.ok && s1.version === r0.version).toBe(true);
    expect((await saveDesignDoc(mate, shared, s1.doc, s1.version)).ok).toBe(true);
  });

  it('pins comments, threads replies and notifies only people with access', async () => {
    const id = await createDesign(owner, { width: 500, height: 500, name: 'Commented' });
    await updateShare(owner, id, { workspaceAccess: 'view' }, new Set());
    const page = (await getDesign(owner, id))!.doc.pages[0].id;
    const first = await addComment(mate, id, { pageId: page, x: 120, y: 80, body: 'Bigger logo?' });
    expect(first.notify).toEqual(['dz-owner']);
    const reply = await addComment(owner, id, { pageId: page, x: 0, y: 0, body: 'Done', parentId: first.comment.id });
    expect(reply.comment).toMatchObject({ x: 120, y: 80, parentId: first.comment.id });
    expect(reply.notify).toEqual(['dz-mate']);
    await updateComment(owner, id, first.comment.id, { resolved: true });
    const list = await listComments(owner, id);
    expect(list.find((c) => c.id === first.comment.id)?.resolved).toBe(true);
    // Sin acceso, ni ver ni comentar.
    await expect(addComment(other, id, { pageId: page, x: 1, y: 1, body: 'hi' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('tracks presence, stars, recents, folders and the trash', async () => {
    const id = await createDesign(owner, { width: 500, height: 500, name: 'Lifecycle' });
    await updateShare(owner, id, { workspaceAccess: 'edit' }, new Set());
    await heartbeat(mate, id, 'p');
    const seen = await heartbeat(owner, id, 'p');
    expect(seen.people.map((p) => p.userId)).toEqual(['dz-mate']);
    await setStar(mate, id, true);
    expect((await listDesigns(mate, { view: 'starred' })).map((x) => x.id)).toContain(id);
    await markOpened(mate, id);
    expect((await listDesigns(mate, { view: 'recent' })).map((x) => x.id)).toContain(id);
    const folder = await createFolder(owner, 'Campaigns');
    await moveDesign(owner, id, folder.id);
    expect((await listDesigns(owner, { view: 'folder', folderId: folder.id })).map((x) => x.id)).toEqual([id]);
    await expect(moveDesign(mate, id, null)).rejects.toMatchObject({ code: 'forbidden' });
    await deleteFolder(owner, folder.id);
    expect((await getDesign(owner, id))?.folderId).toBeNull();
    await trashDesign(owner, id);
    expect(await getDesign(mate, id)).toBeNull();
    expect((await listDesigns(owner, { view: 'trash' })).map((x) => x.id)).toContain(id);
    await restoreDesign(owner, id);
    expect(await getDesign(owner, id)).not.toBeNull();
    await trashDesign(owner, id);
    await purgeDesign(owner, id);
    const gone = await getDb().prepare('SELECT 1 AS x FROM design_designs WHERE id = ?').get(id);
    expect(gone).toBeUndefined();
  });

  it('saves workspace templates that everyone can use, only from admins who can edit', async () => {
    const src = await createDesign(owner, { template: 'deck-pitch', locale: 'en' });
    // Quien solo puede ver no publica el diseño como plantilla, ni siquiera un admin.
    await updateShare(owner, src, { members: [{ userId: 'dz-mate', role: 'view' }, { userId: 'dz-boss', role: 'view' }] }, new Set(['dz-mate', 'dz-boss']));
    await expect(saveAsTemplate(mate, src, 'Leak')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(saveAsTemplate(boss, src, 'Leak')).rejects.toMatchObject({ code: 'forbidden' });
    // Con edición pero sin ser admin, tampoco.
    await updateShare(owner, src, { members: [{ userId: 'dz-mate', role: 'edit' }] }, new Set(['dz-mate']));
    await expect(saveAsTemplate(mate, src, 'Leak')).rejects.toMatchObject({ code: 'forbidden' });
    expect((await listDesigns(mate, { view: 'templates' })).some((x) => x.name === 'Leak')).toBe(false);
    await saveDesignDoc(owner, src, (await getDesign(owner, src))!.doc, (await getDesign(owner, src))!.version, 'data:image/png;base64,AAAA');
    const tpl = await saveAsTemplate(owner, src, 'Team pitch');
    // La plantilla y las copias arrancan con la miniatura.
    expect((await getDesign(owner, tpl))?.thumb).toBe('data:image/png;base64,AAAA');
    expect((await listDesigns(mate, { view: 'templates' })).map((x) => x.id)).toContain(tpl);
    const copy = await createDesign(mate, { template: `w:${tpl}` });
    const d = await getDesign(mate, copy);
    expect(d?.access).toBe('owner');
    expect(d?.doc.pages).toHaveLength(3);
    expect(d?.thumb).toBe('data:image/png;base64,AAAA');
  });

  it('lets only admins edit the brand kit and drops invalid values', async () => {
    const logo = await saveDesignFile(owner, { bytes: PNG, name: 'brand.png', kind: 'logo' });
    const kit = await saveBrandKit(owner, { colors: ['#00A5C8', 'red', '#00a5c8', '#111111'], fonts: { heading: 'montserrat', body: 'comic-sans' }, logos: [logo.id, 'f_missing123'] });
    expect(kit.colors).toEqual(['#00a5c8', '#111111']);
    expect(kit.fonts).toEqual({ heading: 'montserrat', subheading: null, body: null });
    expect(kit.logos.map((l) => l.id)).toEqual([logo.id]);
    await expect(saveBrandKit(mate, { colors: [], fonts: {}, logos: [] })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await getBrandKit('dz-owner')).colors).toHaveLength(2);
  });

  it('starts every new blank design with one valid page', async () => {
    const id = await createDesign(owner, { width: 99999, height: 3, name: 'Clamp' });
    const d = (await getDesign(owner, id))!;
    expect(d.width).toBe(8000);
    expect(d.height).toBe(16);
    expect(parseDoc(d.doc)).not.toBeNull();
    expect(blankDoc(10, 10).pages).toHaveLength(1);
  });
});

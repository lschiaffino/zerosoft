'use client';

/**
 * Acciones del editor que no son componentes: exportar los frames a PDF,
 * agrupar stickies con IA, texto a diagrama y wireframe a código.
 */
import { buildImagePdf, jpegSize, type PdfImagePage } from '@/lib/pdf-images';
import { orderFrames, type FrameLike } from '@/lib/board-present';
import { clusterLayout } from '@/lib/board-cluster';
import { elementText, isSticky, type SceneEl } from '@/lib/board-stickies';
import { wrap } from '@/lib/board-templates';
import type { CanvasApi } from './ExcalidrawCanvas';

export type ActionResult = { ok: true; count?: number } | { ok: false; error: string };

/** Nombre de archivo seguro a partir del nombre de la pizarra. */
export function fileName(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 80) || 'board';
  return `${base}.${ext}`;
}

function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Un PDF con un frame por página, en orden de lectura. Sin frames: `no_frames`. */
export async function exportFramesPdf(api: CanvasApi, boardName: string): Promise<ActionResult> {
  const frames = orderFrames<FrameLike>(api.getSceneElements());
  if (!frames.length) return { ok: false, error: 'no_frames' };
  const { exportFrameJpeg } = await import('./ExcalidrawCanvas');
  const pages: PdfImagePage[] = [];
  try {
    for (const f of frames) {
      const jpeg = await exportFrameJpeg(api, f);
      const size = jpegSize(jpeg) ?? { width: Math.round(f.width), height: Math.round(f.height) };
      pages.push({ jpeg, ...size });
    }
  } catch {
    return { ok: false, error: 'export_failed' };
  }
  download(buildImagePdf(pages, boardName), fileName(boardName, 'pdf'), 'application/pdf');
  return { ok: true, count: pages.length };
}

async function aiPost(boardId: string, body: Record<string, unknown>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const res = await fetch(`/api/boards/${boardId}/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, error: 'network' };
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false, error: typeof data.error === 'string' ? data.error : 'ai_failed' };
  return { ok: true, data };
}

/** Texto a diagrama: el Mermaid que escribió la IA (lo dibuja el diálogo de Excalidraw). */
export async function textToDiagram(boardId: string, prompt: string): Promise<{ ok: true; mermaid: string } | { ok: false; error: string }> {
  const r = await aiPost(boardId, { kind: 'diagram', prompt });
  if (!r.ok) return r;
  return typeof r.data.mermaid === 'string' ? { ok: true, mermaid: r.data.mermaid } : { ok: false, error: 'ai_bad_output' };
}

/** Wireframe a código: la imagen del frame y sus textos → HTML. */
export async function wireframeToCode(api: CanvasApi, boardId: string, frame: unknown, children: readonly unknown[]): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  const { exportFramePngDataUrl } = await import('./ExcalidrawCanvas');
  const image = await exportFramePngDataUrl(api, frame);
  const texts = (children as SceneEl[])
    .filter((e) => e.type === 'text' && typeof (e as { text?: unknown }).text === 'string')
    .map((e) => String((e as { text?: string }).text).slice(0, 500))
    .slice(0, 200);
  const r = await aiPost(boardId, { kind: 'code', image, texts });
  if (!r.ok) return r;
  return typeof r.data.html === 'string' ? { ok: true, html: r.data.html } : { ok: false, error: 'ai_bad_output' };
}

/**
 * Agrupa los stickies (los seleccionados, o todos si no hay selección) por
 * tema con IA y los acomoda en columnas con un título cada una y el resumen
 * arriba. Se puede deshacer con Cmd+Z.
 */
export async function clusterStickies(api: CanvasApi, boardId: string, labels: { other: string; summary: string }): Promise<ActionResult> {
  const all = api.getSceneElements() as SceneEl[];
  const byId = new Map(all.map((e) => [e.id, e]));
  const selected = new Set(Object.keys((api.getAppState().selectedElementIds as Record<string, boolean>) ?? {}));
  const stickies = all.filter((e) => isSticky(e) && (selected.size === 0 || selected.has(e.id)));
  const notes = stickies.map((e) => ({ id: e.id, text: elementText(e, byId).slice(0, 2000) })).filter((n) => n.text.trim());
  if (notes.length < 2) return { ok: false, error: 'no_notes' };
  if (notes.length > 200) return { ok: false, error: 'too_many_notes' };
  const r = await aiPost(boardId, { kind: 'cluster', notes, otherTitle: labels.other });
  if (!r.ok) return r;
  const groups = (r.data.groups as Array<{ title: string; ids: string[] }> | undefined) ?? [];
  const summary = typeof r.data.summary === 'string' ? r.data.summary : '';
  const boxes = stickies.map((e) => ({ id: e.id, x: Number(e.x ?? 0), y: Number(e.y ?? 0), width: Number(e.width ?? 200), height: Number(e.height ?? 150) }));
  const layout = clusterLayout(groups, boxes);
  const { skeletonsToElements, UNDOABLE } = await import('./ExcalidrawCanvas');
  // Mover cada sticky con su texto ligado (misma diferencia).
  const delta = new Map<string, { dx: number; dy: number }>();
  for (const s of stickies) {
    const to = layout.moves.get(s.id);
    if (!to) continue;
    const d = { dx: to.x - Number(s.x ?? 0), dy: to.y - Number(s.y ?? 0) };
    delta.set(s.id, d);
    for (const b of (s.boundElements as Array<{ id: string; type: string }> | null | undefined) ?? []) if (b.type === 'text') delta.set(b.id, d);
  }
  const moved = (api.getSceneElementsIncludingDeleted() as Array<SceneEl & { version?: number }>).map((e) => {
    const d = delta.get(e.id);
    if (!d) return e;
    return { ...e, x: Number(e.x ?? 0) + d.dx, y: Number(e.y ?? 0) + d.dy, version: (e.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() };
  });
  const added = skeletonsToElements([
    ...layout.headers.map((h) => ({ type: 'text', x: h.x, y: h.y, text: h.title, fontSize: 24 })),
    ...(summary ? [{ type: 'text', x: layout.summaryAt.x, y: layout.summaryAt.y, text: wrap(`${labels.summary}: ${summary}`.slice(0, 600), 70), fontSize: 16 }] : []),
  ]);
  api.updateScene({ elements: [...moved, ...added], captureUpdate: UNDOABLE });
  return { ok: true, count: groups.length };
}

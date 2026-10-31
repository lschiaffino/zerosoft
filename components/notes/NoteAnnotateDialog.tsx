'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DocsBlock } from '@/lib/docs-types';
import { noteFileHref } from '@/lib/notes-types';
import { uploadToNote } from './NoteCapture';
import { NotesModal } from './NotesModal';

type Tool = 'pen' | 'highlight' | 'box' | 'text';
const COLORS = ['#d92d20', '#1570ef', '#079455', '#101828'];
const MAX_PDF_PAGES = 40;

/** Trazo en coordenadas de la página (0 a 1), para que no dependa del tamaño en pantalla. */
type Mark =
  | { kind: 'pen' | 'highlight'; page: number; color: string; points: Array<[number, number]> }
  | { kind: 'box'; page: number; color: string; a: [number, number]; b: [number, number] }
  | { kind: 'text'; page: number; color: string; at: [number, number]; text: string };

export function annotatableBlocks(blocks: DocsBlock[]): DocsBlock[] {
  return blocks.filter((b) => b.url && (b.type === 'image' || b.type === 'pdf' || (b.type === 'file' && b.mime === 'application/pdf')));
}

export function drawMarks(ctx: CanvasRenderingContext2D, marks: Mark[], w: number, h: number): void {
  const scale = w / 800;
  for (const m of marks) {
    ctx.save();
    ctx.strokeStyle = m.color;
    ctx.fillStyle = m.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if ('points' in m) {
      ctx.lineWidth = (m.kind === 'pen' ? 2.5 : 18) * scale;
      if (m.kind === 'highlight') ctx.globalAlpha = 0.3;
      ctx.beginPath();
      m.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
      ctx.stroke();
    } else if ('a' in m) {
      ctx.lineWidth = 2.5 * scale;
      ctx.strokeRect(m.a[0] * w, m.a[1] * h, (m.b[0] - m.a[0]) * w, (m.b[1] - m.a[1]) * h);
    } else {
      ctx.font = `${Math.round(18 * scale)}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(m.text, m.at[0] * w, m.at[1] * h);
    }
    ctx.restore();
  }
}

function toBlob(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

/** Página sobre la que se dibuja: fondo (imagen o PDF ya dibujado) y capa de trazos. */
function AnnotatePage({
  page,
  background,
  marks,
  tool,
  color,
  onAdd,
  onAskText,
}: {
  page: number;
  background: HTMLCanvasElement;
  marks: Mark[];
  tool: Tool;
  color: string;
  onAdd: (m: Mark) => void;
  onAskText: (page: number, at: [number, number]) => void;
}) {
  const t = useTranslations('notes.annotate');
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef<Mark | null>(null);

  const redraw = () => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(background, 0, 0);
    drawMarks(ctx, live.current ? [...marks, live.current] : marks, c.width, c.height);
  };
  useEffect(redraw);

  const point = (e: React.PointerEvent): [number, number] => {
    const box = ref.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), Math.min(1, Math.max(0, (e.clientY - box.top) / box.height))];
  };

  return (
    <canvas
      ref={ref}
      className="note-annotate-canvas"
      width={background.width}
      height={background.height}
      data-testid="annotate-canvas"
      role="img"
      aria-label={t('pageLabel', { page: page + 1 })}
      onPointerDown={(e) => {
        const p = point(e);
        if (tool === 'text') {
          onAskText(page, p);
          return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        live.current = tool === 'box' ? { kind: 'box', page, color, a: p, b: p } : { kind: tool, page, color, points: [p] };
      }}
      onPointerMove={(e) => {
        const m = live.current;
        if (!m) return;
        if (m.kind === 'box') m.b = point(e);
        else if (m.kind === 'pen' || m.kind === 'highlight') m.points.push(point(e));
        redraw();
      }}
      onPointerUp={() => {
        if (live.current) onAdd(live.current);
        live.current = null;
      }}
    />
  );
}

/**
 * Anotar una imagen o un PDF de la nota: lápiz, resaltador, recuadro y texto.
 * Guardar agrega una copia anotada a la nota y deja el original como estaba.
 */
export default function NoteAnnotateDialog({
  noteId,
  blocks,
  onInsert,
  onClose,
  onError,
}: {
  noteId: string;
  blocks: DocsBlock[];
  onInsert: (blocks: DocsBlock[]) => void;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('notes.annotate');
  const [target, setTarget] = useState<DocsBlock | null>(blocks.length === 1 ? blocks[0] : null);
  const [pages, setPages] = useState<HTMLCanvasElement[] | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [textAt, setTextAt] = useState<{ page: number; at: [number, number] } | null>(null);
  const [text, setText] = useState('');
  const pdfBytes = useRef<ArrayBuffer | null>(null);
  const isPdf = target ? target.type !== 'image' : false;

  useEffect(() => {
    if (!target) return;
    let live = true;
    setPages(null);
    setMarks([]);
    setLoadError(false);
    (async () => {
      const res = await fetch(noteFileHref(noteId, target.id));
      if (!res.ok) throw new Error('fetch');
      const buf = await res.arrayBuffer();
      if (target.type === 'image') {
        const url = URL.createObjectURL(new Blob([buf], { type: target.mime || 'image/png' }));
        const img = new Image();
        await new Promise<void>((ok, bad) => {
          img.onload = () => ok();
          img.onerror = () => bad(new Error('image'));
          img.src = url;
        });
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d')?.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        if (live) setPages([c]);
        return;
      }
      pdfBytes.current = buf.slice(0);
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
      const out: HTMLCanvasElement[] = [];
      for (let i = 1; i <= Math.min(doc.numPages, MAX_PDF_PAGES); i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const c = document.createElement('canvas');
        c.width = Math.floor(viewport.width);
        c.height = Math.floor(viewport.height);
        await page.render({ canvas: c, viewport }).promise;
        out.push(c);
      }
      if (live) setPages(out);
    })().catch(() => {
      if (live) setLoadError(true);
    });
    return () => {
      live = false;
    };
  }, [noteId, target]);

  async function save() {
    if (!target || !pages || busy) return;
    setBusy(true);
    try {
      const base = (target.name || 'file').replace(/\.[^.]+$/, '');
      let file: File;
      if (isPdf) {
        const { PDFDocument } = await import('pdf-lib');
        const pdf = await PDFDocument.load(pdfBytes.current!, { ignoreEncryption: true });
        for (let i = 0; i < pages.length; i++) {
          const own = marks.filter((m) => m.page === i);
          if (!own.length) continue;
          const layer = document.createElement('canvas');
          layer.width = pages[i].width;
          layer.height = pages[i].height;
          const ctx = layer.getContext('2d');
          if (!ctx) throw new Error('canvas');
          drawMarks(ctx, own, layer.width, layer.height);
          const blob = await toBlob(layer);
          if (!blob) throw new Error('blob');
          const image = await pdf.embedPng(await blob.arrayBuffer());
          const page = pdf.getPage(i);
          const { width, height } = page.getSize();
          page.drawImage(image, { x: 0, y: 0, width, height });
        }
        file = new File([(await pdf.save()) as BlobPart], `${base} (${t('suffix')}).pdf`, { type: 'application/pdf' });
      } else {
        const c = document.createElement('canvas');
        c.width = pages[0].width;
        c.height = pages[0].height;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('canvas');
        ctx.drawImage(pages[0], 0, 0);
        drawMarks(ctx, marks, c.width, c.height);
        const blob = await toBlob(c);
        if (!blob) throw new Error('blob');
        file = new File([blob], `${base} (${t('suffix')}).png`, { type: 'image/png' });
      }
      const block = await uploadToNote(noteId, file, isPdf ? undefined : 'image');
      if (!block) throw new Error('upload');
      onInsert([isPdf ? { ...block, type: 'pdf' } : block, { id: crypto.randomUUID(), type: 'paragraph', content: '' }]);
      onClose();
    } catch {
      onError(t('saveError'));
    } finally {
      setBusy(false);
    }
  }

  function commitText() {
    if (textAt && text.trim()) setMarks((m) => [...m, { kind: 'text', page: textAt.page, color, at: textAt.at, text: text.trim() }]);
    setTextAt(null);
    setText('');
  }

  return (
    <NotesModal
      title={t('title')}
      onClose={onClose}
      closeLabel={t('close')}
      wide
      className="note-annotate"
      footer={
        target && (
          <>
            <button type="button" className="btn" disabled={!marks.length} onClick={() => setMarks((m) => m.slice(0, -1))}>
              {t('undo')}
            </button>
            <button type="button" className="btn btn-primary" disabled={!marks.length || !pages} aria-busy={busy} onClick={() => void save()}>
              {t('save')}
            </button>
          </>
        )
      }
    >
      {!target ? (
        <ul className="note-annotate-pick">
          {blocks.map((b) => (
            <li key={b.id}>
              <button type="button" className="btn btn-block" onClick={() => setTarget(b)}>
                {b.name || t('untitledFile')}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="note-annotate-tools" role="toolbar" aria-label={t('tools')}>
            {(['pen', 'highlight', 'box', 'text'] as const).map((k) => (
              <button key={k} type="button" className="btn btn-sm" aria-pressed={tool === k} onClick={() => setTool(k)}>
                {t(`tool.${k}`)}
              </button>
            ))}
            <span className="note-annotate-colors">
              {COLORS.map((c) => (
                <button key={c} type="button" className="note-annotate-color" style={{ background: c }} aria-pressed={color === c} aria-label={t('color')} onClick={() => setColor(c)} />
              ))}
            </span>
          </div>
          {textAt && (
            <div className="notes-pop-row note-annotate-text">
              <input
                className="input"
                autoFocus
                value={text}
                maxLength={200}
                aria-label={t('textLabel')}
                placeholder={t('textLabel')}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitText();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setTextAt(null);
                    setText('');
                  }
                }}
              />
              <button type="button" className="btn btn-sm" onClick={commitText}>
                {t('addText')}
              </button>
            </div>
          )}
          {loadError ? (
            <p className="ui-error" role="alert">
              {t('loadError')}
            </p>
          ) : !pages ? (
            <p className="ui-help" role="status">{t('loading')}</p>
          ) : (
            <div className="note-annotate-pages">
              {pages.map((bg, i) => (
                <AnnotatePage
                  key={i}
                  page={i}
                  background={bg}
                  marks={marks.filter((m) => m.page === i)}
                  tool={tool}
                  color={color}
                  onAdd={(m) => setMarks((cur) => [...cur, m])}
                  onAskText={(page, at) => setTextAt({ page, at })}
                />
              ))}
            </div>
          )}
        </>
      )}
    </NotesModal>
  );
}

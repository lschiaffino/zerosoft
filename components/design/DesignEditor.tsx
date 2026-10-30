'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { BrandKit, DesignComment, DesignFileDto, DesignFull, DesignPresence } from '@/lib/design';
import { fillFrame, makeImage, makeLine, makeShape, makeText } from '@/lib/design-factories';
import { resizeDoc, type DesignElement, type ImageEl, type Point } from '@/lib/design-model';
import { loadDocFonts } from './fonts';
import { resetTextLayout } from './textLayout';
import { thumbnail } from './exporter';
import { shrinkForUpload } from './shrink';
import { useEditor } from './useEditor';
import Stage, { type Pin, type StageView } from './Stage';
import Toolbar from './Toolbar';
import SidePanel, { type PanelTab } from './SidePanel';
import CommentsPanel, { type Draft } from './Comments';
import Present from './Present';
import PageSvg, { fileHref } from './PageSvg';
import { ExportDialog, MagicDialog, ResizeDialog, ShareDialog, ShortcutsDialog } from './Dialogs';
import { G, Glyph, Modal, notifyDesignChanged, Popover } from './ui';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error' | 'conflict';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export default function DesignEditor({ initial, canEditBrand, commentId }: { initial: DesignFull; canEditBrand: boolean; commentId: string | null }) {
  const t = useTranslations('design.editor');
  const tp = useTranslations('design.panel');
  const router = useRouter();
  const readOnly = initial.access === 'view';
  const ed = useEditor(initial.doc);
  const [name, setName] = useState(initial.name);
  const [nameDraft, setNameDraft] = useState(initial.name);
  const versionRef = useRef(initial.version);
  const savedRev = useRef(0);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [conflictBy, setConflictBy] = useState('');
  const [view, setView] = useState<StageView>({ zoom: 0.3, panX: 0, panY: 0 });
  const [tool, setTool] = useState<'select' | 'comment'>('select');
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [cropId, setCropId] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>('elements');
  const [panelOpen, setPanelOpen] = useState(true);
  const [uploads, setUploads] = useState<DesignFileDto[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [brand, setBrand] = useState<BrandKit | null>(null);
  const [comments, setComments] = useState<DesignComment[]>([]);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(Boolean(commentId));
  const [activeComment, setActiveComment] = useState<string | null>(commentId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [people, setPeople] = useState<DesignPresence[]>([]);
  const [dialog, setDialog] = useState<null | 'share' | 'export' | 'resize' | 'shortcuts' | 'picker' | 'magic' | 'template'>(null);
  const [picker, setPicker] = useState<null | { kind: 'background' } | { kind: 'fill'; id: string }>(null);
  const [magicSource, setMagicSource] = useState<{ text: string | null; id: string | null }>({ text: null, id: null });
  const [presenting, setPresenting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [starred, setStarred] = useState(initial.starred);
  const viewportBox = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const manualView = useRef(false);
  const setViewManual = useCallback((v: StageView) => {
    manualView.current = true;
    setView(v);
  }, []);
  const centerRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 3500);
  }, []);

  // ---------- Vista ----------

  const fit = useCallback(() => {
    const el = centerRef.current?.querySelector('.dz-stage') as HTMLElement | null;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    viewportBox.current = { w, h };
    const pad = w < 600 ? 24 : 64;
    const zoom = Math.max(0.02, Math.min((w - pad * 2) / ed.doc.width, (h - pad * 2) / ed.doc.height, 4));
    manualView.current = false;
    setView({ zoom, panX: (w - ed.doc.width * zoom) / 2, panY: (h - ed.doc.height * zoom) / 2 });
  }, [ed.doc.width, ed.doc.height]);

  useEffect(() => {
    fit();
    const ro = new ResizeObserver(() => {
      if (!manualView.current) fit();
    });
    const el = centerRef.current?.querySelector('.dz-stage');
    if (el) ro.observe(el);
    return () => ro.disconnect();
    // Solo al montar y si cambia el tamaño del diseño.
  }, [fit]);

  const zoomBy = useCallback((k: number) => {
    manualView.current = true;
    setView((v) => {
      const { w, h } = viewportBox.current;
      const zoom = Math.min(8, Math.max(0.02, v.zoom * k));
      const r = zoom / v.zoom;
      return { zoom, panX: w / 2 - (w / 2 - v.panX) * r, panY: h / 2 - (h / 2 - v.panY) * r };
    });
  }, []);

  // Al cargar las fuentes cambian las medidas del texto: se vuelve a medir.
  const [, setFontsTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadDocFonts(ed.doc).then(() => {
      if (!alive) return;
      resetTextLayout();
      setFontsTick((n) => n + 1);
    });
    return () => {
      alive = false;
    };
    // Las fuentes del diseño al abrir; las nuevas se cargan al usarlas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Guardado automático ----------

  const latestRev = useRef(ed.rev);
  latestRev.current = ed.rev;

  const saving = useRef(false);
  const lastThumbAt = useRef(0);
  const save = useCallback(async () => {
    if (saving.current || readOnly) return;
    const rev = ed.rev;
    if (rev === savedRev.current) return;
    saving.current = true;
    setSaveState('saving');
    const doc = ed.docRef.current;
    let thumb: string | null | undefined;
    if (Date.now() - lastThumbAt.current > 4000) {
      thumb = await thumbnail(doc);
      lastThumbAt.current = Date.now();
    }
    try {
      const r = await fetch(`/api/design/designs/${initial.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ doc, version: versionRef.current, ...(thumb ? { thumb } : {}) }),
      });
      if (r.status === 409) {
        const d = (await r.json().catch(() => ({}))) as { updatedByName?: string };
        setConflictBy(d.updatedByName ?? '');
        setSaveState('conflict');
        return;
      }
      if (!r.ok) throw new Error('save');
      const d = (await r.json()) as { version: number };
      versionRef.current = d.version;
      savedRev.current = rev;
      setSaveState(rev === ed.rev ? 'saved' : 'dirty');
      if (thumb) notifyDesignChanged();
    } catch {
      setSaveState('error');
    } finally {
      saving.current = false;
    }
  }, [ed.rev, ed.docRef, initial.id, readOnly]);

  // Un diseño sin miniatura (recién creado desde un tamaño o una plantilla) la arma al abrir.
  useEffect(() => {
    if (readOnly || initial.thumb) return;
    let gone = false;
    const timer = window.setTimeout(async () => {
      const thumb = await thumbnail(ed.docRef.current);
      if (gone || !thumb) return;
      const r = await fetch(`/api/design/designs/${initial.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ thumb }) }).catch(() => null);
      if (r?.ok) {
        lastThumbAt.current = Date.now();
        notifyDesignChanged();
      }
    }, 1200);
    return () => {
      gone = true;
      window.clearTimeout(timer);
    };
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (readOnly || saveState === 'conflict') return;
    if (ed.rev === savedRev.current) return;
    if (ed.inGesture()) return;
    setSaveState((s) => (s === 'saving' ? s : 'dirty'));
    const id = window.setTimeout(() => void save(), 800);
    return () => window.clearTimeout(id);
  }, [ed.rev, save, readOnly, saveState, ed]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (ed.rev !== savedRev.current && !readOnly) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [ed.rev, readOnly]);

  const loadLatest = useCallback(async () => {
    const r = await fetch(`/api/design/designs/${initial.id}`).catch(() => null);
    if (!r?.ok) return false;
    const d = (await r.json()) as { design: DesignFull };
    versionRef.current = d.design.version;
    ed.replaceFromRemote(d.design.doc);
    savedRev.current = latestRev.current;
    setSaveState('saved');
    return true;
  }, [initial.id, ed]);

  const keepMine = useCallback(async () => {
    const r = await fetch(`/api/design/designs/${initial.id}`).catch(() => null);
    if (!r?.ok) return;
    const d = (await r.json()) as { design: DesignFull };
    versionRef.current = d.design.version;
    savedRev.current = -1;
    setSaveState('dirty');
  }, [initial.id]);

  // ---------- Presencia y cambios de otros ----------

  useEffect(() => {
    let alive = true;
    const beat = async () => {
      const r = await fetch(`/api/design/designs/${initial.id}/presence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId: ed.docRef.current.pages[ed.pageRef.current]?.id ?? '' }),
      }).catch(() => null);
      if (!alive || !r?.ok) return;
      const d = (await r.json()) as { people: DesignPresence[]; version: number };
      setPeople(d.people);
      // Otra persona guardó: si no hay cambios propios sin guardar, se trae su versión.
      const clean = latestRev.current === savedRev.current && !saving.current && !ed.inGesture();
      if (d.version > versionRef.current && clean) {
        if (await loadLatest()) showToast(t('updatedByOther'));
      }
    };
    void beat();
    const id = window.setInterval(() => void beat(), 4000);
    return () => {
      alive = false;
      window.clearInterval(id);
      void fetch(`/api/design/designs/${initial.id}/presence`, { method: 'DELETE', keepalive: true }).catch(() => undefined);
    };
    // El latido corre todo el tiempo que el editor está abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id]);

  // ---------- Datos de los paneles ----------

  const loadUploads = useCallback(() => {
    fetch('/api/design/files')
      .then((r) => (r.ok ? (r.json() as Promise<{ files: DesignFileDto[] }>) : Promise.reject(new Error('load'))))
      .then((d) => setUploads(d.files))
      .catch(() => setUploads([]));
  }, []);
  useEffect(() => {
    if (readOnly) return;
    loadUploads();
    fetch('/api/design/brand')
      .then((r) => (r.ok ? (r.json() as Promise<{ brand: BrandKit }>) : null))
      .then((d) => d && setBrand(d.brand))
      .catch(() => undefined);
  }, [loadUploads, readOnly]);

  const loadComments = useCallback(() => {
    fetch(`/api/design/designs/${initial.id}/comments`)
      .then((r) => (r.ok ? (r.json() as Promise<{ comments: DesignComment[] }>) : Promise.reject(new Error('load'))))
      .then((d) => {
        setComments(d.comments);
        setCommentsError(null);
      })
      .catch(() => setCommentsError(t('commentsError')));
  }, [initial.id, t]);
  useEffect(() => {
    loadComments();
  }, [loadComments]);
  // El aviso de un comentario abre su página.
  useEffect(() => {
    if (!commentId || !comments.length) return;
    const c = comments.find((x) => x.id === commentId);
    if (c) {
      const i = ed.doc.pages.findIndex((p) => p.id === c.pageId);
      if (i >= 0 && i !== ed.pageIndex) ed.setPageIndex(i);
    }
    // Solo cuando llegan los comentarios.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentId, comments.length]);

  // ---------- Imágenes ----------

  const upload = useCallback(
    async (files: File[]): Promise<DesignFileDto[]> => {
      setUploading(true);
      setUploadError(null);
      const out: DesignFileDto[] = [];
      for (const f of files.slice(0, 10)) {
        const form = new FormData();
        form.append('file', await shrinkForUpload(f));
        const r = await fetch('/api/design/files', { method: 'POST', body: form }).catch(() => null);
        if (r?.ok) out.push(((await r.json()) as { file: DesignFileDto }).file);
        else {
          const code = r ? (((await r.json().catch(() => ({}))) as { error?: string }).error ?? '') : 'network';
          setUploadError(code === 'too_large' ? t('uploadTooLarge') : code === 'file_type_not_allowed' ? t('uploadType') : t('uploadError'));
        }
      }
      setUploading(false);
      if (out.length) setUploads((cur) => [...out, ...(cur ?? [])]);
      return out;
    },
    [t],
  );

  const placeFile = useCallback(
    (file: { id: string; width: number; height: number }, at?: Point, frameId?: string | null) => {
      const page = ed.docRef.current.pages[ed.pageRef.current];
      const frame = frameId ? (page.elements.find((e) => e.id === frameId) as ImageEl | undefined) : undefined;
      if (frame && frame.type === 'image' && !frame.locked) {
        ed.updateElements([frame.id], (el) => fillFrame(el as ImageEl, file));
        ed.setSelected([frame.id]);
        return;
      }
      // Con un marco elegido, la imagen lo llena.
      const sel = ed.selectedElements();
      if (!at && sel.length === 1 && sel[0].type === 'image' && !sel[0].src && !sel[0].locked) {
        ed.updateElements([sel[0].id], (el) => fillFrame(el as ImageEl, file));
        return;
      }
      ed.addElements([makeImage({ width: ed.docRef.current.width, height: ed.docRef.current.height }, file, at)]);
    },
    [ed],
  );

  const onPickFile = (f: DesignFileDto) => {
    if (picker?.kind === 'background') ed.setBackground({ image: f.id });
    else if (picker?.kind === 'fill') {
      ed.updateElements([picker.id], (el) => (el.type === 'image' ? fillFrame(el, f) : el));
    }
    setPicker(null);
    setDialog(null);
  };

  // ---------- Comentarios ----------

  const roots = comments.filter((c) => !c.parentId);
  const pins: Pin[] = useMemo(
    () =>
      [
        ...roots.filter((c) => c.pageId === ed.page.id && (!c.resolved || showResolved)).map((c) => ({ id: c.id, n: roots.findIndex((x) => x.id === c.id) + 1, x: c.x, y: c.y, active: c.id === activeComment })),
        ...(draft && draft.pageId === ed.page.id ? [{ id: 'draft', n: roots.length + 1, x: draft.x, y: draft.y, active: true }] : []),
      ],
    [roots, ed.page.id, showResolved, activeComment, draft],
  );

  // ---------- Acciones ----------

  const addQuick = useCallback(
    (kind: 'text' | 'rect' | 'circle' | 'line') => {
      const size = { width: ed.docRef.current.width, height: ed.docRef.current.height };
      const el: DesignElement =
        kind === 'text'
          ? makeText(size, 'heading', { text: tp('textDefault.heading'), font: brand?.fonts.heading ?? null })
          : kind === 'rect'
            ? makeShape(size, 'rect')
            : kind === 'circle'
              ? makeShape(size, 'ellipse')
              : makeLine(size, 'solid');
      ed.addElements([el]);
    },
    [ed, tp, brand],
  );

  const rename = async () => {
    const v = nameDraft.trim();
    if (!v || v === name) {
      setNameDraft(name);
      return;
    }
    const r = await fetch(`/api/design/designs/${initial.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: v }) }).catch(() => null);
    if (r?.ok) {
      setName(v);
      notifyDesignChanged();
    } else {
      setNameDraft(name);
      showToast(t('renameError'));
    }
  };

  const duplicateDesign = async () => {
    const r = await fetch(`/api/design/designs/${initial.id}/duplicate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: t('copyName', { name }) }) }).catch(() => null);
    if (!r?.ok) return showToast(t('actionError'));
    const d = (await r.json()) as { design: { id: string } };
    notifyDesignChanged();
    router.push(`/app/design/${d.design.id}`);
  };

  const saveTemplate = async () => {
    const r = await fetch(`/api/design/designs/${initial.id}/template`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => null);
    showToast(r?.ok ? t('templateSaved') : t('actionError'));
  };

  const trash = async () => {
    const r = await fetch(`/api/design/designs/${initial.id}`, { method: 'DELETE' }).catch(() => null);
    if (!r?.ok) return showToast(t('actionError'));
    notifyDesignChanged();
    router.push('/app/design?view=trash');
  };

  const toggleStar = async () => {
    const next = !starred;
    setStarred(next);
    const r = await fetch(`/api/design/designs/${initial.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ starred: next }) }).catch(() => null);
    if (!r?.ok) setStarred(!next);
    else notifyDesignChanged();
  };

  const applyResize = async (w: number, h: number, copy: boolean) => {
    setDialog(null);
    const next = resizeDoc(ed.docRef.current, w, h);
    if (!copy) {
      ed.commit(next);
      return;
    }
    const r = await fetch('/api/design/designs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ width: w, height: h, name: t('resizedName', { name, w, h }) }) }).catch(() => null);
    if (!r?.ok) return showToast(t('actionError'));
    const d = (await r.json()) as { design: DesignFull };
    await fetch(`/api/design/designs/${d.design.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc: next, version: d.design.version }) }).catch(() => null);
    notifyDesignChanged();
    router.push(`/app/design/${d.design.id}`);
  };

  const applyColor = (c: string) => {
    const sel = ed.selectedElements();
    if (!sel.length) {
      ed.setBackground({ color: c });
      return;
    }
    ed.patchSelected((el) => (el.type === 'text' || el.type === 'icon' ? { color: c } : el.type === 'shape' ? { fill: c } : el.type === 'line' ? { stroke: c } : null));
  };

  const openMagic = (forSelection: boolean) => {
    const sel = ed.selectedElements();
    const text = forSelection && sel.length === 1 && sel[0].type === 'text' ? sel[0] : null;
    setMagicSource({ text: text ? text.text : null, id: text ? text.id : null });
    setDialog('magic');
  };

  // ---------- Teclado y portapapeles ----------

  useEffect(() => {
    if (presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (dialog || isTyping(e.target) || editingTextId) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if ((k === 'enter' || k === ' ') && (e.target as HTMLElement | null)?.closest?.('button, a, [role="button"], [role="tab"], [role="menuitem"]')) return;
      if (mod && k === 'z') {
        e.preventDefault();
        if (readOnly) return;
        if (e.shiftKey) ed.redo();
        else ed.undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        if (!readOnly) ed.redo();
        return;
      }
      if (mod && (k === '=' || k === '+')) {
        e.preventDefault();
        zoomBy(1.2);
        return;
      }
      if (mod && k === '-') {
        e.preventDefault();
        zoomBy(1 / 1.2);
        return;
      }
      if (mod && k === '0') {
        e.preventDefault();
        fit();
        return;
      }
      if (k === 'escape') {
        if (cropId) setCropId(null);
        else if (tool === 'comment') setTool('select');
        else if (draft) setDraft(null);
        else ed.setSelected([]);
        return;
      }
      if (k === '?' || (e.shiftKey && k === '/')) {
        setDialog('shortcuts');
        return;
      }
      if (readOnly) return;
      const sel = ed.selectedElements();
      if (mod && k === 'a') {
        e.preventDefault();
        ed.selectAll();
      } else if (mod && k === 'c') {
        if (ed.copy()) e.preventDefault();
      } else if (mod && k === 'x') {
        if (sel.length) {
          e.preventDefault();
          ed.cut();
        }
      } else if (mod && k === 'd') {
        e.preventDefault();
        ed.duplicate();
      } else if (mod && k === 'g') {
        e.preventDefault();
        if (e.shiftKey) ed.ungroup();
        else ed.group();
      } else if (mod && e.shiftKey && k === 'l') {
        e.preventDefault();
        if (sel.length) ed.patchSelected({ locked: !sel.every((x) => x.locked) });
      } else if (mod && (e.key === ']' || e.key === '}')) {
        e.preventDefault();
        ed.zorder(e.shiftKey ? 'front' : 'forward');
      } else if (mod && (e.key === '[' || e.key === '{')) {
        e.preventDefault();
        ed.zorder(e.shiftKey ? 'back' : 'backward');
      } else if (k === 'delete' || k === 'backspace') {
        if (sel.length) {
          e.preventDefault();
          ed.deleteSelected();
        }
      } else if (k.startsWith('arrow') && sel.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        ed.moveBy(k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0);
      } else if (k === 'enter' && sel.length === 1) {
        e.preventDefault();
        if (sel[0].type === 'text' && !sel[0].locked) setEditingTextId(sel[0].id);
        else if (sel[0].type === 'image' && sel[0].src) setCropId(sel[0].id);
      } else if (k === 'tab' && (e.target as HTMLElement)?.closest?.('.dz-stage')) {
        // Tab en el lienzo: el elemento siguiente (o el anterior con Shift).
        e.preventDefault();
        const els = ed.page.elements.filter((x) => !x.hidden);
        if (!els.length) return;
        const cur = els.findIndex((x) => x.id === sel[0]?.id);
        const next = (cur + (e.shiftKey ? -1 : 1) + els.length) % els.length;
        ed.setSelected([els[cur < 0 ? 0 : next].id]);
      } else if (!mod && !e.altKey) {
        if (k === 't') addQuick('text');
        else if (k === 'r') addQuick('rect');
        else if (k === 'c') addQuick('circle');
        else if (k === 'l') addQuick('line');
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (readOnly || dialog || isTyping(e.target) || editingTextId) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void upload(files).then((list) => list.forEach((f) => placeFile(f)));
        return;
      }
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text && ed.pasteElements(text)) {
        e.preventDefault();
        return;
      }
      // Sin texto en el portapapeles del sistema: lo último copiado en Design (otra pestaña o diseño).
      if (!text && ed.pasteElements(null)) {
        e.preventDefault();
        return;
      }
      if (text.trim()) {
        e.preventDefault();
        ed.addElements([makeText({ width: ed.doc.width, height: ed.doc.height }, 'body', { text: text.slice(0, 2000), font: brand?.fonts.body ?? null })]);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, [ed, dialog, editingTextId, readOnly, cropId, tool, draft, presenting, zoomBy, fit, addQuick, upload, placeFile, brand]);

  const closePresent = useCallback(() => setPresenting(false), []);

  const statusText =
    saveState === 'saving' ? t('saving') : saveState === 'dirty' ? t('unsaved') : saveState === 'error' ? t('saveError') : saveState === 'conflict' ? t('conflictShort') : t('saved');

  const unresolved = roots.filter((c) => !c.resolved).length;

  return (
    <div className="dz-editor" data-testid="design-editor" data-readonly={readOnly || undefined}>
      <header className="dz-top">
        <Link href="/app/design" className="btn btn-ghost btn-sm dz-tool" aria-label={t('back')} title={t('back')}>
          <Glyph d={G.back} />
        </Link>
        <input
          className="input dz-name"
          aria-label={t('name')}
          value={nameDraft}
          readOnly={readOnly}
          maxLength={120}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setNameDraft(name);
              (e.target as HTMLInputElement).blur();
            }
          }}
          data-testid="design-name"
        />
        <button type="button" className={`btn btn-ghost btn-sm dz-tool${starred ? ' is-on' : ''}`} aria-pressed={starred} aria-label={starred ? t('unstar') : t('star')} title={starred ? t('unstar') : t('star')} onClick={() => void toggleStar()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill={starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
          </svg>
        </button>
        {!readOnly && (
          <>
            <button type="button" className="btn btn-ghost btn-sm dz-tool" onClick={ed.undo} disabled={!ed.canUndo} aria-label={t('undo')} title={t('undo')} data-testid="design-undo">
              <Glyph d={G.undo} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm dz-tool" onClick={ed.redo} disabled={!ed.canRedo} aria-label={t('redo')} title={t('redo')} data-testid="design-redo">
              <Glyph d={G.redo} />
            </button>
            <span className={`dz-status is-${saveState}`} role="status" data-testid="design-save-status">
              {statusText}
            </span>
          </>
        )}
        {readOnly && <span className="dz-status">{t('viewOnly')}</span>}
        <span className="dz-top-spacer" />
        {people.length > 0 && (
          <ul className="dz-people" aria-label={t('presence')} data-testid="design-presence">
            {people.slice(0, 5).map((p) => {
              const n = ed.doc.pages.findIndex((x) => x.id === p.pageId) + 1;
              return (
                <li key={p.userId} className="dz-person" title={t('personOnPage', { name: p.name, n: n || 1 })}>
                  {(p.name || '?').trim().slice(0, 1).toUpperCase()}
                </li>
              );
            })}
          </ul>
        )}
        <div className="dz-zoom" role="group" aria-label={t('zoom')}>
          <button type="button" className="btn btn-ghost btn-sm dz-tool" onClick={() => zoomBy(1 / 1.2)} aria-label={t('zoomOut')} title={t('zoomOut')}>
            <Glyph d={G.minus} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm dz-zoom-v" onClick={fit} title={t('fit')}>
            {Math.round(view.zoom * 100)}%
          </button>
          <button type="button" className="btn btn-ghost btn-sm dz-tool" onClick={() => zoomBy(1.2)} aria-label={t('zoomIn')} title={t('zoomIn')}>
            <Glyph d={G.plus} />
          </button>
        </div>
        <button
          type="button"
          className={`btn btn-ghost btn-sm${tool === 'comment' || commentsOpen ? ' is-on' : ''}`}
          aria-pressed={tool === 'comment'}
          onClick={() => {
            setCommentsOpen(true);
            setTool((x) => (x === 'comment' ? 'select' : 'comment'));
          }}
          data-testid="design-comment-tool"
        >
          <Glyph d={G.comment} />
          <span className="dz-hide-sm">{t('comment')}</span>
          {unresolved > 0 && <span className="dz-count">{unresolved}</span>}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPresenting(true)} data-testid="design-present-btn">
          <Glyph d={G.play} />
          <span className="dz-hide-sm">{t('present')}</span>
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('export')} data-testid="design-download">
          <Glyph d={G.download} />
          <span className="dz-hide-sm">{t('download')}</span>
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog('share')} data-testid="design-share-btn">
          {t('share')}
        </button>
        <Popover label={t('more')} button={<Glyph d={G.more} />} align="right" testId="design-more">
          {(close) => (
            <div className="dz-menu" role="menu">
              {!readOnly && (
                <button type="button" role="menuitem" onClick={() => { close(); setDialog('resize'); }}>
                  {t('resize')}
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => { close(); void duplicateDesign(); }}>
                {t('duplicate')}
              </button>
              {canEditBrand && !readOnly && (
                <button type="button" role="menuitem" onClick={() => { close(); void saveTemplate(); }} data-testid="design-save-template">
                  {t('saveTemplate')}
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => { close(); setDialog('shortcuts'); }}>
                {t('shortcuts')}
              </button>
              {initial.access === 'owner' && (
                <button type="button" role="menuitem" className="is-danger" onClick={() => { close(); void trash(); }}>
                  {t('trash')}
                </button>
              )}
            </div>
          )}
        </Popover>
      </header>

      {saveState === 'conflict' && (
        <div className="dz-banner" role="alert" data-testid="design-conflict">
          <span>{conflictBy ? t('conflictBy', { name: conflictBy }) : t('conflict')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadLatest()}>
            {t('loadLatest')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void keepMine()}>
            {t('keepMine')}
          </button>
        </div>
      )}

      <div className="dz-body">
        {!readOnly && (
          <SidePanel
            ed={ed}
            tab={tab}
            setTab={setTab}
            open={panelOpen}
            setOpen={setPanelOpen}
            uploads={uploads}
            uploading={uploading}
            uploadError={uploadError}
            onUpload={(files) => void upload(files).then((list) => list.slice(0, 1).forEach((f) => placeFile(f)))}
            onInsertFile={(f) => placeFile(f)}
            brand={brand}
            canEditBrand={canEditBrand}
            onMagicNew={() => openMagic(false)}
            onApplyColor={applyColor}
          />
        )}
        <div className="dz-center" ref={centerRef}>
          <Toolbar
            ed={ed}
            cropId={cropId}
            setCropId={setCropId}
            onMagic={() => openMagic(true)}
            onPickBackgroundImage={() => {
              setPicker({ kind: 'background' });
              setDialog('picker');
            }}
            onReplaceImage={() => {
              const sel = ed.selectedElements()[0];
              if (!sel) return;
              setPicker({ kind: 'fill', id: sel.id });
              setDialog('picker');
            }}
            readOnly={readOnly}
          />
          <Stage
            ed={ed}
            view={view}
            setView={setViewManual}
            tool={tool}
            editingTextId={editingTextId}
            setEditingTextId={setEditingTextId}
            cropId={cropId}
            setCropId={setCropId}
            pins={pins}
            onPin={(id) => {
              if (id === 'draft') return;
              setActiveComment(id);
              setCommentsOpen(true);
            }}
            onCommentAt={(p) => {
              setDraft({ pageId: ed.page.id, x: Math.round(p.x), y: Math.round(p.y) });
              setCommentsOpen(true);
              setTool('select');
            }}
            onDropFiles={(files, at, frameId) => void upload(files).then((list) => list.forEach((f, i) => placeFile(f, i === 0 && frameId ? undefined : at, i === 0 ? frameId : null)))}
            onDropFileRef={(f, at, frameId) => placeFile(f, frameId ? undefined : at, frameId)}
            readOnly={readOnly}
            placeholderLabel={tp('frameHint')}
            stageLabel={t('stage')}
          />
          <nav className="dz-pages" aria-label={t('pages')} data-testid="design-pages">
            <ol className="dz-pages-list">
              {ed.doc.pages.map((p, i) => (
                <li key={p.id} className={`dz-page-thumb${i === ed.pageIndex ? ' is-active' : ''}`}>
                  <button type="button" onClick={() => ed.setPageIndex(i)} aria-current={i === ed.pageIndex ? 'page' : undefined} aria-label={t('pageN', { n: i + 1 })}>
                    <PageSvg doc={ed.doc} page={p} displayWidth={Math.max(24, Math.round((52 * ed.doc.width) / ed.doc.height))} />
                    <span className="dz-page-n">{i + 1}</span>
                  </button>
                </li>
              ))}
            </ol>
            {!readOnly && (
              <div className="dz-pages-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => ed.addPage()} data-testid="design-add-page">
                  <Glyph d={G.plus} /> <span className="dz-hide-sm">{t('addPage')}</span>
                </button>
                <Popover label={t('pageMenu')} button={<Glyph d={G.more} />} align="right">
                  {(close) => (
                    <div className="dz-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => { close(); ed.duplicatePage(); }}>
                        {t('duplicatePage')}
                      </button>
                      <button type="button" role="menuitem" disabled={ed.pageIndex === 0} onClick={() => { close(); ed.movePage(ed.pageIndex, -1); }}>
                        {t('movePageUp')}
                      </button>
                      <button type="button" role="menuitem" disabled={ed.pageIndex === ed.doc.pages.length - 1} onClick={() => { close(); ed.movePage(ed.pageIndex, 1); }}>
                        {t('movePageDown')}
                      </button>
                      <button type="button" role="menuitem" className="is-danger" disabled={ed.doc.pages.length <= 1} onClick={() => { close(); ed.deletePage(); }}>
                        {t('deletePage')}
                      </button>
                    </div>
                  )}
                </Popover>
              </div>
            )}
          </nav>
        </div>
        {commentsOpen && (
          <CommentsPanel
            designId={initial.id}
            doc={ed.doc}
            comments={comments}
            activeId={activeComment}
            setActiveId={setActiveComment}
            draft={draft}
            setDraft={setDraft}
            onPosted={(c) => {
              setComments((cur) => [...cur, c]);
              if (!c.parentId) setActiveComment(c.id);
            }}
            onChanged={loadComments}
            onClose={() => {
              setCommentsOpen(false);
              setTool('select');
              setDraft(null);
            }}
            goToPage={(pageId) => {
              const i = ed.doc.pages.findIndex((p) => p.id === pageId);
              if (i >= 0) ed.setPageIndex(i);
            }}
            showResolved={showResolved}
            setShowResolved={setShowResolved}
            error={commentsError}
          />
        )}
      </div>

      {toast && (
        <div className="ui-toasts" role="status" aria-live="polite">
          <div className="ui-toast">{toast}</div>
        </div>
      )}

      <ShareDialog open={dialog === 'share'} onClose={() => setDialog(null)} designId={initial.id} onChanged={() => notifyDesignChanged()} />
      <ExportDialog open={dialog === 'export'} onClose={() => setDialog(null)} doc={ed.doc} name={name} pageIndex={ed.pageIndex} />
      <ResizeDialog open={dialog === 'resize'} onClose={() => setDialog(null)} doc={ed.doc} onApply={(w, h, copy) => void applyResize(w, h, copy)} />
      <ShortcutsDialog open={dialog === 'shortcuts'} onClose={() => setDialog(null)} />
      <MagicDialog
        open={dialog === 'magic'}
        onClose={() => setDialog(null)}
        sourceText={magicSource.text}
        onResult={(text) => {
          if (magicSource.id) ed.updateElements([magicSource.id], (el) => (el.type === 'text' ? { ...el, text } : el));
          else ed.addElements([makeText({ width: ed.doc.width, height: ed.doc.height }, 'body', { text, font: brand?.fonts.body ?? null })]);
        }}
      />
      <Modal open={dialog === 'picker'} title={picker?.kind === 'background' ? t('pickBackground') : t('pickImage')} onClose={() => { setDialog(null); setPicker(null); }} wide>
        <ImagePicker uploads={uploads} uploading={uploading} error={uploadError} onUpload={(files) => void upload(files).then((list) => list[0] && onPickFile(list[0]))} onPick={onPickFile} />
      </Modal>
      {presenting && <Present doc={ed.doc} start={ed.pageIndex} onClose={closePresent} />}
    </div>
  );
}

function ImagePicker({ uploads, uploading, error, onUpload, onPick }: { uploads: DesignFileDto[] | null; uploading: boolean; error: string | null; onUpload: (f: File[]) => void; onPick: (f: DesignFileDto) => void }) {
  const t = useTranslations('design.panel');
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="dz-picker">
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onUpload(f); }} />
      <button type="button" className="btn btn-primary btn-sm" onClick={() => ref.current?.click()} disabled={uploading}>
        {uploading ? t('uploading') : t('upload')}
      </button>
      {error && <p className="ui-error">{error}</p>}
      {uploads && uploads.length ? (
        <div className="dz-uploads dz-picker-grid">
          {uploads.map((f) => (
            <button key={f.id} type="button" className="dz-upload" onClick={() => onPick(f)} aria-label={t('insert', { name: f.name })}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileHref(f.id)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">{t('noUploads')}</p>
      )}
    </div>
  );
}


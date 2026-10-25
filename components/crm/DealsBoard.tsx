'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { BoardDeal, BoardStage } from '@/lib/crm';
import { isDealRotting } from '@/lib/crm-rotting';
import { announceQueued, isQueuedResponse } from '@/lib/offline-queue';
import DealForm from './DealForm';
import RecordPreview from './RecordPreview';
import { scoreBand } from './DealInsightCard';
import { AddStageColumn } from './AddPipelineStage';
import { parseRequiredFields } from '@/lib/crm-stage-rules';
import ApprovalDialog, { readApproval, type ApprovalInfo } from './ApprovalDialog';
import StageRequirementsDialog, {
  checkStageMove,
  readRequirements,
  todayIso,
  wonRequirements,
  type StageRequirements,
} from './StageRequirementsDialog';

/** Códigos de error de la API con traducción en crm.errors.*. */
const KNOWN_ERRORS = new Set([
  'missing_lost_reason',
  'invalid_stage',
  'not_found',
  'invalid_input',
  'generic',
]);

const LOST_REASON_KEYS = ['price', 'timing', 'competitor', 'no budget', 'went silent', 'other'] as const;

const DRAG_THRESHOLD = 6; // px antes de activar el drag (permite clicks normales)
/** Ancho de teléfono: una columna por pantalla, barra de etapas y sin drag con el dedo. */
const PHONE_QUERY = '(max-width: 640px)';

interface DealsBoardProps {
  pipelineId: string;
  stages: BoardStage[];
  locale: string;
  /** Moneda base del workspace: los totales de columna se muestran en ella. */
  baseCurrency?: string;
  priorities: Array<{ value: string; label: string }>;
  sources: Array<{ value: string; label: string }>;
}

interface DragState {
  pointerId: number;
  dealId: string;
  fromStageId: string;
  startX: number;
  startY: number;
  dragging: boolean;
  cardEl: HTMLElement | null;
  ghostEl: HTMLElement | null;
  offsetX: number;
  offsetY: number;
  targetStageId: string | null;
  beforeId: string | null;
  originNextId: string | null;
}

interface PendingMove {
  dealId: string;
  stageId: string;
  beforeId: string | null;
  kind: 'lost';
}

/** Recalcula count y Σ amount de una columna. */
function recompute(col: BoardStage): BoardStage {
  return {
    ...col,
    count: col.deals.length,
    amount: col.deals.reduce((s, d) => s + (d.amount_base ?? d.amount), 0),
  };
}

/** Aplica el move al estado local (UI optimista). */
function applyMove(cols: BoardStage[], dealId: string, stageId: string, beforeId: string | null): BoardStage[] {
  const fromCol = cols.find((c) => c.deals.some((d) => d.id === dealId));
  const moved = fromCol?.deals.find((d) => d.id === dealId);
  if (!fromCol || !moved) return cols;
  const movedDeal: BoardDeal = { ...moved, stage_id: stageId };
  return cols.map((col) => {
    const remaining = col.deals.filter((d) => d.id !== dealId);
    if (col.stage.id !== stageId) return recompute({ ...col, deals: remaining });
    const deals = [...remaining];
    const idx = beforeId ? deals.findIndex((d) => d.id === beforeId) : -1;
    if (idx === -1) deals.push(movedDeal);
    else deals.splice(idx, 0, movedDeal);
    return recompute({ ...col, deals });
  });
}

export default function DealsBoard({ pipelineId, stages, locale, baseCurrency = 'USD', priorities, sources }: DealsBoardProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [cols, setCols] = useState<BoardStage[]>(stages);
  const [addStageId, setAddStageId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [lostReasonKey, setLostReasonKey] = useState('');
  const [lostText, setLostText] = useState('');
  const [lostError, setLostError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  /** La etapa destino pide aprobación (lib/crm-approvals.ts). */
  const [approval, setApproval] = useState<{ dealId: string; info: ApprovalInfo } | null>(null);
  /**
   * La etapa destino pide propiedades: diálogo para completarlas y mover. Con
   * `won`, es el mismo diálogo de ganado: fecha de cierre (hoy) y lo que
   * pida la etapa, en un solo paso.
   */
  const [reqMove, setReqMove] = useState<{
    dealId: string;
    request: { stageId: string; beforeId: string | null; lostReason?: string };
    requirements: StageRequirements;
    won?: boolean;
  } | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  /** Columna visible en el teléfono (la barra de etapas la marca). */
  const [activeStageId, setActiveStageId] = useState<string | null>(stages[0]?.stage.id ?? null);
  const suppressClickRef = useRef(false);
  /** Anuncio para lectores de pantalla (región aria-live). */
  const [announce, setAnnounce] = useState('');
  /** Card a enfocar después de moverla con el teclado (cambia de columna y se re-monta). */
  const focusAfterRef = useRef<string | null>(null);
  // Menú de etapas de una card (tecla M): flechas lo recorren, Enter mueve, Esc vuelve a la card.
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null);
  // Posición fija (viewport): el board scrollea en x y recortaría un menú absoluto.
  const [moveMenuPos, setMoveMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const moveMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!moveMenuFor) return;
    // Sin scroll al enfocar: el menú es fijo y un scroll lo cerraría.
    moveMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    function onDown(e: MouseEvent) {
      if (!moveMenuRef.current?.contains(e.target as Node)) setMoveMenuFor(null);
    }
    // Si la página o el board se mueven, el menú quedaría lejos de la card: se cierra.
    function onScroll(e: Event) {
      if (!moveMenuRef.current?.contains(e.target as Node)) setMoveMenuFor(null);
    }
    const onResize = () => setMoveMenuFor(null);
    document.addEventListener('mousedown', onDown);
    // Un frame después: el foco recién movido no cuenta como scroll del usuario.
    const raf = window.requestAnimationFrame(() => {
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onResize);
    });
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [moveMenuFor]);

  const moveCardRect = useRef<DOMRect | null>(null);
  /** Aire entre la card y el menú M (antes se superponía 6px con la card). */
  const MOVE_MENU_GAP = 4;
  function openMoveMenu(card: HTMLElement, dealId: string) {
    const r = card.getBoundingClientRect();
    moveCardRect.current = r;
    setMoveMenuPos({ top: r.bottom + MOVE_MENU_GAP, left: Math.max(8, Math.min(r.left + 8, window.innerWidth - 200)) });
    setMoveMenuFor(dealId);
  }
  // Con el menú ya en pantalla se mide su alto real: si abajo no entra, va
  // pegado arriba de la card (con un alto fijo quedaba lejos si había pocas etapas).
  useLayoutEffect(() => {
    const r = moveCardRect.current;
    const el = moveMenuRef.current;
    if (!moveMenuFor || !r || !el) return;
    const h = el.offsetHeight;
    const below = r.bottom + MOVE_MENU_GAP;
    if (below + h > window.innerHeight) setMoveMenuPos((p) => ({ ...p, top: Math.max(8, r.top - h - MOVE_MENU_GAP) }));
  }, [moveMenuFor]);

  function closeMoveMenu(refocus: boolean) {
    const id = moveMenuFor;
    setMoveMenuFor(null);
    if (refocus && id) boardRef.current?.querySelector<HTMLElement>(`.kb-card[data-deal-id="${CSS.escape(id)}"]`)?.focus();
  }

  function onMoveMenuKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(moveMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMoveMenu(true);
    } else if (e.key === 'Tab') {
      closeMoveMenu(false);
    }
  }

  // Sync tras router.refresh() (el board se remonta al cambiar de pipeline vía key).
  useEffect(() => {
    setCols(stages);
  }, [stages]);

  // El foco sigue a la card que se movió con el teclado.
  useEffect(() => {
    const id = focusAfterRef.current;
    if (!id) return;
    const el = boardRef.current?.querySelector<HTMLElement>(`.kb-card[data-deal-id="${CSS.escape(id)}"]`);
    if (el) {
      el.focus();
      focusAfterRef.current = null;
    }
  }, [cols]);
  // Teléfono: la columna que ocupa la pantalla queda marcada en la barra de etapas.
  useEffect(() => {
    const board = boardRef.current;
    if (!board || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting && en.intersectionRatio >= 0.6) {
            const id = (en.target as HTMLElement).dataset.stageCol;
            if (id) setActiveStageId(id);
          }
        }
      },
      { root: board, threshold: [0.6] },
    );
    board.querySelectorAll('[data-stage-col]').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [cols.length]);

  function jumpToStage(stageId: string) {
    const el = boardRef.current?.querySelector(`[data-stage-col="${stageId}"]`) as HTMLElement | null;
    if (!el || !boardRef.current) return;
    setActiveStageId(stageId);
    boardRef.current.scrollTo({ left: el.offsetLeft - boardRef.current.offsetLeft, behavior: 'smooth' });
  }

  // Limpieza del DOM de drag si el componente se desmonta a mitad de un drag.
  useEffect(() => {
    return () => {
      cleanupDragDom(dragRef.current);
      dragRef.current = null;
    };
  }, []);

  const priorityLabel = new Map(priorities.map((p) => [p.value, p.label]));

  const fmtMoney = (amount: number, currency: string): string =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount);

  const fmtClose = (cd: string | null): string =>
    cd
      ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
          new Date(`${cd.slice(0, 10)}T00:00:00Z`),
        )
      : '';

  // ---------- Drag & drop (pointer events, sin deps) ----------

  function cleanupDragDom(d: DragState | null) {
    if (!d) return;
    d.ghostEl?.remove();
    d.cardEl?.classList.remove('dragging');
    document.querySelectorAll('.kb-cards.drop-target').forEach((c) => c.classList.remove('drop-target'));
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLElement>, deal: BoardDeal, stageId: string) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // En el teléfono el dedo desliza entre columnas: para mover está "Mover a…".
    if (e.pointerType === 'touch' && window.matchMedia(PHONE_QUERY).matches) return;
    const target = e.target as HTMLElement;
    // Elementos interactivos dentro de la card no inician drag.
    if (target.closest('a, button, select, input, textarea, [data-no-drag]')) return;
    const cardEl = e.currentTarget;
    try {
      cardEl.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    dragRef.current = {
      pointerId: e.pointerId,
      dealId: deal.id,
      fromStageId: stageId,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      cardEl,
      ghostEl: null,
      offsetX: 0,
      offsetY: 0,
      targetStageId: stageId,
      beforeId: null,
      originNextId: null,
    };
  }

  function startDrag(d: DragState, e: ReactPointerEvent<HTMLElement>) {
    d.dragging = true;
    const cardEl = d.cardEl!;
    const rect = cardEl.getBoundingClientRect();
    d.offsetX = e.clientX - rect.left;
    d.offsetY = e.clientY - rect.top;
    const ghost = cardEl.cloneNode(true) as HTMLElement;
    ghost.classList.add('kb-card-ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.removeAttribute('data-deal-id');
    document.body.appendChild(ghost);
    d.ghostEl = ghost;
    cardEl.classList.add('dragging');
    // Card que originalmente seguía a la arrastrada (para detectar no-op).
    const next = cardEl.nextElementSibling;
    d.originNextId = next instanceof HTMLElement ? (next.dataset.dealId ?? null) : null;
  }

  function updateDrag(d: DragState, e: ReactPointerEvent<HTMLElement>) {
    if (d.ghostEl) {
      d.ghostEl.style.left = `${e.clientX - d.offsetX}px`;
      d.ghostEl.style.top = `${e.clientY - d.offsetY}px`;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    // Toda la columna recibe el drop (título, "+ Agregar" y el espacio de
    // abajo), no solo la lista de cards.
    const colEl = el?.closest('.kb-col') as HTMLElement | null;
    const cardsEl = (el?.closest('.kb-cards') ?? colEl?.querySelector('.kb-cards')) as HTMLElement | null;
    document.querySelectorAll('.kb-cards.drop-target').forEach((c) => {
      if (c !== cardsEl) c.classList.remove('drop-target');
    });
    if (!cardsEl) {
      d.targetStageId = null;
      d.beforeId = null;
      return;
    }
    cardsEl.classList.add('drop-target');
    d.targetStageId = cardsEl.dataset.stageId ?? null;
    // beforeId = primera card cuyo centro vertical esté por debajo del pointer.
    let beforeId: string | null = null;
    const cards = cardsEl.querySelectorAll('.kb-card[data-deal-id]');
    for (const c of Array.from(cards)) {
      const htmlC = c as HTMLElement;
      if (htmlC.dataset.dealId === d.dealId) continue;
      const r = htmlC.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        beforeId = htmlC.dataset.dealId ?? null;
        break;
      }
    }
    d.beforeId = beforeId;
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLElement>) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.dragging) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
      startDrag(d, e);
    }
    updateDrag(d, e);
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLElement>) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const wasDragging = d.dragging;
    if (wasDragging) {
      // El click posterior al drag no debe navegar.
      suppressClickRef.current = true;
      finishDrag(d);
    }
    cleanupDragDom(d);
    dragRef.current = null;
  }

  function handlePointerCancel(e: ReactPointerEvent<HTMLElement>) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    cleanupDragDom(d);
    dragRef.current = null;
  }

  function finishDrag(d: DragState) {
    const { dealId, fromStageId, targetStageId, beforeId, originNextId } = d;
    if (!targetStageId) return; // soltó fuera de cualquier columna
    const sameSpot = targetStageId === fromStageId && beforeId === originNextId;
    if (sameSpot) return;
    requestMove(dealId, targetStageId, beforeId);
  }

  // ---------- Move (optimista + API) ----------

  function requestMove(dealId: string, stageId: string, beforeId: string | null) {
    const target = cols.find((c) => c.stage.id === stageId);
    if (!target) return;
    if (target.stage.is_lost) {
      setLostReasonKey('');
      setLostText('');
      setLostError(null);
      setPendingMove({ dealId, stageId, beforeId, kind: 'lost' });
      return;
    }
    if (target.stage.is_won) {
      void openWon(dealId, stageId, beforeId, target.stage.name);
      return;
    }
    void doMove(dealId, stageId, beforeId);
  }

  /** Ganado: un solo diálogo con la fecha de cierre y lo que pida la etapa. */
  async function openWon(dealId: string, stageId: string, beforeId: string | null, stageName: string) {
    setBoardError(null);
    const target = cols.find((c) => c.stage.id === stageId);
    const needsCheck = target ? parseRequiredFields(target.stage.required_fields).length > 0 : true;
    const check = await checkStageMove(dealId, stageId);
    if (check?.approval) {
      setApproval({ dealId, info: check.approval });
      return;
    }
    if (!needsCheck && check) check.missing = [];
    setReqMove({
      dealId,
      request: { stageId, beforeId },
      requirements: wonRequirements(check ?? { stage: stageName, missing: [] }),
      won: true,
    });
  }

  async function doMove(dealId: string, stageId: string, beforeId: string | null, lostReason?: string) {
    setBoardError(null);
    // Si la etapa pide propiedades, se pregunta antes: el diálogo se abre sin un 422 de por medio.
    const target = cols.find((c) => c.stage.id === stageId);
    if (target && parseRequiredFields(target.stage.required_fields).length > 0) {
      const check = await checkStageMove(dealId, stageId);
      if (check && check.missing.length) {
        setReqMove({ dealId, request: { stageId, beforeId, ...(lostReason !== undefined ? { lostReason } : {}) }, requirements: check });
        return;
      }
    }
    const snapshot = cols;
    setCols(applyMove(cols, dealId, stageId, beforeId));
    const res = await fetch(`/api/crm/deals/${dealId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stageId,
        beforeId,
        ...(lostReason !== undefined ? { lostReason } : {}),
      }),
    }).catch(() => null);
    if (isQueuedResponse(res)) {
      // Sin red: el deal queda en la etapa nueva y se guarda al volver la conexión.
      announceQueued(`/api/crm/deals/${dealId}/move`);
      return;
    }
    if (res && res.ok) {
      const deal = snapshot.flatMap((c) => c.deals).find((d) => d.id === dealId);
      if (deal && target) setAnnounce(t('deals.keyboard.moved', { deal: deal.name, stage: target.stage.name }));
      router.refresh();
      return;
    }
    // Revert optimista.
    setCols(snapshot);
    const needsApproval = await readApproval(res);
    if (needsApproval) {
      setApproval({ dealId, info: needsApproval });
      setAnnounce(t('approvals.dialogTitle', { stage: needsApproval.stage }));
      return;
    }
    const requirements = await readRequirements(res);
    if (requirements) {
      setReqMove({ dealId, request: { stageId, beforeId, ...(lostReason !== undefined ? { lostReason } : {}) }, requirements });
      return;
    }
    const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = body?.error ?? 'generic';
    setBoardError(t(KNOWN_ERRORS.has(code) ? `errors.${code}` : 'errors.generic'));
  }

  function confirmLost() {
    if (!pendingMove) return;
    const reason = lostText.trim() || lostReasonKey;
    if (!reason) {
      setLostError(t('errors.missing_lost_reason'));
      return;
    }
    const label = lostText.trim() || t(`deals.lostDialog.reasons.${lostReasonKey}`);
    const { dealId, stageId, beforeId } = pendingMove;
    setPendingMove(null);
    void doMove(dealId, stageId, beforeId, label);
  }

  // ---------- Teclado ----------

  /** Card en (columna, índice), con el índice acotado a la columna. */
  function focusCard(colIdx: number, cardIdx: number) {
    const col = cols[colIdx];
    if (!col || !col.deals.length) return false;
    const deal = col.deals[Math.max(0, Math.min(cardIdx, col.deals.length - 1))];
    boardRef.current?.querySelector<HTMLElement>(`.kb-card[data-deal-id="${CSS.escape(deal.id)}"]`)?.focus();
    return true;
  }

  /**
   * Flechas: moverse entre cards (arriba/abajo) y columnas (izquierda/derecha,
   * salteando las vacías). Shift + izquierda/derecha: pasar el deal a la etapa
   * de al lado. Enter abre la vista previa, O el deal, M el menú de etapa.
   */
  function handleCardKey(e: ReactKeyboardEvent<HTMLElement>, deal: BoardDeal, colIdx: number, cardIdx: number) {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      focusCard(colIdx, cardIdx + (key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      const dir = key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) {
        const target = cols[colIdx + dir];
        if (!target) {
          setAnnounce(t('deals.keyboard.edge'));
          return;
        }
        focusAfterRef.current = deal.id;
        setAnnounce(t('deals.keyboard.moving', { deal: deal.name, stage: target.stage.name }));
        requestMove(deal.id, target.stage.id, null);
        return;
      }
      for (let i = colIdx + dir; i >= 0 && i < cols.length; i += dir) {
        if (focusCard(i, cardIdx)) return;
      }
      return;
    }
    if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      setPreviewId(deal.id);
      return;
    }
    if (key === 'o' || key === 'O') {
      e.preventDefault();
      router.push(`/app/crm/deals/${deal.id}`);
      return;
    }
    if (key === 'm' || key === 'M') {
      e.preventDefault();
      openMoveMenu(e.currentTarget, deal.id);
    }
  }

  // ---------- Render ----------

  return (
    <div className="kb-wrap">
      {boardError && <p className="form-error">{boardError}</p>}
      <p className="sr-only" role="status" aria-live="polite" data-testid="board-announce">
        {announce}
      </p>
      <p id={`kb-hint-${pipelineId}`} className="muted kb-hint">
        {t('deals.keyboard.hint')}
      </p>
      <nav className="kb-stagebar" aria-label={t('mobile.stages')}>
        {cols.map((col) => (
          <button
            key={col.stage.id}
            type="button"
            className={`kb-stagebar-btn${activeStageId === col.stage.id ? ' is-active' : ''}`}
            aria-current={activeStageId === col.stage.id ? 'true' : undefined}
            onClick={() => jumpToStage(col.stage.id)}
          >
            <span className="kb-stagebar-name">{col.stage.name}</span>
            <span className="kb-stagebar-stats">
              {col.count} · {fmtMoney(col.amount, baseCurrency)}
            </span>
          </button>
        ))}
      </nav>
      <div className="kb-board" ref={boardRef} data-skip-target data-skip-label={t('deals.keyboard.skipToBoard')}>
        {cols.map((col, colIdx) => {
          const closed = !!(col.stage.is_won || col.stage.is_lost);
          return (
            <div className="kb-col" key={col.stage.id} data-stage-col={col.stage.id}>
              <div className="kb-col-head">
                <span className="kb-col-name">{col.stage.name}</span>
                <span className="kb-col-stats">
                  {col.count} · {fmtMoney(col.amount, baseCurrency)}
                </span>
              </div>

              <div className="kb-cards" data-stage-id={col.stage.id}>
                {col.deals.map((deal, cardIdx) => (
                  <article
                    key={deal.id}
                    className={`kb-card${closed ? ' closed' : ''}`}
                    title={!closed && typeof deal.age_days === 'number' ? t('deals.ageDays', { days: deal.age_days }) : undefined}
                    data-deal-id={deal.id}
                    tabIndex={0}
                    aria-label={t('deals.keyboard.cardLabel', { deal: deal.name, stage: col.stage.name })}
                    aria-describedby={`kb-hint-${pipelineId}`}
                    aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Enter O M"
                    onKeyDown={(e) => handleCardKey(e, deal, colIdx, cardIdx)}
                    onPointerDown={(e) => handlePointerDown(e, deal, col.stage.id)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerCancel}
                    onClick={() => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      setPreviewId(deal.id);
                    }}
                  >
                    <Link
                      href={`/app/crm/deals/${deal.id}`}
                      className="kb-card-name"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {deal.name}
                    </Link>
                    <span className="kb-card-amount">{fmtMoney(deal.amount, deal.currency)}</span>
                    {(deal.company_name || deal.contact_name) && (
                      <span className="kb-card-meta">{deal.company_name ?? deal.contact_name}</span>
                    )}
                    <div className="kb-card-foot">
                      {deal.priority === 'high' && (
                        <span className="badge prio-high">{priorityLabel.get(deal.priority) ?? deal.priority}</span>
                      )}
                      {deal.close_date && (
                        <span className="kb-card-date" title={t('deals.table.closeDate')}>
                          {fmtClose(deal.close_date)}
                        </span>
                      )}
                      {deal.ai_score != null && (
                        <span
                          className={`ai-score ai-score-${scoreBand(deal.ai_score)} kb-card-score`}
                          title={deal.ai_reason ? `${t('ai.score.title')}: ${deal.ai_reason}` : t('ai.score.title')}
                          aria-label={`${t('ai.score.title')} ${deal.ai_score}`}
                        >
                          {deal.ai_score}
                        </span>
                      )}
                      {isDealRotting(deal.idle_days, col.stage) && (
                        <span className="kb-card-rotting" title={t('deals.rotting', { days: deal.idle_days ?? 0 })}>
                          {t('deals.rotting', { days: deal.idle_days ?? 0 })}
                        </span>
                      )}
                    </div>
                    <select
                      className="filter-select kb-move"
                      value=""
                      data-no-drag
                      aria-label={t('deals.moveTo')}
                      onChange={(e) => {
                        const stageId = e.target.value;
                        e.target.value = '';
                        if (stageId) {
                          focusAfterRef.current = deal.id;
                          requestMove(deal.id, stageId, null);
                        }
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <option value="" disabled>
                        {t('deals.moveTo')}
                      </option>
                      {cols
                        .filter((c) => c.stage.id !== col.stage.id)
                        .map((c) => (
                          <option key={c.stage.id} value={c.stage.id}>
                            {c.stage.name}
                          </option>
                        ))}
                    </select>
                    {/* En el body: dentro del board (scroll-snap y columnas al 100% en el
                        teléfono) el fixed quedaba lejos de la card. */}
                    {moveMenuFor === deal.id &&
                      createPortal(
                      <div
                        ref={moveMenuRef}
                        role="menu"
                        className="record-more-menu kb-move-menu"
                        style={{ top: moveMenuPos.top, left: moveMenuPos.left }}
                        aria-label={t('deals.moveTo')}
                        data-no-drag
                        data-testid="kb-move-menu"
                        onKeyDown={onMoveMenuKey}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {cols
                          .filter((c) => c.stage.id !== col.stage.id)
                          .map((c) => (
                            <button
                              key={c.stage.id}
                              type="button"
                              role="menuitem"
                              tabIndex={-1}
                              className="record-more-item"
                              onClick={() => {
                                setMoveMenuFor(null);
                                focusAfterRef.current = deal.id;
                                setAnnounce(t('deals.keyboard.moving', { deal: deal.name, stage: c.stage.name }));
                                requestMove(deal.id, c.stage.id, null);
                              }}
                            >
                              {c.stage.name}
                            </button>
                          ))}
                      </div>,
                        document.body,
                      )}
                  </article>
                ))}
                {col.count === 0 && <p className="muted kb-empty">{t('deals.emptyStage')}</p>}
              </div>

              {addStageId === col.stage.id ? (
                <DealForm
                  pipelineId={pipelineId}
                  stageId={col.stage.id}
                  priorities={priorities}
                  sources={sources}
                  onDone={() => {
                    setAddStageId(null);
                    router.refresh();
                  }}
                  onCancel={() => setAddStageId(null)}
                />
              ) : (
                <button type="button" className="kb-add" onClick={() => setAddStageId(col.stage.id)}>
                  {t('deals.addDeal')}
                </button>
              )}
            </div>
          );
        })}
        <AddStageColumn pipelineId={pipelineId} />
      </div>

      {pendingMove?.kind === 'lost' && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('deals.lostDialog.title')}>
          <div className="modal-card">
            <h2 className="modal-title">{t('deals.lostDialog.title')}</h2>
            <p className="muted">{t('deals.lostDialog.sub')}</p>
            <label className="field">
              <span className="prop-label">{t('deals.lostDialog.lostReason')}</span>
              <select
                className="select"
                value={lostReasonKey}
                onChange={(e) => setLostReasonKey(e.target.value)}
              >
                <option value="">{t('deals.lostDialog.reasonPlaceholder')}</option>
                {LOST_REASON_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {t(`deals.lostDialog.reasons.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <input
              className="input"
              value={lostText}
              onChange={(e) => setLostText(e.target.value)}
              placeholder={t('deals.lostDialog.lostReason')}
              maxLength={500}
            />
            {lostError && <p className="form-error">{lostError}</p>}
            <div className="form-actions">
              <button type="button" className="btn btn-solid btn-small" onClick={confirmLost}>
                {t('deals.lostDialog.confirm')}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setPendingMove(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {reqMove && (
        <StageRequirementsDialog
          dealId={reqMove.dealId}
          request={reqMove.request}
          requirements={reqMove.requirements}
          {...(reqMove.won
            ? {
                title: t('deals.wonDialog.title'),
                sub: t('deals.wonDialog.sub'),
                submitLabel: t('deals.wonDialog.confirm'),
                initialValues: { closeDate: todayIso() },
              }
            : {})}
          onCancel={() => setReqMove(null)}
          onDone={() => {
            setCols((c) => applyMove(c, reqMove.dealId, reqMove.request.stageId, reqMove.request.beforeId));
            setReqMove(null);
            router.refresh();
          }}
        />
      )}

      {previewId && (
        <RecordPreview type="deal" id={previewId} locale={locale} onClose={() => setPreviewId(null)} />
      )}

      {approval && (
        <ApprovalDialog
          dealId={approval.dealId}
          info={approval.info}
          locale={locale}
          onClose={() => {
            const id = approval.dealId;
            setApproval(null);
            boardRef.current?.querySelector<HTMLElement>(`.kb-card[data-deal-id="${CSS.escape(id)}"]`)?.focus();
          }}
        />
      )}
    </div>
  );
}

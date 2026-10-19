'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { BoardDeal, BoardStage } from '@/lib/crm';
import { isDealRotting } from '@/lib/crm-rotting';
import DealForm from './DealForm';
import RecordPreview from './RecordPreview';
import { AddStageColumn } from './AddPipelineStage';

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
  kind: 'won' | 'lost';
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

  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  // Sync tras router.refresh() (el board se remonta al cambiar de pipeline vía key).
  useEffect(() => {
    setCols(stages);
  }, [stages]);

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
    const cardsEl = el?.closest('.kb-cards') as HTMLElement | null;
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
      setPendingMove({ dealId, stageId, beforeId, kind: 'won' });
      return;
    }
    void doMove(dealId, stageId, beforeId);
  }

  async function doMove(dealId: string, stageId: string, beforeId: string | null, lostReason?: string) {
    setBoardError(null);
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
    if (res && res.ok) {
      router.refresh();
      return;
    }
    // Revert optimista.
    setCols(snapshot);
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

  function confirmWon() {
    if (!pendingMove) return;
    const { dealId, stageId, beforeId } = pendingMove;
    setPendingMove(null);
    void doMove(dealId, stageId, beforeId);
  }

  // ---------- Render ----------

  return (
    <div className="kb-wrap">
      {boardError && <p className="form-error">{boardError}</p>}
      <div className="kb-board">
        {cols.map((col) => {
          const closed = !!(col.stage.is_won || col.stage.is_lost);
          return (
            <div className="kb-col" key={col.stage.id}>
              <div className="kb-col-head">
                <span className="kb-col-name">{col.stage.name}</span>
                <span className="kb-col-stats">
                  {col.count} · {fmtMoney(col.amount, baseCurrency)}
                </span>
              </div>

              <div className="kb-cards" data-stage-id={col.stage.id}>
                {col.deals.map((deal) => (
                  <article
                    key={deal.id}
                    className={`kb-card${closed ? ' closed' : ''}`}
                    title={!closed && typeof deal.age_days === 'number' ? t('deals.ageDays', { days: deal.age_days }) : undefined}
                    data-deal-id={deal.id}
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
                        if (stageId) requestMove(deal.id, stageId, null);
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

      {pendingMove?.kind === 'won' && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('deals.wonDialog.title')}>
          <div className="modal-card">
            <h2 className="modal-title">{t('deals.wonDialog.title')}</h2>
            <p className="muted">{t('deals.wonDialog.sub')}</p>
            <div className="form-actions">
              <button type="button" className="btn btn-solid btn-small" onClick={confirmWon}>
                {t('deals.wonDialog.confirm')}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setPendingMove(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewId && (
        <RecordPreview type="deal" id={previewId} locale={locale} onClose={() => setPreviewId(null)} />
      )}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useCrmLive } from './useCrmLive';
import LeadCardFields, { type CardLead } from './LeadCardFields';
import type { CardCustomDef } from './DealCardFields';
import { DEFAULT_LEAD_CARD_PROPERTIES } from '@/lib/crm-layouts-shared';
import { useLeadPreview } from './LeadsPreview';

export interface BoardLead extends CardLead {
  id: string;
  name: string;
  converted: boolean;
}

export interface BoardColumn {
  id: string;
  name: string;
  kind: 'open' | 'qualified' | 'disqualified';
  count: number;
  leads: BoardLead[];
}

/**
 * Board de leads por etapa. Arrastrar una card a otra columna cambia la
 * etapa (la columna entera es zona de soltar); con teclado, el select
 * "Mover a" de cada card hace lo mismo.
 */
export default function LeadsBoard({
  columns: initial,
  cardKeys = DEFAULT_LEAD_CARD_PROPERTIES,
  cardCustomDefs = [],
  locale,
}: {
  columns: BoardColumn[];
  /** Propiedades de la tarjeta (Ajustes › Ventas › Tarjetas del board), ya sin las ocultas para quien mira. */
  cardKeys?: readonly string[];
  cardCustomDefs?: readonly CardCustomDef[];
  locale: string;
}) {
  const t = useTranslations('crm');
  const openPreview = useLeadPreview();
  const router = useRouter();
  const [columns, setColumns] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setColumns(initial), [initial]);

  // En vivo: un compañero movió o cambió un lead que esta persona ve. Mientras arrastra, se espera.
  const leadIds = useMemo(() => initial.flatMap((c) => c.leads.map((l) => l.id)), [initial]);
  useCrmLive({ list: 'leads', ids: leadIds }, undefined, { enabled: !dragId });

  async function move(leadId: string, stageId: string) {
    const from = columns.find((c) => c.leads.some((l) => l.id === leadId));
    if (!from || from.id === stageId) return;
    const lead = from.leads.find((l) => l.id === leadId)!;
    const prev = columns;
    // Optimista: la card pasa arriba de la columna nueva.
    setColumns((cols) =>
      cols.map((c) =>
        c.id === from.id
          ? { ...c, count: c.count - 1, leads: c.leads.filter((l) => l.id !== leadId) }
          : c.id === stageId
            ? { ...c, count: c.count + 1, leads: [lead, ...c.leads] }
            : c,
      ),
    );
    setError(null);
    const res = await fetch(`/api/crm/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stageId }),
    }).catch(() => null);
    if (!res?.ok) {
      setColumns(prev);
      setError(t('errors.generic'));
      return;
    }
    router.refresh();
  }

  return (
    <>
      <p className="ui-help">{t('leads.dragHint')}</p>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <div className="kb-board" data-testid="leads-board">
        {columns.map((col) => (
          <div
            role="group"
            key={col.id}
            className={`kb-col lead-col kind-${col.kind}`}
            aria-label={col.name}
            data-stage={col.id}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOverId(col.id);
            }}
            onDragLeave={() => setOverId((v) => (v === col.id ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              const id = dragId ?? e.dataTransfer.getData('text/plain');
              setDragId(null);
              setOverId(null);
              if (id) void move(id, col.id);
            }}
          >
            <header className="kb-col-head">
              <h2 className="kb-col-name">{col.name}</h2>
              <span className="kb-col-stats">{col.count}</span>
            </header>
            {col.leads.length === 0 ? (
              <p className={`muted kb-empty kb-cards${overId === col.id ? ' drop-target' : ''}`}>{t('leads.boardEmpty')}</p>
            ) : (
              <ul className={`kb-cards${overId === col.id ? ' drop-target' : ''}`} role="list">
                {col.leads.map((l) => (
                  <li
                    key={l.id}
                    className={`kb-card${dragId === l.id ? ' dragging' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      setDragId(l.id);
                      e.dataTransfer.setData('text/plain', l.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverId(null);
                    }}
                    data-testid="lead-card"
                    onClick={(e) => {
                      // El select "Mover a" y los links de la card hacen lo suyo.
                      if (!openPreview || dragId || (e.target as HTMLElement).closest('a, select, button')) return;
                      openPreview(l.id);
                    }}
                  >
                    {/* Como el board de deals: el nombre va a la ficha y un clic en el resto de la card abre la vista previa. */}
                    <Link href={`/app/crm/leads/${l.id}`} className="kb-card-name" data-testid="lead-card-name" onClick={(e) => e.stopPropagation()}>
                      {l.name}
                    </Link>
                    <LeadCardFields
                      lead={l}
                      keys={cardKeys}
                      customDefs={cardCustomDefs}
                      locale={locale}
                      footExtra={
                        <select
                          className="filter-select kb-move"
                          aria-label={`${t('leads.moveTo')}: ${l.name}`}
                          value={col.id}
                          onChange={(e) => void move(l.id, e.target.value)}
                        >
                          {columns.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

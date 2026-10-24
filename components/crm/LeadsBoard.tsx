'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';

export interface BoardLead {
  id: string;
  name: string;
  contact: string;
  company: string;
  owner: string;
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
export default function LeadsBoard({ columns: initial }: { columns: BoardColumn[] }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [columns, setColumns] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setColumns(initial), [initial]);

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
                  >
                    <Link href={`/app/crm/leads/${l.id}`} className="kb-card-name">
                      {l.name}
                    </Link>
                    {(l.contact || l.company) && (
                      <span className="kb-card-meta">{[l.contact, l.company].filter(Boolean).join(' · ')}</span>
                    )}
                    <span className="kb-card-foot">
                      <span className="kb-card-meta">{l.owner}</span>
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
                    </span>
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

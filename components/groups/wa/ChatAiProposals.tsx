'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ChatProposal, ProposalKind } from '@/lib/wa-insights';

export interface CreatedRef {
  kind: ProposalKind;
  href: string;
  /** "#12 Título" de un ticket o el título de la tarea. */
  label: string;
}

export type CreateResult = { ok: true; created: CreatedRef } | { ok: false; code: string };

interface Row extends ChatProposal {
  key: string;
  state: 'open' | 'busy' | 'created' | 'dismissed';
  created?: CreatedRef;
  failed?: boolean;
}

/**
 * Cómo quedó cada propuesta de un resultado (creada, descartada), en la memoria de esta pestaña del navegador: si el
 * panel se cierra y se vuelve a abrir, lo ya creado no se ofrece crear de nuevo. Nada se guarda en el servidor.
 */
const rowsBySeq = new Map<number, Row[]>();

/**
 * Los seguimientos que propone la IA (pestaña IA, Lines e Inbox): cada uno con su título (se puede cambiar), su
 * prioridad y, en Lines, tarea o ticket. Nada se crea sin "Crear"; "Descartar" lo saca de la lista. En Inbox sin el
 * CRM (`canCreate` false) se ven pero no se ofrecen crear.
 */
export default function ChatAiProposals({
  seq,
  proposals,
  kinds,
  canCreate,
  where,
  create,
  sectionClass,
  titleClass,
}: {
  /** El resultado del que vienen (cambia con cada "Resumir"). */
  seq: number;
  proposals: ChatProposal[];
  kinds: readonly ProposalKind[];
  canCreate: boolean;
  where: string;
  create: (p: ChatProposal) => Promise<CreateResult>;
  sectionClass: string;
  titleClass: string;
}) {
  const t = useTranslations('groups.wa.details.ai');
  const [rows, setRows] = useState<Row[]>(() => {
    const start = rowsBySeq.get(seq) ?? proposals.map((p, i): Row => ({ ...p, key: String(i), state: 'open' }));
    rowsBySeq.set(seq, start);
    return start;
  });
  // El estado va primero a la memoria de la pestaña: un "Crear" que termina con el panel cerrado igual queda anotado.
  const patch = (key: string, change: Partial<Row>) => {
    const next = (rowsBySeq.get(seq) ?? rows).map((r) => (r.key === key ? { ...r, ...change } : r));
    rowsBySeq.set(seq, next);
    setRows(next);
  };

  const approve = async (r: Row) => {
    // Dos clics seguidos crean uno solo: el estado se mira en la memoria, que cambia antes de volver a pintar.
    const now = (rowsBySeq.get(seq) ?? rows).find((x) => x.key === r.key);
    if (!r.title.trim() || now?.state !== 'open') return;
    patch(r.key, { state: 'busy', failed: false });
    const res = await create({ title: r.title.trim(), notes: r.notes, kind: r.kind, priority: r.priority });
    if (res.ok) patch(r.key, { state: 'created', created: res.created });
    else patch(r.key, { state: 'open', failed: true });
  };

  const visible = rows.filter((r) => r.state !== 'dismissed');
  return (
    <section className={sectionClass} data-testid="details-ai-proposals">
      <h3 className={titleClass}>{t('proposalsTitle')}</h3>
      {visible.length === 0 ? (
        <p className="ui-help">{t('noProposals')}</p>
      ) : (
        <ul className="wa-ai-plist">
          {visible.map((r) => (
            <li key={r.key} className="wa-ai-proposal" data-testid="details-ai-proposal" data-state={r.state}>
              {r.state === 'created' && r.created ? (
                <p className="wa-ai-done" role="status">
                  <span>{r.created.kind === 'ticket' ? t('createdTicket') : t('createdTask')}</span>{' '}
                  <Link href={r.created.href} data-testid="details-ai-created-link">
                    {r.created.label}
                  </Link>
                </p>
              ) : (
                <>
                  <input
                    className="input"
                    data-testid="details-ai-proposal-title"
                    value={r.title}
                    maxLength={200}
                    aria-label={t('titleLabel')}
                    disabled={r.state === 'busy' || !canCreate}
                    onChange={(e) => patch(r.key, { title: e.target.value })}
                  />
                  {r.notes && (
                    <p className="ui-help" dir="auto">
                      {r.notes}
                    </p>
                  )}
                  <div className="wa-ai-prow">
                    <span className="ui-help">
                      {t('priorityLabel')}: {t(`priority.${r.priority}`)}
                    </span>
                    {kinds.length > 1 && canCreate && (
                      <select
                        className="select wa-ai-kind"
                        data-testid="details-ai-proposal-kind"
                        value={r.kind}
                        aria-label={t('kindLabel')}
                        disabled={r.state === 'busy'}
                        onChange={(e) => patch(r.key, { kind: e.target.value as ProposalKind })}
                      >
                        {kinds.map((k) => (
                          <option key={k} value={k}>
                            {t(`kind.${k}`)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {r.failed && (
                    <p className="ui-help wa-ai-error" role="alert">
                      {t('createError')}
                    </p>
                  )}
                  <div className="wa-ai-actions">
                    {canCreate && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        data-testid="details-ai-create"
                        aria-disabled={r.state === 'busy' || !r.title.trim() || undefined}
                        aria-busy={r.state === 'busy' || undefined}
                        onClick={() => void approve(r)}
                      >
                        {r.state === 'busy' ? t('creating') : t('create')}
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" data-testid="details-ai-dismiss" disabled={r.state === 'busy'} onClick={() => patch(r.key, { state: 'dismissed' })}>
                      {t('dismiss')}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="ui-help">{canCreate ? where : t('crmOff')}</p>
    </section>
  );
}

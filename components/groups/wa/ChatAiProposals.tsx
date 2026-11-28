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
  /** El título que propuso la IA (antes de editarlo): con eso se reconoce en otra pasada lo ya creado. */
  origin: string;
  state: 'open' | 'busy' | 'created' | 'dismissed';
  created?: CreatedRef;
  failed?: string;
}

/**
 * En la memoria de esta pestaña del navegador (nada se guarda en el servidor): cómo quedó cada propuesta de un
 * resultado, para que cerrar y abrir el panel no vuelva a ofrecer crear lo creado, y lo creado en cada chat, para que
 * "Resumir de nuevo" lo muestre creado en vez de ofrecerlo otra vez.
 */
const rowsBySeq = new Map<number, Row[]>();
const createdByChat = new Map<string, Map<string, CreatedRef>>();
const originKey = (title: string) => title.trim().toLowerCase();

/**
 * Los seguimientos que propone la IA (pestaña IA, Lines e Inbox): cada uno con su título y, si es tarea, sus notas (se
 * pueden cambiar o borrar antes de crear), su prioridad y, en Lines, tarea o ticket. Nada se crea sin "Crear";
 * "Descartar" lo saca de la lista. En Inbox sin el CRM (`canCreate` false) se ven pero no se ofrecen crear.
 */
export default function ChatAiProposals({
  chatKey,
  seq,
  proposals,
  kinds,
  canCreate,
  where,
  create,
  sectionClass,
  titleClass,
}: {
  chatKey: string;
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
  const te = useTranslations('common.aiCompose.errors');
  const [rows, setRows] = useState<Row[]>(() => {
    const done = createdByChat.get(chatKey);
    const start =
      rowsBySeq.get(seq) ??
      proposals.map((p, i): Row => {
        const created = done?.get(originKey(p.title));
        return { ...p, key: String(i), origin: p.title, state: created ? 'created' : 'open', created };
      });
    rowsBySeq.set(seq, start);
    return start;
  });
  // El estado va primero a la memoria de la pestaña: un "Crear" que termina con el panel cerrado igual queda anotado.
  const patch = (key: string, change: Partial<Row>) => {
    const next = (rowsBySeq.get(seq) ?? rows).map((r) => (r.key === key ? { ...r, ...change } : r));
    rowsBySeq.set(seq, next);
    setRows(next);
  };

  const errorText = (code: string) => {
    if (code === 'crm_off') return t('crmOff');
    if (code === 'rate_limited') return t('createBusy');
    if (code === 'not_found' || code === 'unauthorized') return te('gone');
    if (code === 'network' || code === 'network_error') return te('offline');
    return t('createError');
  };

  const approve = async (r: Row) => {
    // Dos clics seguidos crean uno solo: el estado se mira en la memoria, que cambia antes de volver a pintar.
    const now = (rowsBySeq.get(seq) ?? rows).find((x) => x.key === r.key);
    if (!r.title.trim() || now?.state !== 'open') return;
    patch(r.key, { state: 'busy', failed: undefined });
    // Un ticket no lleva notas (no tiene dónde): solo el título y la prioridad.
    const res = await create({ title: r.title.trim(), notes: r.kind === 'task' ? r.notes.trim() : '', kind: r.kind, priority: r.priority });
    if (res.ok) {
      const done = createdByChat.get(chatKey) ?? new Map<string, CreatedRef>();
      done.set(originKey(r.origin), res.created);
      createdByChat.set(chatKey, done);
      patch(r.key, { state: 'created', created: res.created });
    } else patch(r.key, { state: 'open', failed: res.code });
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
                  {r.kind === 'task' && canCreate && (
                    <textarea
                      className="input wa-ai-input"
                      data-testid="details-ai-proposal-notes"
                      rows={2}
                      maxLength={4000}
                      value={r.notes}
                      placeholder={t('notesPlaceholder')}
                      aria-label={t('notesLabel')}
                      disabled={r.state === 'busy'}
                      onChange={(e) => patch(r.key, { notes: e.target.value })}
                    />
                  )}
                  {r.kind === 'task' && !canCreate && r.notes && (
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
                    <p className="ui-help wa-ai-error" role="alert" data-testid="details-ai-create-error">
                      {errorText(r.failed)}
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

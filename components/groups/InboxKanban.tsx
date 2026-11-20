'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import MenuSelect, { type MenuSelectOption } from '@/components/ui/MenuSelect';
import type { ChatDto, GroupsPerson } from '@/lib/groups';
import { fetchIfChanged } from '@/lib/conditional-fetch';
import { decodeSysPreview } from '@/lib/wa-group-events';
import {
  KANBAN_COLORS,
  KANBAN_HS_PREFIX,
  KANBAN_ME,
  KANBAN_NONE,
  KANBAN_TEAM,
  type KanbanBoardDto,
  type KanbanColor,
  type KanbanColumnDto,
} from '@/lib/groups-kanban-shared';
import { LabelTag, Modal, api, markChatSwitch, useErrorText, useMediaText, useToast } from './ui';
import Avatar from './wa/Avatar';
import { useGroupEventText } from './wa/GroupEvent';
import { listTime } from './wa/format';
import { plainWa } from './wa/rich';
import { ClockIcon, Plus } from './wa/icons';
import { MessageMenu, type MenuItem } from './ThreadParts';
import { LineBadge, LineDot, type LineOption } from './LineFolders';

type Board = KanbanBoardDto<ChatDto>;
type Column = KanbanColumnDto<ChatDto>;

function DotsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

function MoveIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** Mueve una tarjeta entre columnas de una copia del tablero (para el cambio optimista). */
function withMove(board: Board, chatId: string, to: string): Board {
  let card: ChatDto | undefined;
  const columns = board.columns.map((c) => {
    const i = c.cards.findIndex((x) => x.id === chatId);
    if (i < 0) return c;
    card = c.cards[i];
    return { ...c, count: Math.max(0, c.count - 1), cards: c.cards.filter((x) => x.id !== chatId) };
  });
  if (!card) return board;
  return { ...board, columns: columns.map((c) => (c.id === to ? { ...c, count: c.count + 1, cards: [card!, ...c.cards] } : c)) };
}

/**
 * La bandeja de Lines como kanban: los mismos chats que la lista (la misma
 * consulta: filtros, búsqueda, carpeta, línea, archivados), repartidos en
 * columnas de las etapas del equipo, de las propias o de una propiedad de la
 * empresa de HubSpot. Arrastrar una tarjeta o "Mover a…" la cambia de columna
 * (optimista; si falla vuelve y lo dice). Abrir una tarjeta abre el chat.
 */
export default function InboxKanban({
  query,
  listRows,
  current,
  listSuffix,
  numbers,
  people,
  manyLines,
  emptyText,
}: {
  /** La misma query que pide la lista (GET /api/groups/chats). */
  query: string;
  /** Las filas de la lista: cuando cambian (un mensaje nuevo, otra persona), el tablero se pone al día. */
  listRows: readonly ChatDto[];
  current: string | null;
  listSuffix: string;
  numbers: LineOption[];
  people: GroupsPerson[];
  /** Varias líneas a la vista: cada tarjeta dice de qué línea es. */
  manyLines: boolean;
  emptyText: string;
}) {
  const t = useTranslations('groups.kanban');
  const tc = useTranslations('groups');
  const locale = useLocale();
  const errText = useErrorText();
  const mediaText = useMediaText();
  const sysText = useGroupEventText();
  const [toast, showToast] = useToast();
  const [board, setBoard] = useState<string | null>(null);
  const [data, setData] = useState<Board | null>(null);
  const [error, setError] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ mode: 'new' } | { mode: 'rename'; column: Column } | null>(null);
  const [removing, setRemoving] = useState<Column | null>(null);
  const etag = useRef('');
  const want = useRef('');
  // Mientras hay un movimiento sin confirmar, una relectura de fondo no lo pisa.
  const pending = useRef(0);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p.name || p.email])), [people]);
  const lineById = useMemo(() => new Map(numbers.map((n) => [n.id, n])), [numbers]);

  const url = `/api/groups/kanban?${query}${query ? '&' : ''}${board ? `board=${encodeURIComponent(board)}` : ''}`;
  const load = useCallback(
    async (silent: boolean) => {
      want.current = url;
      const r = await fetchIfChanged<Board>(url, silent ? etag.current : null);
      if (want.current !== url || pending.current > 0) return;
      if (r.state === 'error') {
        if (!silent) setError(true);
        return;
      }
      setError(false);
      if (r.state !== 'fresh') return;
      etag.current = r.etag;
      setData(r.data);
      // Un tablero que ya no existe (HubSpot desconectado, propiedad borrada): el servidor abrió otro.
      if (board && r.data.board !== board) setBoard(r.data.board);
    },
    [url, board],
  );
  useEffect(() => {
    void load(false);
  }, [load]);
  // La lista cambió (mensaje nuevo, leído, otra persona): el tablero también.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => void load(true), 300);
    return () => clearTimeout(id);
  }, [listRows, load]);
  // Si no cargó (red o servidor lentos), se reintenta cada 5 s mientras se ve el error.
  useEffect(() => {
    if (!error) return;
    const id = setInterval(() => void load(true), 5000);
    return () => clearInterval(id);
  }, [error, load]);
  // Las etapas del equipo las mueve otra gente: cada 30 s con la pestaña visible (con ETag: sin cambios no pesa).
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const shown = board ?? data?.board ?? KANBAN_TEAM;
  const source = data?.source ?? 'team';
  const canMove = Boolean(data) && !data?.readOnly;
  const unlinked = useMemo(() => new Set(data?.unlinked ?? []), [data?.unlinked]);
  const collapsed = useMemo(() => new Set(data?.collapsed ?? []), [data?.collapsed]);
  const noneName = source === 'hs' ? t('noValue') : t('noStage');
  const colName = (c: Pick<Column, 'id' | 'name'>) => (c.id === KANBAN_NONE ? noneName : c.name);
  const movable = (c: ChatDto) => canMove && !(source === 'hs' && unlinked.has(c.id));

  function pickBoard(next: string) {
    setBoard(next);
    etag.current = '';
    void api('/api/groups/kanban', { method: 'PUT', body: { board: next } });
  }

  async function move(chatId: string, to: string) {
    if (!data) return;
    const from = data.columns.find((c) => c.cards.some((x) => x.id === chatId));
    if (!from || from.id === to) return;
    const before = data;
    const target = data.columns.find((c) => c.id === to);
    setData(withMove(data, chatId, to));
    pending.current += 1;
    const res = await api('/api/groups/kanban/move', { body: { chatId, board: data.board, column: to } });
    pending.current -= 1;
    if (!res.data) {
      // Vuelve a donde estaba y dice por qué.
      setData((cur) => (cur && cur.board === before.board ? before : cur));
      showToast(errText(res.error), true);
      return;
    }
    const name = before.columns.find((c) => c.cards.some((x) => x.id === chatId))?.cards.find((x) => x.id === chatId)?.name ?? '';
    showToast(t('moved', { name, column: target ? colName(target) : '' }));
    etag.current = '';
    void load(true);
  }

  async function setCollapsed(column: string, fold: boolean) {
    if (!data) return;
    const next = fold ? [...new Set([...data.collapsed, column])] : data.collapsed.filter((c) => c !== column);
    setData({ ...data, collapsed: next });
    await api('/api/groups/kanban', { method: 'PUT', body: { collapsed: { board: data.board, columns: next } } });
  }

  const scope = source === 'me' ? 'me' : 'team';
  async function reorder(column: Column, delta: number) {
    if (!data) return;
    const stages = data.columns.filter((c) => c.id !== KANBAN_NONE).map((c) => c.id);
    const i = stages.indexOf(column.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= stages.length) return;
    [stages[i], stages[j]] = [stages[j], stages[i]];
    const before = data;
    const byId = new Map(data.columns.map((c) => [c.id, c]));
    setData({ ...data, columns: [byId.get(KANBAN_NONE)!, ...stages.map((id) => byId.get(id)!)] });
    const res = await api('/api/groups/kanban/stages', { method: 'PATCH', body: { scope, order: stages } });
    if (!res.data) {
      setData(before);
      showToast(errText(res.error), true);
    }
  }

  async function removeStage(column: Column) {
    setRemoving(null);
    const res = await api(`/api/groups/kanban/stages?scope=${scope}&id=${encodeURIComponent(column.id)}`, { method: 'DELETE' });
    if (!res.data) return showToast(errText(res.error), true);
    showToast(t('stageDeleted', { name: column.name }));
    etag.current = '';
    void load(true);
  }

  // ---------- Arrastrar ----------
  const onDragStart = (e: DragEvent<HTMLLIElement>, c: ChatDto) => {
    e.dataTransfer.setData('text/plain', c.id);
    e.dataTransfer.effectAllowed = 'move';
    setDragging(c.id);
  };
  const onDragEnd = () => {
    setDragging(null);
    setOver(null);
  };
  const dropProps = (col: Column) =>
    canMove && !col.stale
      ? {
          onDragOver: (e: DragEvent<HTMLElement>) => {
            if (!dragging) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (over !== col.id) setOver(col.id);
          },
          onDragLeave: (e: DragEvent<HTMLElement>) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver((o) => (o === col.id ? null : o));
          },
          onDrop: (e: DragEvent<HTMLElement>) => {
            e.preventDefault();
            const id = e.dataTransfer.getData('text/plain') || dragging;
            setDragging(null);
            setOver(null);
            if (id) void move(id, col.id);
          },
        }
      : {};

  // ---------- Selector de tablero ----------
  const boardOptions = useMemo<MenuSelectOption[]>(() => {
    const out: MenuSelectOption[] = [
      { value: KANBAN_TEAM, label: t('teamStages') },
      { value: KANBAN_ME, label: t('myStages') },
    ];
    for (const p of data?.hubspot.props ?? []) out.push({ value: `${KANBAN_HS_PREFIX}${p.name}`, label: p.label, hint: 'HubSpot' });
    return out;
  }, [data?.hubspot.props, t]);

  function cardPreview(c: ChatDto): string {
    const sys = decodeSysPreview(c.lastMessagePreview);
    if (sys) return sysText(sys);
    if (c.lastKind === 'deleted' || c.lastMessagePreview === '[deleted]') return c.lastDirection === 'out' ? tc('wa.youDeleted') : tc('wa.deletedMessage');
    if (c.lastKind === 'voice' || c.lastMessagePreview === '[voice]') return tc('media.audio');
    const text = plainWa(mediaText({ preview: c.lastMessagePreview }));
    return c.kind === 'group' && c.lastDirection === 'in' && c.lastSender ? `${c.lastSender}: ${text}` : text;
  }

  function moveItems(c: ChatDto, from: Column): MenuItem[] {
    return (data?.columns ?? [])
      .filter((col) => col.id !== from.id && !col.stale)
      .map((col) => ({ key: col.id, label: colName(col), glyph: <span className={`gr-label gr-label-${col.color} gr-kanban-dot`} aria-hidden="true"><i /></span>, onSelect: () => void move(c.id, col.id) }));
  }

  function renderCard(c: ChatDto, col: Column) {
    const line = lineById.get(c.numberId);
    const assignee = c.assignedTo ? (peopleById.get(c.assignedTo) ?? '') : '';
    const isOpen = c.id === current;
    const can = movable(c);
    return (
      <li
        key={c.id}
        className={`gr-kanban-card${isOpen ? ' is-open' : ''}${dragging === c.id ? ' is-dragging' : ''}${c.muted ? ' is-muted' : ''}`}
        data-testid="kanban-card"
        data-chat-id={c.id}
        draggable={can}
        onDragStart={can ? (e) => onDragStart(e, c) : undefined}
        onDragEnd={can ? onDragEnd : undefined}
      >
        <Link
          href={`/app/lines/inbox/${c.id}${listSuffix}`}
          className="gr-kanban-open"
          aria-current={isOpen ? 'page' : undefined}
          draggable={false}
          onClick={(e) => {
            if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0 && c.id !== current) markChatSwitch(c.id);
          }}
        >
          <span className="gr-kanban-card-top">
            <Avatar name={c.name} kind={c.kind} src={c.pictureUrl} seed={c.id} size={28} />
            <span className="gr-kanban-name">{c.name}</span>
            <span className={`gr-kanban-time${c.unread > 0 ? ' is-unread' : ''}${c.flagged ? ' is-overdue' : c.awaitingSince ? ' is-waiting' : ''}`}>
              {(c.flagged || c.awaitingSince) && <ClockIcon size={13} label={c.flagged ? tc('inbox.flagged') : t('waiting')} />}
              {listTime(c.lastMessageAt ?? c.createdAt, locale)}
            </span>
          </span>
          <span className="gr-kanban-preview">{cardPreview(c)}</span>
          <span className="gr-kanban-meta">
            {manyLines && line && (
              <span className="gr-kanban-line">
                {line.color && <LineDot color={line.color} label={line.name} />}
                <LineBadge name={line.name} />
              </span>
            )}
            {c.labels.slice(0, 2).map((l) => (
              <LabelTag key={l.id} name={l.name} color={l.color} />
            ))}
            {c.labels.length > 2 && <span className="gr-kanban-more">+{c.labels.length - 2}</span>}
            {source === 'hs' && unlinked.has(c.id) && <span className="gr-kanban-more">{t('noCompany')}</span>}
            <span className="gr-kanban-end">
              {c.unread > 0 && (
                <span className="gr-unread" aria-label={tc('inbox.unread', { n: c.unread })}>
                  {c.unread > 999 ? '999+' : c.unread}
                </span>
              )}
              {assignee && (
                <span className="gr-kanban-assignee" title={t('assignedTo', { name: assignee })}>
                  <Avatar name={assignee} kind="dm" seed={c.assignedTo ?? assignee} size={20} />
                  <span className="wa-sr">{t('assignedTo', { name: assignee })}</span>
                </span>
              )}
            </span>
          </span>
        </Link>
        {can && (
          <span className="gr-kanban-card-menu" data-no-gesture>
            <MessageMenu label={t('moveTo', { name: c.name })} items={moveItems(c, col)} trigger={<MoveIcon size={16} />} className="wa-icon-btn gr-kanban-move" align="right" />
          </span>
        )}
      </li>
    );
  }

  function columnMenu(col: Column, i: number, stages: number): MenuItem[] {
    const items: MenuItem[] = [{ key: 'collapse', label: t('collapse'), onSelect: () => void setCollapsed(col.id, true) }];
    if (data?.canEditStages && col.id !== KANBAN_NONE && source !== 'hs') {
      items.push({ key: 'rename', label: t('renameStage'), onSelect: () => setEditing({ mode: 'rename', column: col }) });
      if (i > 1) items.push({ key: 'left', label: t('moveLeft'), onSelect: () => void reorder(col, -1) });
      if (i < stages) items.push({ key: 'right', label: t('moveRight'), onSelect: () => void reorder(col, 1) });
      items.push({ key: 'delete', label: t('deleteStage'), danger: true, divider: true, onSelect: () => setRemoving(col) });
    }
    return items;
  }

  const readOnlyText = data?.readOnly ? t(`readOnly.${data.readOnly}`) : '';
  const noStages = data && source !== 'hs' && data.columns.length === 1;
  const total = data?.columns.reduce((s, c) => s + c.count, 0) ?? 0;

  return (
    <div className="gr-kanban" data-testid="lines-kanban" data-board={shown} aria-busy={!data || undefined}>
      <div className="gr-kanban-head">
        <MenuSelect className="gr-kanban-board" testId="lines-kanban-board" label={t('boardLabel')} value={shown} onChange={pickBoard} options={boardOptions} />
        {data?.canEditStages && source !== 'hs' && (
          <button type="button" className="btn btn-ghost btn-sm gr-kanban-new" data-testid="kanban-new-stage" onClick={() => setEditing({ mode: 'new' })}>
            <Plus size={16} /> {t('newStage')}
          </button>
        )}
        {readOnlyText && (
          <p className="gr-kanban-note" role="note" data-testid="kanban-read-only">
            {readOnlyText}
          </p>
        )}
        {noStages && (
          <p className="gr-kanban-note" data-testid="kanban-no-stages">
            {data?.canEditStages ? (source === 'me' ? t('emptyMine') : t('emptyTeamAdmin')) : t('emptyTeam')}
          </p>
        )}
        {data?.truncated && <p className="gr-kanban-note">{t('truncated')}</p>}
      </div>
      {error && (
        <div className="gr-error" role="alert">
          {t('loadError')}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load(false)}>
            {tc('common.retry')}
          </button>
        </div>
      )}
      {!data ? (
        !error && (
          <div className="gr-kanban-cols" aria-label={tc('common.loading')}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="gr-kanban-col">
                <div className="ui-skeleton ui-skeleton-row" />
                <div className="ui-skeleton ui-skeleton-row" />
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          {total === 0 && <p className="gr-list-empty gr-kanban-empty">{emptyText}</p>}
          <div className="gr-kanban-cols" role="list" aria-label={t('boardRegion')}>
            {data.columns.map((col, i) => {
              const folded = collapsed.has(col.id);
              const stages = data.columns.length - 1;
              return (
                <section
                  key={col.id}
                  role="listitem"
                  className={`gr-kanban-col${folded ? ' is-collapsed' : ''}${over === col.id ? ' is-over' : ''}${col.id === KANBAN_NONE ? ' is-none' : ''}`}
                  data-testid="kanban-column"
                  data-column-id={col.id}
                  aria-label={t('columnLabel', { name: colName(col), n: col.count })}
                  {...dropProps(col)}
                >
                  {folded ? (
                    <button type="button" className="gr-kanban-unfold" aria-expanded={false} aria-label={t('expand', { name: colName(col) })} onClick={() => void setCollapsed(col.id, false)}>
                      <span className={`gr-label gr-label-${col.color} gr-kanban-dot`} aria-hidden="true">
                        <i />
                      </span>
                      <span className="gr-kanban-unfold-name">{colName(col)}</span>
                      <span className="gr-kanban-count" data-testid="kanban-column-count">
                        {col.count}
                      </span>
                    </button>
                  ) : (
                    <>
                      <header className="gr-kanban-col-head">
                        <span className={`gr-label gr-label-${col.color} gr-kanban-dot`} aria-hidden="true">
                          <i />
                        </span>
                        <h3 className="gr-kanban-col-name" title={colName(col)}>
                          {colName(col)}
                        </h3>
                        <span className="gr-kanban-count" data-testid="kanban-column-count">
                          {col.count}
                        </span>
                        <MessageMenu label={t('columnOptions', { name: colName(col) })} items={columnMenu(col, i, stages)} trigger={<DotsIcon />} className="wa-icon-btn gr-kanban-col-menu" align="right" />
                      </header>
                      <ul className="gr-kanban-cards">
                        {col.cards.map((c) => renderCard(c, col))}
                        {col.count > col.cards.length && <li className="gr-kanban-more-row">{t('moreCards', { n: col.count - col.cards.length })}</li>}
                        {col.cards.length === 0 && <li className="gr-kanban-drop-hint">{canMove ? t('dropHere') : t('noCards')}</li>}
                      </ul>
                    </>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
      <StageModal
        state={editing}
        scope={scope}
        onClose={() => setEditing(null)}
        onSaved={(name) => {
          const mode = editing?.mode;
          setEditing(null);
          showToast(mode === 'new' ? t('stageCreated', { name }) : tc('common.saved'));
          etag.current = '';
          void load(true);
        }}
      />
      <ConfirmDialog
        open={!!removing}
        title={t('deleteTitle', { name: removing?.name ?? '' })}
        body={t('deleteBody')}
        confirmLabel={t('deleteStage')}
        cancelLabel={tc('common.cancel')}
        danger
        onConfirm={() => removing && void removeStage(removing)}
        onCancel={() => setRemoving(null)}
      />
      {toast}
    </div>
  );
}

/** Crear o renombrar una etapa: nombre y color. */
function StageModal({
  state,
  scope,
  onClose,
  onSaved,
}: {
  state: { mode: 'new' } | { mode: 'rename'; column: Column } | null;
  scope: 'team' | 'me';
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const t = useTranslations('groups.kanban');
  const tc = useTranslations('groups');
  const errText = useErrorText();
  const [name, setName] = useState('');
  const [color, setColor] = useState<KanbanColor>('gray');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!state) return;
    setName(state.mode === 'rename' ? state.column.name : '');
    setColor(state.mode === 'rename' ? state.column.color : 'blue');
    setError('');
  }, [state]);
  async function submit() {
    if (!state || !name.trim()) return;
    setBusy(true);
    const r =
      state.mode === 'rename'
        ? await api('/api/groups/kanban/stages', { method: 'PATCH', body: { scope, id: state.column.id, name, color } })
        : await api('/api/groups/kanban/stages', { body: { scope, name, color } });
    setBusy(false);
    if (!r.data) return setError(errText(r.error));
    onSaved(name.trim());
  }
  return (
    <Modal
      open={!!state}
      title={state?.mode === 'rename' ? t('renameStage') : t('newStage')}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {tc('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()} aria-busy={busy || undefined}>
            {tc('common.save')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        <label className="ui-field">
          <span className="label">{t('stageName')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus required placeholder={t('stageNamePlaceholder')} data-testid="kanban-stage-name" />
        </label>
        <fieldset className="ui-field gr-kanban-colors">
          <legend className="label">{t('stageColor')}</legend>
          <div className="gr-label-picker">
            {KANBAN_COLORS.map((c) => (
              <button key={c} type="button" className={`gr-label-toggle gr-label gr-label-${c}${color === c ? ' is-on' : ''}`} aria-pressed={color === c} onClick={() => setColor(c)}>
                <i aria-hidden="true" />
                {tc(`colors.${c}`)}
              </button>
            ))}
          </div>
        </fieldset>
        {scope === 'me' && <p className="ui-help">{t('mineHelp')}</p>}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

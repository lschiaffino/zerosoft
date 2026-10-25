'use client';

import { useEffect, useRef, useState } from 'react';
import type { DbFile, DbProperty, DbRow, DbValue, DocsMentionableUser } from '@/lib/docs-types';
import { cellValue, isTextType, parseNumber } from '@/lib/docs-database';
import DbPopover from './DbPopover';
import DbOptionPicker from './DbOptionPicker';
import { DbFilesEditor, DbRelationPicker, type RelationChoice } from './DbRelationPicker';

export type DbExitMove = 'next' | 'prev' | 'down' | null;

/** Lo que necesitan las celdas de relación y archivos (lo arma el bloque de la base). */
export interface DbCellExtras {
  relation?: (prop: DbProperty) => {
    choices: RelationChoice[];
    status: 'loading' | 'ready' | 'error';
    onCreate?: (title: string) => Promise<string | null>;
  };
  files?: {
    href: (fileId: string) => string | null;
    upload: ((file: File) => Promise<DbFile>) | null;
  };
  onFiles?: (rowId: string, propId: string, files: DbFile[]) => void;
}

/** Tipos que se editan en un popover (la celda sigue mostrando el valor). */
export const POPOVER_TYPES = new Set(['select', 'status', 'multi_select', 'person', 'relation', 'files']);

/**
 * Edición de una celda (tabla o panel de la fila). Texto, URL, email y
 * teléfono guardan al tipear; número al salir; fecha al elegir; opciones y
 * personas en un popover. Enter o Esc terminan, Tab pasa a la celda siguiente.
 */
export default function DbCellEditor({
  prop,
  row,
  members,
  anchor,
  initialText,
  onChange,
  onCreateOption,
  onExit,
  extras,
}: {
  prop: DbProperty;
  row: DbRow;
  extras?: DbCellExtras;
  members: DocsMentionableUser[];
  /** Celda donde se ancla el popover de opciones. */
  anchor: HTMLElement | null;
  /** Primera tecla tipeada sobre la celda (reemplaza el valor, como en una planilla). */
  initialText?: string;
  onChange: (value: DbValue) => void;
  onCreateOption: (name: string) => void;
  onExit: (move: DbExitMove) => void;
}) {
  const v = cellValue(prop, row);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [numText, setNumText] = useState(() => (initialText ?? (typeof v === 'number' ? String(v) : '')));
  const exited = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (initialText === undefined && el.type !== 'date') {
      try {
        el.setSelectionRange(el.value.length, el.value.length);
      } catch {
        // Algunos tipos de input no soportan selección.
      }
    }
    // Solo al entrar en edición.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Texto tipeado como primera tecla: entra como valor.
  useEffect(() => {
    if (initialText !== undefined && isTextType(prop.type)) onChange(initialText);
    // Solo al entrar en edición.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exit = (move: DbExitMove) => {
    if (exited.current) return;
    exited.current = true;
    if (prop.type === 'number') onChange(parseNumber(numText));
    onExit(move);
  };

  const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      exit(null);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      exit(null);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      exit(e.shiftKey ? 'prev' : 'next');
    } else {
      // Flechas, Backspace, etc. editan el texto: no mueven la celda activa.
      e.stopPropagation();
    }
  };

  if (prop.type === 'relation') {
    const rel = extras?.relation?.(prop) ?? { choices: [], status: 'error' as const };
    return (
      <DbPopover anchor={anchor} onClose={() => exit(null)} label={prop.name} width={300} className="docs-db-popover-picker">
        <DbRelationPicker
          label={prop.name}
          choices={rel.choices}
          status={rel.status}
          value={Array.isArray(v) ? v : []}
          single={prop.relation?.limit === 1}
          onChange={(ids) => onChange(ids)}
          onCreate={rel.onCreate}
          onDone={() => exit(null)}
        />
      </DbPopover>
    );
  }

  if (prop.type === 'files') {
    return (
      <DbPopover anchor={anchor} onClose={() => exit(null)} label={prop.name} width={300} className="docs-db-popover-picker">
        <DbFilesEditor
          label={prop.name}
          files={row.files?.[prop.id] ?? []}
          href={extras?.files?.href ?? (() => null)}
          upload={extras?.files?.upload ?? null}
          onChange={(files) => extras?.onFiles?.(row.id, prop.id, files)}
        />
      </DbPopover>
    );
  }

  if (prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select' || prop.type === 'person') {
    return (
      <DbPopover anchor={anchor} onClose={() => exit(null)} label={prop.name} width={280} className="docs-db-popover-picker">
        <DbOptionPicker
          prop={prop}
          value={v}
          members={members}
          onChange={onChange}
          onCreate={prop.type === 'person' ? undefined : onCreateOption}
          onDone={() => exit(null)}
        />
      </DbPopover>
    );
  }

  if (prop.type === 'number') {
    return (
      <input
        ref={inputRef}
        className="docs-db-input mono"
        inputMode="decimal"
        aria-label={prop.name}
        value={numText}
        onChange={(e) => setNumText(e.target.value)}
        onKeyDown={keys}
        onBlur={() => exit(null)}
      />
    );
  }

  if (prop.type === 'date') {
    return (
      <input
        ref={inputRef}
        className="docs-db-input mono"
        type="date"
        aria-label={prop.name}
        value={typeof v === 'string' ? v : ''}
        onChange={(e) => onChange(e.target.value || null)}
        onKeyDown={keys}
        onBlur={() => exit(null)}
      />
    );
  }

  return (
    <input
      ref={inputRef}
      className="docs-db-input"
      type={prop.type === 'email' ? 'email' : prop.type === 'url' ? 'url' : prop.type === 'phone' ? 'tel' : 'text'}
      aria-label={prop.name}
      value={typeof v === 'string' ? v : ''}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={keys}
      onBlur={() => exit(null)}
    />
  );
}

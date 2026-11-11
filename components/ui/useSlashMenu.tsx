'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { buildSlashView, removalEnd, replaceRange, slashTokenAt, type SlashCommand, type SlashInsert, type SlashOption } from '@/lib/slash-commands';
import SlashMenu from './SlashMenu';

/** Desde este ancho del campo entra el aviso de "/" en el placeholder sin cortarse. */
const ROOMY_PX = 380;

export interface SlashMenuApi {
  /** El menú está a la vista: los otros (menciones, emojis, snippets) no se muestran. */
  open: boolean;
  /** true: la tecla era del menú (el composer no la usa). Va primero en el onKeyDown del campo. */
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** El menú (o null). Va adentro del composer, que es su ancla. */
  menu: ReactNode;
  /** Para el <textarea>: composición (IME) y lo que anuncia el lector de pantalla. */
  inputProps: {
    onCompositionStart: () => void;
    onCompositionEnd: () => void;
    'aria-autocomplete'?: 'list';
    'aria-controls'?: string;
    'aria-activedescendant'?: string;
  };
  /** Abre el menú desde un botón: escribe "/" donde está el cursor. */
  openFromButton: () => void;
  /** El placeholder con el aviso de "/" si el campo tiene lugar; si no, el de siempre. */
  placeholder: (base: string) => string;
}

/**
 * Comandos con "/" para un composer. El composer le pasa su texto, el cursor
 * y cómo cambiarlos; cada app arma `commands` con las acciones que ya tiene
 * (components/groups/slash-commands.tsx, components/inbox/slash-commands.tsx).
 *
 * - Nunca manda nada. Elegir un comando borra el "/comando" del campo (el
 *   resto queda igual) y después lo ejecuta, ya con el campo actualizado.
 * - Esc cierra y deja el texto como está; Enter entonces lo manda como texto.
 * - No abre mientras se compone con un IME.
 */
export function useSlashMenu(opts: {
  text: string;
  caret: number;
  /** Cambia el texto del campo y deja el cursor en `caret` (con el foco en el campo). */
  apply: (text: string, caret: number) => void;
  commands: SlashCommand[];
  /** Respuestas guardadas que entran con "/atajo". */
  inserts?: SlashInsert[];
  /** Título de esa sección ("Respuestas rápidas", "Snippets"). */
  insertsLabel?: string;
  disabled?: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}): SlashMenuApi {
  const t = useTranslations('common.slash');
  const listId = `${useId()}-list`;
  const { text, caret, disabled, inputRef } = opts;
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ key: string; index: number }>({ key: '', index: 0 });
  const [pending, setPending] = useState<{ commandId: string; option?: SlashOption } | null>(null);
  const [roomy, setRoomy] = useState(false);
  // Lo último de cada render, para ejecutar el comando con el campo ya actualizado.
  const live = useRef(opts);
  live.current = opts;

  const found = disabled ? null : slashTokenAt(text, caret);
  // Mientras se compone con un IME no hay menú (lo cerrado con Esc sigue cerrado al terminar).
  const token = composing ? null : found;
  const start = found?.start ?? -1;
  const view = token && start !== dismissed ? buildSlashView(text, token, opts.commands, opts.inserts ?? []) : null;
  const open = view !== null;
  const count = view ? (view.mode === 'args' ? view.options.length : view.items.length) : 0;
  // Otra búsqueda: vuelve a marcar el primero (o el atajo escrito entero).
  const key = view ? `${view.mode}:${token?.name ?? ''}:${view.mode === 'args' ? view.query : ''}` : '';
  const first = view?.mode === 'list' ? view.initial : 0;
  const index = Math.min(cursor.key === key ? cursor.index : first, Math.max(count - 1, 0));
  const setIndex = (i: number) => setCursor({ key, index: i });

  // Otra "/" (o ninguna): lo cerrado con Esc vuelve a abrir.
  useEffect(() => {
    if (dismissed !== null && start !== dismissed) setDismissed(null);
  }, [start, dismissed]);

  // La fila marcada, siempre a la vista.
  const activeId = open && count > 0 ? `${listId}-o${index}` : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  // Clic afuera del menú y del campo: se cierra (el texto queda).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || el.closest('[data-slash-menu]') || el === live.current.inputRef.current) return;
      setDismissed(start);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, start]);

  // El comando elegido corre después de que el campo se actualizó (ya sin el "/comando"), y con
  // los handlers de ese render: lo que lean del composer (el texto a programar o a pulir) es lo que quedó.
  useEffect(() => {
    if (!pending) return;
    setPending(null);
    queueMicrotask(() => {
      const command = live.current.commands.find((c) => c.id === pending.commandId);
      if (!command) return;
      if (!pending.option) return command.run();
      const fresh = command.args?.({ rest: live.current.text }).find((o) => o.id === pending.option!.id);
      command.run(fresh ?? pending.option);
    });
  }, [pending]);

  // ¿Entra el aviso en el placeholder? Se mide el campo (la columna del chat puede ser angosta aunque la ventana no).
  useEffect(() => {
    const el = inputRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setRoomy(el.clientWidth >= ROOMY_PX);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [inputRef, disabled]);

  const pick = (i: number) => {
    if (!view) return;
    if (view.mode === 'args') {
      const option = view.options[i];
      if (!option) return;
      const end = removalEnd(text, view.start, view.end);
      opts.apply(text.slice(0, view.start) + text.slice(end), view.start);
      setPending({ commandId: view.command.id, option });
      return;
    }
    const it = view.items[i];
    if (!it) return;
    if (it.kind === 'insert') {
      const next = replaceRange(text, view.start, view.end, it.insert.body);
      opts.apply(next.text, next.caret);
      return;
    }
    if (it.command.args) {
      // Con argumento: el campo queda en "/comando " y el menú pasa a sus opciones.
      const spaced = text[view.end] === ' ';
      const next = replaceRange(text, view.start, view.end, `/${it.command.name}${spaced ? '' : ' '}`);
      opts.apply(next.text, view.start + it.command.name.length + 2);
      return;
    }
    const end = removalEnd(text, view.start, view.end);
    const cut = end - view.start;
    opts.apply(text.slice(0, view.start) + text.slice(end), caret <= view.start ? caret : Math.max(view.start, caret - cut));
    setPending({ commandId: it.command.id });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || e.nativeEvent.isComposing || e.keyCode === 229) return false;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(start);
      return true;
    }
    if ((e.key === 'Enter' && (!e.shiftKey || e.metaKey || e.ctrlKey)) || (e.key === 'Tab' && !e.shiftKey)) {
      // También con ⌘ o Ctrl (enviar, enviar más tarde): con el menú abierto, Enter nunca manda ni programa el "/comando".
      // Shift+Enter solo sigue bajando de línea.
      e.preventDefault();
      e.stopPropagation();
      if (count > 0) pick(index);
      return true;
    }
    if (count === 0 || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((index + (e.key === 'ArrowDown' ? 1 : count - 1)) % count);
      return true;
    }
    return false;
  };

  const openFromButton = useCallback(() => {
    const o = live.current;
    if (o.disabled) return;
    const el = o.inputRef.current;
    const at = Math.min(el?.selectionStart ?? o.text.length, o.text.length);
    const to = Math.min(el?.selectionEnd ?? at, o.text.length);
    const sep = at > 0 && !/\s/.test(o.text[at - 1]) ? ' ' : '';
    const tail = to < o.text.length && !/\s/.test(o.text[to]) ? ' ' : '';
    setDismissed(null);
    o.apply(`${o.text.slice(0, at)}${sep}/${tail}${o.text.slice(to)}`, at + sep.length + 1);
  }, []);

  const menu = view ? (
    <SlashMenu
      id={listId}
      view={view}
      index={index}
      labels={{
        label: t('label'),
        actions: t('actions'),
        inserts: opts.insertsLabel ?? t('inserts'),
        ai: t('ai'),
        empty: t('empty'),
        foot: t('foot'),
        count: (n) => t('count', { n }),
        checked: t('checked'),
      }}
      onHover={setIndex}
      onPick={pick}
    />
  ) : null;

  return {
    open,
    onKeyDown,
    menu,
    inputProps: {
      onCompositionStart: () => setComposing(true),
      onCompositionEnd: () => setComposing(false),
      ...(disabled ? {} : { 'aria-autocomplete': 'list' as const }),
      ...(open ? { 'aria-controls': listId } : {}),
      ...(activeId ? { 'aria-activedescendant': activeId } : {}),
    },
    openFromButton,
    placeholder: (base) => (roomy && !disabled ? t('placeholder', { base }) : base),
  };
}

/**
 * Comandos con "/" en un composer (Lines e Inbox): la parte pura, sin React.
 *
 * - `slashTokenAt` encuentra el "/comando" (y su argumento) que termina en el
 *   cursor. Solo vale al principio del mensaje o después de un espacio o salto
 *   de línea: "y/o", una URL o una ruta no abren nada.
 * - `buildSlashView` decide qué se muestra: la lista filtrada (acciones,
 *   respuestas guardadas, AI), las opciones de un comando con argumento
 *   ("/asignar ana") o un comando ya escrito seguido de texto ("/nota llamar").
 * - `removalEnd` dice hasta dónde borrar al ejecutar un comando, para que el
 *   resto del mensaje quede como estaba.
 *
 * La UI (components/ui/SlashMenu.tsx) y cada app (components/groups y
 * components/inbox) arman la lista de comandos con las acciones que ya tienen.
 */

/** Largo máximo del nombre de un comando escrito después de "/". */
export const SLASH_NAME_MAX = 32;
/** Largo máximo de lo escrito para filtrar las opciones de un comando. */
export const SLASH_ARG_MAX = 48;
/** Cuántas respuestas guardadas se listan como mucho. */
export const SLASH_INSERT_LIMIT = 8;

export type SlashSection = 'actions' | 'inserts' | 'ai';

/** Una opción de un comando con argumento (una persona, una etiqueta, un idioma). */
export interface SlashOption {
  id: string;
  label: string;
  /** Otras palabras que la encuentran ("yo", "me"). */
  keywords?: string[];
  /** Texto secundario (el correo de la persona). */
  hint?: string;
  /** Color de la etiqueta (clase gr-label-<color>). */
  color?: string;
  /** Ya está puesta (la etiqueta del chat, a quién está asignado). */
  checked?: boolean;
}

/** Lo que el menú sabe del mensaje al decidir si un comando se ofrece. */
export interface SlashEnv {
  /** El mensaje sin el "/comando": lo que queda en el campo al ejecutarlo. */
  rest: string;
}

export interface SlashCommand {
  id: string;
  /** Lo que se escribe después de "/", en el idioma de la persona. Sin espacios. */
  name: string;
  /** Otros nombres que también lo encuentran. El nombre en inglés va siempre acá. */
  aliases?: string[];
  /** Palabras sueltas, en el idioma de la persona, que lo encuentran. */
  keywords?: string[];
  description: string;
  section: 'actions' | 'ai';
  /** Atajo de teclado que ya existe para lo mismo ("N", "⌘J"). */
  shortcut?: string;
  /** Ícono (un nodo de React; acá no se mira). */
  icon?: unknown;
  /** Se ofrece o no, según lo que quede escrito. Sin esto, siempre. */
  available?: (env: SlashEnv) => boolean;
  /** Con argumento: las opciones (las mismas que muestra el control de la app). */
  args?: (env: SlashEnv) => SlashOption[];
  /** Texto del menú cuando ninguna opción coincide. */
  emptyText?: string;
  /** Lo hace. Con argumento, recibe la opción elegida. */
  run: (option?: SlashOption) => void;
}

/** Una respuesta guardada (respuesta rápida de Lines, snippet de Inbox). */
export interface SlashInsert {
  id: string;
  shortcut: string;
  title?: string;
  /** El texto que entra en el campo (ya con sus variables resueltas). */
  body: string;
}

export interface SlashToken {
  /** Posición de la "/". */
  start: number;
  /** Fin de lo escrito (el cursor). */
  end: number;
  /** Lo escrito después de "/" hasta el primer espacio. */
  name: string;
  /** Hay un espacio después del nombre. */
  hasArg: boolean;
  /** Lo escrito después de ese espacio. */
  arg: string;
}

/** Minúsculas y sin tildes, para comparar ("Atribuição" = "atribuicao"). */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * El "/comando" que termina en el cursor, o null.
 *
 * Vale si la "/" está al principio del texto o después de un espacio o salto
 * de línea, si todo está en la misma línea y si el cursor está al final de la
 * palabra (lo que sigue es un espacio o nada). El nombre no lleva otra "/".
 */
export function slashTokenAt(text: string, caret: number): SlashToken | null {
  const at = Math.max(0, Math.min(caret, text.length));
  if (at < text.length && !/\s/.test(text[at])) return null;
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  const line = text.slice(lineStart, at);
  for (let i = line.length - 1; i >= 0; i--) {
    if (line[i] !== '/') continue;
    if (i > 0 && !/\s/.test(line[i - 1])) continue;
    // Gana la "/" válida más cercana al cursor. Si lo que sigue no tiene forma de comando (una ruta
    // como "/usr/bin"), se mira la anterior: "/nota ver /usr/bin" sigue siendo el comando "/nota".
    const m = /^([^\s/]*)(?:[ \t]([^\n]*))?$/.exec(line.slice(i + 1));
    if (!m) continue;
    const name = m[1];
    const hasArg = m[2] !== undefined;
    if (name.length > SLASH_NAME_MAX || (hasArg && !name)) continue;
    return { start: lineStart + i, end: at, name, hasArg, arg: hasArg ? m[2].replace(/^[ \t]+/, '') : '' };
  }
  return null;
}

/** Los nombres de un comando, ya normalizados (el propio primero). */
function namesOf(c: SlashCommand): string[] {
  return [c.name, ...(c.aliases ?? [])].map(fold).filter(Boolean);
}

function isSubsequence(q: string, s: string): boolean {
  let i = 0;
  for (const ch of s) if (ch === q[i]) i++;
  return i === q.length;
}

/**
 * Qué tan bien coincide un comando con lo escrito (0: no coincide).
 * Nombre exacto > empieza igual > una palabra clave empieza igual > lo
 * contiene > las letras en orden (solo contra el nombre, desde 3 letras).
 */
export function scoreCommand(c: SlashCommand, query: string): number {
  const q = fold(query);
  if (!q) return 1;
  const names = namesOf(c);
  if (names.includes(q)) return 100;
  if (names[0]?.startsWith(q)) return 85;
  if (names.some((n) => n.startsWith(q))) return 75;
  if ((c.keywords ?? []).some((k) => fold(k).startsWith(q))) return 55;
  if (names.some((n) => n.includes(q))) return 40;
  if (q.length >= 3 && names.some((n) => isSubsequence(q, n))) return 20;
  return 0;
}

/** Los comandos que coinciden, del mejor al peor (a igual puntaje, en el orden dado). */
export function rankCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  return commands
    .map((c, i) => ({ c, i, s: scoreCommand(c, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}

/** Respuestas guardadas: por atajo (empieza igual) y, si tienen, por título. */
export function rankInserts(inserts: SlashInsert[], query: string, limit = SLASH_INSERT_LIMIT): SlashInsert[] {
  const q = fold(query);
  if (!q) return inserts.slice(0, limit);
  const score = (x: SlashInsert) => {
    const sc = fold(x.shortcut);
    if (sc === q) return 100;
    if (sc.startsWith(q)) return 80;
    if (x.title && fold(x.title).includes(q)) return 40;
    return 0;
  };
  return inserts
    .map((x, i) => ({ x, i, s: score(x) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.x);
}

/** Las opciones de un comando que coinciden con lo escrito. */
export function rankOptions(options: SlashOption[], query: string): SlashOption[] {
  const q = fold(query);
  if (!q) return options;
  const score = (o: SlashOption) => {
    const label = fold(o.label);
    const keys = (o.keywords ?? []).map(fold);
    if (label === q || keys.includes(q)) return 100;
    if (label.startsWith(q)) return 85;
    if (keys.some((k) => k.startsWith(q))) return 75;
    if (label.split(/[\s@._-]+/).some((w) => w.startsWith(q))) return 65;
    if (label.includes(q)) return 40;
    if (o.hint && fold(o.hint).startsWith(q)) return 30;
    return 0;
  };
  return options
    .map((o, i) => ({ o, i, s: score(o) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((r) => r.o);
}

/**
 * El comando al que se refiere "/nombre " (ya con el espacio). El nombre
 * exacto (propio o alias) gana. Si no, y solo entre los que llevan argumento,
 * el único que empieza así ("/asig ana"), desde 2 letras.
 */
export function resolveCommand(commands: SlashCommand[], name: string): SlashCommand | null {
  const q = fold(name);
  if (!q) return null;
  const own = commands.find((c) => fold(c.name) === q);
  if (own) return own;
  const alias = commands.find((c) => namesOf(c).includes(q));
  if (alias) return alias;
  if (q.length < 2) return null;
  const starts = commands.filter((c) => c.args && namesOf(c).some((n) => n.startsWith(q)));
  return starts.length === 1 ? starts[0] : null;
}

export type SlashItem = { kind: 'command'; section: 'actions' | 'ai'; command: SlashCommand } | { kind: 'insert'; section: 'inserts'; insert: SlashInsert };

export type SlashView =
  | {
      mode: 'list';
      /** En el orden en que se muestran: acciones, respuestas guardadas, AI. */
      items: SlashItem[];
      /** El que arranca marcado. */
      initial: number;
      /** Lo que se borra del texto al elegir: [start, end). */
      start: number;
      end: number;
    }
  | {
      mode: 'args';
      command: SlashCommand;
      options: SlashOption[];
      query: string;
      start: number;
      end: number;
    };

/**
 * Qué muestra el menú para lo escrito, o null (cerrado).
 *
 * - "/" o "/asi": la lista filtrada. Sin coincidencias, null: el texto queda
 *   como texto y Enter lo manda.
 * - "/asignar ana": las opciones de ese comando. Sin coincidencias sigue
 *   abierto (vacío), para que Enter no mande "/asignar ana" al cliente.
 * - "/nota llamar mañana": el comando solo; al elegirlo se borra "/nota " y
 *   queda "llamar mañana".
 */
export function buildSlashView(text: string, token: SlashToken, commands: SlashCommand[], inserts: SlashInsert[] = []): SlashView | null {
  const env: SlashEnv = { rest: text.slice(0, token.start) + text.slice(token.end) };
  if (token.hasArg) {
    // Lo que queda si se ejecuta el comando solo: el mensaje sin "/nombre ".
    const nameEnd = token.start + 1 + token.name.length;
    const envAfter: SlashEnv = { rest: text.slice(0, token.start) + text.slice(removalEnd(text, token.start, nameEnd)) };
    const pool = commands.filter((c) => !c.available || c.available(c.args ? env : envAfter));
    const command = resolveCommand(pool, token.name);
    if (!command) return null;
    if (!command.args) {
      return { mode: 'list', items: [{ kind: 'command', section: command.section, command }], initial: 0, start: token.start, end: nameEnd };
    }
    const query = token.arg.slice(0, SLASH_ARG_MAX);
    const options = token.arg.length > SLASH_ARG_MAX ? [] : rankOptions(command.args(env), query);
    return { mode: 'args', command, options, query, start: token.start, end: token.end };
  }
  const ranked = rankCommands(
    commands.filter((c) => !c.available || c.available(env)),
    token.name,
  );
  const picked = rankInserts(inserts, token.name);
  const items: SlashItem[] = [
    ...ranked.filter((c) => c.section === 'actions').map((command) => ({ kind: 'command' as const, section: 'actions' as const, command })),
    ...picked.map((insert) => ({ kind: 'insert' as const, section: 'inserts' as const, insert })),
    ...ranked.filter((c) => c.section === 'ai').map((command) => ({ kind: 'command' as const, section: 'ai' as const, command })),
  ];
  if (items.length === 0) return null;
  // Un atajo escrito entero ("/horario") arranca marcado aunque haya acciones arriba: es lo que la persona guardó con ese nombre.
  const q = fold(token.name);
  const exact = q ? items.findIndex((it) => it.kind === 'insert' && fold(it.insert.shortcut) === q) : -1;
  return { mode: 'list', items, initial: exact >= 0 ? exact : 0, start: token.start, end: token.end };
}

/**
 * Hasta dónde borrar al sacar [start, end) del texto: si el comando estaba
 * entre dos espacios (o al principio, seguido de uno), se va también el
 * espacio de después, para no dejar dos seguidos.
 */
export function removalEnd(text: string, start: number, end: number): number {
  const spaceAfter = text[end] === ' ' || text[end] === '\t';
  const edgeBefore = start === 0 || /\s/.test(text[start - 1]);
  return spaceAfter && edgeBefore ? end + 1 : end;
}

/** El texto con [start, end) cambiado por `insert`, y dónde queda el cursor. */
export function replaceRange(text: string, start: number, end: number, insert: string): { text: string; caret: number } {
  return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}

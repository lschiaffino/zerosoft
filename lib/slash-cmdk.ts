import type { CommandAction } from './cmdk-context';
import type { SlashCommand, SlashEnv } from './slash-commands';

/**
 * Las acciones del chat abierto (Lines e Inbox) también en ⌘K, como en
 * Superhuman: la paleta muestra lo mismo que el menú "/" del campo, con los
 * mismos handlers, así nada se hace por otro camino.
 *
 * - El texto de la opción es la descripción del comando ("Archivar este
 *   chat"); el nombre, los alias y las palabras clave la encuentran.
 * - Un comando con argumento (asignar, etiqueta, silenciar) abre una página
 *   de opciones, con la que ya está puesta tildada.
 * - Los comandos de AI (que escriben en el campo) y los que se piden en
 *   `skip` (emojis, dictar: viven en el campo) no van.
 */
export interface SlashCmdkOptions {
  /** Prefijo de los ids ("inbox-chat"), para que no choquen con otras acciones. */
  prefix: string;
  /** Ids de comandos que no van en la paleta. */
  skip?: ReadonlySet<string> | readonly string[];
  /** Color de fondo del punto de una opción con color (etiquetas de Lines). */
  swatch?: (color: string) => string | undefined;
}

const EMPTY_ENV: SlashEnv = { rest: '' };

export function slashToCommandActions(commands: readonly SlashCommand[], opts: SlashCmdkOptions): CommandAction[] {
  const skip = new Set(opts.skip ?? []);
  const out: CommandAction[] = [];
  for (const c of commands) {
    if (c.section !== 'actions' || skip.has(c.id)) continue;
    if (c.available && !c.available(EMPTY_ENV)) continue;
    const keywords = [c.name, ...(c.aliases ?? []), ...(c.keywords ?? [])].join(' ');
    const base: CommandAction = { id: `${opts.prefix}:${c.id}`, label: c.description, keywords, ...(c.shortcut ? { meta: c.shortcut } : {}) };
    const args = c.args;
    if (args) {
      out.push({
        ...base,
        placeholder: c.description,
        children: () =>
          args(EMPTY_ENV).map((o) => {
            const swatch = o.color && opts.swatch ? opts.swatch(o.color) : undefined;
            return {
              id: `${opts.prefix}:${c.id}:${o.id}`,
              label: o.label,
              keywords: (o.keywords ?? []).join(' '),
              ...(o.hint ? { meta: o.hint } : {}),
              ...(o.checked ? { checked: true } : {}),
              ...(swatch ? { swatch } : {}),
              run: () => c.run(o),
            };
          }),
      });
    } else {
      out.push({ ...base, run: () => c.run() });
    }
  }
  return out;
}

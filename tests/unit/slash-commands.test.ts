import { describe, expect, it, vi } from 'vitest';
import {
  buildSlashView,
  fold,
  rankCommands,
  rankInserts,
  rankOptions,
  removalEnd,
  replaceRange,
  resolveCommand,
  scoreCommand,
  slashTokenAt,
  type SlashCommand,
  type SlashInsert,
  type SlashOption,
} from '@/lib/slash-commands';

/** El token con el cursor al final del texto. */
const at = (text: string) => slashTokenAt(text, text.length);

function cmd(id: string, over: Partial<SlashCommand> = {}): SlashCommand {
  return { id, name: id, description: `${id} desc`, section: 'actions', run: vi.fn(), ...over };
}

const people: SlashOption[] = [
  { id: 'u1', label: 'Ana Pereyra', hint: 'ana@example.test', keywords: ['me', 'yo'] },
  { id: 'u2', label: 'Bruno Anaya', hint: 'bruno@example.test' },
  { id: 'u3', label: 'Carla Méndez' },
  { id: '', label: 'Unassigned', keywords: ['nobody', 'nadie'] },
];

/** Una lista como la de Lines en español: nombre local, alias en inglés. */
const commands: SlashCommand[] = [
  cmd('assign', { name: 'asignar', aliases: ['assign'], keywords: ['responsable', 'persona'], args: () => people }),
  cmd('close', { name: 'cerrar', aliases: ['close', 'done'], keywords: ['resolver'] }),
  cmd('label', { name: 'etiqueta', aliases: ['label', 'tag'], args: () => [{ id: 'l1', label: 'Urgente', color: 'red' }, { id: 'l2', label: 'Ventas', color: 'blue', checked: true }] }),
  cmd('note', { name: 'nota', aliases: ['note', 'internal'], keywords: ['interna', 'privada'] }),
  cmd('later', { name: 'después', aliases: ['later', 'schedule'], keywords: ['programar'] }),
  cmd('unread', { name: 'no-leído', aliases: ['unread'] }),
  cmd('polish', { name: 'pulir', aliases: ['polish'], section: 'ai', available: (env) => env.rest.trim() !== '' }),
  cmd('write', { name: 'escribir', aliases: ['write', 'ai'], section: 'ai' }),
];

const inserts: SlashInsert[] = [
  { id: 'q1', shortcut: 'horario', body: 'Atendemos de 9 a 18.' },
  { id: 'q2', shortcut: 'hola', body: 'Hola, ¿en qué te ayudo?' },
  { id: 'q3', shortcut: 'nota', body: 'Te dejo una nota.' },
  { id: 'q4', shortcut: 'dir', title: 'Dirección del local', body: 'Av. Siempreviva 742' },
];

describe('slashTokenAt: dónde hay un comando', () => {
  it('al principio del mensaje', () => {
    expect(at('/')).toEqual({ start: 0, end: 1, name: '', hasArg: false, arg: '' });
    expect(at('/asi')).toEqual({ start: 0, end: 4, name: 'asi', hasArg: false, arg: '' });
  });

  it('después de un espacio o de un salto de línea', () => {
    expect(at('hola /no')).toMatchObject({ start: 5, end: 8, name: 'no' });
    expect(at('primera línea\n/cerr')).toMatchObject({ start: 14, name: 'cerr' });
    expect(at('con tab\t/x')).toMatchObject({ start: 8, name: 'x' });
  });

  it('no en medio de una palabra, una fracción, una URL o una ruta', () => {
    expect(at('y/o')).toBeNull();
    expect(at('and/or')).toBeNull();
    expect(at('1/2')).toBeNull();
    expect(at('http://')).toBeNull();
    expect(at('mirá https://example.test/precios')).toBeNull();
    expect(at('/usr/bin')).toBeNull();
    expect(at('está en /var/log/app')).toBeNull();
    expect(at('//')).toBeNull();
  });

  it('solo mira la línea del cursor', () => {
    expect(at('/nota\n')).toBeNull();
    expect(at('/nota\nsigo escribiendo')).toBeNull();
    // El cursor vuelve a la primera línea: el comando sigue ahí.
    expect(slashTokenAt('/nota\nsigo', 5)).toMatchObject({ start: 0, end: 5, name: 'nota' });
  });

  it('el cursor tiene que estar al final de la palabra', () => {
    expect(slashTokenAt('/nota', 3)).toBeNull();
    expect(slashTokenAt('/nota sigue', 5)).toMatchObject({ name: 'nota', hasArg: false, end: 5 });
    expect(slashTokenAt('hola /no mundo', 8)).toMatchObject({ start: 5, end: 8, name: 'no' });
    expect(slashTokenAt('hola', 0)).toBeNull();
  });

  it('con argumento: lo que sigue al espacio, con sus espacios', () => {
    expect(at('/asignar ')).toMatchObject({ name: 'asignar', hasArg: true, arg: '' });
    expect(at('/asignar ana')).toMatchObject({ name: 'asignar', hasArg: true, arg: 'ana', start: 0, end: 12 });
    expect(at('ok /asignar  ana per')).toMatchObject({ start: 3, name: 'asignar', arg: 'ana per' });
    expect(at('/ hola')).toBeNull();
  });

  it('gana la "/" válida más cercana; una ruta en el argumento no rompe el comando', () => {
    expect(at('/nota /asi')).toMatchObject({ start: 6, name: 'asi', hasArg: false });
    expect(at('/nota ver /usr/bin')).toMatchObject({ start: 0, name: 'nota', arg: 'ver /usr/bin' });
    expect(at('/nota ver https://example.test/a')).toMatchObject({ start: 0, name: 'nota', arg: 'ver https://example.test/a' });
  });

  it('acepta nombres con tildes y guiones, y corta los demasiado largos', () => {
    expect(at('/no-leí')).toMatchObject({ name: 'no-leí' });
    expect(at(`/${'a'.repeat(40)}`)).toBeNull();
  });

  it('tolera un cursor fuera de rango', () => {
    expect(slashTokenAt('/a', 99)).toMatchObject({ name: 'a', end: 2 });
    expect(slashTokenAt('/a', -3)).toBeNull();
    expect(slashTokenAt('', 0)).toBeNull();
  });
});

describe('filtrar y ordenar', () => {
  it('fold: minúsculas y sin tildes', () => {
    expect(fold('  Atribuição ')).toBe('atribuicao');
    expect(fold('DESPUÉS')).toBe('despues');
  });

  it('el nombre local y el alias en inglés encuentran lo mismo', () => {
    expect(rankCommands(commands, 'asig')[0].id).toBe('assign');
    expect(rankCommands(commands, 'assi')[0].id).toBe('assign');
    expect(rankCommands(commands, 'despues')[0].id).toBe('later');
    expect(rankCommands(commands, 'DESPUÉS')[0].id).toBe('later');
    expect(rankCommands(commands, 'sched')[0].id).toBe('later');
  });

  it('las palabras clave en el idioma de la persona también', () => {
    expect(rankCommands(commands, 'respons').map((c) => c.id)).toEqual(['assign']);
    expect(rankCommands(commands, 'priv').map((c) => c.id)).toEqual(['note']);
  });

  it('orden: exacto, empieza igual (nombre antes que alias), palabra clave, contiene, letras en orden', () => {
    const list = [
      cmd('a', { name: 'renota' }),
      cmd('b', { name: 'x', keywords: ['notable'] }),
      cmd('c', { name: 'y', aliases: ['notar'] }),
      cmd('d', { name: 'notas' }),
      cmd('e', { name: 'nota' }),
      cmd('f', { name: 'n-o-t-a' }),
      cmd('g', { name: 'otra' }),
    ];
    expect(rankCommands(list, 'nota').map((c) => c.id)).toEqual(['e', 'd', 'c', 'b', 'a', 'f']);
  });

  it('las letras en orden solo valen desde 3 letras y solo contra el nombre', () => {
    expect(scoreCommand(cmd('x', { name: 'cerrar' }), 'cr')).toBe(0);
    expect(scoreCommand(cmd('x', { name: 'cerrar' }), 'crr')).toBeGreaterThan(0);
    expect(scoreCommand(cmd('x', { name: 'z', keywords: ['cerrar'] }), 'crr')).toBe(0);
  });

  it('sin nada escrito, todos en el orden dado', () => {
    expect(rankCommands(commands, '').map((c) => c.id)).toEqual(commands.map((c) => c.id));
  });

  it('respuestas guardadas: por atajo (empieza igual) y por título; como mucho 8', () => {
    expect(rankInserts(inserts, 'ho').map((x) => x.id)).toEqual(['q1', 'q2']);
    expect(rankInserts(inserts, 'hola').map((x) => x.id)).toEqual(['q2']);
    expect(rankInserts(inserts, 'local').map((x) => x.id)).toEqual(['q4']);
    expect(rankInserts(inserts, 'ayudo')).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, shortcut: `s${i}`, body: 'x' }));
    expect(rankInserts(many, '')).toHaveLength(8);
    expect(rankInserts(many, 's1').map((x) => x.id)).toEqual(['m1', 'm10', 'm11', 'm12', 'm13', 'm14', 'm15', 'm16']);
  });

  it('opciones: nombre, palabra del nombre, palabra clave ("me") y correo', () => {
    expect(rankOptions(people, 'ana').map((o) => o.id)).toEqual(['u1', 'u2']);
    expect(rankOptions(people, 'me').map((o) => o.id)).toEqual(['u1', 'u3']);
    expect(rankOptions(people, 'mendez').map((o) => o.id)).toEqual(['u3']);
    expect(rankOptions(people, 'nadie').map((o) => o.id)).toEqual(['']);
    expect(rankOptions(people, 'bruno@').map((o) => o.id)).toEqual(['u2']);
    expect(rankOptions(people, 'zzz')).toEqual([]);
    expect(rankOptions(people, '')).toBe(people);
  });

  it('resolveCommand: exacto por nombre o alias; prefijo único solo entre los que llevan argumento', () => {
    expect(resolveCommand(commands, 'asignar')?.id).toBe('assign');
    expect(resolveCommand(commands, 'ASSIGN')?.id).toBe('assign');
    expect(resolveCommand(commands, 'asig')?.id).toBe('assign');
    expect(resolveCommand(commands, 'tag')?.id).toBe('label');
    expect(resolveCommand(commands, 'cerr')).toBeNull();
    expect(resolveCommand(commands, 'a')).toBeNull();
    expect(resolveCommand(commands, '')).toBeNull();
    // "et" empieza "etiqueta" y nada más con argumento; "e" es muy corto.
    expect(resolveCommand(commands, 'et')?.id).toBe('label');
    const two = [cmd('a', { name: 'mover', args: () => [] }), cmd('b', { name: 'mostrar', args: () => [] })];
    expect(resolveCommand(two, 'mo')).toBeNull();
  });
});

describe('buildSlashView: qué muestra el menú', () => {
  const view = (text: string, list = commands, ins = inserts) => {
    const token = at(text);
    return token ? buildSlashView(text, token, list, ins) : null;
  };

  it('"/" lista todo: acciones, respuestas guardadas y AI, en ese orden', () => {
    const v = view('/');
    expect(v?.mode).toBe('list');
    if (v?.mode !== 'list') return;
    expect(v.items.map((it) => it.section)).toEqual([...Array(6).fill('actions'), ...Array(4).fill('inserts'), 'ai']);
    expect(v.initial).toBe(0);
    expect([v.start, v.end]).toEqual([0, 1]);
  });

  it('un comando de AI que trabaja sobre lo escrito no se ofrece con el campo vacío', () => {
    const empty = view('/pul');
    expect(empty).toBeNull();
    const withText = view('gracias por escribir /pul');
    expect(withText?.mode === 'list' && withText.items.map((it) => it.kind === 'command' && it.command.id)).toEqual(['polish']);
  });

  it('sin coincidencias no hay menú: el texto se manda como texto', () => {
    expect(view('/hello')).toBeNull();
    expect(view('/zzz')).toBeNull();
    expect(view('/hello world')).toBeNull();
  });

  it('un atajo guardado escrito entero arranca marcado aunque haya una acción con ese nombre', () => {
    const v = view('/nota');
    expect(v?.mode).toBe('list');
    if (v?.mode !== 'list') return;
    expect(v.items[0]).toMatchObject({ kind: 'command', command: { id: 'note' } });
    expect(v.items[v.initial]).toMatchObject({ kind: 'insert', insert: { id: 'q3' } });
    // A medio escribir, primero la acción.
    const half = view('/not');
    expect(half?.mode === 'list' && half.initial).toBe(0);
  });

  it('un atajo guardado solo sigue funcionando como antes: es el primero y Enter lo pone', () => {
    const v = view('/hor');
    expect(v?.mode === 'list' && v.items.map((it) => it.kind === 'insert' && it.insert.id)).toEqual(['q1']);
    if (v?.mode !== 'list') return;
    const it0 = v.items[0];
    expect(it0.kind === 'insert' && replaceRange('/hor', v.start, v.end, it0.insert.body)).toEqual({ text: 'Atendemos de 9 a 18.', caret: 20 });
  });

  it('"/asignar ana": las opciones del comando, filtradas', () => {
    const v = view('/asignar ana');
    expect(v?.mode).toBe('args');
    if (v?.mode !== 'args') return;
    expect(v.command.id).toBe('assign');
    expect(v.options.map((o) => o.id)).toEqual(['u1', 'u2']);
    expect([v.start, v.end]).toEqual([0, 12]);
    expect(view('/assign carla')?.mode === 'args' && view('/assign carla')).toMatchObject({ options: [{ id: 'u3' }] });
    expect(view('/asig me')).toMatchObject({ mode: 'args', options: [{ id: 'u1' }, { id: 'u3' }] });
  });

  it('con argumento y sin coincidencias sigue abierto y vacío (Enter no manda "/asignar zzz")', () => {
    expect(view('/asignar zzz')).toMatchObject({ mode: 'args', options: [] });
    expect(view(`/asignar ${'a'.repeat(60)}`)).toMatchObject({ mode: 'args', options: [] });
  });

  it('"/nota llamar mañana": el comando solo; se borra "/nota " y queda el resto', () => {
    const text = '/nota llamar mañana';
    const v = view(text, commands, []);
    expect(v).toMatchObject({ mode: 'list', items: [{ kind: 'command', command: { id: 'note' } }], start: 0, end: 5 });
    if (!v) return;
    const end = removalEnd(text, v.start, v.end);
    expect(text.slice(0, v.start) + text.slice(end)).toBe('llamar mañana');
    // Con el nombre en inglés, igual.
    expect(view('/note call back', commands, [])).toMatchObject({ mode: 'list', items: [{ command: { id: 'note' } }], end: 5 });
    // Un prefijo no alcanza para un comando sin argumento: "/no llamar" es texto.
    expect(view('/no llamar', commands, [])).toBeNull();
  });

  it('en medio de un mensaje, lo demás no se toca', () => {
    const text = 'te confirmo mañana /cerrar';
    const v = view(text);
    expect(v).toMatchObject({ mode: 'list', start: 19, end: 26 });
    if (!v) return;
    expect(text.slice(0, v.start) + text.slice(removalEnd(text, v.start, v.end))).toBe('te confirmo mañana ');
  });

  it('available decide con lo que queda escrito', () => {
    const list = [cmd('later', { available: (env) => env.rest.trim().length > 0 })];
    expect(view('/later', list, [])).toBeNull();
    expect(view('hola /later', list, [])).toMatchObject({ mode: 'list' });
    // Ya escrito y seguido de texto: lo que queda es ese texto.
    expect(view('/later hola', list, [])).toMatchObject({ mode: 'list', items: [{ command: { id: 'later' } }] });
    expect(view('/later ', list, [])).toBeNull();
  });
});

describe('borrar el comando sin tocar el resto', () => {
  const cut = (text: string, start: number, end: number) => text.slice(0, start) + text.slice(removalEnd(text, start, end));

  it('al principio, seguido de texto: se va también el espacio', () => {
    expect(cut('/nota llamar', 0, 5)).toBe('llamar');
  });

  it('entre dos palabras: queda un solo espacio', () => {
    expect(cut('hola /nota mundo', 5, 10)).toBe('hola mundo');
  });

  it('al final: lo de antes queda igual, con su espacio', () => {
    expect(cut('hola /nota', 5, 10)).toBe('hola ');
  });

  it('en otra línea: el salto de línea queda', () => {
    expect(cut('uno\n/nota\ndos', 4, 9)).toBe('uno\n\ndos');
    expect(cut('uno\n/nota dos', 4, 9)).toBe('uno\ndos');
  });

  it('replaceRange deja el cursor después de lo insertado', () => {
    expect(replaceRange('a /x b', 2, 4, 'hola')).toEqual({ text: 'a hola b', caret: 6 });
    expect(replaceRange('/asi', 0, 4, '/asignar ')).toEqual({ text: '/asignar ', caret: 9 });
  });
});

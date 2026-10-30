import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoeditEngine, type CoeditScreen, type CoeditTransport } from '@/lib/docs-coedit-client';
import { apply, baseLength, diff, textHash, transform, type TextOp } from '@/lib/docs-ot';
import { COEDIT_BLOCK_MAX, type CoeditEvent, type CoeditOpItem, type CoeditOpResult } from '@/lib/docs-coedit-shared';

type OpEvent = Extract<CoeditEvent, { kind: 'op' }>;

/** Servidor en memoria con las mismas reglas que lib/docs-coedit.ts (un bloque). */
class FakeServer {
  text: string;
  rev = 0;
  log: OpEvent[] = [];
  listeners: Array<(e: OpEvent) => void> = [];
  constructor(text: string) {
    this.text = text;
  }
  hashAt(rev: number): string | null {
    if (rev === this.rev) return textHash(this.text);
    if (rev === 0) return null;
    return this.log.find((e) => e.rev === rev)?.ha ?? null;
  }
  baseHash = '';
  /** Sanitizador del servidor (lib/docs-coedit.ts sanea antes de guardar y guarda una sola operación). */
  sanitize: (t: string) => string = (t) => t;
  /** Un guardado de página que cambió el texto (lib/docs-coedit.ts coeditAfterSave): operación sin sesión. */
  save(next: string) {
    const ev: OpEvent = { kind: 'op', block: 'p', rev: this.rev + 1, session: null, seq: null, user: null, op: diff(this.text, next), hb: textHash(this.text), ha: textHash(next) };
    this.text = next;
    this.rev += 1;
    this.log.push(ev);
    for (const l of this.listeners) l(ev);
  }
  receive(session: string, items: CoeditOpItem[]): CoeditOpResult[] {
    return items.map((item) => {
      const dup = this.log.find((e) => e.session === session && e.seq === item.seq);
      if (dup) return { block: item.block, seq: item.seq, status: 'dup', events: [dup] };
      let op = item.op;
      let base: number | null = item.rev;
      if (base === null) {
        if (textHash(this.text) === item.hash) base = this.rev;
        else base = [...this.log].reverse().find((e) => e.ha === item.hash)?.rev ?? (this.baseHash === item.hash ? 0 : null);
      } else if ((base === 0 ? this.baseHash : this.hashAt(base)) !== item.hash) base = null;
      if (base !== null) {
        for (const e of this.log.filter((x) => x.rev > base!)) op = transform(op, e.op)[0];
      } else if (item.base !== undefined && textHash(item.base) === item.hash) {
        op = transform(op, diff(item.base, this.text))[0];
      } else return { block: item.block, seq: item.seq, status: 'resync', rev: this.rev, text: this.text };
      if (baseLength(op) !== this.text.length) return { block: item.block, seq: item.seq, status: 'resync', rev: this.rev, text: this.text };
      const raw = apply(this.text, op);
      const next = this.sanitize(raw);
      if (next !== raw) op = diff(this.text, next);
      const ev: OpEvent = { kind: 'op', block: item.block, rev: this.rev + 1, session, seq: item.seq, user: session, op, hb: textHash(this.text), ha: textHash(next) };
      this.text = next;
      this.rev += 1;
      this.log.push(ev);
      for (const l of this.listeners) l(ev);
      return { block: item.block, seq: item.seq, status: 'ok', events: [ev] };
    });
  }
}

/** Un editor: pantalla en memoria y una cola de eventos que llegan cuando el test decide. */
function client(server: FakeServer, session: string, initial: string) {
  let text = initial;
  let online = true;
  const inbox: CoeditEvent[] = [];
  server.listeners.push((e) => inbox.push(e));
  const screen: CoeditScreen = {
    get: () => text,
    set: (_b, t) => {
      text = t;
    },
    busy: () => false,
  };
  const transport: CoeditTransport = {
    send: async (items) => {
      if (!online) throw new Error('offline');
      return server.receive(session, items);
    },
    snapshot: async () => ({ p: { rev: server.rev, text: server.text } }),
  };
  const unmanaged: string[] = [];
  const engine = new CoeditEngine(session, screen, transport, { throttleMs: 1, gapMs: 200, onUnmanaged: (b, why) => unmanaged.push(`${b}:${why}`) });
  engine.register([{ id: 'p', text: initial, rev: 0 }]);
  return {
    engine,
    unmanaged,
    get text() {
      return text;
    },
    type(at: number, s: string) {
      const i = Math.min(at, text.length);
      text = text.slice(0, i) + s + text.slice(i);
      engine.localChanged();
    },
    erase(at: number, n: number) {
      text = text.slice(0, at) + text.slice(at + n);
      engine.localChanged();
    },
    /** Cambia la pantalla sin operaciones (el texto viaja en el guardado, como en modo sugerir). */
    edit(next: string) {
      text = next;
    },
    deliver(count = Infinity) {
      for (let k = 0; k < count && inbox.length; k++) engine.receive(inbox.shift()!);
    },
    setOnline(v: boolean) {
      online = v;
      if (v) engine.resume();
    },
  };
}

async function settle(rounds = 40) {
  for (let i = 0; i < rounds; i++) await vi.advanceTimersByTimeAsync(20);
}

describe('CoeditEngine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('dos personas escribiendo en el mismo punto del mismo bloque: no se pierde ninguna tecla', async () => {
    const server = new FakeServer('centro');
    server.baseHash = textHash('centro');
    const a = client(server, 'sessA0000', 'centro');
    const b = client(server, 'sessB0000', 'centro');
    for (const ch of 'hola') {
      a.type(6, ch);
      b.type(6, ch.toUpperCase());
      await settle(2);
      a.deliver(1);
    }
    await settle();
    a.deliver();
    b.deliver();
    await settle();
    a.deliver();
    b.deliver();
    await settle();
    expect(a.text).toBe(server.text);
    expect(b.text).toBe(server.text);
    // Cada letra está una vez.
    expect([...server.text].sort().join('')).toBe([...'centroholaHOLA'].sort().join(''));
  });

  it('fuzz: escrituras al azar con entregas desordenadas convergen', async () => {
    let seed = 99;
    const r = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    for (let round = 0; round < 40; round++) {
      const server = new FakeServer('abc def');
      server.baseHash = textHash('abc def');
      const cs = [client(server, `s${round}aaaaaaa`, 'abc def'), client(server, `s${round}bbbbbbb`, 'abc def'), client(server, `s${round}ccccccc`, 'abc def')];
      for (let step = 0; step < 30; step++) {
        const c = cs[Math.floor(r() * cs.length)];
        if (r() < 0.7) c.type(Math.floor(r() * (c.text.length + 1)), 'xyz'[Math.floor(r() * 3)]);
        else if (c.text.length) c.erase(Math.floor(r() * c.text.length), 1);
        if (r() < 0.5) await settle(1);
        cs[Math.floor(r() * cs.length)].deliver(Math.floor(r() * 3));
      }
      for (let k = 0; k < 4; k++) {
        await settle();
        for (const c of cs) c.deliver();
      }
      for (const c of cs) expect(c.text).toBe(server.text);
    }
  });

  it('sin red: lo escrito queda y se fusiona al volver', async () => {
    const server = new FakeServer('uno dos');
    server.baseHash = textHash('uno dos');
    const a = client(server, 'sessA1111', 'uno dos');
    const b = client(server, 'sessB1111', 'uno dos');
    b.setOnline(false);
    b.type(7, ' tres');
    await settle();
    a.type(0, 'cero ');
    await settle();
    expect(server.text).toBe('cero uno dos');
    b.setOnline(true);
    await settle();
    a.deliver();
    b.deliver();
    await settle();
    a.deliver();
    b.deliver();
    expect(server.text).toBe('cero uno dos tres');
    expect(a.text).toBe(server.text);
    expect(b.text).toBe(server.text);
  });

  it('desfasado (versión desconocida y huella distinta): pide el texto y fusiona', async () => {
    const server = new FakeServer('base');
    server.baseHash = textHash('base');
    // El servidor avanzó sin que este editor lo viera.
    server.receive('otro0000', [{ block: 'p', rev: 0, hash: textHash('base'), op: diff('base', 'base!'), seq: 'x1' }]);
    const a = client(server, 'sessA2222', 'base');
    a.engine.register([{ id: 'p', text: 'base', rev: null }]);
    a.type(0, '>');
    await settle();
    a.deliver();
    await settle();
    a.deliver();
    expect(server.text).toBe('>base!');
    expect(a.text).toBe('>base!');
  });

  it('el eco de un guardado propio (texto que viajó en el guardado) no se escribe dos veces', async () => {
    const server = new FakeServer('Reunión el lunes');
    server.baseHash = textHash('Reunión el lunes');
    const a = client(server, 'sessA3333', 'Reunión el lunes');
    const b = client(server, 'sessB3333', 'Reunión el lunes');
    const saved = 'Reunión el lunes<span data-sug-kind="ins"> a las 10</span>';
    a.edit(saved);
    server.save(saved);
    a.deliver();
    b.deliver();
    await settle();
    expect(a.text).toBe(saved);
    // Quien no tenía el cambio lo recibe.
    expect(b.text).toBe(saved);
    // Aceptar en la pantalla y guardar: el eco no cambia nada.
    a.edit('Reunión el lunes a las 10');
    server.save('Reunión el lunes a las 10');
    a.deliver();
    expect(a.text).toBe('Reunión el lunes a las 10');
    // Se siguió escribiendo antes de que llegara el eco: queda una sola vez.
    a.edit('Reunión el lunes a las 10:30!');
    server.save('Reunión el lunes a las 10:30');
    a.deliver();
    expect(a.text).toBe('Reunión el lunes a las 10:30!');
    b.deliver();
    expect(b.text).toBe('Reunión el lunes a las 10:30');
  });

  it('lo propio que el servidor guardó saneado: la pantalla queda igual que lo guardado y la otra persona ve lo mismo', async () => {
    const server = new FakeServer('ab');
    server.baseHash = textHash('ab');
    server.sanitize = (t) => t.replace(/<img[^>]*>/g, '');
    const a = client(server, 'sessA4444', 'ab');
    const b = client(server, 'sessB4444', 'ab');
    a.type(1, '<img src=x onerror=alert(1)>ok');
    await settle();
    a.deliver();
    b.deliver();
    await settle();
    expect(server.text).toBe('aokb');
    expect(a.text).toBe('aokb');
    expect(b.text).toBe('aokb');
  });

  it('un link a página o un bloque demasiado largo deja de viajar por operaciones (sale por el guardado)', async () => {
    const server = new FakeServer('ab');
    server.baseHash = textHash('ab');
    const a = client(server, 'sessA5555', 'ab');
    a.type(2, ' <a data-page="x">Secreto</a>');
    await settle();
    expect(server.text).toBe('ab');
    expect(a.unmanaged).toEqual(['p:unsupported']);
    expect(a.engine.manages('p')).toBe(false);
    // Vuelve con la base nueva del guardado.
    a.engine.register([{ id: 'p', text: 'ab', rev: null }]);
    expect(a.engine.manages('p')).toBe(true);
    const c = client(server, 'sessC5555', 'ab');
    c.type(2, 'x'.repeat(COEDIT_BLOCK_MAX));
    await settle();
    expect(c.unmanaged).toEqual(['p:too_large']);
    expect(server.text).toBe('ab');
  });

  it('partir el bloque donde se escribe: lo propio pasa al bloque nuevo', async () => {
    const server = new FakeServer('alpha beta gamma delta');
    server.baseHash = textHash('alpha beta gamma delta');
    const b = client(server, 'sessB4444', 'alpha beta gamma delta');
    // Ana escribe al final (sin mandar todavía).
    b.type(22, ' uno');
    // La otra persona parte después de "alpha beta": su operación corta la cola.
    server.receive('sessA4444', [{ block: 'p', rev: 0, hash: textHash('alpha beta gamma delta'), op: [10, -12], seq: 'a1' }]);
    b.deliver();
    expect(b.text).toBe('alpha beta uno');
    // Llega la estructura: el bloque nuevo con la cola.
    const prev = [{ id: 'p', content: b.text }];
    const merged = [{ id: 'p', content: b.text }, { id: 'n', content: ' gamma delta' }];
    const res = b.engine.remap(prev, merged, merged, { block: 'p', index: b.text.length })!;
    expect(res.blocks.map((x) => x.content)).toEqual(['alpha beta', ' gamma delta uno']);
    expect(res.caret).toEqual({ block: 'n', index: ' gamma delta uno'.length });
    // Ya se usó: otra fusión no vuelve a mover.
    expect(b.engine.remap(res.blocks, res.blocks, res.blocks, null)).toBeNull();
  });

  it('reintentar la misma operación no la aplica dos veces', () => {
    const server = new FakeServer('a');
    const item = { block: 'p', rev: 0, hash: textHash('a'), op: ['b', 1] as TextOp, seq: 'q1' };
    server.baseHash = textHash('a');
    expect(server.receive('s1', [item])[0].status).toBe('ok');
    expect(server.receive('s1', [item])[0].status).toBe('dup');
    expect(server.text).toBe('ba');
  });
});

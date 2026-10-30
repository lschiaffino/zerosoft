/**
 * Docs, edición simultánea (navegador, sin React ni DOM: se prueba en
 * vitest). Por cada bloque de texto que existe en el servidor guarda:
 * - `S`: el texto confirmado por el servidor y su versión (`rev`);
 * - a lo sumo una operación en vuelo (enviada, sin confirmar);
 * - lo escrito después vive en la pantalla: se calcula al mandar (diff).
 *
 * Al llegar una operación de otra persona se transforma contra lo propio
 * (en vuelo y sin mandar) y se aplica a la pantalla corriendo el caret; al
 * llegar la propia, se confirma. Los eventos se procesan en orden de
 * versión; un hueco o una huella que no coincide piden el texto actual al
 * servidor y se fusiona contra él. Sin red, lo propio queda en la pantalla
 * y se manda al volver (con el mismo id: el servidor no lo aplica dos veces).
 * Deshacer sigue siendo del editor: deshacer es un cambio local más.
 */
import { apply, diff, isNoop, textHash, transform, type TextOp } from './docs-ot';
import { COEDIT_BLOCK_MAX, hasPageLink, type CoeditEvent, type CoeditOpItem, type CoeditOpResult } from './docs-coedit-shared';
import { remapStructure, type RemapBlock, type RemapCaret, type RemapResult, type RemoteTrace } from './docs-coedit-remap';

/** Cuánto se recuerdan las operaciones ajenas y lo escrito acá (para reubicar al partir o unir bloques). */
const TRACE_MS = 10_000;
const OWN_MS = 3_000;

/** Cuánto cambia una operación (caracteres insertados más borrados). */
const opSize = (op: TextOp): number => op.reduce<number>((n, c) => n + (typeof c === 'string' ? c.length : c < 0 ? -c : 0), 0);

type OpEvent = Extract<CoeditEvent, { kind: 'op' }>;

export interface CoeditScreen {
  /** Texto del bloque en pantalla (null = no está). */
  get(block: string): string | null;
  /** Pone el texto nuevo; `op` lleva de lo que había a lo nuevo (para correr el caret). */
  set(block: string, text: string, op: TextOp, prev: string): void;
  /** Composición en curso (acentos, IME): lo remoto espera. */
  busy(): boolean;
}

export interface CoeditTransport {
  send(items: CoeditOpItem[]): Promise<CoeditOpResult[]>;
  snapshot(blocks: string[]): Promise<Record<string, { rev: number; text: string } | null>>;
}

interface BlockSync {
  S: string;
  rev: number | null;
  inflight: { op: TextOp; seq: string; base: string; rev: number | null; full: boolean } | null;
  buffer: Map<number, OpEvent>;
  resync: boolean;
  /** Pedir el texto base completo al servidor en el próximo envío (después de un desfase). */
  sendBase: boolean;
  gapTimer: ReturnType<typeof setTimeout> | null;
}

export interface CoeditDraftBlock {
  s: string;
  rev: number | null;
  inflight?: { op: TextOp; seq: string };
}

export class CoeditEngine {
  private blocks = new Map<string, BlockSync>();
  /** Bloques con los que el servidor no trabaja por operaciones (sincronizados, tipos sin texto). */
  private unsupported = new Set<string>();
  private deferred: OpEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;
  private seqN = 0;
  private stopped = false;
  private failures = 0;
  /** Operaciones ajenas recién aplicadas en pantalla (lib/docs-coedit-remap.ts). */
  private traces: RemoteTrace[] = [];
  /** Última vez que salió algo propio de cada bloque. */
  private ownAt = new Map<string, number>();
  online = true;

  constructor(
    readonly session: string,
    private screen: CoeditScreen,
    private transport: CoeditTransport,
    private opts: {
      throttleMs?: number;
      gapMs?: number;
      onError?: (code: string) => void;
      /** Un envío llegó bien (después de errores, el aviso se saca). */
      onOk?: () => void;
      /** El bloque deja de viajar por operaciones (link a página o demasiado largo): su texto sigue por el guardado. */
      onUnmanaged?: (block: string, reason: 'unsupported' | 'too_large') => void;
    } = {},
  ) {}

  stop() {
    this.stopped = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    for (const b of this.blocks.values()) if (b.gapTimer) clearTimeout(b.gapTimer);
  }

  /**
   * Deja de mandar el bloque por operaciones: su texto sale por el guardado.
   * Vuelve solo con `register` (la base nueva del guardado) cuando el
   * servidor lo tiene otra vez como bloque de texto común.
   */
  private unmanage(id: string, reason: 'unsupported' | 'too_large') {
    const b = this.blocks.get(id);
    if (!b) return;
    if (b.gapTimer) clearTimeout(b.gapTimer);
    this.blocks.delete(id);
    this.opts.onUnmanaged?.(id, reason);
  }

  /** ¿El texto de este bloque viaja por operaciones? */
  manages(block: string): boolean {
    return this.blocks.has(block);
  }

  /** Hay algo propio sin confirmar (en vuelo o escrito después). */
  pending(): boolean {
    for (const [id, b] of this.blocks) {
      if (b.inflight) return true;
      const v = this.screen.get(id);
      if (v !== null && v !== b.S) return true;
    }
    return false;
  }

  /**
   * Bloques que existen en el servidor (la base del editor): los nuevos se
   * suman con su texto (versión desconocida hasta el primer evento), los que
   * ya no están se olvidan.
   */
  register(server: Array<{ id: string; text: string; rev?: number | null }>, opts: { prune?: boolean } = {}) {
    const seen = new Set<string>();
    for (const b of server) {
      seen.add(b.id);
      if (this.unsupported.has(b.id) || this.blocks.has(b.id)) continue;
      this.blocks.set(b.id, { S: b.text, rev: b.rev ?? null, inflight: null, buffer: new Map(), resync: false, sendBase: false, gapTimer: null });
    }
    if (opts.prune) {
      for (const [id, b] of this.blocks) {
        if (!seen.has(id) && !b.inflight) this.blocks.delete(id);
      }
    }
    this.drainDeferred();
  }

  /** La pantalla se rehízo con la versión del servidor (recargar tras un conflicto): todo vuelve a empezar. */
  reset() {
    for (const b of this.blocks.values()) if (b.gapTimer) clearTimeout(b.gapTimer);
    this.blocks.clear();
    this.deferred = [];
  }

  /**
   * Se perdieron eventos (hueco grande en el feed): las versiones se vuelven
   * a ubicar por la huella con el próximo evento de cada bloque.
   */
  forgetRevs() {
    for (const b of this.blocks.values()) {
      if (b.inflight) continue;
      b.rev = null;
      b.buffer.clear();
    }
  }

  /** Texto confirmado de un bloque (base del borrador sin conexión). */
  exportDraft(): Record<string, CoeditDraftBlock> {
    const out: Record<string, CoeditDraftBlock> = {};
    for (const [id, b] of this.blocks) {
      const v = this.screen.get(id);
      if (!b.inflight && (v === null || v === b.S)) continue;
      out[id] = { s: b.S, rev: b.rev, ...(b.inflight ? { inflight: { op: b.inflight.op, seq: b.inflight.seq } } : {}) };
    }
    return out;
  }

  /** Algo cambió en la pantalla: se manda en un rato. */
  localChanged(delay = this.opts.throttleMs ?? 120) {
    if (this.stopped || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
  }

  private nextSeq() {
    this.seqN += 1;
    return `${this.session.slice(0, 12)}.${Date.now().toString(36)}.${this.seqN}`;
  }

  /** Manda lo propio de cada bloque (uno en vuelo por bloque). */
  async flush(): Promise<void> {
    if (this.stopped || this.sending) return;
    // Composición en curso (IME, acentos): lo intermedio no sale; se manda el texto final.
    if (this.screen.busy()) {
      this.localChanged(100);
      return;
    }
    const items: CoeditOpItem[] = [];
    for (const [id, b] of this.blocks) {
      if (b.resync) continue;
      if (!b.inflight) {
        const v = this.screen.get(id);
        if (v === null || v === b.S) continue;
        // Un link a página (su título depende de quién mira) o un bloque demasiado largo: por el guardado.
        if (hasPageLink(v) || v.length > COEDIT_BLOCK_MAX) {
          this.unmanage(id, hasPageLink(v) ? 'unsupported' : 'too_large');
          continue;
        }
        const op = diff(b.S, v);
        if (isNoop(op)) continue;
        this.ownAt.set(id, Date.now());
        b.inflight = { op, seq: this.nextSeq(), base: b.S, rev: b.rev, full: b.sendBase };
        b.sendBase = false;
      }
      const f = b.inflight;
      items.push({ block: id, rev: f.rev, hash: textHash(f.base), op: f.op, seq: f.seq, ...(f.full ? { base: f.base } : {}) });
    }
    if (!items.length) return;
    this.sending = true;
    let results: CoeditOpResult[] | null = null;
    try {
      results = await this.transport.send(items);
      this.failures = 0;
      this.online = true;
      this.opts.onOk?.();
    } catch (err) {
      this.failures += 1;
      this.online = false;
      const code = err instanceof Error ? err.message : '';
      this.opts.onError?.(code);
      // Sin permiso o bloqueada: no se reintenta solo.
      if (code === 'forbidden' || code === 'locked' || code === 'not_found') {
        this.sending = false;
        return;
      }
    }
    this.sending = false;
    if (!results) {
      // Sin red o error del servidor: se reintenta con los mismos ids.
      if (!this.stopped) this.localChanged(Math.min(10_000, 500 * 2 ** Math.min(this.failures, 5)));
      return;
    }
    for (const r of results) await this.onResult(r);
    // Lo escrito mientras viajaba.
    this.localChanged();
  }

  /** Volvió la red: se manda lo pendiente ya. */
  resume() {
    this.failures = 0;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    void this.flush();
  }

  private async onResult(r: CoeditOpResult) {
    const b = this.blocks.get(r.block);
    if (!b) return;
    switch (r.status) {
      case 'ok':
      case 'dup':
        for (const e of r.events ?? []) this.receive(e);
        // Repetida sin eventos (el servidor ya la tenía y no hay más que decir): la trae el feed.
        return;
      case 'resync':
        if (b.inflight?.seq === r.seq) b.inflight = null;
        if (typeof r.text === 'string' && typeof r.rev === 'number') this.rebase(r.block, b, r.text, r.rev);
        b.sendBase = true;
        return;
      case 'gone':
        // Ya no está en el servidor (lo borró otra persona) o no es de esta página (sincronizado).
        if (b.inflight?.seq === r.seq) b.inflight = null;
        this.blocks.delete(r.block);
        this.unsupported.add(r.block);
        return;
      case 'unsupported':
      case 'too_large':
        this.unmanage(r.block, r.status);
        return;
    }
  }

  /** Eventos del feed en vivo (y las respuestas propias). */
  receive(ev: CoeditEvent) {
    if (ev.kind !== 'op') return;
    if (this.screen.busy()) {
      this.deferred.push(ev);
      setTimeout(() => this.drainDeferred(), 60);
      return;
    }
    const b = this.blocks.get(ev.block);
    if (!b) {
      // Bloque que todavía no llegó a la base (lo creó otra persona hace un instante).
      if (!this.unsupported.has(ev.block)) {
        this.deferred.push(ev);
        if (this.deferred.length > 500) this.deferred.splice(0, this.deferred.length - 500);
      }
      return;
    }
    if (b.rev === null) {
      const h = textHash(b.S);
      if (h === ev.hb) b.rev = ev.rev - 1;
      else if (h === ev.ha) {
        b.rev = ev.rev;
        // Puede ser la propia (la base ya la incluye).
        if (b.inflight && b.inflight.seq === ev.seq) b.inflight = null;
        return;
      } else {
        b.buffer.set(ev.rev, ev);
        this.askResync(ev.block, b);
        return;
      }
    }
    if (ev.rev <= b.rev) return;
    b.buffer.set(ev.rev, ev);
    this.drain(ev.block, b);
  }

  private drainDeferred() {
    if (this.screen.busy()) {
      if (this.deferred.length) setTimeout(() => this.drainDeferred(), 60);
      return;
    }
    const list = this.deferred.splice(0);
    const keep: OpEvent[] = [];
    for (const e of list) {
      if (this.blocks.has(e.block)) this.receive(e);
      else if (!this.unsupported.has(e.block)) keep.push(e);
    }
    this.deferred.push(...keep);
  }

  private drain(id: string, b: BlockSync) {
    while (b.rev !== null) {
      const ev = b.buffer.get(b.rev + 1);
      if (!ev) break;
      if (ev.hb && textHash(b.S) !== ev.hb) {
        // Desfasado: se pide el texto actual.
        this.askResync(id, b);
        return;
      }
      b.buffer.delete(ev.rev);
      this.applyEvent(id, b, ev);
    }
    for (const r of [...b.buffer.keys()]) if (b.rev !== null && r <= b.rev) b.buffer.delete(r);
    if (b.gapTimer && !b.buffer.size) {
      clearTimeout(b.gapTimer);
      b.gapTimer = null;
    }
    if (b.buffer.size && !b.gapTimer && !b.resync) {
      // Falta una versión: si no llega enseguida, se pide el texto actual.
      b.gapTimer = setTimeout(() => {
        b.gapTimer = null;
        if (b.buffer.size) this.askResync(id, b);
      }, this.opts.gapMs ?? 2000);
    }
  }

  private applyEvent(id: string, b: BlockSync, ev: OpEvent) {
    if (b.inflight && ev.session === this.session && ev.seq === b.inflight.seq) {
      // La propia, confirmada (ya transformada por el servidor igual que acá).
      const sent = apply(b.S, b.inflight.op);
      b.S = apply(b.S, ev.op);
      b.inflight = null;
      b.rev = ev.rev;
      // El servidor la guardó saneada (sacó algo que el editor no admite): la pantalla queda igual que lo guardado.
      if (b.S !== sent) {
        const V = this.screen.get(id);
        if (V === null) return;
        const R = diff(sent, b.S);
        const [, R2] = transform(diff(sent, V), R);
        if (!isNoop(R2)) this.screen.set(id, apply(V, R2), R2, V);
      }
      return;
    }
    const R = ev.op;
    // Cambio de un guardado de página (sin sesión) que la pantalla ya tiene: el eco
    // del guardado propio cuando el texto viajó en el guardado (modo sugerir) o
    // de un guardado que ya se fusionó acá. Transformarlo lo escribiría dos veces.
    if (ev.session === null && !b.inflight) {
      const V0 = this.screen.get(id);
      const after = apply(b.S, R);
      if (V0 !== null && (V0 === after || opSize(diff(after, V0)) < opSize(diff(b.S, V0)))) {
        b.S = after;
        b.rev = ev.rev;
        return;
      }
    }
    const known = b.inflight ? apply(b.S, b.inflight.op) : b.S;
    const inflight = b.inflight;
    let R1 = R;
    if (b.inflight) {
      const [inf2, r1] = transform(b.inflight.op, R);
      b.inflight.op = inf2;
      b.inflight.base = apply(b.S, R);
      b.inflight.rev = ev.rev;
      R1 = r1;
    }
    b.S = apply(b.S, R);
    b.rev = ev.rev;
    const V = this.screen.get(id);
    if (V === null) return;
    const B = diff(known, V);
    const [, R2] = transform(B, R1);
    if (isNoop(R2)) return;
    this.trace({ block: id, at: Date.now(), prev: V, op: R2, own: !!inflight || !isNoop(B) || this.recentOwn(id) });
    this.screen.set(id, apply(V, R2), R2, V);
  }

  private trace(t: RemoteTrace) {
    const now = t.at;
    this.traces = this.traces.filter((x) => now - x.at < TRACE_MS).slice(-40);
    this.traces.push(t);
  }

  private recentOwn(id: string) {
    return Date.now() - (this.ownAt.get(id) ?? 0) < OWN_MS;
  }

  /** Hay algo propio en el bloque: sin confirmar, en pantalla sin mandar o escrito hace un momento. */
  ownIn(id: string): boolean {
    const b = this.blocks.get(id);
    if (b && (b.inflight || (this.screen.get(id) ?? b.S) !== b.S)) return true;
    return this.recentOwn(id);
  }

  /**
   * Llegó un cambio de estructura de otra persona (partir o unir el bloque
   * donde se escribía): lo propio pasa al bloque que corresponde. Ver
   * lib/docs-coedit-remap.ts. Si mueve algo, las operaciones salen enseguida.
   */
  remap<B extends RemapBlock>(prev: B[], theirs: RemapBlock[], merged: B[], caret: RemapCaret | null): RemapResult<B> | null {
    const now = Date.now();
    const traces = this.traces.filter((x) => now - x.at < TRACE_MS);
    if (!traces.length) return null;
    const res = remapStructure(prev, theirs, merged, traces, caret, (id) => this.ownIn(id));
    if (res) {
      // Ya se usaron: una fusión siguiente no vuelve a mover lo mismo.
      const used = new Set(res.touched);
      this.traces = this.traces.filter((x) => !used.has(x.block));
      this.localChanged();
    }
    return res;
  }

  /**
   * Trae el texto actual del bloque y fusiona: lo propio (en pantalla) se
   * transforma contra lo que cambió en el servidor.
   */
  private askResync(id: string, b: BlockSync) {
    if (b.resync) return;
    b.resync = true;
    const run = async () => {
      // Con un envío en camino se espera su respuesta.
      for (let i = 0; i < 50 && this.sending; i++) await new Promise((r) => setTimeout(r, 100));
      try {
        const snap = (await this.transport.snapshot([id]))[id];
        b.resync = false;
        if (!snap) {
          this.blocks.delete(id);
          return;
        }
        // Mientras tanto se puso al día solo (llegó lo que faltaba).
        if (b.rev !== null && snap.rev <= b.rev && !b.buffer.size) return;
        this.rebase(id, b, snap.text, snap.rev);
        this.drain(id, b);
        this.localChanged();
      } catch {
        b.resync = false;
        setTimeout(() => this.askResync(id, b), 2000);
      }
    };
    void run();
  }

  /**
   * Compara la base de cada bloque con el servidor y, si no coincide (algo se
   * perdió en el camino: reconexión, borrador que se mandó antes de conectar),
   * trae el texto actual y rebasa lo propio encima. Bloques con algo en vuelo
   * se dejan: su confirmación lo pone al día.
   */
  async verify(ids?: string[]): Promise<void> {
    const list = (ids ?? [...this.blocks.keys()]).filter((id) => {
      const b = this.blocks.get(id);
      return !!b && !b.inflight && !b.resync;
    });
    for (let i = 0; i < list.length; i += 50) {
      const chunk = list.slice(i, i + 50);
      // Lo que tenía cada bloque al pedir la foto: si mientras tanto entró algo (eventos,
      // la confirmación de un envío), ese camino ya lo puso al día y no se toca.
      const seen = new Map(chunk.map((id) => [id, { S: this.blocks.get(id)?.S, rev: this.blocks.get(id)?.rev }]));
      let snap: Record<string, { rev: number; text: string } | null>;
      try {
        snap = await this.transport.snapshot(chunk);
      } catch {
        return;
      }
      for (const id of chunk) {
        const b = this.blocks.get(id);
        const s = snap[id];
        if (!b || !s || b.inflight || b.resync) continue;
        const was = seen.get(id);
        if (!was || was.S !== b.S || was.rev !== b.rev) continue;
        if (s.text === b.S && (b.rev === null || b.rev === s.rev)) continue;
        if (b.rev !== null && s.rev < b.rev) continue;
        this.rebase(id, b, s.text, s.rev);
        this.drain(id, b);
      }
    }
    this.localChanged();
  }

  /** El servidor tiene `text` en la versión `rev`: lo propio que no tiene se rebasa encima. */
  private rebase(id: string, b: BlockSync, text: string, rev: number) {
    if (b.gapTimer) clearTimeout(b.gapTimer);
    b.gapTimer = null;
    // ¿La en vuelo ya entró? (su confirmación está entre lo recibido hasta esa versión)
    const f = b.inflight;
    const applied = !!f && [...b.buffer.values()].some((e) => e.session === this.session && e.seq === f.seq && e.rev <= rev);
    const known = f && applied ? apply(b.S, f.op) : b.S;
    // Si no entró, sigue en pantalla y se manda de nuevo como pendiente.
    b.inflight = null;
    const V = this.screen.get(id);
    b.S = text;
    b.rev = rev;
    for (const r of [...b.buffer.keys()]) if (r <= rev) b.buffer.delete(r);
    if (V === null) return;
    const R = diff(known, text);
    if (isNoop(R)) return;
    const [, R2] = transform(diff(known, V), R);
    if (!isNoop(R2)) this.screen.set(id, apply(V, R2), R2, V);
  }
}

/**
 * Nonces de un solo uso para "tomar notas" (puro). main los crea cuando la
 * persona toca el aviso o el menú, los pone en la URL de Voice y la página
 * los canjea por el puente: solo un nonce vigente y sin usar arranca la
 * grabación. Un link copiado (en Talk, un mail) no sirve: o es viejo, o ya
 * se usó, o nunca lo creó esta app.
 */
export const NONCE_RE = /^[A-Za-z0-9_-]{22,64}$/;
export const NONCE_TTL_MS = 2 * 60_000;

export class NonceStore {
  private items = new Map<string, number>();

  constructor(private ttlMs = NONCE_TTL_MS) {}

  add(nonce: string, now: number) {
    this.prune(now);
    this.items.set(nonce, now + this.ttlMs);
  }

  /** true una sola vez por nonce, y solo si no venció. */
  consume(nonce: unknown, now: number): boolean {
    if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) return false;
    const until = this.items.get(nonce);
    this.items.delete(nonce);
    return until !== undefined && now <= until;
  }

  private prune(now: number) {
    for (const [k, until] of this.items) if (until < now) this.items.delete(k);
  }
}

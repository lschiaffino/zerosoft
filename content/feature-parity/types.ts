/**
 * Esquema de la paridad de funciones contra el competidor principal de cada
 * app. Un archivo por producto (content/feature-parity/<product>.ts) es la
 * única fuente: la página de producto, el índice /products y los tests leen
 * de ahí. El porcentaje se calcula con computeParity (lib/feature-parity.ts),
 * nunca se escribe a mano.
 *
 * Es nuestra evaluación: la armamos leyendo el código de main contra la
 * documentación pública del competidor (docs/benchmark/<app>.md).
 */

/** Texto en los tres idiomas del sitio. */
export interface Localized {
  en: string;
  es: string;
  pt: string;
}

/**
 * - have: funciona de punta a punta.
 * - partial: existe con menos alcance que el competidor.
 * - missing: el competidor lo tiene y nosotros no.
 * - better: lo hacemos y el competidor no, o lo hacemos mejor.
 */
export type ParityStatus = 'have' | 'partial' | 'missing' | 'better';

export interface ParityArea {
  /** id corto en kebab-case, único dentro del producto ("editing"). */
  id: string;
  label: Localized;
}

export interface ParityRow {
  /** id estable en kebab-case, único dentro del producto ("realtime-editing"). Lo referencian las ideas (`parity`). */
  id: string;
  /** id de un área de `areas`. */
  area: string;
  label: Localized;
  /** Detalle corto: el alcance real, con números si los hay. */
  detail?: Localized;
  status: ParityStatus;
  /** El competidor lo tiene. Solo estas filas cuentan para el porcentaje. */
  competitorHas: boolean;
  /** 2 = capacidad central para un equipo que viene del competidor. Por defecto 1. */
  weight?: 1 | 2;
}

export interface ProductParity {
  /** Competidor principal (el de la comparación). */
  competitor: string;
  /** Otros con los que también se miró, solo de referencia. */
  alsoCompared?: string[];
  /** Última revisión contra el código de main (YYYY-MM-DD). */
  lastReviewed: string;
  areas: ParityArea[];
  rows: ParityRow[];
}

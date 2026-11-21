/**
 * Tours guiados por app: pasos que resaltan una parte de la pantalla con una
 * tarjeta chica (título, texto, Siguiente / Atrás / Saltear paso / Salir y
 * "No mostrar más tours").
 *
 * Un tour nuevo es una lista de pasos (un archivo en lib/tours/, sumado a
 * TOURS) más los anclajes `data-tour="<nombre>"` en los componentes, y los
 * textos en messages/<locale>/common.json › tour.<tour>.<paso>.{title,body}.
 * El motor (components/tour/TourHost.tsx) y el estado por persona
 * (lib/tours/server.ts, users.profile.tours) son los mismos para todas.
 *
 * Puro: lo usan el servidor, el cliente y los tests.
 */
import { BOARD_TOUR } from './board';
import { DOCS_TOUR } from './docs';
import { INBOX_TOUR } from './inbox';
import { LINES_TOUR } from './lines';
import { NOTES_TOUR } from './notes';
import { TRACK_TOUR } from './track';

export const TOUR_KEYS = ['lines', 'inbox', 'notes', 'track', 'docs', 'board'] as const;
export type TourKey = (typeof TOUR_KEYS)[number];

/** Para quién es un paso: equipo (asignar, notas, acceso a líneas) o persona sola. */
export type TourAudience = 'team' | 'solo';

export interface TourStep {
  /** Id estable: se guarda como progreso y arma la clave del texto. */
  id: string;
  /** Nombres de `data-tour`; el primero que está a la vista gana. Sin targets, la tarjeta va centrada. */
  targets?: readonly string[];
  /** Si ninguno de los targets está a la vista: saltear el paso (default) o mostrarlo centrado. */
  ifMissing?: 'skip' | 'center';
  /** Solo para equipo o solo para quien usa la app sola. */
  audience?: TourAudience;
  /** Solo para quien administra el workspace (ajustes de la app). */
  adminOnly?: boolean;
  /** El paso se cumple usando el elemento (clic): en vez de Siguiente se ofrece Saltear paso. */
  advanceOn?: 'click';
  /** Si no se sabe si es equipo o persona sola, este paso lo pregunta (una vez). */
  askAudience?: boolean;
}

export interface TourDef {
  key: TourKey;
  /** Dónde arranca (ruta sin locale): solo ahí se abre solo, y adonde lleva reiniciarlo. */
  startPath: string;
  /** Prefijos de ruta donde el tour existe (el menú de la cuenta ofrece reiniciarlo). */
  paths: readonly string[];
  steps: readonly TourStep[];
}

export const TOURS: Record<TourKey, TourDef> = {
  lines: LINES_TOUR,
  inbox: INBOX_TOUR,
  notes: NOTES_TOUR,
  track: TRACK_TOUR,
  docs: DOCS_TOUR,
  board: BOARD_TOUR,
};

/** Evento para abrir un tour a mano (menú de la cuenta): `detail.tour` es la clave. Lo escucha TourHost. */
export const TOUR_START_EVENT = 'zs:tour-start';

export function requestTour(tour: TourKey): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TOUR_START_EVENT, { detail: { tour } }));
}

export function isTourKey(v: unknown): v is TourKey {
  return typeof v === 'string' && (TOUR_KEYS as readonly string[]).includes(v);
}

/** Quita el prefijo de idioma (/es/app/lines → /app/lines). */
export function stripLocale(pathname: string): string {
  return pathname.replace(/^\/(?:en|es|pt)(?=\/|$)/, '') || '/';
}

/** El tour de la app en esta ruta (con o sin locale), o null. */
export function tourForPath(pathname: string | null | undefined): TourDef | null {
  if (!pathname) return null;
  const p = stripLocale(pathname);
  for (const key of TOUR_KEYS) {
    const def = TOURS[key];
    if (def.paths.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) return def;
  }
  return null;
}

/** La ruta es la de arranque del tour (con o sin locale). */
export function atTourStart(def: TourDef, pathname: string | null | undefined): boolean {
  return Boolean(pathname) && stripLocale(pathname!) === def.startPath;
}

/**
 * Pasos que le tocan a esta persona. Sin saber si es equipo, los de equipo
 * quedan afuera hasta que conteste (la pregunta va en el primer paso).
 */
export function stepsFor(def: TourDef, who: { audience: TourAudience | null; admin: boolean }): TourStep[] {
  return def.steps.filter((s) => {
    if (s.audience && s.audience !== (who.audience ?? 'solo')) return false;
    if (s.adminOnly && !who.admin) return false;
    return true;
  });
}

// ---------- Estado por persona (users.profile.tours) ----------

export type TourStatus = 'active' | 'done' | 'exited';

export interface TourProgress {
  status: TourStatus;
  /** Último paso mostrado (id), para retomar después de recargar. */
  step?: string;
  at: string;
}

export interface ToursProfile {
  /** "No mostrar más tours": ninguno se abre solo (se pueden reiniciar a mano). */
  off?: boolean;
  /** Respuesta a "¿la usás sola o con tu equipo?" cuando el workspace no lo dice. */
  audience?: TourAudience;
  seen?: Partial<Record<TourKey, TourProgress>>;
}

export function parseTours(raw: unknown): ToursProfile {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: ToursProfile = {};
  if (r.off === true) out.off = true;
  if (r.audience === 'team' || r.audience === 'solo') out.audience = r.audience;
  if (r.seen && typeof r.seen === 'object') {
    const seen: Partial<Record<TourKey, TourProgress>> = {};
    for (const [k, v] of Object.entries(r.seen as Record<string, unknown>)) {
      if (!isTourKey(k) || !v || typeof v !== 'object') continue;
      const p = v as Record<string, unknown>;
      if (p.status !== 'active' && p.status !== 'done' && p.status !== 'exited') continue;
      seen[k] = { status: p.status, step: typeof p.step === 'string' ? p.step : undefined, at: typeof p.at === 'string' ? p.at : '' };
    }
    out.seen = seen;
  }
  return out;
}

/** Lo que el cliente necesita para arrancar el tour de una app. */
export interface TourBoot {
  tour: TourKey;
  /** Se abre solo al entrar a la ruta de arranque. */
  auto: boolean;
  /** Paso donde quedó (si estaba a medias). */
  resume: string | null;
  audience: TourAudience | null;
  admin: boolean;
  off: boolean;
}

/**
 * Se abre solo: la persona pasó por el onboarding actual (perfil v2, el mismo
 * corte que "Primeros pasos"), no apagó los tours y este no lo terminó ni lo
 * cerró. Las cuentas de antes lo tienen a mano desde el menú de la cuenta.
 */
export function shouldAutoStart(input: { onboarded: boolean; profileVersion: number; tours: ToursProfile; tour: TourKey }): boolean {
  if (!input.onboarded || input.profileVersion < 2 || input.tours.off) return false;
  const p = input.tours.seen?.[input.tour];
  return !p || p.status === 'active';
}

/**
 * Equipo o persona sola, sacado del workspace: alguien más en el espacio (o
 * entrar al de otro) es equipo; si no, lo que dijo en el onboarding
 * (teams.use_mode); sin dato, lo que contestó en el tour; si tampoco, null
 * (se pregunta).
 */
export function deduceAudience(input: { acting: boolean; people: number; useMode: string | null | undefined; answer: TourAudience | undefined }): TourAudience | null {
  if (input.acting || input.people > 1) return 'team';
  if (input.useMode === 'personal') return 'solo';
  if (input.useMode === 'team') return 'team';
  return input.answer ?? null;
}

/**
 * Anchos de los paneles de la bandeja de Lines (lista | conversación |
 * detalles). La persona los cambia arrastrando los divisores y quedan en su
 * navegador. Los números de acá son los mismos que usa styles/groups-wa.css
 * (anchos por defecto y cortes de 1440 y 1024 px).
 */
import { clampWidth, panelMax } from './panel-resize';

/** Tres columnas, dos (los detalles pasan a ser un panel flotante) o una (teléfono y tablet). */
export type LinesPanelMode = 'three' | 'two' | 'one';

export const LINES_PANELS = {
  list: { min: 300, max: 600 },
  details: { min: 280, max: 520, fallback: 340 },
  /** La conversación nunca queda más angosta que esto. */
  conversationMin: 400,
} as const;

export interface SavedPanels {
  list?: number;
  details?: number;
}

export interface PanelState {
  /** Ancho que se ve. */
  value: number;
  min: number;
  max: number;
  /** true: se aplica con una variable CSS. false: manda el ancho por defecto del CSS. */
  custom: boolean;
}

export const linesPanelsKey = (person: string) => `zs-lines-panels:${person || 'me'}`;

export function linesPanelMode(viewportWidth: number): LinesPanelMode {
  if (viewportWidth >= 1440) return 'three';
  if (viewportWidth >= 1024) return 'two';
  return 'one';
}

/** El ancho por defecto de la lista: clamp(340px, 30%, 460px) con detalles al lado, clamp(320px, 34%, 420px) sin ellos. */
export function defaultListWidth(container: number, mode: LinesPanelMode): number {
  return mode === 'three' ? clampWidth(container * 0.3, 340, 460) : clampWidth(container * 0.34, 320, 420);
}

/** Lo guardado en localStorage. Cualquier cosa rara se descarta. */
export function parseSavedPanels(raw: string | null | undefined): SavedPanels {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    const out: SavedPanels = {};
    if (v && typeof v === 'object') {
      for (const k of ['list', 'details'] as const) {
        const n = v[k];
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[k] = Math.round(n);
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Anchos que se ven para lo guardado, el ancho de la bandeja y el modo. Un
 * ancho guardado se acomoda a la ventana de ahora: la lista deja lugar para la
 * conversación y el mínimo de detalles; los detalles, para la conversación y
 * la lista. null: ese divisor no existe en este modo y lo guardado no se usa.
 */
export function resolveLinesPanels(saved: SavedPanels, container: number, mode: LinesPanelMode): { list: PanelState | null; details: PanelState | null } {
  if (mode === 'one') return { list: null, details: null };
  const { list: L, details: D, conversationMin } = LINES_PANELS;
  const listMax = panelMax(container, conversationMin + (mode === 'three' ? D.min : 0), L.min, L.max);
  const list: PanelState = {
    value: clampWidth(saved.list ?? defaultListWidth(container, mode), L.min, listMax),
    min: L.min,
    max: listMax,
    custom: saved.list != null,
  };
  if (mode !== 'three') return { list, details: null };
  const detailsMax = panelMax(container, conversationMin + list.value, D.min, D.max);
  const wanted = saved.details ?? D.fallback;
  const value = clampWidth(wanted, D.min, detailsMax);
  // Sin ancho guardado manda el CSS, salvo que una lista ancha obligue a achicar los detalles.
  const details: PanelState = { value, min: D.min, max: detailsMax, custom: saved.details != null || value !== wanted };
  return { list, details };
}

/** Script en línea: aplica lo guardado antes del primer pintado. El componente lo ajusta a la ventana al montar. */
export function linesPanelsScript(person: string): string {
  const { list: L, details: D } = LINES_PANELS;
  const key = JSON.stringify(linesPanelsKey(person)).replace(/</g, '\\u003c');
  return (
    `try{var v=JSON.parse(localStorage.getItem(${key})||'null'),s=document.documentElement.style;` +
    `if(v){if(v.list>=${L.min}&&v.list<=${L.max})s.setProperty('--gr-list-w',Math.round(v.list)+'px');` +
    `if(v.details>=${D.min}&&v.details<=${D.max})s.setProperty('--gr-details-w',Math.round(v.details)+'px')}}catch(e){}`
  );
}

/** Notes: widgets del inicio (puro). */
export const HOME_WIDGETS = ['scratch', 'tasks', 'recent', 'pinned', 'shared', 'events', 'notebooks', 'tags', 'searches'] as const;
export type HomeWidget = (typeof HOME_WIDGETS)[number];
export const DEFAULT_HOME_WIDGETS: readonly HomeWidget[] = ['scratch', 'tasks', 'recent', 'pinned', 'events', 'notebooks'];

/** Solo widgets que existen, sin repetidos, en el orden pedido. */
export function cleanHomeWidgets(raw: unknown): HomeWidget[] {
  if (!Array.isArray(raw)) return [...DEFAULT_HOME_WIDGETS];
  const seen = new Set<string>();
  const out: HomeWidget[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && (HOME_WIDGETS as readonly string[]).includes(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v as HomeWidget);
    }
  }
  return out;
}

/** Sube o baja un widget en la lista. */
export function moveHomeWidget(list: readonly HomeWidget[], w: HomeWidget, delta: -1 | 1): HomeWidget[] {
  const i = list.indexOf(w);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

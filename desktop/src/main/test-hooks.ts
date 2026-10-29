/**
 * Ganchos para el e2e (ZEROSOFT_DESKTOP_TEST=1): lo que la app habría hecho
 * afuera (abrir el navegador, mostrar un aviso) queda anotado acá y el test
 * lo lee con electronApp.evaluate(). Fuera del modo test no se usa.
 */
export interface ShownNotification {
  title: string;
  body: string;
  click: () => void;
}

export const testHooks = {
  openedExternal: [] as string[],
  notifications: [] as ShownNotification[],
  pasted: [] as string[],
  badge: -1,
  deepLink: (async () => undefined) as (url: string) => Promise<void>,
  pollBadge: (async () => undefined) as () => Promise<void>,
  startDictation: (() => undefined) as () => void,
  stopDictation: (async () => undefined) as () => Promise<void>,
  overlayLabels: [] as string[],
  /** Pedidos de captura (getDisplayMedia) atendidos: con loopback o sin pantalla. */
  displayRequests: [] as Array<'loopback' | 'none'>,
  startNotes: (() => undefined) as (eventKey?: string | null) => void,
};

if (process.env.ZEROSOFT_DESKTOP_TEST === '1') (globalThis as unknown as { __zsTest: typeof testHooks }).__zsTest = testHooks;

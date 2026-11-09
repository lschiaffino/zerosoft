/**
 * Clics en "Descargar la app": un evento download_click en el proyecto de
 * Pulse del propio sitio (ZS_ANALYTICS_SITE_KEY, el mismo que carga el footer)
 * con el lugar del botón (placement) y el sistema. Así se ve en Pulse qué
 * lugar lleva a descargar. Sin la key (self-host, dev, e2e) no guarda nada.
 * Nunca tira: un fallo de Pulse no frena la descarga. Server-only.
 */
import { randomUUID } from 'crypto';
import { projectByKey } from './analytics/projects';
import { storeEvents, requestContext } from './analytics/ingest';
import type { DesktopOs, DownloadPlacement } from './desktop-os';

export const DOWNLOAD_CLICK_EVENT = 'download_click';

function siteKey(): string | null {
  const k = process.env.ZS_ANALYTICS_SITE_KEY ?? '';
  return /^zsp_[a-z0-9]{10,64}$/.test(k) ? k : null;
}

/** Propiedades del evento (aparte para los tests). */
export function downloadClickProps(opts: {
  placement: DownloadPlacement | 'other';
  os: DesktopOs | null;
  locale: string;
  referer: string | null;
  signedIn: boolean;
}): Record<string, unknown> {
  return {
    placement: opts.placement,
    os: opts.os ?? 'none',
    locale: opts.locale,
    signed_in: opts.signedIn,
    // La página donde estaba el botón (sin query: puede traer tokens de otra app).
    ...(opts.referer ? { $current_url: opts.referer.split(/[?#]/)[0] } : {}),
  };
}

export async function recordDownloadClick(req: Request, props: Record<string, unknown>): Promise<void> {
  const key = siteKey();
  if (!key) return;
  try {
    const project = await projectByKey(key, 'public');
    if (!project) return;
    await storeEvents(
      project,
      [{ event: DOWNLOAD_CLICK_EVENT, distinctId: `dl_${randomUUID()}`, properties: props, ts: Date.now(), uuid: randomUUID(), set: null, setOnce: null }],
      requestContext(req),
    );
  } catch {
    /* Pulse caído o sin migrar: la descarga sigue */
  }
}

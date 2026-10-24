'use client';

/**
 * Estado compartido de las llamadas desde el navegador: el CallDock (montado
 * en el layout del CRM) dice si están disponibles y escucha los pedidos de
 * llamada que hacen los botones de teléfono (PhoneTouch) con startBrowserCall.
 */

export interface BrowserCallRequest {
  phone: string;
  name?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
}

export const CALL_EVENT = 'zs:crm-browser-call';

let available = false;
const listeners = new Set<() => void>();

export function setVoiceAvailable(v: boolean): void {
  if (available === v) return;
  available = v;
  listeners.forEach((l) => l());
}

export function subscribeVoice(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function voiceAvailable(): boolean {
  return available;
}

export function startBrowserCall(req: BrowserCallRequest): void {
  window.dispatchEvent(new CustomEvent<BrowserCallRequest>(CALL_EVENT, { detail: req }));
}

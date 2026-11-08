/**
 * Insertar texto en la app que tiene el foco (portapapeles + Cmd/Ctrl+V
 * simulado y después se devuelve lo que había; la lógica está en
 * shared/clipboard.ts).
 *
 * La tecla se manda con uiohook (CGEvent en Mac, SendInput en Windows). En
 * Mac necesita el permiso de Accesibilidad; sin él el texto queda copiado y
 * el overlay lo dice.
 */
import { app, clipboard, systemPreferences } from 'electron';
import { pasteViaClipboard, type ClipboardPort } from '../shared/clipboard';
import { getSettings } from './config';
import { TEST_MODE } from './state';
import { testHooks } from './test-hooks';

type Hook = typeof import('uiohook-napi');
let hook: Hook | null = null;
let lastText = '';

export function setPasteHook(h: Hook | null) {
  hook = h;
}

export function canSimulatePaste(): boolean {
  if (!hook) return false;
  if (process.platform === 'darwin') return systemPreferences.isTrustedAccessibilityClient(false);
  return true;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const electronClipboard: ClipboardPort<Electron.ClipboardItem[]> = {
  snapshot: async () => clipboard.read(),
  isEmpty: (s) => !s.length,
  writeText: (text) => clipboard.writeText(text),
  readText: () => clipboard.readText(),
  restore: (s) => clipboard.write(s),
  clear: () => clipboard.clear(),
};

/** Último texto pegado o copiado por el dictado (para "pegar el último" sin red). */
export function lastInserted(): string {
  return lastText;
}

/** 'pasted' si se simuló la tecla; 'copied' si el texto quedó en el portapapeles para pegar a mano. */
export async function insertText(text: string): Promise<'pasted' | 'copied'> {
  lastText = text;
  if (TEST_MODE) {
    testHooks.pasted.push(text);
    return 'pasted';
  }
  const h = canSimulatePaste() ? hook : null;
  const { how } = await pasteViaClipboard(text, {
    clipboard: electronClipboard,
    tapPaste: h ? () => h.uIOhook.keyTap(h.UiohookKey.V, [process.platform === 'darwin' ? h.UiohookKey.Meta : h.UiohookKey.Ctrl]) : null,
    sleep,
    restore: getSettings().restoreClipboard,
  });
  return how;
}

/**
 * Pegar desde una ventana propia (historial de Ajustes): se esconde zerosoft
 * para que el foco vuelva a la app anterior y ahí se pega.
 */
export async function insertIntoPreviousApp(text: string, hideOwn: () => void): Promise<'pasted' | 'copied'> {
  hideOwn();
  if (process.platform === 'darwin' && !TEST_MODE) app.hide();
  await sleep(TEST_MODE ? 0 : 350);
  return insertText(text);
}

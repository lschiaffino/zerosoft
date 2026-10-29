/**
 * Insertar texto en la app que tiene el foco: se guarda el portapapeles, se
 * escribe el texto, se simula Cmd/Ctrl+V y después se devuelve lo que había
 * (solo si nadie copió otra cosa en el medio).
 *
 * La tecla se manda con uiohook (CGEvent en Mac, SendInput en Windows). En
 * Mac necesita el permiso de Accesibilidad; sin él el texto queda copiado y
 * el overlay lo dice.
 */
import { clipboard, systemPreferences } from 'electron';
import { TEST_MODE } from './state';
import { testHooks } from './test-hooks';

type Hook = typeof import('uiohook-napi');
let hook: Hook | null = null;

export function setPasteHook(h: Hook | null) {
  hook = h;
}

export function canSimulatePaste(): boolean {
  if (!hook) return false;
  if (process.platform === 'darwin') return systemPreferences.isTrustedAccessibilityClient(false);
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 'pasted' si se simuló la tecla; 'copied' si el texto quedó en el portapapeles para pegar a mano. */
export async function insertText(text: string): Promise<'pasted' | 'copied'> {
  if (TEST_MODE) {
    testHooks.pasted.push(text);
    return 'pasted';
  }
  if (!canSimulatePaste() || !hook) {
    await clipboard.writeText(text);
    return 'copied';
  }
  // Todo lo que había (texto, HTML, imágenes, archivos), para devolverlo igual.
  const saved = await clipboard.read().catch(() => [] as Electron.ClipboardItem[]);
  await clipboard.writeText(text);
  const { uIOhook, UiohookKey } = hook;
  uIOhook.keyTap(UiohookKey.V, [process.platform === 'darwin' ? UiohookKey.Meta : UiohookKey.Ctrl]);
  // La app de destino lee el portapapeles al procesar la tecla: se espera antes de devolverlo.
  await sleep(450);
  if ((await clipboard.readText().catch(() => '')) === text) {
    if (saved.length) await clipboard.write(saved).catch(() => undefined);
    else clipboard.clear();
  }
  return 'pasted';
}

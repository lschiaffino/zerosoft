/**
 * Preload de la ventana de la app (sandbox, contextIsolation). Expone
 * window.zerosoftDesktop solo si la página es del servidor configurado: main
 * responde app-info únicamente a ese origen, y además valida cada mensaje.
 * Nada de Node, ni el token, ni IPC genérico llega a la página.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type AppInfo } from '../shared/ipc';

const info = ipcRenderer.sendSync(IPC.appInfo) as (AppInfo & { server: string }) | null;

// Sin DOM en los tipos del preload: location existe igual en el renderer.
const origin = (globalThis as unknown as { location: { origin: string } }).location.origin;
if (info && origin === info.server) {
  const bridge = Object.freeze({
    version: info.version,
    platform: info.platform,
    systemAudio: info.systemAudio,
    dictation: info.dictation,
    /** Login con Google en el navegador del sistema (vuelve por zerosoft://). */
    startLogin: () => ipcRenderer.send(IPC.startLogin),
    /** Ajustes del escritorio: atajo, permisos, servidor. */
    openSettings: () => ipcRenderer.send(IPC.openSettings),
    /** Canjea el nonce de "tomar notas" (lo creó main al tocar el aviso o el menú): true una sola vez. */
    consumeAutostart: (nonce: string) => ipcRenderer.invoke(IPC.consumeAutostart, String(nonce).slice(0, 80)) as Promise<boolean>,
  });
  contextBridge.exposeInMainWorld('zerosoftDesktop', bridge);
}

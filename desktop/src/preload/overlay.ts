/** Preload del overlay de dictado: recibe el estado y devuelve el audio grabado. */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type OverlayAudio, type OverlayState } from '../shared/ipc';

contextBridge.exposeInMainWorld('zsOverlay', {
  onState: (cb: (s: OverlayState) => void) => {
    ipcRenderer.on(IPC.overlayState, (_e, s: OverlayState) => cb(s));
  },
  sendAudio: (a: OverlayAudio) => ipcRenderer.send(IPC.overlayAudio, a),
});

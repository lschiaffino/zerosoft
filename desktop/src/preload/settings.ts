/** Preload de Ajustes: leer, guardar y pedir permisos. */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type PermissionKind, type SettingsInput, type SettingsView } from '../shared/ipc';

contextBridge.exposeInMainWorld('zsSettings', {
  get: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<SettingsView | null>,
  save: (input: SettingsInput) => ipcRenderer.invoke(IPC.settingsSave, input) as Promise<{ ok: boolean; error?: string; view?: SettingsView }>,
  ask: (kind: PermissionKind) => ipcRenderer.invoke(IPC.permissionAsk, kind) as Promise<SettingsView | null>,
  onRefresh: (cb: () => void) => {
    ipcRenderer.on(IPC.settingsGet, () => cb());
  },
});

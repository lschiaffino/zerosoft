/** Preload de Ajustes: leer y guardar ajustes, permisos, y lo de Voice en el servidor (por main, con la sesión). */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type PermissionKind, type SettingsInput, type VoiceServerSettings } from '../shared/ipc';

contextBridge.exposeInMainWorld('zsSettings', {
  get: () => ipcRenderer.invoke(IPC.settingsGet),
  save: (input: SettingsInput) => ipcRenderer.invoke(IPC.settingsSave, input),
  ask: (kind: PermissionKind) => ipcRenderer.invoke(IPC.permissionAsk, kind),
  onRefresh: (cb: () => void) => {
    ipcRenderer.on(IPC.settingsGet, () => cb());
  },
  onTab: (cb: (tab: string) => void) => {
    ipcRenderer.on(IPC.settingsTab, (_e, tab: unknown) => cb(String(tab)));
  },
  voiceGet: () => ipcRenderer.invoke(IPC.voiceGet),
  voiceSave: (patch: Partial<VoiceServerSettings>) => ipcRenderer.invoke(IPC.voiceSave, patch),
  dictionaryList: () => ipcRenderer.invoke(IPC.dictionaryList),
  dictionaryAdd: (input: { kind: string; phrase: string; replacement?: string }) => ipcRenderer.invoke(IPC.dictionaryAdd, input),
  dictionaryDelete: (id: string) => ipcRenderer.invoke(IPC.dictionaryDelete, id),
  historyList: () => ipcRenderer.invoke(IPC.historyList),
  historyCopy: (text: string) => ipcRenderer.invoke(IPC.historyCopy, text),
  historyPaste: (text: string) => ipcRenderer.invoke(IPC.historyPaste, text),
  pendingRetry: (id: string) => ipcRenderer.invoke(IPC.pendingRetry, id),
  pendingDiscard: (id: string) => ipcRenderer.invoke(IPC.pendingDiscard, id),
  signIn: () => ipcRenderer.invoke(IPC.accountSignIn),
  signOut: () => ipcRenderer.invoke(IPC.accountSignOut),
  openVoice: (which: 'history' | 'settings' | 'download') => ipcRenderer.invoke(IPC.openVoice, which),
});

/**
 * Permisos de macOS (micrófono, Accesibilidad, Grabación de pantalla y audio
 * del sistema). En Windows no hay nada que pedir: se informan como
 * 'not-needed' (el micrófono lo maneja la configuración de privacidad).
 */
import { shell, systemPreferences } from 'electron';
import type { PermissionKind, PermissionStatus } from '../shared/ipc';

const PANES: Record<PermissionKind, string> = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
};

export function permissionStatus(kind: PermissionKind): PermissionStatus {
  if (process.platform !== 'darwin') {
    if (kind === 'microphone' && process.platform === 'win32') {
      const s = systemPreferences.getMediaAccessStatus('microphone');
      return s === 'granted' || s === 'denied' ? s : 'not-needed';
    }
    return 'not-needed';
  }
  if (kind === 'accessibility') return systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied';
  return systemPreferences.getMediaAccessStatus(kind) as PermissionStatus;
}

export function allPermissions(): Record<PermissionKind, PermissionStatus> {
  return {
    microphone: permissionStatus('microphone'),
    accessibility: permissionStatus('accessibility'),
    screen: permissionStatus('screen'),
  };
}

/**
 * Pide el permiso: el micrófono con el diálogo del sistema; Accesibilidad
 * con el aviso que lleva a Ajustes; pantalla abre el panel (macOS no tiene
 * diálogo para pedirla desde código sin intentar capturar).
 */
export async function askPermission(kind: PermissionKind): Promise<PermissionStatus> {
  if (process.platform !== 'darwin') return permissionStatus(kind);
  if (kind === 'microphone') {
    const status = permissionStatus('microphone');
    if (status === 'not-determined') await systemPreferences.askForMediaAccess('microphone');
    else if (status !== 'granted') await shell.openExternal(PANES.microphone);
  } else if (kind === 'accessibility') {
    if (!systemPreferences.isTrustedAccessibilityClient(true)) await shell.openExternal(PANES.accessibility);
  } else {
    await shell.openExternal(PANES.screen);
  }
  return permissionStatus(kind);
}

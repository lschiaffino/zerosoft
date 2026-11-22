import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopBridge, desktopHasSettings, desktopHasTabs, desktopUsesUpdateFeed, type DesktopBridge } from '@/lib/desktop-bridge';

const noop = () => {};
/** Lo que define bridge_script en desktop/src-tauri/src/lib.rs (sin campos de capacidad). */
const tauri = { version: '0.3.9', platform: 'darwin', systemAudio: true, dictation: true, startLogin: noop, openSettings: noop };
/** Lo que define BridgeScript.swift en desktop-mac (bloque 3). */
const swift = {
  version: '0.1.0',
  platform: 'darwin',
  systemAudio: false,
  dictation: false,
  settingsWindow: false,
  updateFeed: false,
  tabs: false,
  store: false,
  lockdown: false,
  startLogin: noop,
  openSettings: noop,
};

afterEach(() => vi.unstubAllGlobals());

describe('desktopBridge() reconoce las dos apps de escritorio', () => {
  it('Tauri y Swift por startLogin; sin startLogin (bloque 2 de Swift) o en el navegador, null', () => {
    vi.stubGlobal('window', { zerosoftDesktop: tauri });
    expect(desktopBridge()).toBe(tauri);
    vi.stubGlobal('window', { zerosoftDesktop: swift });
    expect(desktopBridge()).toBe(swift);
    vi.stubGlobal('window', { zerosoftDesktop: { version: '0.1.0', platform: 'darwin', info: noop } });
    expect(desktopBridge()).toBeNull();
    vi.stubGlobal('window', {});
    expect(desktopBridge()).toBeNull();
  });

  it('sin el campo, Tauri tiene Ajustes, feed de actualizaciones y pestañas; Swift todavía no', () => {
    const t = tauri as DesktopBridge;
    const s = swift as DesktopBridge;
    expect([desktopHasSettings(t), desktopUsesUpdateFeed(t), desktopHasTabs(t)]).toEqual([true, true, true]);
    expect([desktopHasSettings(s), desktopUsesUpdateFeed(s), desktopHasTabs(s)]).toEqual([false, false, false]);
    expect([desktopHasSettings(null), desktopUsesUpdateFeed(null), desktopHasTabs(null)]).toEqual([false, false, false]);
  });
});

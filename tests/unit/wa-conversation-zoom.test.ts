import { describe, expect, it } from 'vitest';
import { ZOOM_MAX, ZOOM_MIN, clampZoom, isPinchWheel, readStoredZoom, zoomAfterGesture, zoomAfterWheel } from '@/lib/wa-conversation-zoom';

/** El zoom de la conversación (Lines e Inbox): qué cuenta como pellizco y cómo cambia el nivel. */

describe('zoom de la conversación', () => {
  it('un pellizco del trackpad es un wheel con ctrlKey y deltas chicos; Ctrl + rueda del mouse no', () => {
    expect(isPinchWheel({ ctrlKey: true, deltaMode: 0, deltaY: -3.5 })).toBe(true);
    expect(isPinchWheel({ ctrlKey: true, deltaMode: 0, deltaY: 24 })).toBe(true);
    // Scroll común.
    expect(isPinchWheel({ ctrlKey: false, deltaMode: 0, deltaY: -3.5 })).toBe(false);
    // Rueda del mouse con Ctrl: saltos de 100 o más, o por renglones.
    expect(isPinchWheel({ ctrlKey: true, deltaMode: 0, deltaY: 100 })).toBe(false);
    expect(isPinchWheel({ ctrlKey: true, deltaMode: 0, deltaY: -120 })).toBe(false);
    expect(isPinchWheel({ ctrlKey: true, deltaMode: 1, deltaY: 3 })).toBe(false);
    expect(isPinchWheel({ ctrlKey: true, deltaMode: 0, deltaY: 0 })).toBe(false);
  });

  it('acercar agranda, alejar achica, con tope en 100% y 200%', () => {
    expect(zoomAfterWheel(1, -10)).toBeGreaterThan(1);
    expect(zoomAfterWheel(1.5, 10)).toBeLessThan(1.5);
    // La curva del navegador: deltaY = -100 · ln(escala).
    expect(zoomAfterWheel(1, -100 * Math.log(1.5))).toBeCloseTo(1.5, 5);
    expect(zoomAfterWheel(1, 30)).toBe(ZOOM_MIN);
    expect(zoomAfterWheel(1.9, -40)).toBe(ZOOM_MAX);
    let z = 1;
    for (let i = 0; i < 200; i++) z = zoomAfterWheel(z, -8);
    expect(z).toBe(ZOOM_MAX);
    for (let i = 0; i < 200; i++) z = zoomAfterWheel(z, 8);
    expect(z).toBe(ZOOM_MIN);
  });

  it('el gesto de Safari escala desde el nivel con el que empezó', () => {
    expect(zoomAfterGesture(1, 1.4)).toBeCloseTo(1.4, 5);
    expect(zoomAfterGesture(1.5, 0.8)).toBeCloseTo(1.2, 5);
    expect(zoomAfterGesture(1.5, 3)).toBe(ZOOM_MAX);
    expect(zoomAfterGesture(1.2, 0.2)).toBe(ZOOM_MIN);
    expect(zoomAfterGesture(1.3, Number.NaN)).toBe(1.3);
    expect(zoomAfterGesture(1.3, 0)).toBe(1.3);
  });

  it('lo guardado se lee entre 100% y 200%, y cualquier otra cosa es 100%', () => {
    expect(readStoredZoom(null)).toBe(1);
    expect(readStoredZoom('1.5')).toBe(1.5);
    expect(readStoredZoom('9')).toBe(2);
    expect(readStoredZoom('0.4')).toBe(1);
    expect(readStoredZoom('grande')).toBe(1);
    expect(readStoredZoom('')).toBe(1);
    expect(clampZoom(1.2345)).toBe(1.23);
    // Casi 100% es 100%: no queda un zoom que no se nota y no se puede sacar.
    expect(clampZoom(1.015)).toBe(1);
  });
});

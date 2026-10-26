'use client';

import { contextForPath, type VoiceContext } from '@/lib/voice-types';

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', '']);

/** Campo donde se puede dictar: input de texto, textarea o contenteditable (no contraseñas). */
export function editableTarget(el: Element | null): HTMLElement | null {
  if (!el || !(el instanceof HTMLElement)) return null;
  if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el;
  if (el instanceof HTMLInputElement) {
    return TEXT_INPUTS.has(el.type) && !el.readOnly && !el.disabled ? el : null;
  }
  if (el.isContentEditable) return el;
  return null;
}

/** Contexto del campo: data-voice-context en el campo o un ancestro, o según la app. */
export function contextFor(el: HTMLElement | null): VoiceContext {
  const declared = el?.closest('[data-voice-context]')?.getAttribute('data-voice-context');
  if (declared === 'email' || declared === 'chat' || declared === 'note' || declared === 'other') return declared;
  if (el instanceof HTMLInputElement && /subject|asunto|assunto/i.test(`${el.name} ${el.id} ${el.getAttribute('aria-label') ?? ''}`)) return 'email';
  return contextForPath(window.location.pathname);
}

/**
 * Inserta el texto donde está el cursor (con espacio delante si hace falta).
 * execCommand('insertText') mantiene el deshacer y dispara el input que
 * escuchan React y los editores; si no anda, se escribe a mano y se avisa.
 */
export function insertIntoField(el: HTMLElement, text: string): boolean {
  if (!el.isConnected) return false;
  el.focus();
  let toInsert = text;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const pos = el.selectionStart ?? el.value.length;
    const prev = el.value.slice(0, pos);
    if (prev && !/\s$/.test(prev)) toInsert = ` ${text}`;
    if (el instanceof HTMLInputElement) toInsert = toInsert.replace(/\n+/g, ' ');
    if (document.execCommand('insertText', false, toInsert)) return true;
    const end = el.selectionEnd ?? pos;
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const next = el.value.slice(0, pos) + toInsert + el.value.slice(end);
    setter?.call(el, next);
    el.setSelectionRange(pos + toInsert.length, pos + toInsert.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const r = sel.getRangeAt(0);
    const before = r.startContainer.textContent?.slice(0, r.startOffset) ?? '';
    if (before && !/\s$/.test(before)) toInsert = ` ${text}`;
  }
  return document.execCommand('insertText', false, toInsert);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

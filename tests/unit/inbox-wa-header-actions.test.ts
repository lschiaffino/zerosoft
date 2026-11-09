import { describe, expect, it } from 'vitest';
import en from '@/messages/en/inbox.json';
import es from '@/messages/es/inbox.json';
import pt from '@/messages/pt/inbox.json';
import { readFileSync } from 'node:fs';

/** Textos que usan la cabecera y el campo de la conversación de WhatsApp (las acciones de Inbox). */
const MORE = ['pin', 'unpin', 'read', 'unread', 'mute8h', 'muteWeek', 'unmute', 'clearFollowUp', 'unsnooze', 'aiDraft', 'delete', 'deleteConfirm', 'deleteYes', 'cancel'];
const ACTIONS = ['done', 'undone', 'snooze', 'followUp', 'move', 'notes', 'more', 'rename', 'save'];

describe('acciones de Inbox en la conversación de WhatsApp', () => {
  for (const [lang, d] of [['en', en], ['es', es], ['pt', pt]] as const) {
    it(`${lang}: textos de cabecera, menú y campo`, () => {
      const msgs = d as unknown as Record<string, Record<string, unknown>>;
      for (const k of MORE) expect(msgs.more[k], `more.${k}`).toBeTruthy();
      for (const k of ACTIONS) expect(msgs.actions[k], `actions.${k}`).toBeTruthy();
      const tr = msgs.composer.translateTo as Record<string, string>;
      expect(Object.keys(tr).sort()).toEqual(['en', 'es', 'pt']);
      for (const k of ['dictate', 'snippets', 'aiAsk', 'aiDraft', 'aiFromText', 'later', 'undoAi']) expect(msgs.composer[k], `composer.${k}`).toBeTruthy();
    });
  }

  it('la cabecera ofrece cada acción en el menú y los íconos', () => {
    const src = readFileSync('components/inbox/wa/WaConversation.tsx', 'utf8');
    for (const a of ['snooze', 'followUp', 'move', 'unread', 'pin', 'aiDraft', 'mute8h', 'muteWeek', 'unmute', 'clearFollowUp', 'unsnooze', 'delete']) {
      expect(src, a).toContain(`onAction('${a}')`);
    }
    expect(src).toContain("onAction(thread.done ? 'undone' : 'done')");
    expect(src).toContain('onRename');
  });

  it('el campo ofrece IA con instrucción, reescrituras, traducir, dictar y snippets', () => {
    const src = readFileSync('components/inbox/wa/WaComposer.tsx', 'utf8');
    for (const k of ["key: 'ask'", "key: 'draft'", 'REWRITES.map', 'LANGS.map', "key: 'dictate'", "key: 'snippets'", 'zs:voice-dictate']) expect(src, k).toContain(k);
  });
});

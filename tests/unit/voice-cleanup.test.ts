import { describe, expect, it } from 'vitest';
import { applyBacktrack, applyDictionary, formatSpokenList, removeFillers, ruleCleanup, stripHallucinations } from '@/lib/voice-cleanup';
import { cleanupInstructions } from '@/lib/voice-ai';
import { contextForPath, countWords, formatDuration, parseShortcut, speakerKey } from '@/lib/voice-types';

describe('voice cleanup rules', () => {
  it('removes filler words', () => {
    expect(removeFillers('um so the plan is, uh, simple')).toBe('so the plan is, simple');
    expect(removeFillers('eh bueno mmm vamos')).toBe('bueno vamos');
  });

  it('applies spoken self-corrections', () => {
    expect(applyBacktrack("let's meet on Monday, no, I mean Tuesday")).toBe("let's meet on Tuesday");
    expect(applyBacktrack('nos vemos el lunes, no, quise decir el martes')).toBe('nos vemos el martes');
    expect(applyBacktrack('Send it today. Actually send it now, scratch that, tomorrow works')).toBe('Send it today. tomorrow works');
    expect(applyBacktrack('hello from the shortcut, no, I mean from Voice')).toBe('hello from Voice');
    expect(applyBacktrack('compré en la tienda, no, quise decir en la web y listo')).toBe('compré en la web y listo');
  });

  it('formats spoken lists', () => {
    expect(formatSpokenList('we need three things first milk second eggs and third bread')).toBe(
      'We need three things:\n1. Milk\n2. Eggs\n3. Bread',
    );
    expect(formatSpokenList('just one thing')).toBe('just one thing');
  });

  it('applies dictionary replacements, snippets and word casing', () => {
    const entries = [
      { kind: 'replace' as const, phrase: 'zero soft', replacement: 'zerosoft' },
      { kind: 'snippet' as const, phrase: 'my booking link', replacement: 'https://zerosoft.ai/ana' },
      { kind: 'word' as const, phrase: 'Turso', replacement: '' },
    ];
    expect(applyDictionary('book with zero soft at my booking link on turso', entries)).toBe(
      'book with zerosoft at https://zerosoft.ai/ana on Turso',
    );
  });

  it('runs the full pipeline', () => {
    expect(ruleCleanup('um the demo is on monday, no, I mean friday')).toBe('The demo is on friday.');
    expect(ruleCleanup('hola new line chau')).toBe('Hola\nChau.');
    expect(ruleCleanup('   ')).toBe('');
  });
});

describe('voice helpers', () => {
  it('parses shortcuts', () => {
    expect(parseShortcut('Alt+Space')).toEqual({ alt: true, ctrl: false, shift: false, meta: false, code: 'Space' });
    expect(parseShortcut('Ctrl+Shift+D').code).toBe('KeyD');
  });
  it('maps paths to contexts', () => {
    expect(contextForPath('/es/app/chat/inbox')).toBe('chat');
    expect(contextForPath('/app/docs/abc')).toBe('note');
    expect(contextForPath('/app/crm/email')).toBe('email');
    expect(contextForPath('/app/links')).toBe('other');
  });
  it('formats and counts', () => {
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(countWords(' a b  c ')).toBe(3);
    expect(speakerKey('them', '1')).toBe('them:1');
    expect(speakerKey('me', '0')).toBe('me');
  });
});

describe('frases inventadas por el modelo en el silencio', () => {
  it('saca los créditos de subtítulos y el saludo de noticiero donde estén', () => {
    expect(stripHallucinations('hola MBC 뉴스 이덕영입니다.')).toBe('hola');
    expect(stripHallucinations('Nos vemos mañana. Subtítulos realizados por la comunidad de Amara.org')).toBe('Nos vemos mañana.');
  });

  it('una despedida de video se saca solo si es todo el texto', () => {
    expect(stripHallucinations('Thanks for watching!')).toBe('');
    expect(stripHallucinations('Tell them thanks for watching the demo.')).toBe('Tell them thanks for watching the demo.');
    expect(stripHallucinations('La reunión es el martes.')).toBe('La reunión es el martes.');
  });
});

describe('instrucciones de la limpieza con IA', () => {
  it('piden viñetas para enumeraciones y no agregar contenido', () => {
    const t = cleanupInstructions({ context: 'note', tone: 'neutral', words: [] });
    expect(t).toContain('bulleted list');
    expect(t).toContain('never add or reword content');
    expect(t).not.toContain('It is an email');
  });

  it('en un mail, el saludo y la despedida van en su línea solo si se dijeron', () => {
    const t = cleanupInstructions({ context: 'email', tone: 'neutral', words: [] });
    expect(t).toContain('It is an email');
    expect(t).toContain('do not write one');
  });
});

import { describe, expect, it } from 'vitest';
import { emptyDefinition, pipeRedirectUrl } from '@/lib/forms/engine';
import type { FormDefinition, Question } from '@/lib/forms/types';

const q = (id: string, type: Question['type'], extra: Partial<Question> = {}): Question => ({ id, ref: id, type, title: id, description: '', required: false, ...extra });

const def: FormDefinition = {
  ...emptyDefinition('en'),
  questions: [
    q('name', 'short_text'),
    q('email', 'email'),
    q('plan', 'choice', { choices: [{ id: 'p1', label: 'Pro & Team' }] }),
  ],
  hidden: ['utm'],
};
const ctx = { answers: { name: 'Ana María', email: 'ana+x@example.com', plan: 'p1' }, vars: { score: 7 }, hidden: { utm: 'mail' } };

describe('pipeRedirectUrl', () => {
  it('fills answers, variables and hidden fields, URL encoded', () => {
    const url = pipeRedirectUrl('https://cal.example.com/demo?name={{name}}&email={{email}}&plan={{plan}}&s={{score}}&u={{utm}}', def, ctx);
    const parsed = new URL(url);
    expect(parsed.host).toBe('cal.example.com');
    expect(parsed.searchParams.get('name')).toBe('Ana María');
    expect(parsed.searchParams.get('email')).toBe('ana+x@example.com');
    expect(parsed.searchParams.get('plan')).toBe('Pro & Team');
    expect(parsed.searchParams.get('s')).toBe('7');
    expect(parsed.searchParams.get('u')).toBe('mail');
  });

  it('fills the path and the fragment too', () => {
    expect(pipeRedirectUrl('https://example.com/u/{{name}}#{{utm}}', def, ctx)).toBe('https://example.com/u/Ana%20Mar%C3%ADa#mail');
  });

  it('leaves unknown or empty refs empty', () => {
    expect(pipeRedirectUrl('https://example.com/?x={{nope}}', def, { answers: {} })).toBe('https://example.com/?x=');
  });

  it('never lets an answer or hidden field change the host', () => {
    const evil = { answers: { name: 'evil.test/' }, hidden: { utm: '@evil.test' } };
    expect(new URL(pipeRedirectUrl('https://example.com/{{name}}', def, evil)).host).toBe('example.com');
    expect(new URL(pipeRedirectUrl('https://example.com?{{utm}}', def, evil)).host).toBe('example.com');
    // Variables en el host no se reemplazan: quedan afuera.
    expect(pipeRedirectUrl('https://{{name}}', def, evil)).toBe('');
    expect(new URL(pipeRedirectUrl('https://app{{utm}}.example.com/', def, evil)).host).toBe('app.example.com');
  });

  it('keeps a plain URL as it is and rejects what is not https', () => {
    expect(pipeRedirectUrl('https://example.com/thanks', def, ctx)).toBe('https://example.com/thanks');
    expect(pipeRedirectUrl('http://example.com/?e={{email}}', def, ctx)).toBe('');
    expect(pipeRedirectUrl('javascript:alert(1)', def, ctx)).toBe('');
    expect(pipeRedirectUrl('', def, ctx)).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { composeFormDescription, formFieldsSchema, isFormTemplate, newFieldId, parseFormFields, validateFormAnswers, type TrackFormField } from '@/lib/track-forms';

const fields: TrackFormField[] = [
  { id: 'where', label: 'Where', type: 'select', required: true, options: ['Web', 'Mobile'] },
  { id: 'what', label: 'What happened', type: 'textarea', required: true },
  { id: 'url', label: 'URL', type: 'text', required: false },
  { id: 'repro', label: 'I can reproduce it', type: 'checkbox', required: false },
];

describe('track forms: field schema', () => {
  it('keeps options only for lists and drops repeated ones', () => {
    const parsed = formFieldsSchema.parse([
      { id: 'a', label: 'A', type: 'select', options: ['x', 'x', 'y'] },
      { id: 'b', label: 'B', type: 'text', options: ['ignored'] },
    ]);
    expect(parsed[0].options).toEqual(['x', 'y']);
    expect(parsed[1].options).toBeUndefined();
    expect(parsed[1].required).toBe(false);
  });

  it('rejects a list without options, repeated ids and bad ids', () => {
    expect(formFieldsSchema.safeParse([{ id: 'a', label: 'A', type: 'select', options: [] }]).success).toBe(false);
    expect(formFieldsSchema.safeParse([{ id: 'a', label: 'A', type: 'text' }, { id: 'a', label: 'B', type: 'text' }]).success).toBe(false);
    expect(formFieldsSchema.safeParse([{ id: 'a b', label: 'A', type: 'text' }]).success).toBe(false);
  });

  it('reads stored JSON and treats broken JSON as no form', () => {
    expect(parseFormFields(JSON.stringify(fields))).toHaveLength(4);
    expect(parseFormFields('not json')).toEqual([]);
    expect(parseFormFields(null)).toEqual([]);
    expect(isFormTemplate({ fields: '[]' })).toBe(false);
    expect(isFormTemplate({ fields: JSON.stringify(fields) })).toBe(true);
  });
});

describe('track forms: answers', () => {
  it('reports required fields and unknown options', () => {
    const res = validateFormAnswers(fields, { where: 'Desktop', what: '   ' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors).toEqual([
        { fieldId: 'where', code: 'invalid_option' },
        { fieldId: 'what', code: 'required' },
      ]);
    }
  });

  it('requires a ticked box when the checkbox is required', () => {
    const res = validateFormAnswers([{ id: 'ok', label: 'I agree', type: 'checkbox', required: true }], { ok: false });
    expect(res.ok).toBe(false);
  });

  it('builds the description in form order, skipping empty answers', () => {
    const res = validateFormAnswers(fields, { where: 'Web', what: 'It crashed\n\nTwice', url: '', repro: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(composeFormDescription(fields, res.values, { details: '  extra  ' })).toBe(
      '**Where**\nWeb\n\n**What happened**\n\nIt crashed\n\nTwice\n\n- [x] I can reproduce it\n\nextra',
    );
  });

  it('a one-line answer cannot start a heading or a list', () => {
    const one: TrackFormField[] = [{ id: 't', label: 'T', type: 'text', required: false }];
    expect(composeFormDescription(one, { t: '# big' })).toBe('**T**\n\\# big');
    expect(composeFormDescription(one, { t: '- item' })).toBe('**T**\n\\- item');
  });

  it('new field ids never clash', () => {
    expect(newFieldId([{ id: 'f2' }, { id: 'f3' }])).toBe('f4');
    expect(newFieldId([{ id: 'f1' }])).toBe('f2');
    expect(newFieldId([])).toBe('f1');
  });
});

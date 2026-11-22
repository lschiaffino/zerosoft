import { describe, expect, it, vi } from 'vitest';
import { slashToCommandActions } from '@/lib/slash-cmdk';
import { matchesQuery } from '@/lib/cmdk-context';
import type { SlashCommand } from '@/lib/slash-commands';

function cmd(id: string, extra: Partial<SlashCommand> = {}): SlashCommand {
  return { id, name: id, description: `Do ${id}`, section: 'actions', run: vi.fn(), ...extra };
}

describe('slashToCommandActions', () => {
  it('turns each chat action into a palette action with the same handler', () => {
    const archive = cmd('archive', { name: 'archivar', aliases: ['archive'], keywords: ['guardar'], shortcut: 'E' });
    const [a] = slashToCommandActions([archive], { prefix: 'inbox-chat' });
    expect(a.id).toBe('inbox-chat:archive');
    expect(a.label).toBe('Do archive');
    expect(a.meta).toBe('E');
    // Se encuentra por el nombre, el alias en inglés y las palabras clave.
    expect(matchesQuery(a, 'archivar')).toBe(true);
    expect(matchesQuery(a, 'archive')).toBe(true);
    expect(matchesQuery(a, 'guardar')).toBe(true);
    a.run?.();
    expect(archive.run).toHaveBeenCalledWith();
  });

  it('leaves out AI commands, skipped ids and commands not available with an empty field', () => {
    const list = [
      cmd('pin'),
      cmd('rewrite', { section: 'ai' }),
      cmd('emoji'),
      cmd('needs-text', { available: (env) => env.rest.trim().length > 0 }),
    ];
    const out = slashToCommandActions(list, { prefix: 'x', skip: ['emoji'] });
    expect(out.map((a) => a.id)).toEqual(['x:pin']);
  });

  it('opens a page of options for a command with an argument, with the current one checked', () => {
    const label = cmd('label', {
      args: () => [
        { id: 'l1', label: 'Lead', color: 'blue', checked: true },
        { id: 'l2', label: 'Client', keywords: ['customer'], hint: 'h' },
      ],
    });
    const [a] = slashToCommandActions([label], { prefix: 'lines-chat', swatch: (c) => (c === 'blue' ? '#00f' : undefined) });
    expect(a.run).toBeUndefined();
    const kids = a.children?.() ?? [];
    expect(kids.map((k) => k.id)).toEqual(['lines-chat:label:l1', 'lines-chat:label:l2']);
    expect(kids[0]).toMatchObject({ checked: true, swatch: '#00f' });
    expect(kids[1].checked).toBeUndefined();
    expect(kids[1].meta).toBe('h');
    expect(matchesQuery(kids[1], 'customer')).toBe(true);
    kids[1].run?.();
    expect(label.run).toHaveBeenCalledWith(expect.objectContaining({ id: 'l2' }));
  });

  it('reads the options when the page opens, so they follow the latest state', () => {
    let pinned = false;
    const mute = cmd('mute', { args: () => [{ id: 'm', label: 'Mute', checked: pinned }] });
    const [a] = slashToCommandActions([mute], { prefix: 'p' });
    expect(a.children?.()[0].checked).toBeUndefined();
    pinned = true;
    expect(a.children?.()[0].checked).toBe(true);
  });
});

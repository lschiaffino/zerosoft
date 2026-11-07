import { describe, expect, it } from 'vitest';
import { pickDefaultTemplate } from '@/lib/track-template-default';
import { templateCreateSchema, templateUpdateSchema } from '@/lib/track-schema';

describe('plantilla predeterminada de Track', () => {
  it('elige la marcada y nada si ninguna lo está', () => {
    const list = [{ id: 'a', is_default: 0 }, { id: 'b', is_default: 1 }, { id: 'c' }];
    expect(pickDefaultTemplate(list)?.id).toBe('b');
    expect(pickDefaultTemplate([{ id: 'a', is_default: 0 }])).toBeUndefined();
    expect(pickDefaultTemplate([])).toBeUndefined();
  });

  it('el payload acepta isDefault booleano', () => {
    expect(templateCreateSchema.safeParse({ name: 'Bug', isDefault: true }).success).toBe(true);
    expect(templateUpdateSchema.safeParse({ isDefault: false }).success).toBe(true);
    expect(templateCreateSchema.safeParse({ name: 'Bug', isDefault: 'yes' }).success).toBe(false);
  });
});

describe('plantilla predeterminada: persistencia', () => {
  it('solo una por proyecto y primera en la lista', async () => {
    const { createProject } = await import('@/lib/track-data');
    const { createTeam } = await import('@/lib/teams');
    const { createTemplate, listTemplates, updateTemplate } = await import('@/lib/track-templates');
    const { makeUser } = await import('./helpers');
    const owner = await makeUser('own');
    const team = await createTeam(owner.id, 'Team');
    const project = await createProject(owner.id, team.id, { name: `P ${crypto.randomUUID().slice(0, 6)}` });
    const a = await createTemplate(project, { name: 'Bug', isDefault: true });
    const b = await createTemplate(project, { name: 'Alpha' });
    expect(a.is_default).toBe(1);
    expect(b.is_default).toBe(0);
    await updateTemplate(project, b.id, { isDefault: true });
    const rows = await listTemplates(project.id);
    expect(rows.map((r) => [r.name, r.is_default])).toEqual([['Alpha', 1], ['Bug', 0]]);
    await updateTemplate(project, b.id, { isDefault: false });
    expect(pickDefaultTemplate(await listTemplates(project.id))).toBeUndefined();
  });
});

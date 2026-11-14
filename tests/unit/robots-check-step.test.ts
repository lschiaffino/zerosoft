import { describe, expect, it } from 'vitest';
import { robotInterpreter, type InterpreterStep, type RobotLocator, type RobotPage } from '@/lib/robots-interpreter';
import { defaultStep, validateSteps } from '@/lib/robots-schema';

function steps(list: unknown[]): InterpreterStep[] {
  const v = validateSteps(list);
  if (!v.ok) throw new Error(`invalid: ${v.error}`);
  return v.steps as unknown as InterpreterStep[];
}

function pageWithChecks(calls: Array<{ selector: string; checked: boolean }>, fail = false) {
  const page = {
    locator: (selector: string) => {
      const l = {
        first: () => l,
        count: async () => 1,
        setChecked: async (checked: boolean) => {
          if (fail) throw new Error('Timeout exceeded');
          calls.push({ selector, checked });
        },
      } as unknown as RobotLocator;
      return l;
    },
    url: () => '',
    waitForTimeout: async () => {},
    evaluate: async () => true,
  };
  return page as unknown as RobotPage;
}
const opts = () => ({ deadline: Date.now() + 30_000, checkUrl: async () => null });

describe('Marcar o desmarcar', () => {
  it('valida el paso: selector obligatorio, estado conocido, marcado por defecto', () => {
    const ok = validateSteps([{ type: 'check', selector: 'input[name=terms]' }]);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect((ok.steps[0] as { state: string }).state).toBe('checked');
    expect(validateSteps([{ type: 'check', selector: '' }]).ok).toBe(false);
    expect(validateSteps([{ type: 'check', selector: '#a', state: 'maybe' }]).ok).toBe(false);
  });

  it('el editor crea el paso marcado', () => {
    expect(defaultStep('check')).toEqual({ type: 'check', selector: '', state: 'checked' });
  });

  it('marca y desmarca con el selector del paso', async () => {
    const calls: Array<{ selector: string; checked: boolean }> = [];
    const res = await robotInterpreter(
      pageWithChecks(calls),
      steps([
        { type: 'check', selector: '#terms' },
        { type: 'check', selector: '#news', state: 'unchecked' },
      ]),
      {},
      opts(),
    );
    expect(res.status).toBe('success');
    expect(calls).toEqual([
      { selector: '#terms', checked: true },
      { selector: '#news', checked: false },
    ]);
  });

  it('falla la corrida si la casilla no se puede cambiar', async () => {
    const res = await robotInterpreter(pageWithChecks([], true), steps([{ type: 'check', selector: '#terms' }]), {}, opts());
    expect(res.status).not.toBe('success');
  });
});

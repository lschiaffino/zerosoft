import { describe, expect, it } from 'vitest';
import { robotInterpreter, type InterpreterStep, type RobotLocator, type RobotPage } from '@/lib/robots-interpreter';
import { validateSteps } from '@/lib/robots-schema';

function steps(list: unknown[]): InterpreterStep[] {
  const v = validateSteps(list);
  if (!v.ok) throw new Error(`invalid: ${v.error}`);
  return v.steps as unknown as InterpreterStep[];
}

function pageWithWaits(states: string[], failHidden = false) {
  const loc = (): RobotLocator => {
    const l = {
      first: () => l,
      count: async () => 1,
      waitFor: async (o?: { state?: string }) => {
        states.push(o?.state ?? 'default');
        if (failHidden && o?.state === 'hidden') throw new Error('Timeout exceeded');
      },
    } as unknown as RobotLocator;
    return l;
  };
  return { locator: loc, url: () => '', waitForTimeout: async () => {}, evaluate: async () => true } as unknown as RobotPage;
}
const opts = () => ({ deadline: Date.now() + 30_000, checkUrl: async () => null });

describe('Esperar: hasta que aparezca, sea visible o desaparezca', () => {
  it('acepta solo los valores conocidos y conserva los pasos viejos', () => {
    expect(validateSteps([{ type: 'wait', selector: '.x', until: 'disappears' }]).ok).toBe(true);
    expect(validateSteps([{ type: 'wait', selector: '.x', until: 'gone' }]).ok).toBe(false);
    expect(validateSteps([{ type: 'wait', ms: 500 }]).ok).toBe(true);
  });

  it('mapea cada opcion al estado del navegador', async () => {
    const states: string[] = [];
    const page = pageWithWaits(states);
    for (const until of [undefined, 'appears', 'visible', 'disappears']) {
      await robotInterpreter(page, steps([{ type: 'wait', selector: '.spinner', ...(until ? { until } : {}) }]), {}, opts());
    }
    expect(states).toEqual(['attached', 'attached', 'visible', 'hidden']);
  });

  it('falla si el elemento no desaparece a tiempo', async () => {
    const res = await robotInterpreter(pageWithWaits([], true), steps([{ type: 'wait', selector: '.spinner', until: 'disappears' }]), {}, opts());
    expect(res.status).not.toBe('success');
  });
});

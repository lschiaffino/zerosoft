'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { AGENT_MAX_TESTS, AGENT_SIM_MAX_TURNS, type AgentTestCaseDto, type AgentTestKind } from '@/lib/agents-config';
import FormSection from '@/components/ui/FormSection';
import { useConfirm } from './useConfirm';
import { api, errorText, toolName } from './agents-ui';

interface Props {
  agentId: string;
  tests: AgentTestCaseDto[];
  onTestsChange: (tests: AgentTestCaseDto[]) => void;
  canEdit: boolean;
  aiEnabled: boolean;
  /** Hay cambios sin guardar: los tests corren contra la versión guardada. */
  dirty: boolean;
  /** Pregunta que llega desde el playground ("Guardar como test"); nonce para repetirla. */
  prefill: { question: string; nonce: number } | null;
}

type FormState = { id: string | null; question: string; expected: string; kind: AgentTestKind; persona: string; maxTurns: number };

const emptyForm = (question = ''): FormState => ({ id: null, question, expected: '', kind: 'single', persona: '', maxTurns: 4 });

/** Resumen de la última corrida: cuántos pasaron de los que corrieron. */
export function testSummary(tests: AgentTestCaseDto[]): { passed: number; ran: number; total: number } {
  const ran = tests.filter((x) => x.lastStatus !== null);
  return { passed: ran.filter((x) => x.lastStatus === 'pass').length, ran: ran.length, total: tests.length };
}

/**
 * Casos de prueba del agente (pestaña Playground): pregunta + comportamiento
 * esperado. "Correr tests" los corre de a uno en simulación y un juez AI
 * marca cada uno como aprobado o fallado, con el motivo.
 */
export default function AgentTests({ agentId, tests, onTestsChange, canEdit, aiEnabled, dirty, prefill }: Props) {
  const t = useTranslations('agents');
  const [confirmNode, ask] = useConfirm();
  const format = useFormatter();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [runAll, setRunAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expectedRef = useRef<HTMLTextAreaElement>(null);
  const testsRef = useRef(tests);
  testsRef.current = tests;

  useEffect(() => {
    if (!prefill || !canEdit) return;
    setForm(emptyForm(prefill.question));
    window.setTimeout(() => {
      expectedRef.current?.focus();
      expectedRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 0);
  }, [prefill, canEdit]);

  function replace(next: AgentTestCaseDto) {
    const list = testsRef.current;
    const updated = list.some((x) => x.id === next.id) ? list.map((x) => (x.id === next.id ? next : x)) : [...list, next];
    testsRef.current = updated;
    onTestsChange(updated);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    const body = JSON.stringify({ question: form.question, expected: form.expected, kind: form.kind, persona: form.persona, maxTurns: form.maxTurns });
    const res = form.id
      ? await api<{ test?: AgentTestCaseDto }>(`/api/agents/${agentId}/tests/${form.id}`, { method: 'PATCH', body })
      : await api<{ test?: AgentTestCaseDto }>(`/api/agents/${agentId}/tests`, { method: 'POST', body });
    setSaving(false);
    if (!res.ok || !res.data.test) {
      setError(errorText(t, res.data.error));
      return;
    }
    replace(res.data.test);
    setForm(null);
  }

  async function remove(test: AgentTestCaseDto) {
    if (!(await ask({ title: t('tests.deleteConfirm'), confirmLabel: t('tests.delete'), danger: true }))) return;
    const res = await api(`/api/agents/${agentId}/tests/${test.id}`, { method: 'DELETE' });
    if (!res.ok) {
      setError(errorText(t, res.data.error));
      return;
    }
    const next = testsRef.current.filter((x) => x.id !== test.id);
    testsRef.current = next;
    onTestsChange(next);
  }

  /** Corre un caso; devuelve false si hay que cortar (AI apagada, cuota, rate limit). */
  async function runOne(id: string): Promise<boolean> {
    setRunning(id);
    const res = await api<{ test?: AgentTestCaseDto }>(`/api/agents/${agentId}/tests/${id}/run`, { method: 'POST' });
    setRunning(null);
    if (!res.ok || !res.data.test) {
      setError(errorText(t, res.data.error));
      return false;
    }
    replace(res.data.test);
    return true;
  }

  async function runEvery() {
    if (runAll || running) return;
    setRunAll(true);
    setError(null);
    for (const test of testsRef.current.slice()) {
      if (!(await runOne(test.id))) break;
    }
    setRunAll(false);
  }

  const { passed, ran, total } = testSummary(tests);
  const lastRun = tests.reduce<string | null>((max, x) => (x.lastRunAt && (!max || x.lastRunAt > max) ? x.lastRunAt : max), null);
  const busy = runAll || running !== null;

  return (
    <FormSection
      title={t('tests.title')}
      description={t('tests.hint')}
      footer={
        <>
          <p className="ui-section-note" role="status" aria-live="polite">
            {total === 0
              ? t('tests.none')
              : ran === 0
                ? t('tests.notRun', { total })
                : (
                    <>
                      {t('tests.summary', { passed, total })}
                      {lastRun && (
                        <>
                          {' · '}
                          <time dateTime={lastRun} suppressHydrationWarning>
                            {t('tests.lastRun', { when: format.relativeTime(new Date(lastRun)) })}
                          </time>
                        </>
                      )}
                    </>
                  )}
          </p>
          {canEdit && !form && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={tests.length >= AGENT_MAX_TESTS}
              onClick={() => setForm(emptyForm())}
            >
              {t('tests.add')}
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={total === 0 || !aiEnabled || (busy && !runAll)}
            aria-busy={runAll || undefined}
            onClick={runEvery}
          >
            {runAll ? t('tests.running') : t('tests.runAll')}
          </button>
        </>
      }
    >
      {dirty && total > 0 && <p className="ui-help">{t('tests.dirty')}</p>}
      {confirmNode}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {form && (
        <form
          className="ag-test-form"
          onSubmit={submit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setForm(null);
          }}
        >
          <fieldset className="ag-test-kind">
            <legend className="label">{t('tests.kind')}</legend>
            {(['single', 'simulation'] as const).map((k) => (
              <label key={k} className="ui-check">
                <input type="radio" name="ag-test-kind" checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} /> {t(`tests.kinds.${k}`)}
              </label>
            ))}
            <p className="ui-help">{t(`tests.kindHint.${form.kind}`)}</p>
          </fieldset>
          {form.kind === 'simulation' && (
            <div className="ag-field-row">
              <div className="ui-field">
                <label className="label" htmlFor="ag-test-persona">
                  {t('tests.persona')}
                </label>
                <textarea
                  id="ag-test-persona"
                  className="textarea"
                  rows={2}
                  maxLength={1000}
                  value={form.persona}
                  placeholder={t('tests.personaPlaceholder')}
                  onChange={(e) => setForm({ ...form, persona: e.target.value })}
                />
              </div>
              <div className="ui-field ag-field-narrow">
                <label className="label" htmlFor="ag-test-turns">
                  {t('tests.maxTurns')}
                </label>
                <input
                  id="ag-test-turns"
                  className="input data"
                  type="number"
                  min={2}
                  max={AGENT_SIM_MAX_TURNS}
                  value={form.maxTurns}
                  onChange={(e) => setForm({ ...form, maxTurns: Math.min(AGENT_SIM_MAX_TURNS, Math.max(2, Number(e.target.value) || 4)) })}
                />
              </div>
            </div>
          )}
          <div className="ui-field">
            <label className="label" htmlFor="ag-test-q">
              {form.kind === 'simulation' ? t('tests.opening') : t('tests.question')}
            </label>
            <textarea
              id="ag-test-q"
              className="textarea"
              rows={2}
              maxLength={2000}
              required
              value={form.question}
              placeholder={t('tests.questionPlaceholder')}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
            />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="ag-test-e">
              {form.kind === 'simulation' ? t('tests.criteria') : t('tests.expected')}
            </label>
            <textarea
              id="ag-test-e"
              ref={expectedRef}
              className="textarea"
              rows={3}
              maxLength={2000}
              required
              value={form.expected}
              aria-describedby="ag-test-e-help"
              placeholder={t('tests.expectedPlaceholder')}
              onChange={(e) => setForm({ ...form, expected: e.target.value })}
            />
            <p className="ui-help" id="ag-test-e-help">
              {t('tests.expectedHelp')}
            </p>
          </div>
          <div className="ag-test-form-actions">
            <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setForm(null)}>
              {t('tests.cancel')}
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!form.question.trim() || !form.expected.trim()}
              aria-busy={saving || undefined}
            >
              {t('tests.save')}
            </button>
          </div>
        </form>
      )}
      {tests.length > 0 && (
        <ul className="ag-rows ag-tests">
          {tests.map((x) => {
            const tone =
              x.lastStatus === 'pass' ? ' badge-ok' : x.lastStatus === 'fail' ? ' badge-bad' : x.lastStatus === 'error' ? ' badge-warn' : '';
            return (
              <li key={x.id} className="ag-test">
                <div className="ag-test-main">
                  <p className="ag-test-q">
                    {x.kind === 'simulation' && <span className="badge ag-test-kind-badge">{t('tests.kinds.simulation')}</span>} {x.question}
                  </p>
                  <p className="ui-help">
                    {t('tests.expectedShort')}: {x.expected}
                  </p>
                  {x.lastStatus && x.lastReason && (
                    <p className={x.lastStatus === 'pass' ? 'ui-help' : 'ag-test-reason'}>
                      {x.lastStatus === 'error' ? errorText(t, x.lastReason) : x.lastReason}
                    </p>
                  )}
                  {x.lastStatus && x.lastStatus !== 'error' && (
                    <details className="ag-tool">
                      <summary>
                        <svg className="ag-tool-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                        {x.kind === 'simulation' ? t('tests.transcript') : t('tests.reply')}
                      </summary>
                      <div className="ag-tool-body">
                        {x.kind === 'simulation' && x.lastTranscript.length > 0 ? (
                          <ol className="ag-sim-transcript">
                            {x.lastTranscript.map((turn, i) => (
                              <li key={i} className={`ag-sim-turn is-${turn.role}`}>
                                <span className="label">{turn.role === 'user' ? t('tests.simCustomer') : t('tests.simAgent')}</span> {turn.content || '–'}
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <pre>{x.lastReply || '–'}</pre>
                        )}
                        {x.lastTools.length > 0 && (
                          <p className="ui-help">
                            {t('tests.tools')}:{' '}
                            {x.lastTools
                              .map((c) => `${toolName(t, c.tool)}${c.simulated ? ` (${t('chat.simulated')})` : c.error ? ` (${c.error})` : ''}`)
                              .join(', ')}
                          </p>
                        )}
                      </div>
                    </details>
                  )}
                </div>
                <span className={`badge${tone}`}>{t(`tests.status.${x.lastStatus ?? 'none'}`)}</span>
                <div className="ag-test-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!aiEnabled || busy}
                    aria-busy={running === x.id || undefined}
                    aria-label={`${t('tests.run')}: ${x.question}`}
                    onClick={() => {
                      setError(null);
                      void runOne(x.id);
                    }}
                  >
                    {running === x.id ? t('tests.runningOne') : t('tests.run')}
                  </button>
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => setForm({ id: x.id, question: x.question, expected: x.expected, kind: x.kind, persona: x.persona, maxTurns: x.maxTurns })}
                      >
                        {t('tests.edit')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => remove(x)}>
                        {t('tests.delete')}
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </FormSection>
  );
}

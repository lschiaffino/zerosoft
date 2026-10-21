'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { isStepTestable, isTriggerType, type FlowNodeType } from '@/lib/flow-schema';

export interface StepTestOutcome {
  status: 'success' | 'skipped' | 'failed';
  output: unknown;
  error: string | null;
  handles: string[];
  durationMs: number;
}

interface Props {
  flowId: string;
  nodeId: string;
  type: FlowNodeType;
  config: Record<string, unknown>;
  /** Datos de prueba armados por el editor: { trigger, nodes } (o los del trigger). */
  sample: unknown;
  /** Salida fijada de este nodo (undefined = ninguna). */
  pinned: unknown;
  canEdit: boolean;
  onResult: (outcome: StepTestOutcome) => void;
  /** Fija (o suelta con null) la salida de este nodo. */
  onPin: (output: unknown) => Promise<boolean>;
}

function pretty(v: unknown): string {
  try {
    return JSON.stringify(v ?? null, null, 2);
  } catch {
    return String(v);
  }
}

/**
 * "Probar paso": corre solo este nodo con datos de prueba (lo fijado y la
 * última corrida, editable) y deja fijar el resultado como dato de prueba de
 * los pasos siguientes. En el trigger, fija los datos de prueba del flow.
 */
export default function StepTest({ flowId, nodeId, type, config, sample, pinned, canEdit, onResult, onPin }: Props) {
  const t = useTranslations('flow');
  const trigger = isTriggerType(type);
  const testable = isStepTestable(type);
  const [text, setText] = useState(() => pretty(sample));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StepTestOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPinned = pinned !== undefined;

  if (!canEdit) return null;
  if (!trigger && !testable) {
    return (
      <section className="flow-test" aria-labelledby={`flow-test-${nodeId}`}>
        <h3 className="flow-test-title" id={`flow-test-${nodeId}`}>
          {t('editor.testStepTitle')}
        </h3>
        <p className="ui-help">{t('editor.testStepNotTestable')}</p>
      </section>
    );
  }

  function parsed(): unknown | undefined {
    try {
      const v = JSON.parse(text || '{}');
      setJsonError(null);
      return v;
    } catch {
      setJsonError(t('editor.invalidJson'));
      return undefined;
    }
  }

  async function run() {
    const ctx = parsed();
    if (ctx === undefined) return;
    const c = (ctx && typeof ctx === 'object' && !Array.isArray(ctx) ? ctx : {}) as { trigger?: unknown; nodes?: unknown };
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/flow/flows/${flowId}/test-step`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        node: { type, config },
        context: {
          trigger: c.trigger ?? {},
          nodes: c.nodes && typeof c.nodes === 'object' && !Array.isArray(c.nodes) ? c.nodes : {},
        },
      }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { result?: StepTestOutcome; error?: string } | null;
    setBusy(false);
    if (!data?.result) {
      const code = data?.error ?? 'generic';
      setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
      return;
    }
    setResult(data.result);
    onResult(data.result);
  }

  async function pin(output: unknown) {
    setBusy(true);
    setError(null);
    const ok = await onPin(output);
    setBusy(false);
    if (!ok) setError(t('errors.generic'));
  }

  return (
    <section className="flow-test" aria-labelledby={`flow-test-${nodeId}`}>
      <h3 className="flow-test-title" id={`flow-test-${nodeId}`}>
        {trigger ? t('editor.pinSampleTitle') : t('editor.testStepTitle')}
      </h3>
      <p className="ui-help">{trigger ? t('editor.pinTriggerHint') : t('editor.testStepHint')}</p>
      <div className="ui-field">
        <label className="label" htmlFor={`flow-test-input-${nodeId}`}>
          {t('editor.testStepSample')}
        </label>
        <textarea
          id={`flow-test-input-${nodeId}`}
          className="textarea data"
          rows={8}
          spellCheck={false}
          value={text}
          aria-invalid={jsonError ? true : undefined}
          aria-describedby={`flow-test-hint-${nodeId}`}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="ui-help" id={`flow-test-hint-${nodeId}`}>
          {trigger ? t('editor.pinTriggerSampleHint') : t('editor.testStepSampleHint')}
        </p>
        {jsonError && <p className="ui-error">{jsonError}</p>}
      </div>
      <div className="flow-test-actions">
        {trigger ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-busy={busy || undefined}
            onClick={() => {
              const v = parsed();
              if (v !== undefined) void pin(v);
            }}
          >
            {t('editor.pinSample')}
          </button>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" aria-busy={busy || undefined} onClick={() => void run()}>
            {busy ? t('editor.testStepRunning') : t('editor.testStepRun')}
          </button>
        )}
        {isPinned && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void pin(null)}>
            {t('editor.unpin')}
          </button>
        )}
      </div>
      {isPinned && <p className="ui-help">{trigger ? t('editor.pinnedTrigger') : t('editor.pinned')}</p>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="flow-test-result" role="status">
          <p className={`flow-test-status is-${result.status}`}>
            {t('editor.testStepResult', { status: t(`editor.testStepStatus.${result.status}`), ms: result.durationMs })}
            {result.error ? ` · ${result.error}` : ''}
          </p>
          {result.handles.length > 0 && (
            <p className="ui-help">
              {t('editor.testStepHandles', {
                list: result.handles.map((h) => (t.has(`handles.${h}`) ? t(`handles.${h}`) : h)).join(', '),
              })}
            </p>
          )}
          <pre className="flow-json">{pretty(result.output)}</pre>
          {result.status === 'success' && (
            <button type="button" className="btn btn-ghost btn-sm" aria-busy={busy || undefined} onClick={() => void pin(result.output)}>
              {t('editor.pinOutput')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

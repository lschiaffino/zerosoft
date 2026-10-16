'use client';

import { memo, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useTranslations } from 'next-intl';
import { brandLine } from '@/lib/brand';
import { NODE_DEFS, nodeOutputs, isTriggerType, type FlowNodeType } from '@/lib/flow-schema';
import { i18nKey, interchangeLine } from './flow-ui';

export type FlowNodeData = {
  type: FlowNodeType;
  config: Record<string, unknown>;
  /** Estado del último paso de este nodo en la corrida mostrada. */
  status?: string;
  summary?: string;
};

export type FlowCanvasNode = Node<FlowNodeData, 'flow'>;

function handleLabel(t: ReturnType<typeof useTranslations>, handle: string, config: Record<string, unknown>): string {
  if (handle.startsWith('case-')) {
    const i = Number(handle.slice(5));
    const cases = Array.isArray(config.cases) ? (config.cases as unknown[]) : [];
    return String(cases[i] ?? '') || t('handles.case', { n: i + 1 });
  }
  return t(`handles.${handle}`);
}

/**
 * Nodo del canvas: una estación sobre la línea de Flow con su cartel al lado.
 * La línea entra por arriba y sale por abajo pasando por la estación; si el
 * nodo toca otra app de zerosoft, el anillo toma el color de esa línea.
 */
function FlowNodeCard({ data, selected, id }: NodeProps<FlowCanvasNode>) {
  const t = useTranslations('flow');
  const def = NODE_DEFS[data.type];
  const outputs = nodeOutputs({ type: data.type, config: data.config });
  const named = outputs.length > 1 || outputs[0] !== 'out';
  const trigger = isTriggerType(data.type);
  const line = interchangeLine(data.type, data.config);
  const style = (line ? { '--station-ring': brandLine(line).line } : undefined) as CSSProperties | undefined;

  return (
    <div
      className={`flow-node${selected ? ' is-selected' : ''}`}
      data-status={data.status}
      data-trigger={trigger || undefined}
      data-named={named || undefined}
      style={style}
    >
      {!trigger && <Handle type="target" position={Position.Top} className="flow-handle flow-handle-in" />}
      <span className="flow-node-track" aria-hidden="true" />
      <span className="flow-node-station" aria-hidden="true" />
      <div className="flow-node-body">
        <div className="flow-node-head">
          <span className="flow-node-cat">
            {t(`categories.${def.category}`)}
            {line && ` · ${brandLine(line).name}`}
          </span>
          {data.status && <span className={`flow-node-status is-${data.status}`}>{t(`stepStatus.${data.status}`)}</span>}
        </div>
        <div className="flow-node-title">{t(`nodes.${i18nKey(data.type)}.title`)}</div>
        {data.summary ? <div className="flow-node-summary">{data.summary}</div> : <div className="flow-node-summary data">{id}</div>}
      </div>
      {named ? (
        <div className="flow-node-outputs">
          {outputs.map((h, i) => (
            <div
              className={`flow-node-output${h === 'error' ? ' is-error' : ''}`}
              key={h}
              style={{ left: `${((i + 1) / (outputs.length + 1)) * 100}%` }}
            >
              <span>{handleLabel(t, h, data.config)}</span>
              <Handle type="source" id={h} position={Position.Bottom} className="flow-handle" />
            </div>
          ))}
        </div>
      ) : (
        <Handle type="source" id="out" position={Position.Bottom} className="flow-handle flow-handle-out" />
      )}
    </div>
  );
}

export default memo(FlowNodeCard);

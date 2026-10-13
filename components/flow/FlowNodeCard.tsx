'use client';

import { memo, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useTranslations } from 'next-intl';
import { NODE_DEFS, nodeOutputs, isTriggerType, type FlowNodeType } from '@/lib/flow-schema';
import { CATEGORY_COLOR, i18nKey } from './flow-ui';

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

/** Nodo del canvas: barra de color por categoría, título y salidas con nombre. */
function FlowNodeCard({ data, selected, id }: NodeProps<FlowCanvasNode>) {
  const t = useTranslations('flow');
  const def = NODE_DEFS[data.type];
  const outputs = nodeOutputs({ type: data.type, config: data.config });
  const named = outputs.length > 1 || outputs[0] !== 'out';
  const style = { '--node-color': CATEGORY_COLOR[def.category] } as CSSProperties;

  return (
    <div className={`flow-node${selected ? ' is-selected' : ''}${data.status ? ` has-${data.status}` : ''}`} style={style}>
      {!isTriggerType(data.type) && <Handle type="target" position={Position.Top} className="flow-handle" />}
      <div className="flow-node-head">
        <span className="flow-node-cat">{t(`categories.${def.category}`)}</span>
        {data.status && (
          <span className={`flow-dot is-${data.status}`} title={t(`stepStatus.${data.status}`)} aria-label={t(`stepStatus.${data.status}`)} />
        )}
      </div>
      <div className="flow-node-title">{t(`nodes.${i18nKey(data.type)}.title`)}</div>
      {data.summary ? <div className="flow-node-summary">{data.summary}</div> : <div className="flow-node-id mono">{id}</div>}
      {named ? (
        <div className="flow-node-outputs">
          {outputs.map((h, i) => (
            <div className="flow-node-output" key={h} style={{ left: `${((i + 1) / (outputs.length + 1)) * 100}%` }}>
              <span>{handleLabel(t, h, data.config)}</span>
              <Handle type="source" id={h} position={Position.Bottom} className="flow-handle" />
            </div>
          ))}
        </div>
      ) : (
        <Handle type="source" id="out" position={Position.Bottom} className="flow-handle" />
      )}
    </div>
  );
}

export default memo(FlowNodeCard);

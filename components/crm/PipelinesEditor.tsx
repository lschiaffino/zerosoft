'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { PipelineWithStages } from '@/lib/crm';
import { RemoveIcon } from './RowTools';

interface PipelinesEditorProps {
  initialPipelines: PipelineWithStages[];
}

type Patch = { name?: string; probability?: number; isWon?: boolean; isLost?: boolean };

/** Editor de pipelines y stages: rename inline, probabilidad, flags, reorder ↑↓. */
export default function PipelinesEditor({ initialPipelines }: PipelinesEditorProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [pipelines, setPipelines] = useState<PipelineWithStages[]>(initialPipelines);
  const [newName, setNewName] = useState('');
  const [newStageNames, setNewStageNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmPipeline, setConfirmPipeline] = useState<string | null>(null);
  const [confirmStage, setConfirmStage] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flashSaved() {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
  }

  function setError(pipelineId: string, message: string | null) {
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[pipelineId] = message;
      else delete next[pipelineId];
      return next;
    });
  }

  async function api(path: string, init: RequestInit): Promise<{ status: number; data: unknown }> {
    const res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    }).catch(() => null);
    if (!res) return { status: 0, data: null };
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, data };
  }

  function errorText(data: unknown): string {
    const code = (data as { error?: string } | null)?.error;
    return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');
  }

  // ---------- Pipelines ----------

  async function onCreatePipeline(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    const { status, data } = await api('/api/crm/pipelines', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (status === 201 && data) {
      setPipelines((prev) => [...prev, { ...(data as PipelineWithStages), stages: [] }]);
      setNewName('');
      flashSaved();
      router.refresh();
    }
    setBusy(false);
  }

  async function onRenamePipeline(id: string, name: string, prev: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === prev || busy) return;
    setBusy(true);
    const { status, data } = await api(`/api/crm/pipelines/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: trimmed }),
    });
    if (status === 200 && data) {
      setPipelines((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name: (data as { name: string }).name } : p)),
      );
      flashSaved();
      router.refresh();
    }
    setBusy(false);
  }

  async function onDeletePipeline(id: string) {
    if (busy) return;
    setBusy(true);
    const { status, data } = await api(`/api/crm/pipelines/${id}`, { method: 'DELETE' });
    setConfirmPipeline(null);
    if (status === 204) {
      setPipelines((prev) => prev.filter((p) => p.id !== id));
      setError(id, null);
      flashSaved();
      router.refresh();
    } else {
      setError(id, errorText(data));
    }
    setBusy(false);
  }

  // ---------- Stages ----------

  async function onPatchStage(pipelineId: string, stageId: string, patch: Patch) {
    if (busy) return;
    setBusy(true);
    const { status, data } = await api(`/api/crm/stages/${stageId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (status === 200 && data) {
      const stage = data as PipelineWithStages['stages'][number];
      setPipelines((prev) =>
        prev.map((p) =>
          p.id === pipelineId
            ? { ...p, stages: p.stages.map((s) => (s.id === stageId ? stage : s)) }
            : p,
        ),
      );
      setError(pipelineId, null);
      flashSaved();
      router.refresh();
    } else if (status !== 0) {
      setError(pipelineId, errorText(data));
    }
    setBusy(false);
  }

  async function onMoveStage(pipelineId: string, index: number, dir: -1 | 1) {
    const pipeline = pipelines.find((p) => p.id === pipelineId);
    if (!pipeline || busy) return;
    const target = index + dir;
    if (target < 0 || target >= pipeline.stages.length) return;
    const before = pipeline.stages;
    const reordered = [...before];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setPipelines((prev) =>
      prev.map((p) => (p.id === pipelineId ? { ...p, stages: reordered } : p)),
    );
    setBusy(true);
    const { status, data } = await api(`/api/crm/pipelines/${pipelineId}/stages/reorder`, {
      method: 'POST',
      body: JSON.stringify({ stageIds: reordered.map((s) => s.id) }),
    });
    if (status === 200) {
      flashSaved();
      router.refresh();
    } else {
      // Revertir el swap optimista.
      setPipelines((prev) => prev.map((p) => (p.id === pipelineId ? { ...p, stages: before } : p)));
      setError(pipelineId, errorText(data));
    }
    setBusy(false);
  }

  async function onAddStage(e: React.FormEvent, pipelineId: string) {
    e.preventDefault();
    const name = (newStageNames[pipelineId] ?? '').trim();
    if (!name || busy) return;
    setBusy(true);
    const { status, data } = await api(`/api/crm/pipelines/${pipelineId}/stages`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (status === 201 && data) {
      const stage = data as PipelineWithStages['stages'][number];
      setPipelines((prev) =>
        prev.map((p) => (p.id === pipelineId ? { ...p, stages: [...p.stages, stage] } : p)),
      );
      setNewStageNames((prev) => ({ ...prev, [pipelineId]: '' }));
      flashSaved();
      router.refresh();
    } else {
      setError(pipelineId, errorText(data));
    }
    setBusy(false);
  }

  async function onDeleteStage(pipelineId: string, stageId: string) {
    if (busy) return;
    setBusy(true);
    const { status, data } = await api(`/api/crm/stages/${stageId}`, { method: 'DELETE' });
    setConfirmStage(null);
    if (status === 204) {
      setPipelines((prev) =>
        prev.map((p) =>
          p.id === pipelineId ? { ...p, stages: p.stages.filter((s) => s.id !== stageId) } : p,
        ),
      );
      setError(pipelineId, null);
      flashSaved();
      router.refresh();
    } else {
      setError(pipelineId, errorText(data));
    }
    setBusy(false);
  }

  return (
    <div className="pl-editor">
      <div className="pl-toolbar">
        <form className="pl-create" onSubmit={onCreatePipeline}>
          <input
            className="input"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('settings.pipelineName')}
            aria-label={t('settings.pipelineName')}
            maxLength={200}
          />
          <button type="submit" className="btn btn-solid btn-small" disabled={busy || !newName.trim()}>
            {t('settings.newPipeline')}
          </button>
        </form>
        {saved && <span className="saved-note">{t('common.saved')}</span>}
      </div>

      {pipelines.map((p) => (
        <div className="pl-block" key={p.id}>
          <div className="pl-head">
            <input
              className="input pl-name"
              type="text"
              defaultValue={p.name}
              aria-label={t('settings.pipelineName')}
              maxLength={200}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (!name) {
                  e.target.value = p.name;
                  return;
                }
                if (name !== p.name) onRenamePipeline(p.id, name, p.name);
              }}
            />
            {confirmPipeline === p.id ? (
              <span className="cell-actions confirm">
                <span className="confirm-label">{t('settings.confirmDelete')}</span>
                <button
                  type="button"
                  className="icon-btn danger"
                  onClick={() => onDeletePipeline(p.id)}
                  disabled={busy}
                >
                  {t('common.yes')}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setConfirmPipeline(null)}
                  disabled={busy}
                >
                  {t('common.no')}
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="icon-btn danger"
                onClick={() => setConfirmPipeline(p.id)}
                disabled={busy}
                title={t('settings.deletePipeline')}
              >
                {t('common.delete')}
              </button>
            )}
          </div>

          <div className="pl-stages">
            {p.stages.map((s, idx) => (
              <div className="stage-row" key={s.id}>
                <input
                  className="input"
                  type="text"
                  defaultValue={s.name}
                  aria-label={t('settings.stageName')}
                  maxLength={200}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== s.name) onPatchStage(p.id, s.id, { name });
                  }}
                />
                <input
                  className="input stage-prob"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={s.probability}
                  aria-label={t('settings.probability')}
                  title={t('settings.probability')}
                  onBlur={(e) => {
                    const n = Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0)));
                    e.target.value = String(n);
                    if (n !== s.probability) onPatchStage(p.id, s.id, { probability: n });
                  }}
                />
                <span className="stage-flags">
                  <label>
                    <input
                      type="checkbox"
                      defaultChecked={s.is_won === 1}
                      onChange={(e) => onPatchStage(p.id, s.id, { isWon: e.target.checked })}
                    />{' '}
                    {t('settings.isWon')}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      defaultChecked={s.is_lost === 1}
                      onChange={(e) => onPatchStage(p.id, s.id, { isLost: e.target.checked })}
                    />{' '}
                    {t('settings.isLost')}
                  </label>
                </span>
                <span className="cell-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onMoveStage(p.id, idx, -1)}
                    disabled={busy || idx === 0}
                    title={t('settings.moveUp')}
                    aria-label={t('settings.moveUp')}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onMoveStage(p.id, idx, 1)}
                    disabled={busy || idx === p.stages.length - 1}
                    title={t('settings.moveDown')}
                    aria-label={t('settings.moveDown')}
                  >
                    ↓
                  </button>
                  {confirmStage === s.id ? (
                    <>
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={() => onDeleteStage(p.id, s.id)}
                        disabled={busy}
                        title={t('settings.confirmDelete')}
                      >
                        {t('common.yes')}
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setConfirmStage(null)}
                        disabled={busy}
                      >
                        {t('common.no')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-danger btn-sm btn-icon"
                      onClick={() => setConfirmStage(s.id)}
                      disabled={busy}
                      title={t('settings.deleteStage')}
                      aria-label={`${t('settings.deleteStage')}: ${s.name}`}
                    >
                      <RemoveIcon />
                    </button>
                  )}
                </span>
              </div>
            ))}

            <form className="stage-add" onSubmit={(e) => onAddStage(e, p.id)}>
              <input
                className="input"
                type="text"
                value={newStageNames[p.id] ?? ''}
                onChange={(e) => setNewStageNames((prev) => ({ ...prev, [p.id]: e.target.value }))}
                placeholder={t('settings.stageName')}
                aria-label={t('settings.stageName')}
                maxLength={200}
              />
              <button
                type="submit"
                className="btn btn-small"
                disabled={busy || !(newStageNames[p.id] ?? '').trim()}
              >
                {t('settings.addStage')}
              </button>
            </form>
          </div>

          {errors[p.id] && <p className="form-error">{errors[p.id]}</p>}
        </div>
      ))}
    </div>
  );
}

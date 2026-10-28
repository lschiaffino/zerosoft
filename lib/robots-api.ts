/**
 * Robots — forma pública (API v1) de robots y corridas. Sin logs, capturas
 * ni la captura de la falla: la API devuelve los datos, el detalle queda en
 * la app. Errores con el formato de la v1 ({ error: { code, message } }).
 */
import type { NextResponse } from 'next/server';
import { apiError } from './api-auth';
import type { RobotDto, RobotRunDto } from './robots';
import { runErrorStatus } from './robots-http';

export function toApiRobot(r: RobotDto) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    enabled: r.enabled,
    inputs: r.inputs,
    updatedAt: r.updatedAt,
  };
}

export function toApiRobotRun(r: RobotRunDto) {
  return {
    id: r.id,
    robotId: r.robotId,
    status: r.status,
    trigger: r.trigger,
    input: r.input,
    output: r.output,
    error: r.error,
    warnings: r.warnings,
    changed: r.changed,
    batchId: r.batchId,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    durationMs: r.durationMs,
  };
}

const MESSAGES: Record<string, string> = {
  not_found: 'Robot not found.',
  disabled: 'Automatic runs are turned off for this robot. Turn them on in its Schedule tab.',
  runner_unavailable: 'Robots cannot run on this server.',
  quota_exceeded: 'The workspace used all its robot minutes for this month.',
  rate_limited: 'Too many runs. Try again later.',
  busy: 'Too many runs are waiting in this workspace. Try again when the queue clears.',
  missing_input: 'A required input is missing.',
  missing_credential: 'A credential used by the robot is missing.',
  no_steps: 'The robot has no steps.',
  too_many_inputs: 'Send between 1 and 1,000 inputs.',
};

/** Error de startRobotRun / enqueueRobotBatch → respuesta v1. */
export function robotApiError(code: string, extra: { name?: string; index?: number } = {}): NextResponse {
  let message = MESSAGES[code] ?? code;
  if (code === 'missing_input' && extra.name) {
    message = `Missing required input "${extra.name}"${extra.index !== undefined ? ` (inputs[${extra.index}])` : ''}.`;
  }
  if (code === 'missing_credential' && extra.name) message = `Missing credential "${extra.name}".`;
  return apiError(code === 'too_many_inputs' ? 400 : runErrorStatus(code), code, message);
}

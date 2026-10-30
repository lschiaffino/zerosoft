/**
 * Herramientas de Hiring para el asistente. Lectura: puestos, candidatos que
 * la persona ve, el perfil de uno y sus scorecards pendientes. Escritura (con
 * confirmación): mover un candidato de etapa y dejar una nota. Todas con las
 * mismas funciones y el mismo acceso que la app: un candidato de un puesto
 * cuyo equipo la persona no integra no existe para el asistente.
 * El asistente nunca rechaza candidatos: esa decisión queda en la app.
 */
import { z } from 'zod';
import { listJobs, listStages } from '../hiring/core';
import { addNote, getCandidateProfile, listApplications, moveApplication, requireManageApp } from '../hiring/candidates';
import { myPendingEvaluations } from '../hiring/evaluation';
import type { HiringActor } from '../hiring/types';
import { readTool, writeTool, type AssistantTool, type ToolCtx } from './registry';

const actor = (ctx: ToolCtx): HiringActor => ({ ws: ctx.workspaceId, person: ctx.personId, admin: ctx.isAdmin });

export const hiringTools: AssistantTool[] = [
  readTool({
    name: 'hiring_jobs',
    app: 'hiring',
    description: 'List Hiring jobs (title, department, status, my role, active candidates when I manage the job). Filter by status: draft, published, closed, archived.',
    input: z.object({ status: z.enum(['draft', 'published', 'closed', 'archived']).optional(), query: z.string().trim().max(100).optional() }),
    run: async (ctx, { status, query }) => {
      const jobs = await listJobs(actor(ctx), { status, q: query });
      return {
        jobs: jobs.slice(0, 30).map((j) => ({ title: j.title, department: j.department, location: j.location, status: j.status, myRole: j.myRole, activeCandidates: j.activeCount, href: `/app/hiring/jobs/${j.id}` })),
      };
    },
  }),
  readTool({
    name: 'hiring_candidates',
    app: 'hiring',
    description: 'Search candidates I can see (only jobs where I am on the hiring team, or all if I am an admin): name, job, stage, source and tags. Filter by job title or stage name.',
    input: z.object({ query: z.string().trim().max(100).optional(), job: z.string().trim().max(160).optional(), stage: z.string().trim().max(60).optional(), status: z.enum(['active', 'rejected', 'hired', 'all']).optional() }),
    run: async (ctx, { query, job, stage, status }) => {
      let items = await listApplications(actor(ctx), { q: query, status: status ?? 'active', limit: 200 });
      if (job) items = items.filter((i) => i.jobTitle.toLowerCase().includes(job.toLowerCase()));
      if (stage) items = items.filter((i) => i.stageName.toLowerCase().includes(stage.toLowerCase()));
      return {
        total: items.length,
        candidates: items.slice(0, 30).map((i) => ({ name: i.name, job: i.jobTitle, stage: i.stageName, status: i.status, source: i.source, tags: i.tags, knockedOut: i.knockedOut, href: `/app/hiring/candidates/${i.candidateId}?app=${i.id}` })),
      };
    },
  }),
  readTool({
    name: 'hiring_candidate',
    app: 'hiring',
    description: 'One candidate I can see, by name: applications with stage, answers, scorecards I am allowed to see (interviewers only see others after submitting theirs), AI summary and the latest timeline events.',
    input: z.object({ name: z.string().trim().min(1).max(160) }),
    run: async (ctx, { name }) => {
      const hit = (await listApplications(actor(ctx), { q: name, status: 'all', limit: 5 }))[0];
      if (!hit) return { error: 'not_found' };
      const p = await getCandidateProfile(actor(ctx), hit.candidateId);
      if (!p) return { error: 'not_found' };
      return {
        name: p.candidate.name,
        headline: p.candidate.headline,
        location: p.candidate.location,
        tags: p.candidate.tags,
        summary: p.candidate.aiSummary || null,
        applications: p.applications.map((a) => ({
          job: a.job.title,
          stage: a.stages.find((s) => s.id === a.stageId)?.name,
          status: a.status,
          source: a.source,
          answers: a.answers.map((x) => ({ question: x.label, answer: x.value, knockout: x.knockout })),
          scorecards: a.scorecards.map((s) => ({ by: s.userName, overall: s.overall, notes: s.notes.slice(0, 300) })),
          hiddenScorecards: a.othersHidden,
        })),
        timeline: p.timeline.slice(0, 15).map((e) => ({ kind: e.kind, by: e.actorName, at: e.createdAt })),
        href: `/app/hiring/candidates/${p.candidate.id}`,
      };
    },
  }),
  readTool({
    name: 'hiring_my_scorecards',
    app: 'hiring',
    description: 'Scorecards I still have to submit (candidate, job, stage).',
    input: z.object({}),
    run: async (ctx) => ({
      pending: (await myPendingEvaluations(actor(ctx))).map((p) => ({ candidate: p.candidateName, job: p.jobTitle, stage: p.stageName, href: `/app/hiring/candidates/${p.candidateId}?app=${p.applicationId}` })),
    }),
  }),
  writeTool({
    name: 'propose_hiring_move',
    app: 'hiring',
    description: 'Prepare moving a candidate I manage to another stage of the same job (by stage name). Never use it to reject. The person confirms first.',
    input: z.object({ candidate: z.string().trim().min(1).max(160), job: z.string().trim().max(160).optional(), stage: z.string().trim().min(1).max(60) }),
    prepare: async (ctx, input) => {
      const apps = (await listApplications(actor(ctx), { q: input.candidate, status: 'active', limit: 20 })).filter((a) => !input.job || a.jobTitle.toLowerCase().includes(input.job.toLowerCase()));
      if (!apps.length) return { error: 'not_found' };
      if (apps.length > 1 && new Set(apps.map((a) => a.jobId)).size > 1) return { error: 'ambiguous', hint: { jobs: apps.map((a) => a.jobTitle) } };
      const app = apps[0];
      try {
        await requireManageApp(actor(ctx), app.id);
      } catch {
        return { error: 'forbidden' };
      }
      const stages = await listStages(app.jobId);
      const to = stages.find((s) => s.name.toLowerCase() === input.stage.toLowerCase()) ?? stages.find((s) => s.name.toLowerCase().includes(input.stage.toLowerCase()));
      if (!to) return { error: 'invalid_stage', hint: { stages: stages.map((s) => s.name) } };
      return {
        summary: `Move ${app.name} to "${to.name}"`,
        details: [
          { label: 'Job', after: app.jobTitle },
          { label: 'Stage', before: app.stageName, after: to.name },
        ],
        input: { applicationId: app.id, stageId: to.id, candidateId: app.candidateId },
      };
    },
    execute: async (ctx, input) => {
      try {
        await moveApplication(actor(ctx), String(input.applicationId), String(input.stageId));
        return { ok: true, message: 'Moved.', href: `/app/hiring/candidates/${String(input.candidateId)}?app=${String(input.applicationId)}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'error' };
      }
    },
  }),
  writeTool({
    name: 'propose_hiring_note',
    app: 'hiring',
    description: 'Prepare an internal note on a candidate I can see (it goes to their timeline). The person confirms first.',
    input: z.object({ candidate: z.string().trim().min(1).max(160), note: z.string().trim().min(1).max(4000) }),
    prepare: async (ctx, input) => {
      const app = (await listApplications(actor(ctx), { q: input.candidate, status: 'all', limit: 1 }))[0];
      if (!app) return { error: 'not_found' };
      return {
        summary: `Add a note to ${app.name}`,
        details: [
          { label: 'Job', after: app.jobTitle },
          { label: 'Note', after: input.note.slice(0, 300) },
        ],
        input: { applicationId: app.id, candidateId: app.candidateId, note: input.note },
      };
    },
    execute: async (ctx, input) => {
      try {
        await addNote(actor(ctx), String(input.applicationId), String(input.note));
        return { ok: true, message: 'Note added.', href: `/app/hiring/candidates/${String(input.candidateId)}?app=${String(input.applicationId)}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'error' };
      }
    },
  }),
];

/**
 * Voice: antes y después de la reunión (Granola Business). Server-only.
 * - Brief: lo hablado antes con las mismas personas, solo con las reuniones
 *   de quien lo pide (nunca las de otra persona).
 * - Email de seguimiento: borrador con asunto, cuerpo y destinatarios.
 * - Recipes: un prompt guardado sobre una reunión o sobre varias.
 */
import { getDb } from './db';
import { followupEmail, meetingBrief, type PastMeeting } from './voice-ai';
import { askAcross, chat } from './voice-service';
import { getSessionDetail, getSessionRow, parseAttendees, VoiceError, type VoiceOwner } from './voice';
import { meetingPlainText, type MeetingLabels } from './voice-integrations';
import { getUsablePrompt } from './voice-library';
import { likeContains } from './track-views';
import type { VoiceAttendee, VoiceBrief, VoiceChatMessage, VoiceDictionaryEntry, VoiceFollowup } from './voice-types';

const nowIso = () => new Date().toISOString();

/** Reuniones anteriores propias con alguna de esas personas (por email de asistente o del contacto vinculado). */
export async function pastMeetingsWith(
  owner: VoiceOwner,
  attendees: VoiceAttendee[],
  opts: { excludeId?: string; before?: string; limit?: number } = {},
): Promise<Array<{ id: string; title: string; startedAt: string }>> {
  const emails = [...new Set(attendees.map((a) => a.email).filter(Boolean))].slice(0, 20);
  if (!emails.length) return [];
  const conds: string[] = [];
  const args: string[] = [];
  for (const e of emails) {
    conds.push(`s.attendees LIKE ? ESCAPE '\\'`);
    args.push(likeContains(`"${e}"`));
    conds.push('EXISTS (SELECT 1 FROM crm_contacts c WHERE c.id = s.contact_id AND c.user_id = s.workspace_id AND LOWER(c.email) = ?)');
    args.push(e);
  }
  const rows = (await getDb()
    .prepare(
      `SELECT s.id, s.title, s.started_at FROM voice_sessions s
       WHERE s.workspace_id = ? AND s.person_id = ? AND s.kind = 'meeting' AND s.id != ? AND s.started_at < ?
         AND (${conds.join(' OR ')})
       ORDER BY s.started_at DESC LIMIT ?`,
    )
    .all(owner.workspaceId, owner.personId, opts.excludeId ?? '', opts.before ?? nowIso(), ...args, opts.limit ?? 6)) as Array<{
    id: string;
    title: string;
    started_at: string;
  }>;
  return rows.map((r) => ({ id: r.id, title: r.title, startedAt: r.started_at }));
}

/**
 * Brief para una reunión con esas personas. Sin reuniones anteriores no llama
 * a la IA: devuelve el brief vacío (la UI dice que no hay historia).
 */
export async function buildBrief(args: {
  owner: VoiceOwner;
  title: string;
  attendees: VoiceAttendee[];
  locale: string;
  labels: MeetingLabels;
  excludeId?: string;
}): Promise<VoiceBrief> {
  const found = await pastMeetingsWith(args.owner, args.attendees, { excludeId: args.excludeId });
  if (!found.length) return { summary: '', openItems: [], meetings: [], at: nowIso() };
  const past: PastMeeting[] = [];
  for (const m of found) {
    const d = await getSessionDetail(args.owner, m.id);
    if (!d) continue;
    past.push({
      title: d.title,
      date: d.startedAt.slice(0, 10),
      summary: d.enhanced?.summary ?? '',
      actionItems: (d.enhanced?.actionItems ?? []).map((a) => `${a.text}${a.owner ? ` (${a.owner})` : ''}`),
      notes: d.enhanced ? meetingPlainText(d, args.labels) : d.myNotes,
    });
  }
  const out = await meetingBrief({
    workspaceId: args.owner.workspaceId,
    title: args.title,
    attendees: args.attendees.map((a) => a.name || a.email),
    past,
    locale: args.locale,
  });
  return { ...out, meetings: found, at: nowIso() };
}

/** Brief de una reunión ya creada (queda guardado en la reunión). */
export async function briefForSession(owner: VoiceOwner, sessionId: string, locale: string, labels: MeetingLabels): Promise<VoiceBrief> {
  const d = await getSessionDetail(owner, sessionId);
  if (!d || d.kind !== 'meeting') throw new VoiceError('not_found');
  const attendees = [...d.attendees];
  if (d.contactId) {
    const c = (await getDb().prepare('SELECT first_name, last_name, email FROM crm_contacts WHERE id = ? AND user_id = ?').get(d.contactId, owner.workspaceId)) as
      | { first_name: string; last_name: string; email: string }
      | undefined;
    if (c?.email) attendees.push({ name: `${c.first_name} ${c.last_name}`.trim(), email: c.email.toLowerCase() });
  }
  if (!attendees.length) throw new VoiceError('invalid_state');
  const brief = await buildBrief({ owner, title: d.title, attendees, locale, labels, excludeId: d.id });
  await getDb()
    .prepare(
      `INSERT INTO voice_notes (session_id, brief, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET brief = excluded.brief, updated_at = excluded.updated_at`,
    )
    .run(d.id, JSON.stringify(brief), nowIso());
  return brief;
}

/** Borrador del email de seguimiento (queda guardado; se puede editar y volver a generar). */
export async function followupForSession(args: {
  owner: VoiceOwner;
  sessionId: string;
  locale: string;
  labels: MeetingLabels;
  senderName: string;
}): Promise<VoiceFollowup> {
  const d = await getSessionDetail(args.owner, args.sessionId);
  if (!d || d.kind !== 'meeting') throw new VoiceError('not_found');
  const notes = d.enhanced ? meetingPlainText(d, args.labels) : d.myNotes.trim();
  if (!notes) throw new VoiceError('invalid_state');
  const attendees = [...d.attendees];
  if (!attendees.length && d.contactId) {
    const c = (await getDb().prepare('SELECT first_name, last_name, email FROM crm_contacts WHERE id = ? AND user_id = ?').get(d.contactId, args.owner.workspaceId)) as
      | { first_name: string; last_name: string; email: string }
      | undefined;
    if (c?.email) attendees.push({ name: `${c.first_name} ${c.last_name}`.trim(), email: c.email.toLowerCase() });
  }
  const draft = await followupEmail({
    workspaceId: args.owner.workspaceId,
    title: d.title || args.labels.fromVoice,
    notes,
    attendees,
    senderName: args.senderName,
    locale: args.locale,
  });
  const followup: VoiceFollowup = { to: attendees.map((a) => a.email).filter(Boolean), ...draft, at: nowIso() };
  await saveFollowup(d.id, followup);
  return followup;
}

export async function saveFollowup(sessionId: string, followup: VoiceFollowup): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO voice_notes (session_id, followup, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET followup = excluded.followup, updated_at = excluded.updated_at`,
    )
    .run(sessionId, JSON.stringify(followup), nowIso());
}

/** Destinatarios del email de una reunión (para validar lo que edita la persona). */
export async function sessionAttendees(owner: VoiceOwner, sessionId: string): Promise<VoiceAttendee[]> {
  const row = await getSessionRow(owner, sessionId);
  return row ? parseAttendees(row.attendees) : [];
}

/** Texto de un recipe de fábrica (messages/<locale>/voice.json › prompts.recipes). */
export type BuiltinPromptText = Record<string, { name: string; prompt: string }>;

/** Prompt de un recipe por id (propio, del equipo o de fábrica "builtin:<clave>"). */
export async function recipePrompt(owner: VoiceOwner, id: string, builtin: BuiltinPromptText): Promise<{ name: string; prompt: string } | null> {
  if (id.startsWith('builtin:')) return builtin[id.slice(8)] ?? null;
  const p = await getUsablePrompt(owner, id);
  return p && p.kind === 'recipe' ? { name: p.name, prompt: p.prompt } : null;
}

/** Corre un recipe sobre una reunión: queda en su chat como "/Nombre". */
export async function runRecipeOnMeeting(args: {
  owner: VoiceOwner;
  sessionId: string;
  recipe: { name: string; prompt: string };
  locale: string;
  labels: MeetingLabels;
}): Promise<VoiceChatMessage[]> {
  return chat({ owner: args.owner, sessionId: args.sessionId, question: args.recipe.prompt, shownQuestion: `/${args.recipe.name}`, locale: args.locale, labels: args.labels });
}

/** Corre un recipe sobre varias reuniones (las que mencionan el tema, o las últimas). */
export async function runRecipeAcross(args: {
  owner: VoiceOwner;
  recipe: { name: string; prompt: string };
  topic: string;
  locale: string;
  labels: MeetingLabels;
}) {
  return askAcross({ owner: args.owner, question: `${args.recipe.prompt}${args.topic ? `\n\n${args.topic}` : ''}`, searchText: args.topic, locale: args.locale, labels: args.labels });
}

// ---------- Command Mode y transforms ----------

/** Transform por nombre dicho ("más formal" → el transform "Más formal"), si hay uno que coincida. */
export function matchTransform<T extends { name: string }>(instruction: string, transforms: T[]): T | null {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\p{L}\p{N} ]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const said = norm(instruction);
  if (!said) return null;
  return transforms.find((t) => norm(t.name) === said) ?? null;
}

/**
 * Reescribe el texto seleccionado: con una instrucción dicha (Command Mode)
 * o con un transform guardado. Si lo dicho es el nombre de un transform, se
 * usa su prompt.
 */
export async function runCommand(args: {
  owner: VoiceOwner;
  text: string;
  instruction?: string;
  transformId?: string;
  locale: string;
  builtin: BuiltinPromptText;
}): Promise<{ text: string; instruction: string; transform: string | null }> {
  const { listPrompts } = await import('./voice-library');
  const { rewriteText } = await import('./voice-ai');
  let instruction = (args.instruction ?? '').trim();
  let transform: string | null = null;
  const own = await listPrompts(args.owner, 'transform');
  const all = [...own.map((p) => ({ id: p.id, name: p.name, prompt: p.prompt })), ...Object.entries(args.builtin).map(([k, v]) => ({ id: `builtin:${k}`, ...v }))];
  if (args.transformId) {
    const t = all.find((x) => x.id === args.transformId);
    if (!t) throw new VoiceError('not_found');
    instruction = t.prompt;
    transform = t.name;
  } else {
    const t = matchTransform(instruction, all);
    if (t) {
      instruction = t.prompt;
      transform = t.name;
    }
  }
  if (!instruction || !args.text.trim()) throw new VoiceError('invalid_state');
  const text = await rewriteText({ workspaceId: args.owner.workspaceId, text: args.text, instruction, locale: args.locale });
  return { text, instruction: args.instruction?.trim() || instruction, transform };
}

// ---------- Aprender de las correcciones ----------

/**
 * Corregir un dictado enseña al diccionario: las palabras cambiadas pasan a
 * reemplazos (lo que se oyó → lo que va) o a palabras para escribir así.
 * Solo con "Aprender de mis correcciones" prendido. Devuelve lo que sumó (la
 * UI lo muestra con la opción de deshacer).
 */
export async function learnFromEdit(owner: VoiceOwner, before: string, after: string): Promise<VoiceDictionaryEntry[]> {
  const { getVoiceSettings, listDictionary, addDictionaryEntry } = await import('./voice');
  const { learnCorrections } = await import('./voice-learn');
  const settings = await getVoiceSettings(owner);
  if (!settings.learnCorrections) return [];
  const known = await listDictionary(owner);
  const added: VoiceDictionaryEntry[] = [];
  for (const c of learnCorrections(before, after, known)) {
    try {
      added.push(await addDictionaryEntry(owner, c));
    } catch {
      // Repetida o diccionario lleno: se sigue con las demás.
    }
  }
  return added;
}

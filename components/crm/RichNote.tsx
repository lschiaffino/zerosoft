'use client';

import { forwardRef, useMemo } from 'react';
import RichEditor, { type RichEditorHandle } from '@/components/track/RichEditor';
import { MarkdownView } from '@/components/track/MarkdownView';
import type { Mentionable } from '@/lib/crm-mentions';
import { MentionText } from './MentionTextarea';

/**
 * Notas y comentarios con formato del CRM (C1). Reusan el editor y la lectura
 * de Track: el editor guarda markdown (negrita, cursiva, listas, links y
 * @menciones como `@email`) y la lectura lo pasa por el render de Track, que
 * escapa todo el HTML. Fuera de Track no hay referencias a issues.
 */

/** Las personas con email: el editor menciona por email (la lectura muestra el nombre). */
function withEmail(people: Mentionable[]): Mentionable[] {
  return people.filter((p) => p.email);
}

/** El cuerpo de una nota o comentario: markdown con formato, o el texto plano de antes con sus @menciones resaltadas. */
export function RichNoteBody({
  body,
  format,
  people,
  className = '',
  testId,
}: {
  body: string;
  format?: string | null;
  people: Mentionable[];
  className?: string;
  testId?: string;
}) {
  const members = useMemo(() => withEmail(people), [people]);
  if (format === 'md') {
    return <MarkdownView source={body} members={members} resolveIssues={false} className={`crm-rich ${className}`.trim()} testId={testId} />;
  }
  return (
    <p className={`tl-body ${className}`.trim()} data-testid={testId}>
      <MentionText text={body} people={people} />
    </p>
  );
}

interface NoteEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  people: Mentionable[];
  ariaLabel: string;
  placeholder?: string;
  testId?: string;
  onSubmit?: () => void;
  onEscape?: () => void;
  autoFocus?: boolean;
  /** Comentarios: más bajo. */
  compact?: boolean;
}

/** Editor de notas y comentarios: el de Track con barra de formato fija y sin issues. */
const NoteEditor = forwardRef<RichEditorHandle, NoteEditorProps>(function NoteEditor(
  { value, onChange, people, ariaLabel, placeholder, testId, onSubmit, onEscape, autoFocus, compact = false },
  ref,
) {
  const members = useMemo(() => withEmail(people), [people]);
  return (
    <RichEditor
      ref={ref}
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      testId={testId}
      members={members.length > 1 ? members : []}
      onSubmit={onSubmit}
      onEscape={onEscape}
      autoFocus={autoFocus}
      issueRefs={false}
      toolbar
      compact
      className={`crm-note-editor${compact ? ' is-comment' : ''}`}
    />
  );
});

export default NoteEditor;

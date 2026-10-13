/**
 * Tags de un registro: punto cuadrado del color + texto (sin pastillas).
 * Server- y client-safe (sin hooks).
 */
export interface TagDot {
  id: string;
  name: string;
  color: string;
}

export function tagColorVar(color: string): string {
  return `var(--c-${/^[a-z]+$/.test(color) ? color : 'crm'})`;
}

export default function TagDots({ tags, max = 3 }: { tags: TagDot[]; max?: number }) {
  if (!tags.length) return null;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <span className="tag-dots" title={tags.map((t) => t.name).join(', ')}>
      {shown.map((t) => (
        <span className="tag-dot" key={t.id}>
          <span className="tag-dot-mark" style={{ background: tagColorVar(t.color) }} aria-hidden />
          {t.name}
        </span>
      ))}
      {rest > 0 && <span className="tag-dot tag-dot-more mono">+{rest}</span>}
    </span>
  );
}

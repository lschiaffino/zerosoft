import { Link } from '@/i18n/navigation';
import type { TagInfo } from '@/lib/blog';

/** Tags como links a /blog/tag/<slug>; `current` marca el abierto. */
export default function TagList({ tags, label, current, counts = true }: { tags: TagInfo[]; label: string; current?: string; counts?: boolean }) {
  if (tags.length === 0) return null;
  return (
    <ul className="blog-tags" aria-label={label}>
      {tags.map((tag) => (
        <li key={tag.slug}>
          <Link href={`/blog/tag/${tag.slug}`} aria-current={tag.slug === current ? 'page' : undefined}>
            {tag.label}
            {counts && <span className="blog-tag-count data">{tag.count}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

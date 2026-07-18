'use client';

import { useRouter, usePathname } from '@/i18n/navigation';

interface PipelineSelectProps {
  pipelines: Array<{ id: string; name: string }>;
  selectedId: string | null;
  label: string;
}

/** Selector de pipeline para reports: navega a ?pipeline=<id> (server re-render). */
export default function PipelineSelect({ pipelines, selectedId, label }: PipelineSelectProps) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <select
      className="filter-select"
      value={selectedId ?? ''}
      aria-label={label}
      onChange={(e) => {
        router.replace(`${pathname}?pipeline=${e.target.value}`, { scroll: false });
      }}
    >
      {pipelines.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

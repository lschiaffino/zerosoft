'use client';

export type ViewType = 'list' | 'board' | 'calendar' | 'gantt';

interface ViewSwitcherProps {
  active: ViewType;
  onChange: (view: ViewType) => void;
  labels: {
    list: string;
    board: string;
    calendar: string;
    gantt: string;
  };
}

export default function ViewSwitcher({ active, onChange, labels }: ViewSwitcherProps) {
  const views: ViewType[] = ['list', 'board', 'calendar', 'gantt'];
  return (
    <div className="track-view-switcher" role="tablist" aria-label="View">
      {views.map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={active === v}
          className={active === v ? 'active' : undefined}
          onClick={() => onChange(v)}
        >
          {labels[v]}
        </button>
      ))}
    </div>
  );
}

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
    /** Nombre del grupo para lectores de pantalla. */
    group?: string;
  };
}

const VIEWS: ViewType[] = ['list', 'board', 'calendar', 'gantt'];

/** Lista / Tablero / Calendario / Cronograma: botones pegados con aria-pressed. */
export default function ViewSwitcher({ active, onChange, labels }: ViewSwitcherProps) {
  return (
    <div className="btn-group track-view-switcher" role="group" aria-label={labels.group}>
      {VIEWS.map((v) => (
        <button
          key={v}
          type="button"
          className="btn btn-sm"
          aria-pressed={active === v}
          onClick={() => onChange(v)}
          data-testid={`track-view-${v}`}
        >
          {labels[v]}
        </button>
      ))}
    </div>
  );
}

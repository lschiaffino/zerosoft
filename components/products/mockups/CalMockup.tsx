import { useTranslations } from 'next-intl';

/** July 2026 starts on a Wednesday (Monday-first grid). */
const LEADING_BLANKS = 2;
const DAYS = 31;
const AVAILABLE = new Set([2, 7, 9, 14, 16, 21, 23, 28, 30]);
const TODAY = 15;

const SLOTS = ['09:00', '09:30', '10:00', '11:30', '14:00', '15:30'];
const SELECTED = '10:00';

/** High-fidelity fake of Cal: a booking page with month grid and time slots. */
export default function CalMockup() {
  const t = useTranslations('pages.mockups.cal');
  const cells: (number | null)[] = [
    ...Array.from({ length: LEADING_BLANKS }, () => null),
    ...Array.from({ length: DAYS }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="mk mk-cal">
      <div className="mk-cal-side">
        <span className="mk-cal-ava" aria-hidden="true">
          0
        </span>
        <p className="mk-cal-name">{t('name')}</p>
        <p className="mk-cal-meet">{t('meeting')}</p>
        <p className="mk-cal-desc">{t('desc')}</p>
        <span className="mk-cal-dur">● 30 min</span>
      </div>

      <div className="mk-cal-mid">
        <div className="mk-cal-month">
          <span>{t('month')}</span>
          <nav aria-hidden="true">
            <span>←</span>
            <span>→</span>
          </nav>
        </div>
        <div className="mk-cal-grid">
          {(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'] as const).map((d) => (
            <span className="mk-cal-dow" key={d}>
              {t(d)}
            </span>
          ))}
          {cells.map((day, i) =>
            day === null ? (
              <span key={i} />
            ) : (
              <span
                key={i}
                className={`mk-cal-d ${AVAILABLE.has(day) ? 'ok' : ''} ${
                  day === TODAY ? 'today' : ''
                }`}
              >
                {day}
              </span>
            )
          )}
        </div>
      </div>

      <div className="mk-cal-slots">
        <span className="mk-cal-slots-label">{t('slotsLabel')}</span>
        {SLOTS.map((slot) => (
          <span className={`mk-slot ${slot === SELECTED ? 'sel' : ''}`} key={slot}>
            {slot}
          </span>
        ))}
        <span className="mk-cal-confirm">{t('confirm')}</span>
        <span className="mk-cal-tz">{t('tz')}</span>
      </div>
    </div>
  );
}

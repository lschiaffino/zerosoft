"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  atTime,
  dayKey,
  longWhen,
  monthGrid,
  MORNING,
  parseTimeText,
  presetDate,
  weekStart,
  whenOptions,
  zoneCity,
  type ClockTime,
  type WhenMode,
  type WhenPreset,
} from "@/lib/when-presets";

/** La última hora elegida a mano vuelve como sugerencia (solo en este navegador). */
const LAST_KEY = "zs:when-last-time";
const CHIPS: ClockTime[] = [
  { h: 8, m: 0 },
  { h: 9, m: 0 },
  { h: 13, m: 0 },
  { h: 18, m: 0 },
];
/** Hasta cuándo deja ir el calendario. */
const MAX_MONTHS = 24;

function readLast(): ClockTime | null {
  try {
    const v = localStorage.getItem(LAST_KEY);
    return v ? parseTimeText(v) : null;
  } catch {
    return null;
  }
}
function saveLast(t: ClockTime) {
  try {
    localStorage.setItem(LAST_KEY, `${t.h}:${String(t.m).padStart(2, "0")}`);
  } catch {
    // Sin almacenamiento: no se recuerda, nada más.
  }
}

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable);
const noon = (d: Date) => {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
/** El mismo día n meses después (el 31 pasa al último del mes si no tiene 31). */
const addMonths = (d: Date, n: number) =>
  new Date(
    d.getFullYear(),
    d.getMonth() + n,
    Math.min(
      d.getDate(),
      new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate(),
    ),
    12,
  );
const monthOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1, 12);
const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();
const sameTime = (a: ClockTime | null, b: ClockTime) =>
  !!a && a.h === b.h && a.m === b.m;

/**
 * Atajo 1, 2, 3… del selector: aprieta la opción con ese número. Para el
 * onKeyDown del contenedor (el diálogo); no hace nada mientras se escribe.
 */
export function whenShortcut(e: KeyboardEvent<HTMLElement>): boolean {
  if (
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    !/^[1-9]$/.test(e.key) ||
    typing(e.target)
  )
    return false;
  const btn = e.currentTarget.querySelector<HTMLButtonElement>(
    `[data-when-n="${e.key}"]`,
  );
  if (!btn || btn.disabled) return false;
  e.preventDefault();
  btn.click();
  return true;
}

/**
 * Elegir cuándo: las opciones del momento (con su fecha a la derecha y un
 * atajo 1, 2, 3… sin huecos) y, al final, "Elegir día y hora", que cambia a
 * un calendario del mes y una hora (atajos de hora o escrita: "9", "9:30",
 * "21", "9pm"), con la fecha completa y la zona antes del botón. Lo usan
 * WhenDialog (posponer, enviar más tarde, cambiar la hora) y el diálogo de
 * envíos programados de Inbox.
 */
export default function WhenPicker({
  mode,
  now,
  initial,
  confirmLabel,
  disabled = false,
  autoFocus = true,
  startCustom = false,
  onPick,
}: {
  mode: WhenMode;
  /** El momento en que se abrió (las opciones no saltan mientras está abierto). */
  now: Date;
  /** Fecha con la que arranca "Elegir día y hora" (al cambiar la hora de algo ya programado). */
  initial?: string | null;
  confirmLabel: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Arrancar en el calendario (editar algo ya programado: guardar sin cambiar la hora es un clic). */
  startCustom?: boolean;
  onPick: (iso: string) => void;
}) {
  const t = useTranslations("common.when");
  const locale = useLocale();
  const ids = useId();
  const root = useRef<HTMLDivElement>(null);
  const options = useMemo(() => whenOptions(now, mode), [now, mode]);
  const [view, setView] = useState<"list" | "custom">(
    startCustom ? "custom" : "list",
  );

  // Elegir a mano: arranca en lo que ya estaba programado o mañana a la hora de siempre.
  const start = useMemo(() => {
    const at = initial ? new Date(initial) : null;
    if (
      at &&
      !Number.isNaN(at.getTime()) &&
      at.getTime() > now.getTime() + 60_000
    )
      return { day: noon(at), time: { h: at.getHours(), m: at.getMinutes() } };
    return {
      day: noon(presetDate("tomorrow", now, mode)),
      time: readLast() ?? { h: MORNING[mode], m: 0 },
    };
  }, [initial, now, mode]);
  const [day, setDay] = useState(start.day);
  const [month, setMonth] = useState(() => monthOf(start.day));
  const [time, setTime] = useState<ClockTime | null>(start.time);
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }),
    [locale],
  );
  const fmt = (c: ClockTime) => timeFmt.format(atTime(now, c));
  const [timeText, setTimeText] = useState(() => fmt(start.time));
  /** El usuario cambió de vista (el foco va adonde fue); si no, solo con autoFocus. */
  const [moved, setMoved] = useState(false);

  const today = noon(now);
  const firstDay = weekStart(locale);
  const weeks = monthGrid(month, firstDay);
  const at = time ? atTime(day, time) : null;
  const past = !!at && at.getTime() <= Date.now() + 60_000;
  const chips = useMemo(() => {
    const last = readLast();
    const list =
      last && !CHIPS.some((c) => sameTime(last, c)) ? [...CHIPS, last] : CHIPS;
    return [...list].sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));
  }, []);
  const city = useMemo(() => {
    try {
      return zoneCity(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      return "";
    }
  }, []);

  const weekdayNames = useMemo(() => {
    // Un domingo conocido (2026-11-15) y los seis días que siguen.
    const narrow = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
    const long = new Intl.DateTimeFormat(locale, { weekday: "long" });
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(2026, 10, 15 + ((firstDay + i) % 7), 12);
      return { short: narrow.format(d), long: long.format(d) };
    });
  }, [locale, firstDay]);
  const monthName = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(month);
  const dayName = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [locale],
  );

  const pickPreset = (p: WhenPreset) => {
    if (disabled) return;
    onPick(presetDate(p, new Date(), mode).toISOString());
  };

  // Al abrir: el foco en la primera opción. Al pasar al calendario: en el día elegido; al volver, en "Elegir día y hora".
  useEffect(() => {
    const r = root.current;
    if (!r || (!moved && !autoFocus)) return;
    if (view === "custom")
      r.querySelector<HTMLElement>('.ui-cal-day[tabindex="0"]')?.focus();
    else
      r.querySelector<HTMLElement>(
        moved ? ".ui-when-more" : ".ui-when-opt",
      )?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const moveTo = (next: Date) => {
    let d = noon(next);
    if (d.getTime() < today.getTime()) d = today;
    const max = new Date(
      today.getFullYear(),
      today.getMonth() + MAX_MONTHS,
      0,
      12,
    );
    if (d.getTime() > max.getTime()) d = max;
    setDay(d);
    setMonth(monthOf(d));
    // El foco sigue al día (después de dibujar el mes nuevo, si cambió).
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLElement>(`.ui-cal-day[data-day="${dayKey(d)}"]`)
        ?.focus(),
    );
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, () => Date> = {
      ArrowLeft: () => addDays(day, -1),
      ArrowRight: () => addDays(day, 1),
      ArrowUp: () => addDays(day, -7),
      ArrowDown: () => addDays(day, 7),
      Home: () => addDays(day, -((day.getDay() - firstDay + 7) % 7)),
      End: () => addDays(day, 6 - ((day.getDay() - firstDay + 7) % 7)),
      PageUp: () => addMonths(day, -1),
      PageDown: () => addMonths(day, 1),
    };
    const go = step[e.key];
    if (!go || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    moveTo(go());
  };

  const setTyped = (text: string) => {
    setTimeText(text);
    setTime(parseTimeText(text));
  };
  const chooseTime = (c: ClockTime) => {
    setTime(c);
    setTimeText(fmt(c));
  };
  const submit = () => {
    if (disabled || !at || past || !time) return;
    saveLast(time);
    onPick(at.toISOString());
  };

  const visibleDay = monthIndex(day) === monthIndex(month);
  const tabbable = visibleDay
    ? dayKey(day)
    : dayKey(
        weeks.flat().find((d) => d && d.getTime() >= today.getTime()) ?? day,
      );
  const canPrev = monthIndex(month) > monthIndex(today);
  const canNext = monthIndex(month) < monthIndex(today) + MAX_MONTHS - 1;
  const shiftMonth = (n: number) => {
    const m = new Date(month.getFullYear(), month.getMonth() + n, 1, 12);
    setMonth(m);
  };

  return (
    <div ref={root} className="ui-when-picker" data-view={view}>
      {view === "list" ? (
        <ul
          className="ui-when-list"
          onKeyDown={(e) => {
            // Enter elige la opción con el foco (acá, antes de que un atajo de la página se lo lleve).
            if (
              e.key === "Enter" &&
              !e.metaKey &&
              !e.ctrlKey &&
              !e.altKey &&
              !e.shiftKey &&
              (e.target as Element).closest(".ui-when-opt")
            ) {
              e.preventDefault();
              e.stopPropagation();
              (e.target as HTMLElement)
                .closest<HTMLButtonElement>(".ui-when-opt")
                ?.click();
              return;
            }
            // Flechas arriba y abajo recorren las opciones.
            if (
              (e.key !== "ArrowDown" && e.key !== "ArrowUp") ||
              e.metaKey ||
              e.ctrlKey ||
              e.altKey
            )
              return;
            const items = Array.from(
              e.currentTarget.querySelectorAll<HTMLButtonElement>(
                ".ui-when-opt:not(:disabled)",
              ),
            );
            const i = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            e.preventDefault();
            items[
              i < 0
                ? 0
                : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length
            ]?.focus();
          }}
        >
          {options.map((o, i) => (
            <li key={o.preset}>
              <button
                type="button"
                className="ui-when-opt"
                data-preset={o.preset}
                data-when-n={i + 1}
                disabled={disabled}
                onClick={() => pickPreset(o.preset)}
              >
                <span className="kbd" aria-hidden>
                  {i + 1}
                </span>
                <span className="ui-when-label">{t(`preset.${o.preset}`)}</span>
                <span className="ui-when-at">
                  {longWhen(o.at.toISOString(), locale)}
                </span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="ui-when-opt ui-when-more"
              data-testid="when-custom"
              onClick={() => {
                setMoved(true);
                setView("custom");
              }}
            >
              <CalendarIcon />
              <span className="ui-when-label">{t("custom")}</span>
              <ChevronIcon dir="right" />
            </button>
          </li>
        </ul>
      ) : (
        <form
          className="ui-when-pick"
          aria-label={t("custom")}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          onKeyDown={(e) => {
            // Enter en la hora programa (sin depender del envío implícito del form).
            if (
              e.key === "Enter" &&
              e.target instanceof HTMLInputElement &&
              !e.metaKey &&
              !e.ctrlKey &&
              !e.altKey &&
              !e.shiftKey
            ) {
              e.preventDefault();
              e.stopPropagation();
              submit();
            }
          }}
        >
          <div className="ui-when-pick-cols">
            <div className="ui-cal">
              <div className="ui-cal-head">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon ui-when-back"
                  aria-label={t("back")}
                  title={t("back")}
                  onClick={() => {
                    setMoved(true);
                    setView("list");
                  }}
                >
                  <BackIcon />
                </button>
                <span
                  className="ui-cal-month"
                  id={`${ids}-m`}
                  aria-live="polite"
                >
                  {monthName}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon"
                  aria-label={t("prevMonth")}
                  title={t("prevMonth")}
                  disabled={!canPrev}
                  onClick={() => shiftMonth(-1)}
                >
                  <ChevronIcon dir="left" />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon"
                  aria-label={t("nextMonth")}
                  title={t("nextMonth")}
                  disabled={!canNext}
                  onClick={() => shiftMonth(1)}
                >
                  <ChevronIcon dir="right" />
                </button>
              </div>
              <div
                className="ui-cal-grid"
                role="grid"
                aria-labelledby={`${ids}-m`}
                onKeyDown={onGridKey}
              >
                <div className="ui-cal-row" role="row">
                  {weekdayNames.map((w) => (
                    <span
                      key={w.long}
                      className="ui-cal-dow"
                      role="columnheader"
                      aria-label={w.long}
                      title={w.long}
                    >
                      {w.short}
                    </span>
                  ))}
                </div>
                {weeks.map((week, wi) => (
                  <div key={wi} className="ui-cal-row" role="row">
                    {week.map((d, di) =>
                      d ? (
                        <span
                          key={di}
                          role="gridcell"
                          aria-selected={dayKey(d) === dayKey(day)}
                        >
                          <button
                            type="button"
                            className="ui-cal-day"
                            data-day={dayKey(d)}
                            tabIndex={dayKey(d) === tabbable ? 0 : -1}
                            disabled={d.getTime() < today.getTime()}
                            aria-pressed={dayKey(d) === dayKey(day)}
                            aria-current={
                              dayKey(d) === dayKey(today) ? "date" : undefined
                            }
                            aria-label={dayName.format(d)}
                            onClick={() => moveTo(d)}
                          >
                            {d.getDate()}
                          </button>
                        </span>
                      ) : (
                        <span key={di} role="gridcell" className="ui-cal-pad" />
                      ),
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="ui-when-time">
              <label className="label" htmlFor={`${ids}-t`}>
                {t("time")}
              </label>
              <input
                id={`${ids}-t`}
                className="input"
                value={timeText}
                inputMode="text"
                autoComplete="off"
                enterKeyHint="done"
                placeholder={t("timePlaceholder")}
                aria-invalid={!time || undefined}
                aria-describedby={`${ids}-s`}
                onChange={(e) => setTyped(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => time && setTimeText(fmt(time))}
              />
              <div
                className="ui-when-chips"
                role="group"
                aria-label={t("quickTimes")}
              >
                {chips.map((c) => (
                  <button
                    key={`${c.h}:${c.m}`}
                    type="button"
                    className="ui-when-chip"
                    aria-pressed={sameTime(time, c)}
                    onClick={() => chooseTime(c)}
                  >
                    {fmt(c)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="ui-when-done">
            <p className="ui-when-summary" id={`${ids}-s`} aria-live="polite">
              {at ? (
                <strong>{longWhen(at.toISOString(), locale)}</strong>
              ) : null}
              {city && <span>{t("zone", { city })}</span>}
            </p>
            {!time ? (
              <p className="ui-error" role="alert">
                {t("timeError")}
              </p>
            ) : past ? (
              <p className="ui-error" role="alert">
                {t("pastError")}
              </p>
            ) : null}
            <button
              type="submit"
              className="btn btn-primary ui-when-confirm"
              disabled={disabled || !time || past}
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg
      className="ui-when-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <rect x="3.5" y="5" width="17" height="15.5" rx="1.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

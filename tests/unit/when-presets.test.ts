import { afterAll, describe, expect, it } from "vitest";
import {
  atTime,
  monthGrid,
  parseTimeText,
  presetDate,
  visiblePresets,
  weekStart,
  whenOptions,
  WHEN_PRESETS,
  zoneCity,
  type WhenMode,
  type WhenPreset,
} from "@/lib/when-presets";

// 2026-11-15 es domingo: día 15 + n es el día n de la semana (0 domingo … 6 sábado).
const on = (dow: number, h: number, m = 0) =>
  new Date(2026, 10, 15 + dow, h, m);
const HOURS: [number, number][] = [
  [1, 0],
  [7, 0],
  [11, 0],
  [16, 0],
  [19, 0],
  [23, 30],
];
const MODES: WhenMode[] = ["snooze", "send"];

describe('opciones de "cuándo" según el momento', () => {
  for (const mode of MODES)
    for (let dow = 0; dow < 7; dow++)
      for (const [h, m] of HOURS) {
        const now = on(dow, h, m);
        it(`${mode}, día ${dow} a las ${h}:${String(m).padStart(2, "0")}: en orden, sin repetidos, en el futuro, entre 3 y 6`, () => {
          const opts = whenOptions(now, mode);
          expect(opts.length).toBeGreaterThanOrEqual(3);
          expect(opts.length).toBeLessThanOrEqual(6);
          const times = opts.map((o) => o.at.getTime());
          expect(new Set(times).size).toBe(times.length);
          expect(new Set(opts.map((o) => o.preset)).size).toBe(opts.length);
          for (const t of times)
            expect(t).toBeGreaterThan(now.getTime() + 60_000);
          expect([...times].sort((a, b) => a - b)).toEqual(times);
          // "Mañana a la mañana" está siempre (y es lo que se espera ver).
          expect(opts.map((o) => o.preset)).toContain("tomorrow");
          // Los atajos 1..n: las opciones visibles en el orden en que se ven, sin huecos.
          expect(visiblePresets(now, mode)).toEqual(opts.map((o) => o.preset));
          // Un envío no cae en sábado o domingo salvo "Mañana a la mañana" (y "Más tarde hoy" si hoy lo es).
          if (mode === "send")
            for (const o of opts)
              if (o.preset !== "tomorrow" && o.preset !== "later")
                expect([0, 6]).not.toContain(o.at.getDay());
          // "En dos días" no aparece si otra opción ya cae ese día.
          const two = opts.find((o) => o.preset === "twoDays");
          if (two)
            expect(
              opts.filter((o) => o.at.toDateString() === two.at.toDateString()),
            ).toHaveLength(1);
        });
      }
});

const names = (now: Date, mode: WhenMode) => visiblePresets(now, mode);
const hm = (d: Date) =>
  `${d.getDay()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

describe("las reglas", () => {
  it("martes 11:00, enviar: más tarde, mañana a la mañana y a la tarde, en dos días, el viernes, la semana que viene", () => {
    expect(names(on(2, 11), "send")).toEqual([
      "later",
      "tomorrow",
      "tomorrowAfternoon",
      "twoDays",
      "friday",
      "nextWeek",
    ]);
    expect(hm(presetDate("later", on(2, 11), "send"))).toBe("2 14:00");
    expect(hm(presetDate("tomorrow", on(2, 11), "send"))).toBe("3 9:00");
    expect(hm(presetDate("tomorrowAfternoon", on(2, 11), "send"))).toBe(
      "3 14:00",
    );
    expect(hm(presetDate("friday", on(2, 11), "send"))).toBe("5 14:00");
    expect(hm(presetDate("nextWeek", on(2, 11), "send"))).toBe("1 9:00");
  });

  it("martes 11:00, posponer: más tarde, esta noche, mañana a las 8, en dos días, el fin de semana, la semana que viene", () => {
    expect(names(on(2, 11), "snooze")).toEqual([
      "later",
      "tonight",
      "tomorrow",
      "twoDays",
      "weekend",
      "nextWeek",
    ]);
    expect(hm(presetDate("tonight", on(2, 11), "snooze"))).toBe("2 20:00");
    expect(hm(presetDate("tomorrow", on(2, 11), "snooze"))).toBe("3 8:00");
    expect(hm(presetDate("weekend", on(2, 11), "snooze"))).toBe("6 10:00");
  });

  it('el lunes "A mitad de semana" es el miércoles y reemplaza a "En dos días"', () => {
    const opts = names(on(1, 11), "send");
    expect(opts).toContain("midweek");
    expect(opts).not.toContain("twoDays");
    expect(hm(presetDate("midweek", on(1, 11), "send"))).toBe("3 9:00");
  });

  it('jueves, viernes y sábado: "El lunes a la mañana" y la mitad de la semana que viene, no "La semana que viene"', () => {
    for (const dow of [4, 5, 6]) {
      const opts = names(on(dow, 11), "send");
      expect(opts).toContain("monday");
      expect(opts).toContain("midweek");
      expect(opts).not.toContain("nextWeek");
      expect(
        presetDate("midweek", on(dow, 11), "send").getTime() -
          on(dow, 11).getTime(),
      ).toBeGreaterThan(3 * 86_400_000);
    }
    // El viernes, mañana es sábado: no hay "Mañana a la tarde" para un envío.
    expect(names(on(5, 11), "send")).not.toContain("tomorrowAfternoon");
  });

  it('el domingo, mañana ya es lunes: ni "El lunes" ni "La semana que viene"', () => {
    for (const mode of MODES) {
      const opts = names(on(0, 11), mode);
      expect(opts).not.toContain("monday");
      expect(opts).not.toContain("nextWeek");
      expect(presetDate("tomorrow", on(0, 11), mode).getDay()).toBe(1);
    }
  });

  it('"Más tarde hoy" redondea a la media hora y solo si cae antes de las 19', () => {
    expect(hm(presetDate("later", on(2, 11, 10)))).toBe("2 14:30");
    expect(hm(presetDate("later", on(2, 11, 30)))).toBe("2 14:30");
    expect(names(on(2, 15, 29), "snooze")).toContain("later");
    expect(names(on(2, 15, 31), "snooze")).not.toContain("later");
    expect(names(on(2, 16), "send")).not.toContain("later");
  });

  it('"Esta noche" solo antes de las 18 y solo al posponer', () => {
    expect(names(on(3, 17, 59), "snooze")).toContain("tonight");
    expect(names(on(3, 18), "snooze")).not.toContain("tonight");
    expect(names(on(3, 11), "send")).not.toContain("tonight");
  });

  it('de madrugada "Mañana" es la mañana que viene (hoy)', () => {
    const now = on(3, 1, 30);
    expect(presetDate("tomorrow", now, "snooze").toDateString()).toBe(
      now.toDateString(),
    );
    expect(presetDate("tomorrow", now, "snooze").getHours()).toBe(8);
    expect(names(now, "snooze")).not.toContain("later");
    expect(names(now, "snooze")).not.toContain("tonight");
    // A las 5 ya es otro día.
    expect(presetDate("tomorrow", on(3, 5), "snooze").getDate()).toBe(
      on(4, 5).getDate(),
    );
  });

  it("cada preset da una fecha futura en cualquier momento (aunque no se muestre)", () => {
    for (const mode of MODES)
      for (let dow = 0; dow < 7; dow++)
        for (const [h, m] of HOURS)
          for (const p of WHEN_PRESETS as WhenPreset[])
            expect(
              presetDate(p, on(dow, h, m), mode).getTime(),
            ).toBeGreaterThan(on(dow, h, m).getTime());
  });
});

describe("con cambio de hora", () => {
  const tz = process.env.TZ;
  afterAll(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it("en Nueva York, el fin de semana del cambio: horas justas, sin repetidos y en el futuro", () => {
    process.env.TZ = "America/New_York";
    // El cambio de zona tiene efecto: marzo antes y después del cambio tienen distinto desfase.
    expect(new Date(2026, 2, 7, 12).getTimezoneOffset()).not.toBe(
      new Date(2026, 2, 9, 12).getTimezoneOffset(),
    );
    // 2026-03-08 (domingo) adelanta a las 2; 2026-11-01 (domingo) atrasa.
    for (const day of [
      new Date(2026, 2, 6),
      new Date(2026, 2, 7),
      new Date(2026, 2, 8),
      new Date(2026, 9, 30),
      new Date(2026, 9, 31),
      new Date(2026, 10, 1),
    ]) {
      for (const [h, m] of HOURS) {
        const now = new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          h,
          m,
        );
        for (const mode of MODES) {
          const opts = whenOptions(now, mode);
          const times = opts.map((o) => o.at.getTime());
          expect(new Set(times).size).toBe(times.length);
          for (const o of opts) {
            expect(o.at.getTime()).toBeGreaterThan(now.getTime());
            if (o.preset !== "later") expect(o.at.getMinutes()).toBe(0);
            if (o.preset === "tomorrow")
              expect(o.at.getHours()).toBe(mode === "send" ? 9 : 8);
          }
        }
      }
    }
  });
});

describe("la hora escrita", () => {
  const ok: [string, number, number][] = [
    ["9", 9, 0],
    ["09", 9, 0],
    ["9:30", 9, 30],
    ["9.30", 9, 30],
    ["930", 9, 30],
    ["0930", 9, 30],
    ["21", 21, 0],
    ["21:05", 21, 5],
    ["21hs", 21, 0],
    ["9 hs", 9, 0],
    ["9h", 9, 0],
    ["9pm", 21, 0],
    ["9 PM", 21, 0],
    ["9:30 p. m.", 21, 30],
    ["9am", 9, 0],
    ["12am", 0, 0],
    ["12pm", 12, 0],
    ["0", 0, 0],
    [" 18:00 ", 18, 0],
  ];
  for (const [text, h, m] of ok)
    it(`"${text}" es ${h}:${m}`, () =>
      expect(parseTimeText(text)).toEqual({ h, m }));
  for (const text of [
    "",
    "abc",
    "25",
    "9:75",
    "13pm",
    "0am",
    "123:45",
    "9:5",
    "mañana",
  ])
    it(`"${text}" no es una hora`, () =>
      expect(parseTimeText(text)).toBeNull());
});

describe("el calendario", () => {
  it("la semana arranca según el idioma: lunes en español, domingo en inglés (EE. UU.) y portugués (Brasil)", () => {
    expect(weekStart("es")).toBe(1);
    expect(weekStart("en")).toBe(0);
    expect(weekStart("pt")).toBe(0);
  });

  it("el mes en semanas completas, con huecos al principio y al final", () => {
    const nov = monthGrid(new Date(2026, 10, 20), 1);
    // Noviembre 2026 arranca un domingo: con semana de lunes, seis huecos antes del 1.
    expect(nov[0].slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(nov[0][6]?.getDate()).toBe(1);
    expect(nov.every((w) => w.length === 7)).toBe(true);
    expect(nov.flat().filter(Boolean)).toHaveLength(30);
    const sun = monthGrid(new Date(2026, 10, 20), 0);
    expect(sun[0][0]?.getDate()).toBe(1);
  });

  it("une día y hora, y la zona se lee como ciudad", () => {
    const d = atTime(new Date(2026, 10, 17, 12), { h: 9, m: 30 });
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([17, 9, 30]);
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneCity("UTC")).toBe("UTC");
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { atTourStart, deduceAudience, parseTours, shouldAutoStart, stepsFor, tourForPath, TOUR_KEYS, TOURS } from '@/lib/tours';

const ids = (steps: Array<{ id: string }>) => steps.map((s) => s.id);
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}/common.json`, 'utf8')) as { tour: Record<string, unknown> };

describe('tours: registro y rutas', () => {
  it('el tour de Lines vive en /app/lines y arranca en la bandeja', () => {
    expect(tourForPath('/app/lines/inbox')?.key).toBe('lines');
    expect(tourForPath('/es/app/lines/settings')?.key).toBe('lines');
    expect(tourForPath('/app/lines')?.key).toBe('lines');
    expect(tourForPath('/app/linesx')).toBeNull();
    expect(tourForPath('/app/inboxes')).toBeNull();
    expect(tourForPath('/app/trackx')).toBeNull();
    expect(tourForPath(null)).toBeNull();
    expect(atTourStart(TOURS.lines, '/pt/app/lines/inbox')).toBe(true);
    expect(atTourStart(TOURS.lines, '/app/lines/inbox/abc')).toBe(false);
  });

  it('el tour de Track arranca en el resumen y sigue en Issues', () => {
    expect(tourForPath('/app/track')?.key).toBe('track');
    expect(tourForPath('/es/app/track/issues')?.key).toBe('track');
    expect(atTourStart(TOURS.track, '/pt/app/track')).toBe(true);
    expect(atTourStart(TOURS.track, '/app/track/issues')).toBe(false);
    // Track no pregunta equipo o sola: los mismos pasos para todos.
    expect(ids(stepsFor(TOURS.track, { audience: 'team', admin: false }))).toEqual(ids(stepsFor(TOURS.track, { audience: 'solo', admin: true })));
    const steps = ids([...TOURS.track.steps]);
    // Abrir Issues (un clic en el lateral) va antes de filtros, visualización y vistas, que viven ahí.
    expect(steps.indexOf('issues')).toBeLessThan(steps.indexOf('filters'));
    expect(TOURS.track.steps.find((s) => s.id === 'issues')).toMatchObject({ advanceOn: 'click' });
  });

  it('el tour de Board arranca en la lista y sigue en el lienzo; equipo ve el taller y compartir con el workspace', () => {
    expect(tourForPath('/app/board')?.key).toBe('board');
    expect(tourForPath('/es/app/board/abc')?.key).toBe('board');
    expect(tourForPath('/app/boards')).toBeNull();
    expect(atTourStart(TOURS.board, '/pt/app/board')).toBe(true);
    expect(atTourStart(TOURS.board, '/app/board/abc')).toBe(false);
    const steps = ids([...TOURS.board.steps]);
    // Abrir una pizarra (clic en una tarjeta) va antes de los pasos del lienzo.
    for (const id of ['toolbar', 'canvasTools', 'zoom', 'share']) expect(steps.indexOf('openBoard')).toBeLessThan(steps.indexOf(id));
    expect(TOURS.board.steps.find((s) => s.id === 'openBoard')).toMatchObject({ advanceOn: 'click' });
    const team = ids(stepsFor(TOURS.board, { audience: 'team', admin: false }));
    const solo = ids(stepsFor(TOURS.board, { audience: 'solo', admin: false }));
    expect(team).toContain('workshop');
    expect(team).toContain('shareTeam');
    expect(team).not.toContain('share');
    expect(solo).not.toContain('workshop');
    expect(solo).toContain('share');
    expect(solo).not.toContain('shareTeam');
  });

  it('el tour de Cal vive en /app/calendar, arranca en el resumen y suma el ruteo para equipo', () => {
    expect(tourForPath('/app/calendar')?.key).toBe('cal');
    expect(tourForPath('/es/app/calendar/event-types/abc')?.key).toBe('cal');
    expect(tourForPath('/app/calendars')).toBeNull();
    expect(atTourStart(TOURS.cal, '/pt/app/calendar')).toBe(true);
    expect(atTourStart(TOURS.cal, '/app/calendar/bookings')).toBe(false);
    const team = ids(stepsFor(TOURS.cal, { audience: 'team', admin: false }));
    const solo = ids(stepsFor(TOURS.cal, { audience: 'solo', admin: false }));
    expect(team).toContain('routing');
    expect(solo).not.toContain('routing');
    expect(solo).toEqual(expect.arrayContaining(['newEventType', 'eventType', 'upcoming', 'bookings', 'availability', 'settings']));
  });

  it('el tour de Send arranca en la lista y sigue en el documento; equipo ve quién lo ve', () => {
    expect(tourForPath('/app/send')?.key).toBe('send');
    expect(tourForPath('/es/app/send/documents/abc')?.key).toBe('send');
    expect(tourForPath('/app/sendx')).toBeNull();
    expect(atTourStart(TOURS.send, '/pt/app/send')).toBe(true);
    expect(atTourStart(TOURS.send, '/app/send/new')).toBe(false);
    const steps = ids([...TOURS.send.steps]);
    // Abrir un documento (clic en una fila) va antes de los pasos del documento.
    for (const id of ['links', 'activity', 'sharing']) expect(steps.indexOf('openDocument')).toBeLessThan(steps.indexOf(id));
    expect(TOURS.send.steps.find((s) => s.id === 'openDocument')).toMatchObject({ advanceOn: 'click' });
    expect(ids(stepsFor(TOURS.send, { audience: 'team', admin: false }))).toContain('sharing');
    const solo = ids(stepsFor(TOURS.send, { audience: 'solo', admin: false }));
    expect(solo).not.toContain('sharing');
    expect(solo).toEqual(expect.arrayContaining(['newDocument', 'openDocument', 'links', 'activity', 'spaces', 'analytics']));
  });

  it('el tour de Rec arranca en Mis videos y sigue en el video; equipo ve el workspace y ajustes es de quien administra', () => {
    expect(tourForPath('/app/rec')?.key).toBe('rec');
    expect(tourForPath('/es/app/rec/abc123')?.key).toBe('rec');
    expect(tourForPath('/app/recx')).toBeNull();
    expect(tourForPath('/app/recipes')).toBeNull();
    expect(atTourStart(TOURS.rec, '/pt/app/rec')).toBe(true);
    expect(atTourStart(TOURS.rec, '/app/rec/new')).toBe(false);
    expect(atTourStart(TOURS.rec, '/app/rec/abc123')).toBe(false);
    const steps = ids([...TOURS.rec.steps]);
    // El lateral va antes de abrir un video, y abrirlo (clic en una tarjeta) antes de los pasos del video.
    for (const id of ['workspace', 'settings']) expect(steps.indexOf(id)).toBeLessThan(steps.indexOf('openVideo'));
    for (const id of ['share', 'insights']) expect(steps.indexOf('openVideo')).toBeLessThan(steps.indexOf(id));
    expect(TOURS.rec.steps.find((s) => s.id === 'openVideo')).toMatchObject({ advanceOn: 'click' });
    expect(ids(stepsFor(TOURS.rec, { audience: 'team', admin: true }))).toEqual(steps);
    const solo = ids(stepsFor(TOURS.rec, { audience: 'solo', admin: true }));
    expect(solo).not.toContain('workspace');
    expect(solo).toContain('settings');
    expect(ids(stepsFor(TOURS.rec, { audience: 'team', admin: false }))).not.toContain('settings');
  });

  it('el tour de Talk arranca en /app/talk o en el canal al que pasa solo, no en ajustes ni analíticas', () => {
    expect(tourForPath('/app/talk')?.key).toBe('talk');
    expect(tourForPath('/es/app/talk/abc123')?.key).toBe('talk');
    expect(tourForPath('/app/talkx')).toBeNull();
    expect(atTourStart(TOURS.talk, '/pt/app/talk')).toBe(true);
    expect(atTourStart(TOURS.talk, '/en/app/talk/abc123')).toBe(true);
    expect(atTourStart(TOURS.talk, '/app/talk/settings')).toBe(false);
    expect(atTourStart(TOURS.talk, '/app/talk/analytics')).toBe(false);
    expect(atTourStart(TOURS.talk, '/app/talk/abc123/extra')).toBe(false);
    expect(atTourStart(TOURS.talk, '/app/talkx')).toBe(false);
    // Los demás tours siguen arrancando solo en su ruta exacta.
    expect(atTourStart(TOURS.cal, '/app/calendar/abc123')).toBe(false);
    // Mismos pasos para todos; el redactor va antes que hilos (en el teléfono se saltea).
    expect(ids(stepsFor(TOURS.talk, { audience: 'solo', admin: false }))).toEqual(ids([...TOURS.talk.steps]));
    expect(ids([...TOURS.talk.steps])).toEqual(['intro', 'channels', 'dms', 'composer', 'threads', 'search', 'analytics', 'settings', 'done']);
  });

  it('el tour de Voice arranca en Reuniones, no en una reunión ni en dictado, y es igual para todos', () => {
    expect(tourForPath('/app/voice')?.key).toBe('voice');
    expect(tourForPath('/es/app/voice/meetings/abc123')?.key).toBe('voice');
    expect(tourForPath('/app/voice/dictation')?.key).toBe('voice');
    expect(tourForPath('/app/voicex')).toBeNull();
    expect(atTourStart(TOURS.voice, '/pt/app/voice')).toBe(true);
    expect(atTourStart(TOURS.voice, '/app/voice/meetings/abc123')).toBe(false);
    expect(atTourStart(TOURS.voice, '/app/voice/dictation')).toBe(false);
    expect(atTourStart(TOURS.voice, '/app/voice/settings')).toBe(false);
    // Voice es de cada persona: los mismos pasos para todos.
    expect(ids(stepsFor(TOURS.voice, { audience: 'team', admin: false }))).toEqual(ids([...TOURS.voice.steps]));
    expect(ids(stepsFor(TOURS.voice, { audience: 'solo', admin: true }))).toEqual(ids([...TOURS.voice.steps]));
    // La página de Reuniones primero; el lateral (en el teléfono, un cajón que se saltea) al final.
    const steps = ids([...TOURS.voice.steps]);
    expect(steps).toEqual(['intro', 'newMeeting', 'import', 'upcoming', 'ask', 'folders', 'meetings', 'dictation', 'settings', 'done']);
  });

  it('el tour de Forms arranca en la lista y sigue en el formulario; equipo ve quién lo ve', () => {
    expect(tourForPath('/app/forms')?.key).toBe('forms');
    expect(tourForPath('/es/app/forms/abc/responses')?.key).toBe('forms');
    expect(tourForPath('/app/formsx')).toBeNull();
    expect(atTourStart(TOURS.forms, '/pt/app/forms')).toBe(true);
    expect(atTourStart(TOURS.forms, '/app/forms/new')).toBe(false);
    const steps = ids([...TOURS.forms.steps]);
    // Abrir un formulario (clic en una fila) va antes de los pasos del formulario.
    for (const id of ['questions', 'publish', 'share', 'responses', 'access']) expect(steps.indexOf('openForm')).toBeLessThan(steps.indexOf(id));
    expect(TOURS.forms.steps.find((s) => s.id === 'openForm')).toMatchObject({ advanceOn: 'click' });
    expect(ids(stepsFor(TOURS.forms, { audience: 'team', admin: false }))).toContain('access');
    expect(ids(stepsFor(TOURS.forms, { audience: 'solo', admin: false }))).not.toContain('access');
  });

  it('el tour de Inbox vive en /app/inbox, arranca en la bandeja y no tiene pasos de equipo', () => {
    expect(tourForPath('/app/inbox')?.key).toBe('inbox');
    expect(tourForPath('/es/app/inbox/v/reply')?.key).toBe('inbox');
    expect(atTourStart(TOURS.inbox, '/en/app/inbox')).toBe(true);
    expect(atTourStart(TOURS.inbox, '/app/inbox/settings')).toBe(false);
    // Inbox es de cada persona: los mismos pasos para todos.
    expect(ids(stepsFor(TOURS.inbox, { audience: 'team', admin: false }))).toEqual(ids([...TOURS.inbox.steps]));
    expect(ids(stepsFor(TOURS.inbox, { audience: 'solo', admin: true }))).toEqual(ids([...TOURS.inbox.steps]));
  });

  it('el tour de Notes arranca en /app/notes; abrir una nota va antes que los pasos de la nota', () => {
    expect(tourForPath('/app/notes')?.key).toBe('notes');
    expect(tourForPath('/es/app/notes/clip')?.key).toBe('notes');
    expect(tourForPath('/app/notesx')).toBeNull();
    expect(atTourStart(TOURS.notes, '/pt/app/notes')).toBe(true);
    expect(atTourStart(TOURS.notes, '/app/notes/settings')).toBe(false);
    // Notes es de cada persona: los mismos pasos para todos.
    expect(ids(stepsFor(TOURS.notes, { audience: 'team', admin: false }))).toEqual(ids([...TOURS.notes.steps]));
    const steps = ids([...TOURS.notes.steps]);
    expect(steps.indexOf('openNote')).toBeLessThan(steps.indexOf('noteBar'));
    expect(steps.indexOf('openNote')).toBeLessThan(steps.indexOf('tags'));
    expect(TOURS.notes.steps.find((s) => s.id === 'openNote')).toMatchObject({ advanceOn: 'click' });
  });

  it('el tour de Docs arranca en /app/docs; abrir una página va antes que los pasos de la página', () => {
    expect(tourForPath('/app/docs')?.key).toBe('docs');
    expect(tourForPath('/es/app/docs/abc123')?.key).toBe('docs');
    expect(tourForPath('/app/docsx')).toBeNull();
    expect(atTourStart(TOURS.docs, '/pt/app/docs')).toBe(true);
    expect(atTourStart(TOURS.docs, '/app/docs/abc123')).toBe(false);
    // Docs no pregunta si es equipo: los mismos pasos para todos.
    expect(ids(stepsFor(TOURS.docs, { audience: 'team', admin: false }))).toEqual(ids([...TOURS.docs.steps]));
    expect(ids(stepsFor(TOURS.docs, { audience: 'solo', admin: true }))).toEqual(ids([...TOURS.docs.steps]));
    const steps = ids([...TOURS.docs.steps]);
    for (const onPage of ['write', 'comments', 'share', 'pageMenu']) expect(steps.indexOf('openPage')).toBeLessThan(steps.indexOf(onPage));
    expect(TOURS.docs.steps.find((s) => s.id === 'openPage')).toMatchObject({ advanceOn: 'click' });
  });

  it('ids de pasos únicos por tour', () => {
    for (const key of TOUR_KEYS) {
      const list = ids([...TOURS[key].steps]);
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe('tours: pasos según equipo o persona sola', () => {
  it('equipo: asignar, notas y acceso a líneas; sola: ajustes', () => {
    const team = ids(stepsFor(TOURS.lines, { audience: 'team', admin: true }));
    const solo = ids(stepsFor(TOURS.lines, { audience: 'solo', admin: true }));
    expect(team).toEqual(expect.arrayContaining(['assign', 'note', 'lineAccess']));
    expect(team).not.toContain('settings');
    expect(solo).not.toEqual(expect.arrayContaining(['assign']));
    expect(solo).not.toContain('note');
    expect(solo).not.toContain('lineAccess');
    expect(solo).toContain('settings');
    expect(team[0]).toBe('intro');
    expect(team[team.length - 1]).toBe('done');
  });

  it('sin saber todavía: como persona sola hasta que conteste', () => {
    expect(ids(stepsFor(TOURS.lines, { audience: null, admin: true }))).toEqual(ids(stepsFor(TOURS.lines, { audience: 'solo', admin: true })));
  });

  it('quien no administra no ve los pasos de ajustes', () => {
    const member = ids(stepsFor(TOURS.lines, { audience: 'team', admin: false }));
    expect(member).not.toContain('lineAccess');
    expect(member).toContain('assign');
  });

  it('deduce el equipo del workspace; si no puede, la respuesta guardada o null', () => {
    expect(deduceAudience({ acting: true, people: 1, useMode: 'personal', answer: undefined })).toBe('team');
    expect(deduceAudience({ acting: false, people: 3, useMode: 'personal', answer: 'solo' })).toBe('team');
    expect(deduceAudience({ acting: false, people: 1, useMode: 'personal', answer: 'team' })).toBe('solo');
    expect(deduceAudience({ acting: false, people: 1, useMode: 'team', answer: undefined })).toBe('team');
    expect(deduceAudience({ acting: false, people: 1, useMode: null, answer: 'solo' })).toBe('solo');
    expect(deduceAudience({ acting: false, people: 1, useMode: null, answer: undefined })).toBeNull();
  });
});

describe('tours: estado por persona', () => {
  it('parsea el perfil y descarta lo que no reconoce', () => {
    expect(parseTours(null)).toEqual({});
    expect(parseTours({ off: true, audience: 'team', seen: { lines: { status: 'done', at: 'x' }, nope: { status: 'done' }, inbox: 1 } })).toEqual({
      off: true,
      audience: 'team',
      seen: { lines: { status: 'done', step: undefined, at: 'x' } },
    });
    expect(parseTours({ audience: 'crowd', seen: { lines: { status: 'weird' } } })).toEqual({ seen: {} });
  });

  it('se abre solo una vez, después del onboarding actual y sin "No mostrar más"', () => {
    const base = { onboarded: true, profileVersion: 2, tours: {}, tour: 'lines' as const };
    expect(shouldAutoStart(base)).toBe(true);
    expect(shouldAutoStart({ ...base, onboarded: false })).toBe(false);
    expect(shouldAutoStart({ ...base, profileVersion: 0 })).toBe(false);
    expect(shouldAutoStart({ ...base, tours: { off: true } })).toBe(false);
    expect(shouldAutoStart({ ...base, tours: { seen: { lines: { status: 'done', at: '' } } } })).toBe(false);
    expect(shouldAutoStart({ ...base, tours: { seen: { lines: { status: 'exited', at: '' } } } })).toBe(false);
    // A medias: se retoma.
    expect(shouldAutoStart({ ...base, tours: { seen: { lines: { status: 'active', step: 'search', at: '' } } } })).toBe(true);
  });
});

describe('tours: teléfono y pantalla táctil', () => {
  /** Nombra un atajo de teclado: Cmd/Ctrl/Shift/Enter/Tab/Esc, "press", una tecla suelta como (E) o "C creates". */
  const KEYS = /\b(?:Cmd|Ctrl|Shift|Enter|Tab|Esc)\b|\b[Pp]ress\b|\(\p{Lu}\)|(?:^|[\s,:.])\p{Lu}(?= (?:and|then|for|creates|adds|shows|goes|to)\b)|\b(?:with|key:) \p{Lu}\b|\bG then\b/u;

  it('los pasos que solo enseñan atajos se saltean en el teléfono', () => {
    for (const key of TOUR_KEYS) {
      const all = ids(stepsFor(TOURS[key], { audience: 'team', admin: true }));
      const touch = ids(stepsFor(TOURS[key], { audience: 'team', admin: true, touch: true }));
      expect(touch, key).toEqual(all.filter((id) => !TOURS[key].steps.find((s) => s.id === id)?.keyboard));
    }
    expect(TOURS.track.steps.find((s) => s.id === 'shortcuts')).toMatchObject({ keyboard: true });
    expect(ids(stepsFor(TOURS.track, { audience: 'team', admin: true, touch: true }))).not.toContain('shortcuts');
  });

  it('un texto que nombra atajos tiene su versión sin atajos (bodyTouch) en en, es y pt', () => {
    const en = messages('en').tour as Record<string, Record<string, { body?: string; bodyTouch?: string }>>;
    const flagged: string[] = [];
    for (const key of TOUR_KEYS) {
      for (const step of TOURS[key].steps) {
        if (step.keyboard) continue;
        const text = en[key]?.[step.id];
        if (!text?.body || !KEYS.test(text.body)) continue;
        flagged.push(`${key}.${step.id}`);
        for (const locale of ['en', 'es', 'pt']) {
          const touch = (messages(locale).tour as typeof en)[key]?.[step.id]?.bodyTouch;
          expect(touch, `${locale} ${key}.${step.id}.bodyTouch`).toBeTruthy();
          if (locale === 'en') expect(KEYS.test(touch!), `en ${key}.${step.id}.bodyTouch`).toBe(false);
        }
      }
    }
    // El de Talk que lo pidió (Cmd+G en la búsqueda) y el detector no se quedan cortos.
    expect(flagged).toEqual(expect.arrayContaining(['talk.search', 'talk.composer', 'inbox.triage', 'track.newIssue', 'docs.search', 'board.toolbar']));
  });

  it('bodyTouch solo donde hay un body, y sin los atajos de es y pt', () => {
    for (const locale of ['en', 'es', 'pt']) {
      const tour = messages(locale).tour as Record<string, Record<string, { body?: string; bodyTouch?: string }>>;
      for (const key of TOUR_KEYS) {
        for (const [id, text] of Object.entries(tour[key] ?? {})) {
          if (!text.bodyTouch) continue;
          expect(text.body, `${locale} ${key}.${id}`).toBeTruthy();
          expect(/\b(?:Cmd|Ctrl|Shift|Enter|Tab)\b|\(\p{Lu}\)|\b(?:apretá|aperte)\b/u.test(text.bodyTouch), `${locale} ${key}.${id}.bodyTouch`).toBe(false);
        }
      }
    }
  });
});

describe('tours: textos y anclajes', () => {
  it('cada paso tiene título y texto en en, es y pt', () => {
    for (const locale of ['en', 'es', 'pt']) {
      const tour = messages(locale).tour as Record<string, Record<string, { title?: string; body?: string }>>;
      for (const key of TOUR_KEYS) {
        for (const step of TOURS[key].steps) {
          expect(tour[key]?.[step.id]?.title, `${locale} ${key}.${step.id}.title`).toBeTruthy();
          expect(tour[key]?.[step.id]?.body, `${locale} ${key}.${step.id}.body`).toBeTruthy();
        }
      }
    }
  });

  it('cada anclaje de un paso existe como data-tour en algún componente', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
    // Componentes y páginas (el inicio de Docs ancla sus botones en la página del servidor).
    const source = [...walk('components'), ...walk('app')].map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const key of TOUR_KEYS) {
      for (const step of TOURS[key].steps) {
        for (const target of step.targets ?? []) {
          // data-tour="x", data-tour={cond ? 'x' : …}, tour="x" (MenuSelect) o tour: 'x' (ítems del lateral).
          const re = new RegExp(`(?:data-tour=\\{?[^}\\n]*|tour=|tour: )["']${target}["']`);
          expect(re.test(source), target).toBe(true);
        }
      }
    }
  });
});

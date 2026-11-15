import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySpokenPunctuation,
  formatEmailLayout,
  formatInlineList,
  formatNumberedMarkers,
  joinSpokenAddresses,
  ruleCleanup,
} from '@/lib/voice-cleanup';
import { canSkipAiCleanup, cleanupInstructions } from '@/lib/voice-ai';
import { dictate } from '@/lib/voice-service';
import { voiceOwner } from '@/lib/voice';
import { makeUser } from './helpers';

describe('puntuación dicha', () => {
  it('español: dos puntos, coma, punto y aparte, paréntesis y comillas', () => {
    expect(applySpokenPunctuation('Quiero una lista, dos puntos, huevo')).toBe('Quiero una lista: huevo');
    expect(applySpokenPunctuation('hola Juan coma cómo estás')).toBe('hola Juan, cómo estás');
    expect(applySpokenPunctuation('listo punto y aparte sigo mañana')).toBe('listo.\n\nsigo mañana');
    expect(applySpokenPunctuation('el martes abrir paréntesis o el miércoles cerrar paréntesis')).toBe('el martes (o el miércoles)');
    expect(applySpokenPunctuation('me dijo abrir comillas ya está cerrar comillas y se fue')).toBe('me dijo "ya está" y se fue');
    expect(applySpokenPunctuation('vienes mañana signo de interrogación')).toBe('vienes mañana?');
  });

  it('inglés y portugués', () => {
    expect(applySpokenPunctuation('three things colon milk comma eggs')).toBe('three things: milk, eggs');
    expect(applySpokenPunctuation('done new paragraph next topic')).toBe('done\n\nnext topic');
    expect(applySpokenPunctuation('she said open quote fine close quote')).toBe('she said "fine"');
    expect(applySpokenPunctuation('preciso de três coisas dois pontos arroz vírgula feijão')).toBe('preciso de três coisas: arroz, feijão');
    expect(applySpokenPunctuation('ok nova linha tchau')).toBe('ok\ntchau');
  });

  it('no toca las palabras cuando son contenido', () => {
    expect(applySpokenPunctuation('ganamos por dos puntos')).toBe('ganamos por dos puntos');
    expect(applySpokenPunctuation('a gente perdeu por dois pontos')).toBe('a gente perdeu por dois pontos');
    expect(applySpokenPunctuation('el paciente entró en coma')).toBe('el paciente entró en coma');
    expect(applySpokenPunctuation('en ese punto no estoy de acuerdo')).toBe('en ese punto no estoy de acuerdo');
    expect(applySpokenPunctuation('the trial period ends today')).toBe('the trial period ends today');
    expect(applySpokenPunctuation('nos vemos mañana punto')).toBe('nos vemos mañana.');
    expect(applySpokenPunctuation('es un buen punto')).toBe('es un buen punto');
    expect(applySpokenPunctuation('we are still in the trial period')).toBe('we are still in the trial period');
    expect(applySpokenPunctuation('é um bom ponto')).toBe('é um bom ponto');
  });

  it('direcciones dictadas', () => {
    expect(joinSpokenAddresses('escribime a juan arroba gmail punto com')).toBe('escribime a juan@gmail.com');
    expect(joinSpokenAddresses('send it to ana at zerosoft dot ai')).toBe('send it to ana@zerosoft.ai');
    expect(joinSpokenAddresses('meet me at home')).toBe('meet me at home');
  });
});

describe('listas por reglas', () => {
  it('el pedido del dueño: "una lista, dos puntos, huevo, carne y leche"', () => {
    expect(ruleCleanup('Quiero una lista, dos puntos, huevo, carne y leche')).toBe('Quiero una lista:\n- Huevo\n- Carne\n- Leche');
    expect(ruleCleanup('quiero una lista dos puntos huevo, carne y leche')).toBe('Quiero una lista:\n- Huevo\n- Carne\n- Leche');
  });

  it('una lista anunciada sin dos puntos, y dos cosas alcanzan si se dijo "lista"', () => {
    expect(ruleCleanup('Quiero una lista de compras, huevo, carne y leche.')).toBe('Quiero una lista de compras:\n- Huevo\n- Carne\n- Leche');
    expect(formatInlineList('Make a list: eggs and milk')).toBe('Make a list:\n- Eggs\n- Milk');
    expect(formatInlineList('Llevá esto: el cargador y la notebook')).toBe('Llevá esto: el cargador y la notebook');
  });

  it('portugués e inglés', () => {
    expect(ruleCleanup('Preciso de uma lista dois pontos arroz, feijão e café')).toBe('Preciso de uma lista:\n- Arroz\n- Feijão\n- Café');
    expect(ruleCleanup('shopping colon apples, pears and plums')).toBe('Shopping:\n- Apples\n- Pears\n- Plums');
  });

  it('numeradas cuando la persona numera', () => {
    expect(formatNumberedMarkers('Tareas para hoy punto uno llamar a Ana punto dos mandar el presupuesto punto tres revisar el contrato')).toBe(
      'Tareas para hoy:\n1. Llamar a Ana\n2. Mandar el presupuesto\n3. Revisar el contrato',
    );
    expect(ruleCleanup('things to do number one call Ana number two send the quote')).toBe('Things to do:\n1. Call Ana\n2. Send the quote');
    expect(ruleCleanup('we need three things first milk second eggs and third bread')).toBe('We need three things:\n1. Milk\n2. Eggs\n3. Bread');
  });

  it('no arma listas con frases ni con "el punto uno del contrato"', () => {
    expect(formatInlineList('Nota: el martes llamo a Juan, a Pedro y a Ana')).toBe('Nota: el martes llamo a Juan, a Pedro y a Ana');
    expect(formatNumberedMarkers('revisá el punto uno del contrato y el punto dos del anexo')).toBe('revisá el punto uno del contrato y el punto dos del anexo');
  });

  it('lo que sigue a la lista queda en su línea', () => {
    expect(ruleCleanup('comprá dos puntos pan, queso y vino. Gracias')).toBe('Comprá:\n- Pan\n- Queso\n- Vino\nGracias.');
  });
});

describe('autocorrecciones y muletillas', () => {
  it('se queda con la última versión', () => {
    expect(ruleCleanup('nos vemos el lunes no mejor el martes')).toBe('Nos vemos el martes.');
    expect(ruleCleanup('nos vemos el lunes, digo, el martes')).toBe('Nos vemos el martes.');
    expect(ruleCleanup('um the demo is on monday, no, I mean friday')).toBe('The demo is on friday.');
  });

  it('"em" y "um" en portugués no son muletillas', () => {
    expect(ruleCleanup('vou em São Paulo amanhã')).toBe('Vou em São Paulo amanhã.');
    expect(ruleCleanup('tarefas número um ligar para o Pedro número dois mandar o orçamento', [], { language: 'pt' })).toBe(
      'Tarefas:\n1. Ligar para o Pedro\n2. Mandar o orçamento',
    );
    expect(ruleCleanup('Segue o relatório. Um abraço, João', [], { context: 'email' })).toBe('Segue o relatório.\n\nUm abraço,\nJoão');
    expect(ruleCleanup('um, então você vem amanhã')).toBe('Então você vem amanhã.');
    expect(ruleCleanup('um so the plan is simple', [], { language: 'en' })).toBe('So the plan is simple.');
  });
});

describe('mail por reglas', () => {
  it('saludo, cuerpo y despedida en su línea, con las palabras de la persona', () => {
    expect(ruleCleanup('Hola Juan, te mando el informe del trimestre. Cualquier duda me avisás. Saludos, Lautaro', [], { context: 'email' })).toBe(
      'Hola Juan,\n\nTe mando el informe del trimestre. Cualquier duda me avisás.\n\nSaludos,\nLautaro',
    );
    expect(ruleCleanup('Olá Maria, segue o relatório. Abraços, João', [], { context: 'email' })).toBe('Olá Maria,\n\nSegue o relatório.\n\nAbraços,\nJoão');
  });

  it('no inventa saludo ni despedida', () => {
    expect(ruleCleanup('te mando el informe gracias por todo', [], { context: 'email' })).toBe('Te mando el informe gracias por todo.');
    expect(formatEmailLayout('Te mando el informe.', 'email')).toBe('Te mando el informe.');
  });

  it('fuera de un mail, solo si es claramente un mail; en un chat nunca', () => {
    expect(ruleCleanup('Hi Ana, attached is the deck. Thanks, Bea', [], { context: 'other' })).toBe('Hi Ana,\n\nAttached is the deck.\n\nThanks,\nBea');
    expect(ruleCleanup('Hola Juan, te mando el informe. Saludos, Lautaro', [], { context: 'chat' })).toBe('Hola Juan, te mando el informe. Saludos, Lautaro.');
    expect(ruleCleanup('Hola Juan, te mando el informe', [], { context: 'note' })).toBe('Hola Juan, te mando el informe.');
  });

  it('respeta el diccionario', () => {
    const dict = [{ kind: 'replace' as const, phrase: 'zero soft', replacement: 'zerosoft' }];
    expect(ruleCleanup('Hola Ana, te paso la demo de zero soft. Saludos, Lautaro', dict, { context: 'email' })).toContain('la demo de zerosoft.');
  });
});

describe('cuándo el modo rápido se saltea la IA', () => {
  it('se la saltea cuando las reglas arman la lista', () => {
    const raw = 'Quiero una lista, dos puntos, huevo, carne y leche';
    expect(canSkipAiCleanup(raw, 'neutral', ruleCleanup(raw))).toBe(true);
  });

  it('pide la IA si se anunció una lista o se enumeraron cosas y las reglas no la armaron', () => {
    const asked = 'te paso la lista de compras huevos leche jugo y pan';
    expect(canSkipAiCleanup(asked, 'neutral', ruleCleanup(asked))).toBe(false);
    const enumerated = 'compré huevos, leche, pan, queso y manteca';
    expect(canSkipAiCleanup(enumerated, 'neutral', ruleCleanup(enumerated))).toBe(false);
    expect(canSkipAiCleanup('mandame el deck antes del almuerzo', 'neutral', ruleCleanup('mandame el deck antes del almuerzo'))).toBe(true);
  });
});

describe('instrucciones de formato para la IA', () => {
  it('puntuación dicha, listas anunciadas y numeradas en los tres idiomas', () => {
    const t = cleanupInstructions({ context: 'other', tone: 'neutral', words: [] });
    expect(t).toContain('"dos puntos"');
    expect(t).toContain('"dois pontos"');
    expect(t).toContain('"colon"');
    expect(t).toContain('two items are a list too');
    expect(t).toContain('"punto uno… punto dos…"');
    expect(t).toContain('Quiero una lista:\n- Huevo\n- Carne\n- Leche');
    expect(t).toContain('clearly an email');
  });

  it('mail con saludo y despedida en su línea; chat corto y sin saludo; nota con título', () => {
    const email = cleanupInstructions({ context: 'email', tone: 'neutral', words: [] });
    expect(email).toContain('It is an email');
    expect(email).toContain('do not write one');
    const chat = cleanupInstructions({ context: 'chat', tone: 'casual', words: [] });
    expect(chat).toContain('Never add a greeting');
    expect(chat).not.toContain('clearly an email');
    const note = cleanupInstructions({ context: 'note', tone: 'neutral', words: [] });
    expect(note).toContain('"# "');
  });
});

describe('dictado de punta a punta con el proveedor falso', () => {
  beforeEach(() => {
    vi.stubEnv('VOICE_TRANSCRIBE_PROVIDER', 'fake');
    vi.stubEnv('VOICE_AI_FAKE', '1');
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
    vi.stubEnv('AI_FREE_TOKENS_PER_MONTH', 'unlimited');
  });
  afterEach(() => vi.unstubAllEnvs());

  const audio = new Uint8Array(2048).fill(7);
  async function owner() {
    const u = await makeUser('voice-format');
    return voiceOwner({ id: u.id, role: 'owner' });
  }

  it('modo rápido: la lista dictada sale como lista, sin esperar a la IA', async () => {
    const res = await dictate({ owner: await owner(), audio, type: 'audio/wav', context: 'note', fakeText: 'Quiero una lista, dos puntos, huevo, carne y leche', fast: true, save: false });
    expect(res.text).toBe('Quiero una lista:\n- Huevo\n- Carne\n- Leche');
    expect(res.ai).toBe(false);
  });

  it('modo rápido: una lista pedida que las reglas no arman va a la IA', async () => {
    const res = await dictate({ owner: await owner(), audio, type: 'audio/wav', context: 'note', fakeText: 'te paso la lista de compras huevos leche y pan', fast: true, save: false });
    expect(res.ai).toBe(true);
  });

  it('mail: saludo y despedida en su línea; chat: como se dijo', async () => {
    const o = await owner();
    const text = 'Hola Juan, te mando el informe. Saludos, Lautaro';
    const email = await dictate({ owner: o, audio, type: 'audio/wav', context: 'email', fakeText: text, fast: true, save: false });
    expect(email.text).toBe('Hola Juan,\n\nTe mando el informe.\n\nSaludos,\nLautaro');
    const chat = await dictate({ owner: o, audio, type: 'audio/wav', context: 'chat', fakeText: text, fast: true, save: false });
    expect(chat.text).not.toContain('\n');
  });

  it('autocorrección y puntuación dicha en portugués', async () => {
    const res = await dictate({ owner: await owner(), audio, type: 'audio/wav', context: 'chat', fakeText: 'a reunião é na segunda, ou melhor, na terça vírgula às dez', fast: true, save: false });
    expect(res.text).toBe('A reunião é na terça, às dez.');
  });
});

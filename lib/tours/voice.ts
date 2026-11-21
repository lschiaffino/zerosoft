import type { TourDef } from './index';

/**
 * Tour de Voice (reuniones con notas y transcripción, como Granola, y dictado).
 * Textos en common.json › tour.voice.
 * Arranca en Reuniones (/app/voice) y no cambia de página: todo lo que señala
 * está ahí o en el lateral. Con ?new=1 (reunión nueva desde ⌘K o el lateral)
 * no se abre solo.
 * Anclajes `data-tour`:
 *   voice-new        components/voice/MeetingsHome.tsx (Nueva reunión: en la cabecera, o en la lista vacía)
 *   voice-import     components/voice/MeetingsHome.tsx (Importar grabación)
 *   voice-upcoming   components/voice/MeetingsHome.tsx (Próximas del calendario)
 *   voice-ask        components/voice/MeetingsHome.tsx (Preguntale a tus reuniones, con recipes)
 *   voice-folders    components/voice/MeetingsHome.tsx (carpetas y Compartidas conmigo)
 *   voice-meetings   components/voice/MeetingsHome.tsx (la lista con su búsqueda)
 *   voice-dictation  components/app/sidebar-nav.ts (Dictado en el lateral)
 *   voice-settings   components/app/sidebar-nav.ts (Ajustes de Voice)
 * Voice es de cada persona (los ajustes también): los mismos pasos para
 * todos. En el teléfono el lateral es un cajón: dictado y ajustes se saltean.
 */
export const VOICE_TOUR = {
  key: 'voice',
  startPath: '/app/voice',
  paths: ['/app/voice'],
  steps: [
    { id: 'intro' },
    { id: 'newMeeting', targets: ['voice-new'] },
    { id: 'import', targets: ['voice-import'] },
    { id: 'upcoming', targets: ['voice-upcoming'] },
    { id: 'ask', targets: ['voice-ask'] },
    // Carpetas antes que la lista: en la compu van a su izquierda y en el teléfono, arriba.
    { id: 'folders', targets: ['voice-folders'] },
    { id: 'meetings', targets: ['voice-meetings'] },
    { id: 'dictation', targets: ['voice-dictation'] },
    { id: 'settings', targets: ['voice-settings'] },
    { id: 'done' },
  ],
} as const satisfies TourDef;

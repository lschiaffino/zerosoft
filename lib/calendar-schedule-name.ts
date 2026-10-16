/**
 * Nombre con el que se crea el horario por defecto (y el que dejó la
 * migración). Se guarda tal cual y la UI lo muestra traducido
 * (calendar.schedules.defaultName) mientras nadie lo renombre. Módulo puro:
 * lo importan componentes de cliente.
 */
export const DEFAULT_SCHEDULE_NAME = 'Horario principal';

export function scheduleDisplayName(name: string, translatedDefault: string): string {
  return name === DEFAULT_SCHEDULE_NAME ? translatedDefault : name;
}

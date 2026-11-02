/** Send: textos de los emails a quien abre un link (en su idioma, el de la página). */
export type SendLocale = 'en' | 'es' | 'pt';

export function sendLocale(value: string | null | undefined): SendLocale {
  const v = value?.toLowerCase().slice(0, 2);
  return v === 'es' || v === 'pt' ? v : 'en';
}

const COPY = {
  en: {
    codeSubject: '{code} is your code to open the document',
    codeLine: 'Enter this code on the page you opened. It expires in {minutes} minutes. If you did not ask for it, ignore this email.',
  },
  es: {
    codeSubject: '{code} es tu código para abrir el documento',
    codeLine: 'Escribí este código en la página que abriste. Vence en {minutes} minutos. Si no lo pediste, ignorá este email.',
  },
  pt: {
    codeSubject: '{code} é seu código para abrir o documento',
    codeLine: 'Digite este código na página que você abriu. Ele vence em {minutes} minutos. Se você não pediu, ignore este email.',
  },
} as const;

export function sendCopy(locale: SendLocale, key: keyof (typeof COPY)['en'], vars: Record<string, string> = {}): string {
  return COPY[locale][key].replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');
}

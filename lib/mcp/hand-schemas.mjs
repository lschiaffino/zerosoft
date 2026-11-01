/**
 * Esquemas escritos a mano donde la derivación del código no alcanza. Clave:
 * "METHOD /api/ruta". Cuentan como reales: salen de leer el handler.
 */
const FILE_UPLOAD = {
  description: 'Attach a file (multipart): pass files: [{ field: "file", filename, contentType, base64 }] in args. Up to 4 MB per call.',
  body: { type: 'object', properties: {}, additionalProperties: true },
};

export const HAND_SCHEMAS = {
  'POST /api/books/documents/[id]/link': {
    body: { type: 'object', properties: { action: { type: 'string', enum: ['regenerate', 'revoke'], description: 'Regenerate the public link of the document, or revoke it.' } }, required: ['action'] },
  },
  'POST /api/books/items/[id]/stock': {
    body: { type: 'object', properties: { quantity: { type: 'number', description: 'Manual adjustment, positive or negative, not zero.' } }, required: ['quantity'] },
  },
  'POST /api/books/settings/country': {
    description: 'Rebuilds the chart of accounts, taxes and series for a country. Only before issuing any document.',
    body: { type: 'object', properties: { country: { type: 'string', description: 'Country code supported by Books.' } }, required: ['country'] },
  },
  'POST /api/track/cycles/[id]/complete': {
    description: 'Completes the cycle and moves unfinished issues to the next one, to targetCycleId, or out of any cycle with null.',
    body: { type: 'object', properties: { targetCycleId: { type: ['string', 'null'] } } },
  },
  'PATCH /api/shop/discounts/[id]': {
    body: {
      type: 'object',
      properties: {
        code: { type: 'string', minLength: 2, maxLength: 40, pattern: '^[A-Za-z0-9_-]+$' },
        kind: { type: 'string', enum: ['percent', 'fixed', 'free_shipping'] },
        value: { type: 'integer', minimum: 0, description: 'percent: basis points (1500 is 15%). fixed: cents.' },
        minOrderCents: { type: 'integer', minimum: 0 },
        usageLimit: { type: ['integer', 'null'], minimum: 1 },
        startsAt: { type: ['string', 'null'], maxLength: 40 },
        endsAt: { type: ['string', 'null'], maxLength: 40 },
        active: { type: 'boolean' },
      },
    },
  },
  'POST /api/crm/activities/[id]/files': FILE_UPLOAD,
  'POST /api/crm/tasks/[id]/files': FILE_UPLOAD,
};

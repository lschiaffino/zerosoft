import { getTranslations } from 'next-intl/server';
import { siteOrigin } from '@/lib/seo';
import { isProductKey } from '@/lib/products';
import type { CardResult } from './cards';
import { firstSentence } from './cards';
import { formatDuration } from './text';

/**
 * Tarjetas del contenido que publica un workspace: un video de Rec, un
 * artículo del centro de ayuda, una nota, pizarra o diseño compartidos por
 * link, un formulario, una página de reservas, un producto de la tienda, un
 * puesto. La regla es la de la página: si alguien sin sesión no la puede
 * abrir (video con contraseña, solo del workspace, vencido; tienda o
 * búsqueda despublicada; link revocado), no hay tarjeta (404) y el link no
 * dice ni el título.
 */

const host = () => new URL(siteOrigin()).host;

/** Sniff de PNG o JPEG: lo único que el render acepta como foto. */
export function imageMime(buf: Buffer): 'image/png' | 'image/jpeg' | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Duración visible de un video (dentro del recorte, si tiene). */
export function visibleDurationMs(durationSec: number, trimStart: number, trimEnd: number | null): number {
  const end = trimEnd != null && trimEnd > 0 ? Math.min(trimEnd, durationSec || trimEnd) : durationSec;
  return Math.max(0, (end - (trimStart || 0)) * 1000);
}

export async function sharedCard(kind: string, args: string[]): Promise<CardResult | null> {
  const [a, b, c] = args;
  switch (kind) {
    // Video de Rec: solo si el link está abierto a cualquiera (sin contraseña, ni solo workspace, ni vencido).
    case 'rec': {
      if (!a) return null;
      const { getPublicVideoRow, publicAccess, toPublicDto } = await import('@/lib/rec');
      const v = await getPublicVideoRow(a);
      if (!v || publicAccess(v, { ws: null, userId: null }, null) !== 'ok') return null;
      const dto = toPublicDto(v, false);
      const { getRecBrand } = await import('@/lib/rec-admin');
      const brand = await getRecBrand(v.workspace_id).catch(() => null);
      let poster: { src: string; duration?: string } | undefined;
      const duration = formatDuration(visibleDurationMs(dto.durationSec, dto.trimStart, dto.trimEnd));
      if (dto.hasThumb && v.thumb_url) {
        const { readRecImage } = await import('@/lib/rec-upload');
        const buf = await readRecImage(v.thumb_url).catch(() => null);
        const mime = buf ? imageMime(buf) : null;
        if (buf && mime) poster = { src: `data:${mime};base64,${buf.toString('base64')}`, duration: duration || undefined };
      }
      return {
        shared: true,
        spec: {
          seed: `rec:${a}`,
          product: 'rec',
          owner: brand?.name || dto.authorName || 'Rec',
          title: dto.title,
          // Sin miniatura: la tarjeta de Rec con la duración.
          sub: poster ? undefined : duration || undefined,
          url: `${host()}/v/${a}`,
          poster,
        },
      };
    }

    // Artículo publicado del centro de ayuda (Docs).
    case 'help': {
      if (!a || !b) return null;
      const { getHelpArticle, getHelpWorkspace } = await import('@/lib/docs-help');
      const ws = await getHelpWorkspace(a);
      const article = ws ? await getHelpArticle(ws.id, b) : null;
      if (!ws || !article) return null;
      const t = await getTranslations({ locale: c && ['en', 'es', 'pt'].includes(c) ? c : 'en', namespace: 'docs.help' });
      return {
        shared: true,
        spec: {
          seed: `help:${ws.id}:${article.id}`,
          product: 'docs',
          owner: ws.name,
          title: article.title || t('untitled'),
          sub: article.excerpt ? firstSentence(article.excerpt) : undefined,
          theme: 'paper',
          url: `${host()}/h/${ws.handle}/${article.slug}`,
        },
      };
    }

    // Nota, pizarra o diseño compartidos por link: el link es el permiso; revocado, 404.
    case 'note': {
      if (!a) return null;
      const { getSharedNote } = await import('@/lib/notes');
      const note = await getSharedNote(a);
      if (!note) return null;
      const t = await getTranslations({ locale: 'en', namespace: 'notes' });
      return { shared: true, spec: { seed: `note:${a}`, product: 'notes', title: note.title || t('untitled'), theme: 'paper', url: `${host()}/n/…` } };
    }
    case 'whiteboard': {
      if (!a) return null;
      const { getSharedBoard } = await import('@/lib/boards');
      const board = await getSharedBoard(a);
      if (!board) return null;
      return { shared: true, spec: { seed: `board:${a}`, product: 'board', title: board.name, url: `${host()}/b/…` } };
    }
    case 'design': {
      if (!a) return null;
      const { getPublicDesign } = await import('@/lib/design');
      const pub = await getPublicDesign(a);
      if (!pub) return null;
      return { shared: true, spec: { seed: `design:${a}`, product: 'design', title: pub.row.name, url: `${host()}/d/…` } };
    }

    // Formulario público (CRM o Forms).
    case 'form': {
      if (!a) return null;
      const { getPublicForm } = await import('@/lib/crm-forms');
      const crm = await getPublicForm(a);
      let title: string | null = null;
      let sub: string | undefined;
      if (crm) {
        title = crm.settings.title || crm.name;
        sub = (crm.settings as { description?: string }).description || undefined;
      } else {
        const { getPublicFormRow } = await import('@/lib/forms/core');
        const row = await getPublicFormRow(a);
        if (row) title = row.name;
      }
      if (!title) return null;
      return { shared: true, spec: { seed: `form:${a}`, product: 'forms', title, sub: sub ? firstSentence(sub) : undefined, theme: 'paper', url: `${host()}/f/${a}` } };
    }

    // Reservas (Cal): el perfil o un tipo de evento. Las encuestas no tienen tarjeta.
    case 'book': {
      if (!a) return null;
      const { getEventTypeByHandle, getPublicProfile } = await import('@/lib/calendar');
      const profile = await getPublicProfile(a);
      if (!profile) return null;
      if (b) {
        const et = await getEventTypeByHandle(a, b);
        if (!et || et.kind === 'poll') return null;
        return {
          shared: true,
          spec: { seed: `book:${et.id}`, product: 'cal', owner: profile.name, title: et.title, sub: `${et.duration_min} min`, theme: 'paper', url: `${host()}/book/${profile.handle}/${et.slug}` },
        };
      }
      const titles = profile.eventTypes.slice(0, 3).map((e) => e.title);
      return {
        shared: true,
        spec: { seed: `book:${profile.userId}`, product: 'cal', title: profile.name, sub: titles.join(', ') || undefined, theme: 'paper', url: `${host()}/book/${profile.handle}` },
      };
    }

    // Tienda publicada y sus productos (sin foto propia; con foto, la página usa la foto).
    case 'store': {
      if (!a) return null;
      const { publishedStore, storefrontProduct } = await import('@/lib/shop-storefront');
      const store = await publishedStore(a);
      if (!store) return null;
      if (b) {
        const p = await storefrontProduct(store.row, b);
        if (!p) return null;
        return {
          shared: true,
          spec: {
            seed: `store:${store.row.id}:${p.id}`,
            product: 'shop',
            owner: store.dto.name,
            title: p.seoTitle || p.title,
            sub: firstSentence(p.seoDescription || p.descriptionText).slice(0, 160) || undefined,
            theme: 'paper',
            url: `${host()}/store/${store.dto.handle}/products/${p.handle}`,
          },
        };
      }
      return { shared: true, spec: { seed: `store:${store.row.id}`, product: 'shop', title: store.dto.name, theme: 'paper', url: `${host()}/store/${store.dto.handle}` } };
    }

    // Página de empleos y cada puesto publicado (los confidenciales no se publican).
    case 'job': {
      if (!a) return null;
      const { publishedCareers, publishedJob } = await import('@/lib/hiring/careers');
      const { careersStrings } = await import('@/lib/hiring/careers-i18n');
      const careers = await publishedCareers(a);
      if (!careers) return null;
      const t = careersStrings(careers.locale);
      if (b) {
        const job = await publishedJob(careers.settings.workspace_id, b);
        if (!job) return null;
        const meta = [job.location, t.workplace[job.workplace], t.employment[job.employmentType]].filter(Boolean).join(' · ');
        return {
          shared: true,
          spec: { seed: `job:${job.id}`, product: 'hiring', owner: careers.company, label: job.department || undefined, title: job.title, sub: meta || undefined, theme: 'paper', url: `${host()}/careers/${careers.settings.handle}/${job.slug}` },
        };
      }
      return { shared: true, spec: { seed: `careers:${careers.settings.handle}`, product: 'hiring', owner: careers.company, title: t.openRoles, theme: 'paper', url: `${host()}/careers/${careers.settings.handle}` } };
    }

    // Ítem del board público de zerosoft (feedback.zerosoft.ai).
    case 'board':
    case 'feedback': {
      if (!a) return null;
      const { getPublicItem } = await import('@/lib/board');
      const item = await getPublicItem(a);
      if (!item) return null;
      return {
        shared: true,
        spec: {
          seed: `feedback:${item.id}`,
          product: isProductKey(item.product) ? item.product : undefined,
          label: isProductKey(item.product) ? undefined : 'Feedback',
          title: item.title,
          sub: item.description ? firstSentence(item.description).slice(0, 160) : undefined,
          url: 'feedback.zerosoft.ai',
        },
      };
    }

    default:
      return null;
  }
}

import { setRequestLocale } from 'next-intl/server';
import BoardChrome from '@/components/board/BoardChrome';
import ProposeIdeaForm from '@/components/board/ProposeIdeaForm';
import { boardLoginHref, getBoardContext } from '@/lib/board-context';
import { boardPath } from '@/lib/board-paths';
import { getBoardPerson } from '@/lib/board-session';
import { boardLabels } from '@/lib/board-labels';
import { isProductKey } from '@/lib/product-taxonomy';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const { t } = await boardLabels(locale);
  return { title: t('meta.newTitle'), robots: { index: false } };
}

/** Proponer una idea (requiere sesión: login con Google y vuelta acá). */
export default async function ProposeIdeaPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ product?: string }>;
}) {
  const { locale } = await props.params;
  const { product } = await props.searchParams;
  setRequestLocale(locale);
  const [ctx, person, labels] = await Promise.all([getBoardContext(locale), getBoardPerson(), boardLabels(locale)]);
  const { t } = labels;
  const loginHref = boardLoginHref(ctx, '/new');

  return (
    <>
      <BoardChrome ctx={ctx} person={person} active="board" returnPath="/new" />
      <main className="bp-wrap">
        <div className="bp-hero">
          <div>
            <a className="bp-back" href={boardPath(locale, ctx.onSurface)}>
              ← {t('detail.back')}
            </a>
            <h1 className="bp-title">{t('propose.title')}</h1>
            <p className="bp-intro">{t('propose.intro')}</p>
          </div>
        </div>
        {person ? (
          <ProposeIdeaForm
            locale={locale}
            itemBase={boardPath(locale, ctx.onSurface, '/i')}
            defaultProduct={isProductKey(product) ? product : 'other'}
            loginHref={loginHref}
            labels={{
              titleLabel: t('propose.titleLabel'),
              titlePlaceholder: t('propose.titlePlaceholder'),
              descriptionLabel: t('propose.descriptionLabel'),
              descriptionPlaceholder: t('propose.descriptionPlaceholder'),
              productLabel: t('propose.productLabel'),
              submit: t('propose.submit'),
              sending: t('propose.sending'),
              similarTitle: t('propose.similarTitle'),
              similarHint: t('propose.similarHint'),
              moderation: t('propose.moderation'),
              errorInvalid: t('propose.errorInvalid'),
              errorRate: t('propose.errorRate'),
              errorGeneric: t('propose.errorGeneric'),
              status: labels.status,
              product: labels.product,
              vote: labels.vote,
            }}
          />
        ) : (
          <div className="bp-propose">
            <div>
              <p className="bp-intro">{t('propose.loginBody')}</p>
              <p className="bp-comment-login">
                <a className="btn btn-solid btn-small" href={loginHref}>
                  {t('propose.login')}
                </a>
              </p>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { boardViewer } from '@/lib/board-access';
import { cachedBoardAnalytics, isBoardAnalyticsEmpty, type BoardAnalytics } from '@/lib/board-analytics';
import { localDay, periodChoice, periodParams } from '@/lib/analytics-kit/period';
import { viewerTz } from '@/lib/analytics-kit/server';
import { TrendChart } from '@/components/analytics-kit/charts';
import { AnalyticsPage, BarList, DataTable, Heatmap, KpiTile, Kpis, Panel, PanelGrid, analyticsFmt, chartAria, pctOf, queryString, type Fmt } from '@/components/analytics-kit/kit';
import '@/styles/analytics-kit.css';

export const dynamic = 'force-dynamic';

type Search = { days?: string; from?: string; to?: string; folder?: string };

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'board' });
  return { title: `${t('report.title')} · Board` };
}

/**
 * Board, analítica (/app/board/analytics): pizarras creadas y editadas, quién
 * edita y cuándo, colaboradores, comentarios y elementos de las pizarras que
 * la persona ve, con el kit de analítica (el formato de Lines).
 */
export default async function BoardAnalyticsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const [t, tk, tz] = await Promise.all([getTranslations({ locale, namespace: 'board' }), getTranslations({ locale, namespace: 'analyticsKit' }), viewerTz()]);
  const period = periodChoice(sp);
  const viewer = boardViewer(user);
  const q = { days: period.days, from: period.from, to: period.to, tz };
  const all = await cachedBoardAnalytics(viewer, undefined, q);
  // Solo una carpeta que la persona ve ('none' = sin carpeta).
  const folder = sp.folder && (sp.folder === 'none' || all.folderList.some((x) => x.id === sp.folder)) ? sp.folder : undefined;
  const data = folder ? await cachedBoardAnalytics(viewer, folder, q) : all;
  const f = analyticsFmt({
    locale,
    tz: data.range.tz,
    t: (key, values) => t(key as never, values as never),
    k: (key, values) => tk(key as never, values as never),
  });
  const base = '/app/board/analytics';
  const href = (extra: Record<string, string | undefined>) => `${base}${queryString({ ...periodParams(data.range), folder, ...extra })}`;
  return (
    <AnalyticsPage
      f={f}
      title={t('report.title')}
      description={t('report.desc')}
      product="board"
      range={data.range}
      period={period}
      periodHref={(days) => href({ days: days === 30 ? undefined : String(days), from: undefined, to: undefined })}
      formAction={`/${locale}${base}`}
      filters={
        all.folderList.length > 0 ? (
          <label className="ui-field">
            <span className="label">{t('report.folder')}</span>
            <select className="select" name="folder" defaultValue={folder ?? ''}>
              <option value="">{t('report.allFolders')}</option>
              <option value="none">{t('report.noFolder')}</option>
              {all.folderList.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
      filtered={period.custom || Boolean(folder)}
      clearHref={base}
      empty={isBoardAnalyticsEmpty(data)}
      emptyTitle={all.boardCount === 0 ? t('report.noBoardsTitle') : t('report.emptyTitle')}
      emptyBody={all.boardCount === 0 ? t('report.noBoardsBody') : t('report.emptyBody')}
      contentKey={`${data.range.from}-${data.range.to}-${folder ?? ''}`}
      foot={t('report.note')}
    >
      <BoardView f={f} d={data} folderHref={(id) => href({ folder: id || 'none' })} />
    </AnalyticsPage>
  );
}

function BoardView({ f, d, folderHref }: { f: Fmt; d: BoardAnalytics; folderHref: (id: string) => string }) {
  const k = d.kpis;
  const labels = d.perDay.map((p) => f.day(p.day));
  const edits = k.edits.value ?? 0;
  const maxPerson = Math.max(1, ...d.people.map((p) => p.edits + p.comments));
  const maxFolder = Math.max(1, ...d.folders.map((x) => x.edits));
  const someone = f.t('report.someone');
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('report.created')} kpi={k.created} spark={d.perDay.map((p) => p.created)} better="up" />
        <KpiTile f={f} i={1} label={f.t('report.edited')} kpi={k.edited} better="up" />
        <KpiTile f={f} i={2} label={f.t('report.edits')} kpi={k.edits} spark={d.perDay.map((p) => p.edits)} better="up" />
        <KpiTile f={f} i={3} label={f.t('report.people')} kpi={k.people} better="up" />
        <KpiTile f={f} i={4} label={f.t('report.comments')} kpi={k.comments} spark={k.comments.value ? d.perDay.map((p) => p.comments) : undefined} />
        <KpiTile f={f} i={5} label={f.t('report.elements')} kpi={k.elements} snapshot />
      </Kpis>
      <Panel title={f.t('report.perDay')}>
        <TrendChart
          kind="bars"
          labels={labels}
          series={[
            { name: f.t('report.edits'), values: d.perDay.map((p) => p.edits) },
            { name: f.t('report.created'), values: d.perDay.map((p) => p.created) },
            { name: f.t('report.comments'), values: d.perDay.map((p) => p.comments) },
          ]}
          summary={chartAria(f, f.t('report.perDay'), d.range)}
          locale={f.locale}
        />
      </Panel>
      <PanelGrid>
        <Panel title={f.t('report.whoEdits')}>
          <BarList
            empty={f.k('noneInPeriod')}
            rows={d.people
              .filter((p) => p.edits + p.comments > 0)
              .slice(0, 8)
              .map((p) => ({
                key: p.id || 'none',
                label: p.name || someone,
                value: f.t('report.editsN', { n: p.edits }),
                extra: edits ? pctOf(f, p.edits, edits) : undefined,
                sub: [f.t('report.boardsN', { n: p.boards }), f.t('report.commentsN', { n: p.comments }), f.k('before', { value: f.num(p.prevEdits) })].join(' · '),
                share: (p.edits + p.comments) / maxPerson,
              }))}
          />
        </Panel>
        <Panel title={f.t('report.whenEdited')}>
          <Heatmap f={f} data={d.heat} none={f.k('noneInPeriod')} peak={(p) => f.t('report.peak', p)} />
        </Panel>
      </PanelGrid>
      {d.folderList.length > 0 && (
        <Panel title={f.t('report.byFolder')}>
          <BarList
            empty={f.k('noneInPeriod')}
            rows={d.folders.slice(0, 8).map((x) => ({
              key: x.id || 'none',
              label: <Link href={folderHref(x.id)}>{x.name || f.t('report.noFolder')}</Link>,
              value: f.t('report.editsN', { n: x.edits }),
              extra: edits ? pctOf(f, x.edits, edits) : undefined,
              sub: [f.t('report.boardsN', { n: x.boards }), f.t('report.createdN', { n: x.created })].join(' · '),
              share: x.edits / maxFolder,
            }))}
          />
        </Panel>
      )}
      <Panel title={f.t('report.byBoard')}>
        <DataTable
          rows={d.boards}
          rowKey={(b) => b.id}
          empty={f.k('noneInPeriod')}
          columns={[
            { key: 'board', label: f.t('report.board'), wide: true, cell: (b) => <Link href={`/app/board/${b.id}`}>{b.name}</Link> },
            { key: 'edits', label: f.t('report.edits'), num: true, cell: (b) => f.num(b.edits) },
            { key: 'editors', label: f.t('report.editors'), num: true, hideNarrow: true, cell: (b) => f.num(b.editors) },
            { key: 'comments', label: f.t('report.comments'), num: true, cell: (b) => f.num(b.comments) },
            { key: 'elements', label: f.t('report.elements'), num: true, hideNarrow: true, cell: (b) => f.num(b.elements) },
            { key: 'last', label: f.t('report.lastEdit'), hideNarrow: true, cell: (b) => (b.lastEditAt ? f.day(localDay(b.lastEditAt, d.range.tz)) : '—') },
          ]}
        />
      </Panel>
    </>
  );
}

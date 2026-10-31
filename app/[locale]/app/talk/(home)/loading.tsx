export default function TalkLoading() {
  return (
    <div className="talk-app talk-app-loading" aria-busy="true">
      <div className="talk-side">
        <div className="ui-loading-stack">
          <div className="ui-skeleton ui-skeleton-row" />
          <div className="ui-skeleton ui-skeleton-row" />
          <div className="ui-skeleton ui-skeleton-row" />
        </div>
      </div>
      <div className="talk-main">
        <div className="ui-loading-stack">
          <div className="ui-skeleton ui-skeleton-title" />
          <div className="ui-skeleton ui-skeleton-row" />
        </div>
      </div>
    </div>
  );
}

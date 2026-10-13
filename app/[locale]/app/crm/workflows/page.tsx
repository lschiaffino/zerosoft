import { getTranslations } from "next-intl/server";
import { isWorkspaceAdmin, requireUser } from "@/lib/session";
import { listWorkflows, TRIGGER_TYPES } from "@/lib/crm-workflows";
import WorkflowQuickCreate from "@/components/crm/WorkflowQuickCreate";
import WorkflowList from "@/components/crm/WorkflowList";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const params = await props.params;

  const { locale } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: "crm" });
  const workflows = await listWorkflows(user.id);
  const triggerOptions = TRIGGER_TYPES.map((tt) => ({
    value: tt,
    label: t(`workflows.triggerTypes.${tt}`),
  }));

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t("workflows.title")}</h1>
        {isWorkspaceAdmin(user) && workflows.length > 0 && (
          <WorkflowQuickCreate triggers={triggerOptions} />
        )}
      </div>
      {!isWorkspaceAdmin(user) && (
        <p className="muted">{t("common.adminOnly")}</p>
      )}
      {workflows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0 0 0 0 0
          </p>
          <h2>{t("workflows.noWorkflows")}</h2>
          <p className="muted">{t("workflows.emptySub")}</p>
          {isWorkspaceAdmin(user) && (
            <WorkflowQuickCreate
              triggers={triggerOptions}
              testId="workflow-quick-create-empty"
            />
          )}
        </div>
      ) : (
        <WorkflowList
          workflows={workflows}
          labels={{
            enabled: t("workflows.enabled"),
            disabled: t("workflows.disabled"),
            edit: t("common.edit"),
            runNow: t("workflows.runNow"),
            delete: t("workflows.deleteConfirm"),
            noWorkflows: t("workflows.noWorkflows"),
            triggerLabel: t("workflows.triggers"),
            actionsLabel: t("workflows.actions"),
          }}
        />
      )}
    </div>
  );
}

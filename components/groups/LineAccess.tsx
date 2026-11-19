"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { GroupsPerson, NumberDto } from "@/lib/groups";
import { Modal, api, useErrorText } from "./ui";

/** Quién ve la línea (todo el workspace, o personas y equipos elegidos). El dueño se elige en la tabla de Números. */
export default function LineAccess({
  number,
  people,
  teams,
  onClose,
  onSaved,
  isOwner = false,
  groupName = "",
}: {
  /** Grupo de líneas de la línea, si tiene: quien tiene el grupo también la ve. */
  groupName?: string;
  /** Quien mira es el dueño de la línea (el dueño se cambia en la tabla, y solo un admin). */
  isOwner?: boolean;
  number: NumberDto | null;
  people: GroupsPerson[];
  teams: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: (n: NumberDto) => void;
}) {
  const t = useTranslations("groups.lines");
  const tc = useTranslations("groups.common");
  const errText = useErrorText();
  const [visibility, setVisibility] = useState<"all" | "restricted">("all");
  const [personIds, setPersonIds] = useState<Set<string>>(new Set());
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!number) return;
    setVisibility(number.visibility);
    setPersonIds(new Set(number.access?.personIds ?? []));
    setTeamIds(new Set(number.access?.teamIds ?? []));
    setError("");
  }, [number]);

  const toggle = (
    set: Set<string>,
    id: string,
    fn: (s: Set<string>) => void,
  ) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    fn(next);
  };

  async function submit() {
    if (!number) return;
    setBusy(true);
    const r = await api<NumberDto>(`/api/groups/numbers/${number.id}`, {
      method: "PATCH",
      body: {
        visibility,
        personIds: [...personIds],
        teamIds: [...teamIds],
      },
    });
    setBusy(false);
    if (!r.data) return setError(errText(r.error));
    onSaved(r.data);
  }

  return (
    <Modal
      open={!!number}
      title={t("accessTitle", { name: number?.name ?? "" })}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {tc("cancel")}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            aria-busy={busy || undefined}
          >
            {tc("save")}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        <p className="ui-help" data-testid={isOwner ? "line-owner-fixed" : "line-owner-note"}>
          {isOwner
            ? t("ownerFixed")
            : number?.ownerName
              ? t("accessOwnerNote", { name: number.ownerName })
              : t("accessNoOwnerNote")}
        </p>
        <fieldset className="ui-field">
          <legend className="label">{t("visibility")}</legend>
          <label className="gr-check-label">
            <input
              type="radio"
              name="line-visibility"
              checked={visibility === "all"}
              onChange={() => setVisibility("all")}
            />
            {t("visibilityAll")}
          </label>
          <label className="gr-check-label">
            <input
              type="radio"
              name="line-visibility"
              checked={visibility === "restricted"}
              onChange={() => setVisibility("restricted")}
              data-testid="line-restricted"
            />
            {t("visibilityRestricted")}
          </label>
          <span className="ui-help">{t("visibilityHelp")}</span>
          {groupName && visibility === "restricted" && (
            <span className="ui-help" data-testid="line-access-group-note">
              {t("accessGroupNote", { group: groupName })}
            </span>
          )}
        </fieldset>
        {visibility === "restricted" && (
          <>
            <fieldset className="ui-field">
              <legend className="label">{t("people")}</legend>
              {people.map((p) => (
                <label key={p.id} className="gr-check-label">
                  <input
                    type="checkbox"
                    className="ui-check"
                    checked={personIds.has(p.id)}
                    onChange={() => toggle(personIds, p.id, setPersonIds)}
                  />
                  {p.name || p.email}
                </label>
              ))}
            </fieldset>
            {teams.length > 0 && (
              <fieldset className="ui-field">
                <legend className="label">{t("teams")}</legend>
                {teams.map((tm) => (
                  <label key={tm.id} className="gr-check-label">
                    <input
                      type="checkbox"
                      className="ui-check"
                      checked={teamIds.has(tm.id)}
                      onChange={() => toggle(teamIds, tm.id, setTeamIds)}
                    />
                    {tm.name}
                  </label>
                ))}
              </fieldset>
            )}
          </>
        )}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

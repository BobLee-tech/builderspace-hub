import type { RouterInputs, RouterOutputs } from "~/utils/api";

export type AudienceChoice = NonNullable<
  RouterInputs["hub"]["documents"]["update"]["audience"]
>;
type Detail = RouterOutputs["hub"]["documents"]["get"];
export type ReaderList = NonNullable<Detail["readers"]>;

/** The picker's starting value for a document as it is now. */
export function audienceFrom(detail: {
  audience: Detail["audience"];
  readers: ReaderList | null;
}): AudienceChoice {
  if (detail.audience !== "selected") return { kind: detail.audience };
  return {
    kind: "selected",
    userIds: detail.readers?.users.map((u) => u.userId) ?? [],
    groups:
      detail.readers?.groups.map((g) => ({
        projectPublicId: g.projectPublicId,
        departmentPublicId: g.departmentPublicId,
      })) ?? [],
  };
}

/** Nothing picked yet under 指定的人: the form should not be sent like that. */
export function isEmptySelection(value: AudienceChoice): boolean {
  return (
    value.kind === "selected" &&
    value.userIds.length === 0 &&
    value.groups.length === 0
  );
}

/** Whether 谁能看 differs from where the edit form started. */
export function audienceChanged(
  value: AudienceChoice,
  initial: AudienceChoice,
): boolean {
  return JSON.stringify(value) !== JSON.stringify(initial);
}

/**
 * The edit form may be sent unless 谁能看 was changed to 指定的人 with nobody
 * picked. Left as it was, it is not sent at all, so a stored list that now
 * resolves to nobody (its only project deleted) still lets the title change.
 */
export function canSendAudience(
  value: AudienceChoice,
  initial: AudienceChoice,
): boolean {
  return !audienceChanged(value, initial) || !isEmptySelection(value);
}

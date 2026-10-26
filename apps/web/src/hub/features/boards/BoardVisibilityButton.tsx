import {
  HiOutlineEye,
  HiOutlineEyeSlash,
  HiOutlineLockClosed,
  HiOutlineShieldCheck,
} from "react-icons/hi2";

import Button from "~/components/Button";
import CheckboxDropdown from "~/components/CheckboxDropdown";
import { Tooltip } from "~/components/Tooltip";
import { usePermissions } from "~/hooks/usePermissions";
import { copy } from "~/hub/copy/zh";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";

const text = copy.boardVisibility;

type Choice = keyof typeof text.options;

const ICONS: Record<Choice, React.ReactNode> = {
  public: <HiOutlineEye />,
  members: <HiOutlineEyeSlash />,
  onlyMe: <HiOutlineLockClosed />,
  admins: <HiOutlineShieldCheck />,
};

// What the Hub stores for each of its two choices.
const AUDIENCE = { onlyMe: "owner", admins: "admins" } as const;

interface QueryParams {
  boardPublicId: string;
  members: string[];
  labels: string[];
  lists: string[];
}

/**
 * Stands in for Kan's `VisibilityButton` on the board page
 * (docs/hub/UPSTREAM_SEAMS.md) and takes the same props. Kan's two choices are
 * renamed for what they mean here (公开链接 / 社团成员可见). Two more come
 * from the Hub: 仅自己可见, offered to the board's creator, and 仅管理员可见,
 * offered to the project's admins; the server says which the viewer may pick.
 *
 * Kan's choices are saved through Kan's `board.update`; the Hub's through
 * `hub.boards.setAudience`. Leaving a Hub choice for 公开链接 is two steps:
 * back to the members first, then public, because the server refuses to
 * publish a board that is still hidden from them.
 */
export function BoardVisibilityButton({
  visibility,
  boardPublicId,
  queryParams,
  isLoading,
  isAdmin,
}: {
  visibility: "public" | "private";
  boardPublicId: string;
  boardSlug: string;
  queryParams: QueryParams;
  isLoading: boolean;
  isAdmin: boolean;
}) {
  const { showPopup } = usePopup();
  const { canEditBoard } = usePermissions();
  const utils = api.useUtils();

  const privacy = api.hub.boards.privacy.useQuery(
    { boardPublicId },
    { enabled: boardPublicId !== "" },
  );
  const updateBoard = api.board.update.useMutation();
  const setAudience = api.hub.boards.setAudience.useMutation();

  const audience = privacy.data?.audience ?? null;
  const current: Choice =
    audience === "owner"
      ? "onlyMe"
      : audience === "admins"
        ? "admins"
        : visibility === "public"
          ? "public"
          : "members";
  const canEditKan = canEditBoard || isAdmin;
  const canSwitchTo = privacy.data?.canSwitchTo;
  const saving = updateBoard.isPending || setAudience.isPending;

  // Kan's choices need Kan's edit right, and, from a hidden board, the right
  // to hand it back to the members; whoever may do that may always pick
  // 社团成员可见. The Hub's choices are whatever the server allows.
  const choices = (["public", "members", "onlyMe", "admins"] as const).filter(
    (choice) => {
      if (choice === current) return true;
      if (choice === "onlyMe") return canSwitchTo?.owner ?? false;
      if (choice === "admins") return canSwitchTo?.admins ?? false;
      const mayLeave = audience === null || (canSwitchTo?.members ?? false);
      return mayLeave && (canEditKan || (choice === "members" && !!audience));
    },
  );
  const disabled =
    isLoading || privacy.isLoading || saving || choices.length < 2;

  async function choose(choice: Choice): Promise<void> {
    if (choice === current) return;
    try {
      if (choice === "onlyMe" || choice === "admins") {
        await setAudience.mutateAsync({
          boardPublicId,
          audience: AUDIENCE[choice],
        });
      } else {
        if (audience !== null)
          await setAudience.mutateAsync({ boardPublicId, audience: null });
        const kanVisibility = choice === "public" ? "public" : "private";
        if (kanVisibility !== visibility) {
          await updateBoard.mutateAsync({
            boardPublicId,
            visibility: kanVisibility,
          });
        }
      }
      showPopup({
        header: text.saved,
        message: text.savedAs(text.options[choice]),
        icon: "success",
      });
    } catch (error) {
      showPopup({
        header: text.failed,
        message:
          error instanceof Error && error.message
            ? error.message
            : text.tryAgain,
        icon: "error",
      });
    } finally {
      await Promise.all([
        utils.board.byId.invalidate(queryParams),
        utils.board.all.invalidate(),
        utils.hub.boards.privacy.invalidate({ boardPublicId }),
      ]);
    }
  }

  return (
    <div className="relative">
      <Tooltip
        content={
          disabled && !isLoading && !privacy.isLoading && !saving
            ? text.noPermission
            : undefined
        }
      >
        <CheckboxDropdown
          items={choices.map((choice) => ({
            key: choice,
            value: text.options[choice],
            selected: choice === current,
            leftIcon: ICONS[choice],
          }))}
          handleSelect={(_group, item) => void choose(item.key as Choice)}
          footer={
            <p className="max-w-[13rem] p-2 text-[11px] leading-4 text-light-900 dark:text-dark-900">
              {text.explain[current]}
            </p>
          }
        >
          <Button variant="secondary" disabled={disabled}>
            <span className="flex items-center gap-2">
              {ICONS[current]}
              <span className="hidden sm:inline">{text.button}</span>
            </span>
          </Button>
        </CheckboxDropdown>
      </Tooltip>
    </div>
  );
}

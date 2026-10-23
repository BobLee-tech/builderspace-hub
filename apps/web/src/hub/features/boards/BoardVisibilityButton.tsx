import {
  HiOutlineEye,
  HiOutlineEyeSlash,
  HiOutlineLockClosed,
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
};

interface QueryParams {
  boardPublicId: string;
  members: string[];
  labels: string[];
  lists: string[];
}

/**
 * Stands in for Kan's `VisibilityButton` on the board page
 * (docs/hub/UPSTREAM_SEAMS.md) and takes the same props. Kan's two choices are
 * renamed for what they mean here (公开链接 / 社团成员可见), and a third,
 * 仅自己可见, is offered to the board's creator.
 *
 * Kan's choices are saved through Kan's `board.update`; 仅自己可见 through
 * `hub.boards.setOnlyMe`. Leaving 仅自己可见 for 公开链接 is two steps: back to
 * the members first, then public, because the server refuses to publish a
 * board that is still private to one person.
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
  const setOnlyMe = api.hub.boards.setOnlyMe.useMutation();

  const onlyMe = privacy.data?.onlyMe ?? false;
  const current: Choice = onlyMe
    ? "onlyMe"
    : visibility === "public"
      ? "public"
      : "members";
  const canEditKan = canEditBoard || isAdmin;
  const canChangeOnlyMe = privacy.data?.canChange ?? false;
  const saving = updateBoard.isPending || setOnlyMe.isPending;
  const disabled =
    isLoading ||
    privacy.isLoading ||
    saving ||
    (!canEditKan && !canChangeOnlyMe);

  // Kan's choices need Kan's edit right; the owner of a private board may
  // always hand it back to the members.
  const choices = (["public", "members", "onlyMe"] as const).filter((choice) =>
    choice === "onlyMe"
      ? canChangeOnlyMe
      : canEditKan || (choice === "members" && onlyMe && canChangeOnlyMe),
  );

  async function choose(choice: Choice): Promise<void> {
    if (choice === current) return;
    try {
      if (choice === "onlyMe") {
        await setOnlyMe.mutateAsync({ boardPublicId, onlyMe: true });
      } else {
        if (onlyMe)
          await setOnlyMe.mutateAsync({ boardPublicId, onlyMe: false });
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

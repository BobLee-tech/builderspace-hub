import Link from "next/link";
import { useState } from "react";
import { TbArrowRight, TbLayoutKanban } from "react-icons/tb";

import type { TaskView } from "@kan/hub/public";
import { authClient } from "@kan/auth/client";
import { can, DUE_SOON_DAYS } from "@kan/hub/public";

import type { RouterOutputs } from "~/utils/api";
import Modal from "~/components/modal";
import { NewWorkspaceForm } from "~/components/NewWorkspaceForm";
import { copy } from "~/hub/copy/zh";
import { keepWhileSwitchingMine } from "~/hub/lib/board-cache";
import { homeHref, taskBoardHref } from "~/hub/lib/routes";
import { useOpenInProject } from "~/hub/lib/use-open-in-project";
import { buttonClass, Card } from "~/hub/ui/admin-primitives";
import { useModal } from "~/providers/modal";
import { api } from "~/utils/api";
import {
  ScopeSwitcher,
  useFollowScope,
  useProjectParam,
} from "../tasks/ScopeSwitcher";
import { TaskRow } from "../tasks/task-display";
import { ColumnsSkeleton, TaskBoardBody } from "../tasks/TaskBoardBody";

type Home = RouterOutputs["hub"]["tasks"]["home"];

const text = copy.home;

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return text.greeting.morning;
  if (hour < 18) return text.greeting.afternoon;
  return text.greeting.evening;
}

/** The page people land on: switch scope, see the counts, jump to a board. */
export function HomePage() {
  const { projectPublicId, isReady } = useProjectParam();
  const home = api.hub.tasks.home.useQuery(
    { project: projectPublicId },
    { enabled: isReady, retry: false },
  );
  const { data: session } = authClient.useSession();
  useFollowScope(home.data?.scope.current);
  // 只看我的 on the embedded 总版. Held here so it survives a scope switch,
  // which reloads everything below.
  const [onlyMine, setOnlyMine] = useState(false);

  const name = session?.user.name;

  return (
    <div className="m-auto w-full max-w-[1100px] px-5 py-8 md:px-12 md:py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-light-1000 dark:text-dark-1000">
          {greeting(new Date())}
          {name ? `，${name}` : ""}
        </h1>
        {home.data && home.data.scope.projects.length > 0 && (
          <p className="mt-1 text-sm text-light-900 dark:text-dark-900">
            {text.projectCount(home.data.scope.projects.length)}
          </p>
        )}
      </header>

      {home.error?.data?.code === "NOT_FOUND" ? (
        <ScopeMissing />
      ) : !home.data ? (
        <Skeleton />
      ) : home.data.scope.projects.length === 0 ? (
        <WaitingForProject />
      ) : (
        <HomeContent
          home={home.data}
          onlyMine={onlyMine}
          onOnlyMineChange={setOnlyMine}
        />
      )}
    </div>
  );
}

function HomeContent({
  home,
  onlyMine,
  onOnlyMineChange,
}: {
  home: Home;
  onlyMine: boolean;
  onOnlyMineChange: (onlyMine: boolean) => void;
}) {
  const scopeId = home.scope.current?.publicId ?? null;
  const openInProject = useOpenInProject();

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <ScopeSwitcher
          projects={home.scope.projects}
          current={home.scope.current}
          hrefFor={homeHref}
        />
        {home.scope.current && (
          <button
            type="button"
            className={buttonClass.ghost}
            onClick={() =>
              home.scope.current &&
              openInProject(home.scope.current.publicId, "/boards")
            }
          >
            <TbLayoutKanban className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {text.openBoards}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          view="mine"
          label={text.tiles.mine}
          value={home.tiles.mine}
          scopeId={scopeId}
        />
        <Tile
          view="due-soon"
          label={text.tiles.dueSoon}
          hint={text.tiles.dueSoonHint(DUE_SOON_DAYS)}
          value={home.tiles.dueSoon}
          scopeId={scopeId}
        />
        <Tile
          view="overdue"
          label={text.tiles.overdue}
          value={home.tiles.overdue}
          scopeId={scopeId}
          alert={home.tiles.overdue > 0}
        />
        <Tile
          view="all"
          label={text.tiles.open}
          hint={text.tiles.openHint}
          value={home.tiles.open}
          scopeId={scopeId}
        />
      </div>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {text.myTasks.title}
          </h2>
          {home.tiles.mine > home.myTasks.length && (
            <Link
              href={taskBoardHref("mine", scopeId)}
              className="inline-flex items-center gap-1 text-xs text-light-900 hover:text-light-1000 dark:text-dark-900 dark:hover:text-dark-1000"
            >
              {text.myTasks.seeAll}
              <TbArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
        <Card className="p-2">
          {home.myTasks.length === 0 ? (
            <p className="px-3 py-4 text-sm text-light-900 dark:text-dark-900">
              {text.myTasks.empty}
            </p>
          ) : (
            <div className="divide-y divide-light-200 dark:divide-dark-200">
              {home.myTasks.map((task) => (
                <TaskRow key={task.publicId} task={task} />
              ))}
            </div>
          )}
        </Card>
      </section>

      <OverallBoard
        scopeId={scopeId}
        onlyMine={onlyMine}
        onOnlyMineChange={onOnlyMineChange}
      />
    </div>
  );
}

/**
 * The 总版 of the chosen scope, right on the home page: every task of the
 * 技术 / 活动 / 运营 boards (of one project, or of all of them), editable in
 * place. Same component and same data as `/tasks/all`.
 */
function OverallBoard({
  scopeId,
  onlyMine,
  onOnlyMineChange,
}: {
  scopeId: string | null;
  onlyMine: boolean;
  onOnlyMineChange: (onlyMine: boolean) => void;
}) {
  const query = {
    view: "all" as const,
    project: scopeId ?? undefined,
    onlyMine: onlyMine || undefined,
  };
  const board = api.hub.tasks.board.useQuery(query, {
    retry: false,
    placeholderData: keepWhileSwitchingMine(query),
  });

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {text.overall.title}
          </h2>
          <p className="mt-0.5 text-xs text-light-900 dark:text-dark-900">
            {copy.tasks.overallHint}
          </p>
        </div>
        <Link
          href={taskBoardHref("all", scopeId, onlyMine)}
          className="inline-flex shrink-0 items-center gap-1 text-xs text-light-900 hover:text-light-1000 dark:text-dark-900 dark:hover:text-dark-1000"
        >
          {text.overall.fullScreen}
          <TbArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
      {board.data ? (
        <TaskBoardBody
          board={board.data}
          query={query}
          onOnlyMineChange={onOnlyMineChange}
        />
      ) : (
        <ColumnsSkeleton />
      )}
    </section>
  );
}

function Tile({
  view,
  label,
  hint,
  value,
  scopeId,
  alert,
}: {
  view: TaskView;
  label: string;
  hint?: string;
  value: number;
  scopeId: string | null;
  alert?: boolean;
}) {
  return (
    <Link
      href={taskBoardHref(view, scopeId)}
      className="group rounded-xl border border-light-300 bg-light-50 p-4 transition-colors hover:border-light-600 dark:border-dark-300 dark:bg-dark-100 dark:hover:border-dark-600"
    >
      <span className="flex items-center justify-between text-xs text-light-900 dark:text-dark-900">
        <span>
          {label}
          {hint && <span className="ml-1 opacity-70">· {hint}</span>}
        </span>
        <TbArrowRight
          className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </span>
      <span
        className={
          alert
            ? "mt-2 block text-3xl font-semibold tabular-nums text-red-600 dark:text-red-400"
            : "mt-2 block text-3xl font-semibold tabular-nums text-light-1000 dark:text-dark-1000"
        }
      >
        {value}
      </span>
    </Link>
  );
}

function WaitingForProject() {
  const me = api.hub.me.get.useQuery(undefined, { retry: false });
  const { openModal, isOpen, modalContentType } = useModal();
  const mayCreate = can(me.data?.role ?? null, "projects.create");

  return (
    <Card className="max-w-xl">
      <h2 className="text-base font-semibold text-light-1000 dark:text-dark-1000">
        {text.waiting.heading}
      </h2>
      <p className="mt-2 text-sm leading-6 text-light-900 dark:text-dark-900">
        {text.waiting.body}
      </p>
      {mayCreate && (
        <>
          <button
            type="button"
            className={`${buttonClass.primary} mt-4`}
            onClick={() => openModal("NEW_WORKSPACE")}
          >
            {text.waiting.create}
          </button>
          <Modal
            modalSize="sm"
            isVisible={isOpen && modalContentType === "NEW_WORKSPACE"}
          >
            <NewWorkspaceForm />
          </Modal>
        </>
      )}
    </Card>
  );
}

function ScopeMissing() {
  return (
    <Card className="max-w-xl">
      <p className="text-sm text-light-1000 dark:text-dark-1000">
        {text.scopeMissing}
      </p>
      <Link href={homeHref()} className={`${buttonClass.ghost} mt-4`}>
        {text.scopeMissingBack}
      </Link>
    </Card>
  );
}

function Skeleton() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="h-8 w-80 animate-pulse rounded-full bg-light-200 dark:bg-dark-200" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[92px] animate-pulse rounded-xl bg-light-200 dark:bg-dark-200"
          />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-xl bg-light-200 dark:bg-dark-200" />
    </div>
  );
}

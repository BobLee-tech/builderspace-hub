import { useEffect, useMemo, useState } from "react";
import { TbCheck, TbCopy, TbMarkdown } from "react-icons/tb";
import { twMerge } from "tailwind-merge";

import { toolsFor } from "@kan/hub/public";

import type { Guide, GuideBlock } from "~/hub/lib/mcp-guide";
import type { RouterOutputs } from "~/utils/api";
import { PageHead } from "~/components/PageHead";
import { copy } from "~/hub/copy/zh";
import { buildMcpGuide, guideToMarkdown } from "~/hub/lib/mcp-guide";
import {
  buttonClass,
  Card,
  ConfirmButton,
  ErrorText,
  PageHeader,
  Pill,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";

type Connection =
  RouterOutputs["hub"]["mcp"]["overview"]["connections"][number];

const text = copy.mcp;

const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * 左侧「MCP」: how to connect an AI app to the Hub, which tools this person's
 * AI gets, and the apps already connected. The guide at its heart is data
 * (`mcp-guide.ts`), so 复制本页 Markdown hands an AI exactly what is shown.
 */
export function McpPage() {
  const me = api.hub.me.get.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });
  const overview = api.hub.mcp.overview.useQuery(undefined, { retry: false });

  const endpoint = overview.data?.endpoint ?? null;
  const guide = useMemo(() => {
    if (!endpoint || !me.data) return null;
    return buildMcpGuide({
      endpoint,
      role: me.data.role,
      tools: toolsFor({ role: me.data.role, siteAccess: me.data.siteAccess }),
    });
  }, [endpoint, me.data]);

  const loading = !overview.error && !me.error && (!overview.data || !me.data);

  return (
    <div className="m-auto w-full max-w-[1100px] px-5 py-8 md:px-12 md:py-12">
      <PageHead title={`${text.title} · ${copy.brand}`} />
      <PageHeader title={text.title} description={text.description}>
        {guide && <CopyMarkdown guide={guide} />}
      </PageHeader>
      <ErrorText message={overview.error?.message ?? me.error?.message} />
      {loading && (
        <div className="h-40 animate-pulse rounded-xl bg-light-200 dark:bg-dark-200" />
      )}
      {overview.data && (
        <div className="space-y-4">
          <Connections connections={overview.data.connections} />
          {overview.data.endpoint === null ? (
            <Card>
              <p className="text-sm text-light-900 dark:text-dark-900">
                {text.endpointMissing}
              </p>
            </Card>
          ) : (
            guide && <GuideView guide={guide} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The clipboard API, then the old select-and-copy for browsers and embedded
 * views that refuse it. False when neither worked.
 */
async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      // Deprecated, but still the only fallback when the clipboard API is refused.
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

/** Puts `value` on the clipboard; `state` says how that went, then resets. */
function useCopy() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [state]);
  const run = (value: string) => {
    void copyText(value).then((ok) => setState(ok ? "copied" : "failed"));
  };
  return { state, run };
}

/** 复制本页 Markdown, and the text itself to select by hand if copying is refused. */
function CopyMarkdown({ guide }: { guide: Guide }) {
  const { state, run } = useCopy();
  const markdown = useMemo(() => guideToMarkdown(guide), [guide]);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className={buttonClass.primary}
        onClick={() => run(markdown)}
      >
        {state === "copied" ? (
          <TbCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />
        ) : (
          <TbMarkdown className="mr-1.5 h-4 w-4" aria-hidden="true" />
        )}
        {text.copyMarkdown}
      </button>
      <span
        role="status"
        className="min-h-4 text-xs text-light-900 dark:text-dark-900"
      >
        {state === "copied"
          ? text.copiedMarkdown
          : state === "failed"
            ? text.copyFailed
            : ""}
      </span>
      {state === "failed" && (
        <textarea
          readOnly
          value={markdown}
          aria-label={text.copyMarkdown}
          onFocus={(event) => event.currentTarget.select()}
          autoFocus
          className="mt-1 h-64 w-full min-w-[18rem] rounded-md border border-light-400 bg-light-50 p-2 font-mono text-xs text-light-1000 dark:border-dark-400 dark:bg-dark-50 dark:text-dark-1000 sm:w-[28rem]"
        />
      )}
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const { state, run } = useCopy();
  return (
    <button
      type="button"
      className={twMerge(buttonClass.ghost, "px-2 py-1 text-xs")}
      onClick={() => run(value)}
      aria-label={label ? `${text.copy} ${label}` : text.copy}
    >
      {state === "copied" ? (
        <TbCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <TbCopy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
      )}
      {state === "copied" ? text.copied : text.copy}
    </button>
  );
}

function Connections({ connections }: { connections: Connection[] }) {
  const utils = api.useUtils();
  const disconnect = api.hub.mcp.disconnect.useMutation({
    onSuccess: () => utils.hub.mcp.overview.invalidate(),
  });

  return (
    <Card title={text.connections.title} hint={text.connections.hint}>
      {connections.length === 0 ? (
        <p className="text-sm text-light-900 dark:text-dark-900">
          {text.connections.empty}
        </p>
      ) : (
        <ul className="divide-y divide-light-300 dark:divide-dark-300">
          {connections.map((connection) => (
            <li
              key={connection.publicId}
              className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-light-1000 dark:text-dark-1000">
                  {connection.clientName}
                </p>
                <p className="text-xs text-light-900 dark:text-dark-900">
                  {text.connections.connectedAt(
                    timeFormat.format(connection.createdAt),
                  )}
                  {" · "}
                  {text.connections.lastUsed(
                    timeFormat.format(connection.lastUsedAt),
                  )}
                </p>
              </div>
              <ConfirmButton
                label={text.connections.disconnect}
                isPending={disconnect.isPending}
                onConfirm={() =>
                  disconnect.mutate({
                    connectionPublicId: connection.publicId,
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}
      <ErrorText message={disconnect.error?.message} />
    </Card>
  );
}

function GuideView({ guide }: { guide: Guide }) {
  return (
    <Card>
      <h2 className="text-base font-semibold text-light-1000 dark:text-dark-1000">
        {guide.heading}
      </h2>
      <p className="mt-2 rounded-lg bg-light-200 px-3 py-2 text-sm text-light-1000 dark:bg-dark-200 dark:text-dark-1000">
        {guide.intro}
      </p>
      <div className="mt-6 space-y-8">
        {guide.sections.map((section) => (
          <section key={section.id} aria-labelledby={`mcp-${section.id}`}>
            <h3
              id={`mcp-${section.id}`}
              className="mb-3 border-b border-light-300 pb-2 text-sm font-semibold text-light-1000 dark:border-dark-300 dark:text-dark-1000"
            >
              {section.heading}
            </h3>
            <div className="space-y-3">
              {section.blocks.map((block, index) => (
                <Block key={index} block={block} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Card>
  );
}

const paragraphClass = "text-sm leading-6 text-light-1000 dark:text-dark-1000";

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-light-200 p-3 pr-20 font-mono text-xs leading-5 text-light-1000 dark:bg-dark-200 dark:text-dark-1000">
        <code>{code}</code>
      </pre>
      <div className="absolute right-2 top-2">
        <CopyButton value={code} />
      </div>
    </div>
  );
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case "paragraph":
      return <p className={paragraphClass}>{block.text}</p>;
    case "facts":
      return (
        <dl className="space-y-2">
          {block.items.map((item) => (
            <div
              key={item.label}
              className="flex flex-col gap-2 rounded-lg border border-light-300 p-3 dark:border-dark-300 sm:flex-row sm:items-center"
            >
              <dt className="shrink-0 text-xs font-medium text-light-900 dark:text-dark-900">
                {item.label}
              </dt>
              <dd className="flex min-w-0 flex-1 items-center gap-2">
                <code className="min-w-0 flex-1 select-all break-all font-mono text-sm text-light-1000 dark:text-dark-1000">
                  {item.value}
                </code>
                <CopyButton value={item.value} label={item.label} />
              </dd>
            </div>
          ))}
        </dl>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List
          className={twMerge(
            "space-y-1.5 pl-5",
            paragraphClass,
            block.ordered ? "list-decimal" : "list-disc",
          )}
        >
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </List>
      );
    }
    case "code":
      return <CodeBlock code={block.code} />;
    case "client":
      return (
        <div className="space-y-2 rounded-lg border border-light-300 p-4 dark:border-dark-300">
          <h4 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {block.name}
          </h4>
          {block.before && <p className={paragraphClass}>{block.before}</p>}
          {block.code && <CodeBlock code={block.code.code} />}
          {block.after && (
            <p className="text-xs leading-5 text-light-900 dark:text-dark-900">
              {block.after}
            </p>
          )}
        </div>
      );
    case "tools":
      return (
        <div className="space-y-5">
          {block.groups.map((group) => (
            <div key={group.label}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-light-900 dark:text-dark-900">
                {group.label}
              </h4>
              <ul className="divide-y divide-light-300 rounded-lg border border-light-300 dark:divide-dark-300 dark:border-dark-300">
                {group.tools.map((tool) => (
                  <li key={tool.name} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-xs font-semibold text-light-1000 dark:text-dark-1000">
                        {tool.name}
                      </code>
                      <span className="text-sm text-light-1000 dark:text-dark-1000">
                        {tool.title}
                      </span>
                      <Pill tone={tool.writes ? "strong" : "neutral"}>
                        {tool.writes
                          ? text.guide.tools.writes
                          : text.guide.tools.readOnly}
                      </Pill>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-light-900 dark:text-dark-900">
                      {tool.description}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
  }
}

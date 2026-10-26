import type { HubRole, McpToolInfo } from "@kan/hub/public";
import {
  mcpNotOffered,
  mcpToolGroupLabels,
  mcpToolGroups,
  roleLabels,
} from "@kan/hub/public";

import { copy } from "../copy/zh";

/**
 * The MCP page's content as data: the page renders it, and 复制本页 Markdown
 * copies the same thing as Markdown, so what a person reads and what their AI
 * reads can never drift apart. Pure; no React.
 */

const text = copy.mcp.guide;

/** The name every client is told to register the server under. */
export const MCP_SERVER_NAME = "builderspace-hub";

export type GuideBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "facts"; items: { label: string; value: string; code?: boolean }[] }
  | { kind: "list"; items: readonly string[]; ordered?: boolean }
  | { kind: "code"; language: "bash" | "json"; code: string }
  | {
      kind: "client";
      name: string;
      before?: string;
      code?: { language: "bash" | "json"; code: string };
      after?: string;
    }
  | {
      kind: "tools";
      groups: { label: string; tools: McpToolInfo[] }[];
    };

export interface GuideSection {
  id: string;
  heading: string;
  blocks: GuideBlock[];
}

export interface Guide {
  heading: string;
  intro: string;
  sections: GuideSection[];
}

export function buildMcpGuide(input: {
  endpoint: string;
  tools: readonly McpToolInfo[];
  role: HubRole | null;
}): Guide {
  const { endpoint } = input;
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  const who = input.role
    ? text.tools.youWithRole(roleLabels[input.role])
    : text.tools.you;

  return {
    heading: text.heading,
    intro: text.pasteHint,
    sections: [
      {
        id: "about",
        heading: text.about.heading,
        blocks: [
          { kind: "paragraph", text: text.about.body },
          {
            kind: "facts",
            items: [
              { label: text.about.endpoint, value: endpoint, code: true },
            ],
          },
          { kind: "list", items: [text.about.transport, text.about.auth] },
        ],
      },
      {
        id: "steps",
        heading: text.steps.heading,
        blocks: [{ kind: "list", items: text.steps.items, ordered: true }],
      },
      {
        id: "clients",
        heading: text.clients.heading,
        blocks: [
          {
            kind: "client",
            name: text.clients.claudeCode.name,
            code: {
              language: "bash",
              code: `claude mcp add --transport http ${MCP_SERVER_NAME} ${endpoint}`,
            },
            after: text.clients.claudeCode.after,
          },
          {
            kind: "client",
            name: text.clients.codex.name,
            code: {
              language: "bash",
              code: [
                `codex mcp add ${MCP_SERVER_NAME} --url ${endpoint}`,
                `codex mcp login ${MCP_SERVER_NAME}`,
              ].join("\n"),
            },
            after: text.clients.codex.after,
          },
          {
            kind: "client",
            name: text.clients.cursor.name,
            before: text.clients.cursor.before,
            code: {
              language: "json",
              code: json({
                mcpServers: { [MCP_SERVER_NAME]: { url: endpoint } },
              }),
            },
            after: text.clients.cursor.after,
          },
          {
            kind: "client",
            name: text.clients.vscode.name,
            before: text.clients.vscode.before,
            code: {
              language: "json",
              code: json({
                servers: { [MCP_SERVER_NAME]: { type: "http", url: endpoint } },
              }),
            },
          },
          {
            kind: "client",
            name: text.clients.claudeApp.name,
            before: text.clients.claudeApp.body,
          },
          {
            kind: "client",
            name: text.clients.other.name,
            before: text.clients.other.body,
          },
        ],
      },
      {
        id: "token",
        heading: text.token.heading,
        blocks: [
          { kind: "paragraph", text: text.token.intro },
          {
            kind: "client",
            name: text.token.claudeCode,
            code: {
              language: "bash",
              code: `claude mcp add --transport http ${MCP_SERVER_NAME} ${endpoint} --header "Authorization: Bearer ${text.token.placeholder}"`,
            },
          },
          {
            kind: "client",
            name: text.token.json,
            code: {
              language: "json",
              code: json({
                mcpServers: {
                  [MCP_SERVER_NAME]: {
                    url: endpoint,
                    headers: {
                      Authorization: `Bearer ${text.token.placeholder}`,
                    },
                  },
                },
              }),
            },
          },
        ],
      },
      {
        id: "tools",
        heading: text.tools.heading,
        blocks: [
          { kind: "paragraph", text: text.tools.intro(who) },
          {
            kind: "tools",
            groups: mcpToolGroups
              .map((group) => ({
                label: mcpToolGroupLabels[group],
                tools: input.tools.filter((tool) => tool.group === group),
              }))
              .filter((group) => group.tools.length > 0),
          },
        ],
      },
      {
        id: "not-offered",
        heading: text.notOffered.heading,
        blocks: [
          { kind: "paragraph", text: text.notOffered.intro },
          { kind: "list", items: mcpNotOffered },
        ],
      },
      {
        id: "reconnect",
        heading: text.reconnect.heading,
        blocks: [{ kind: "list", items: text.reconnect.items }],
      },
      {
        id: "safety",
        heading: text.safety.heading,
        blocks: [{ kind: "list", items: text.safety.items }],
      },
    ],
  };
}

const fence = (language: string, code: string) =>
  ["```" + language, code, "```"].join("\n");

function blockToMarkdown(block: GuideBlock): string {
  switch (block.kind) {
    case "paragraph":
      return block.text;
    case "facts":
      return block.items
        .map(
          (item) =>
            `- ${item.label}：${item.code ? `\`${item.value}\`` : item.value}`,
        )
        .join("\n");
    case "list":
      return block.items
        .map(
          (item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${item}`,
        )
        .join("\n");
    case "code":
      return fence(block.language, block.code);
    case "client":
      return [
        `### ${block.name}`,
        block.before,
        block.code && fence(block.code.language, block.code.code),
        block.after,
      ]
        .filter(Boolean)
        .join("\n\n");
    case "tools":
      return block.groups
        .map((group) =>
          [
            `### ${group.label}`,
            ...group.tools.map(
              (tool) =>
                `- \`${tool.name}\`（${tool.title}，${
                  tool.writes ? text.tools.writes : text.tools.readOnly
                }）：${tool.description}`,
            ),
          ].join("\n"),
        )
        .join("\n\n");
  }
}

/** The whole page as Markdown, for pasting into an AI chat. */
export function guideToMarkdown(guide: Guide): string {
  return [
    `# ${guide.heading}`,
    `> ${guide.intro}`,
    ...guide.sections.map((section) =>
      [`## ${section.heading}`, ...section.blocks.map(blockToMarkdown)].join(
        "\n\n",
      ),
    ),
  ]
    .join("\n\n")
    .concat("\n");
}

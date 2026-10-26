// What apps/web needs to serve the MCP endpoint (`@kan/api/hub-mcp`). The
// `hub.mcp.*` router is mounted from ../index.ts and is not exported here:
// tools.ts loads the whole app router, which in turn loads that router.
export type { HubCaller, McpToolName, McpToolOutcome } from "./tools";
export { createMcpCaller, mcpToolImplementations, runMcpTool } from "./tools";

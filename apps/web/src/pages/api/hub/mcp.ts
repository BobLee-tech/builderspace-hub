import type { NextApiRequest, NextApiResponse } from "next";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createMcpCaller } from "@kan/api/hub-mcp";
import { authenticateMcpRequest } from "@kan/hub/mcp";

import { getHubDb } from "~/hub/server/db";
import { createHubMcpServer } from "~/hub/server/mcp-server";
import { allowCors, requireMcpUrls } from "~/hub/server/oauth-http";
import { withHubRateLimit } from "~/hub/server/rate-limit";

/** Documents go up to 400 KB of text; JSON escaping needs room on top. */
export const config = { api: { bodyParser: { sizeLimit: "2mb" } } };

/**
 * The Hub's MCP endpoint (Streamable HTTP, stateless, JSON answers). Every
 * request carries an OAuth access token from MCP sign-in; without one the
 * answer is 401 with a pointer to the metadata, which is how a client learns
 * to sign the person in (MCP authorization spec, RFC 9728).
 *
 * Not to be confused with Kan's own `/api/mcp`, which takes an API key and
 * knows nothing of the Hub's rules.
 */
export default withHubRateLimit(
  "mcp",
  { window: 60, max: 240 },
  async (req: NextApiRequest, res: NextApiResponse) => {
    allowCors(res, "POST", "WWW-Authenticate, Mcp-Session-Id");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    // Stateless: no event stream to open (GET) and no session to end (DELETE).
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      res.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed" },
        id: null,
      });
      return;
    }

    const urls = requireMcpUrls(res);
    if (!urls) return;

    const db = getHubDb();
    const person = await authenticateMcpRequest(
      db,
      req.headers.authorization,
      new Date(),
    );
    if (!person) {
      const invalid = req.headers.authorization
        ? ', error="invalid_token"'
        : "";
      res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${urls.resourceMetadata}"${invalid}`,
      );
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "需要先登录 BuilderSpace Hub" },
        id: null,
      });
      return;
    }

    const server = createHubMcpServer(
      createMcpCaller(db, person.user),
      person,
      urls,
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  },
);

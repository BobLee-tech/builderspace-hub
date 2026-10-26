/**
 * Rewrites the Hub adds to next.config.js (one registered seam). Plain
 * JavaScript because the config file loads it directly.
 *
 * MCP clients fetch the two sign-in discovery documents from fixed paths on
 * the site's origin; the pages router only serves API routes under /api.
 */
export const hubRewrites = [
  {
    source: "/.well-known/oauth-authorization-server",
    destination: "/api/hub/oauth/authorization-server",
  },
  {
    // Also `…/oauth-protected-resource/api/hub/mcp`: clients try both.
    source: "/.well-known/oauth-protected-resource/:path*",
    destination: "/api/hub/oauth/protected-resource",
  },
];

import type { GitHubDeps } from "./connect.service";
import { createGitHubClient } from "./github.client";

/**
 * Where the GitHub App's settings come from. Server only.
 *
 * The names start with HUB_ on purpose: GITHUB_CLIENT_ID is Kan's own, and
 * setting it would switch on "sign in with GitHub" past the registration gate.
 */
export interface GitHubAppConfig {
  clientId: string;
  clientSecret: string;
  /** The auth secret the tokens are encrypted with. */
  secret: string;
  /** Where GitHub sends people back to after they authorise. */
  callbackUrl: string;
}

export const GITHUB_CALLBACK_PATH = "/api/hub/github/callback";

/** The App's settings, or null while it has not been set up. */
export function gitHubAppConfig(
  env: Record<string, string | undefined> = process.env,
): GitHubAppConfig | null {
  const clientId = env.HUB_GITHUB_CLIENT_ID;
  const clientSecret = env.HUB_GITHUB_CLIENT_SECRET;
  const secret = env.BETTER_AUTH_SECRET;
  const baseUrl = env.NEXT_PUBLIC_BASE_URL ?? env.BETTER_AUTH_URL;
  if (!clientId || !clientSecret || !secret || !baseUrl) return null;
  return {
    clientId,
    clientSecret,
    secret,
    callbackUrl: `${baseUrl.replace(/\/$/, "")}${GITHUB_CALLBACK_PATH}`,
  };
}

export function gitHubDeps(config: GitHubAppConfig): GitHubDeps {
  return {
    client: createGitHubClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    }),
    secret: config.secret,
  };
}

/** The page on github.com where a person authorises the App. */
export function authorizeUrl(config: GitHubAppConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    state,
    allow_signup: "false",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

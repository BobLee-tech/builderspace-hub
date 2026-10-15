import { describe, expect, it } from "vitest";

import { authorizeUrl, gitHubAppConfig, gitHubDeps } from "./config";

const env = {
  HUB_GITHUB_CLIENT_ID: "Iv1.abc",
  HUB_GITHUB_CLIENT_SECRET: "shh",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
  NEXT_PUBLIC_BASE_URL: "https://hub.example/",
};

describe("gitHubAppConfig", () => {
  it("reads the HUB_ names and builds the callback address", () => {
    expect(gitHubAppConfig(env)).toEqual({
      clientId: "Iv1.abc",
      clientSecret: "shh",
      secret: env.BETTER_AUTH_SECRET,
      callbackUrl: "https://hub.example/api/hub/github/callback",
    });
  });

  it("is null until every setting is there, and ignores Kan's own GITHUB_ names", () => {
    expect(
      gitHubAppConfig({ ...env, HUB_GITHUB_CLIENT_SECRET: undefined }),
    ).toBeNull();
    expect(
      gitHubAppConfig({
        GITHUB_CLIENT_ID: "x",
        GITHUB_CLIENT_SECRET: "y",
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
        NEXT_PUBLIC_BASE_URL: env.NEXT_PUBLIC_BASE_URL,
      }),
    ).toBeNull();
  });
});

describe("authorizeUrl", () => {
  it("sends people to GitHub with the state and the callback", () => {
    const config = gitHubAppConfig(env);
    if (!config) throw new Error("config");
    const url = new URL(authorizeUrl(config, "st4te"));

    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "Iv1.abc",
      redirect_uri: "https://hub.example/api/hub/github/callback",
      state: "st4te",
      allow_signup: "false",
    });
    expect(gitHubDeps(config).secret).toBe(env.BETTER_AUTH_SECRET);
  });
});

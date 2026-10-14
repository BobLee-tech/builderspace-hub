import { afterEach, describe, expect, it } from "vitest";

import type { SiteDb } from "./site.db";
import {
  connectSiteDb,
  overrideSiteDbForTests,
  siteDbConfig,
  sitePoolConfig,
} from "./site.db";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

describe("siteDbConfig", () => {
  it("is null until the website's database URL is set", () => {
    expect(siteDbConfig({})).toBeNull();
    expect(siteDbConfig({ HUB_SITE_DATABASE_URL: "  " })).toBeNull();
  });

  it("reads the URL and an optional CA, restoring escaped line breaks", () => {
    expect(
      siteDbConfig({ HUB_SITE_DATABASE_URL: "postgresql://u:p@db.example/x" }),
    ).toEqual({ url: "postgresql://u:p@db.example/x", ca: null });
    expect(
      siteDbConfig({
        HUB_SITE_DATABASE_URL: "postgresql://u:p@db.example/x",
        HUB_SITE_DATABASE_CA: PEM.replace(/\n/g, "\\n"),
      })?.ca,
    ).toBe(PEM);
  });
});

describe("sitePoolConfig", () => {
  it("connects to a local database as the URL says", () => {
    const url = "postgresql://u:p@localhost:5432/site";
    expect(sitePoolConfig({ url, ca: null })).toMatchObject({
      connectionString: url,
    });
    expect(sitePoolConfig({ url, ca: null }).ssl).toBeUndefined();
  });

  it("always verifies TLS for a remote database, whatever sslmode the URL asks for", () => {
    const config = sitePoolConfig({
      url: "postgresql://hub_site_admin.ref:p@pooler.example:6543/postgres?sslmode=no-verify&application_name=hub",
      ca: null,
    });
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(config.connectionString).toBe(
      "postgresql://hub_site_admin.ref:p@pooler.example:6543/postgres?application_name=hub",
    );
  });

  it("verifies against the given CA when there is one", () => {
    const config = sitePoolConfig({
      url: "postgresql://u:p@pooler.example:6543/postgres?sslmode=require",
      ca: PEM,
    });
    expect(config.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
  });
});

describe("connectSiteDb", () => {
  afterEach(() => overrideSiteDbForTests(null));

  it("is null while the website is not connected", () => {
    expect(connectSiteDb(null)).toBeNull();
  });

  it("makes one client per config and reuses it", () => {
    const config = { url: "postgresql://u:p@localhost:5432/site", ca: null };
    const first = connectSiteDb(config);
    expect(first).not.toBeNull();
    expect(connectSiteDb(config)).toBe(first);
    expect(connectSiteDb({ ...config, url: `${config.url}2` })).not.toBe(first);
  });

  it("answers with the test database when one is set", () => {
    const fake = {} as SiteDb;
    overrideSiteDbForTests(fake);
    expect(connectSiteDb(null)).toBe(fake);
  });
});

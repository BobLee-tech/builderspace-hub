import { describe, expect, it } from "vitest";

import type { SeamConfig } from "./seams";
import { hubDiagnostics, parseTscOutput } from "./web-types";

const config: SeamConfig = {
  upstreamRef: "upstream/main",
  ownPaths: ["apps/web/src/hub/", "apps/web/src/pages/admin/"],
  seams: [
    {
      file: "apps/web/src/components/SideNavigation.tsx",
      marker: "hub-seam",
      why: "sidebar",
    },
  ],
  shadowed: [],
};

// What `tsc --pretty false` printed for the broken merge of 2026-10-14,
// trimmed to the Hub's error and two of Kan's.
const output = [
  "apps/web/bootstrap.cjs(44,9): error TS2307: Cannot find module './apps/web/server.js' or its corresponding type declarations.",
  "apps/web/src/hub/features/admin/AdminLayout.tsx(81,9): error TS2353: Object literal may only specify known properties, and 'permission' does not exist in type 'NavItem'.",
  "apps/web/src/views/board/index.tsx(902,19): error TS2322: Type 'string' is not assignable to type '\"public\" | \"private\"'.",
  "",
].join("\n");

describe("parseTscOutput", () => {
  it("reads one diagnostic per error, with the file it is in", () => {
    expect(parseTscOutput(output).map((d) => d.file)).toEqual([
      "apps/web/bootstrap.cjs",
      "apps/web/src/hub/features/admin/AdminLayout.tsx",
      "apps/web/src/views/board/index.tsx",
    ]);
  });

  it("keeps the indented details with the error they explain", () => {
    const diagnostics = parseTscOutput(
      [
        "apps/web/src/hub/a.tsx(1,1): error TS2322: Type '{ a: string; }' is not assignable to type 'B'.",
        "  Property 'b' is missing in type '{ a: string; }' but required in type 'B'.",
        "apps/web/src/hub/c.tsx(2,2): error TS2304: Cannot find name 'c'.",
      ].join("\n"),
    );

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.text).toContain("Property 'b' is missing");
    expect(diagnostics[1]?.text).not.toContain("Property 'b' is missing");
  });

  it("reads errors that are not tied to a file", () => {
    expect(
      parseTscOutput("error TS5083: Cannot read file 'tsconfig.json'."),
    ).toEqual([
      { file: null, text: "error TS5083: Cannot read file 'tsconfig.json'." },
    ]);
  });

  it("reads paths with spaces and parentheses", () => {
    expect(
      parseTscOutput(
        "apps/web/src/pages/(group)/my page.tsx(3,4): error TS2304: Cannot find name 'x'.",
      )[0]?.file,
    ).toBe("apps/web/src/pages/(group)/my page.tsx");
  });

  it("finds nothing in output without errors", () => {
    expect(parseTscOutput("")).toEqual([]);
    expect(parseTscOutput("Version 5.8.3\n")).toEqual([]);
  });
});

describe("hubDiagnostics", () => {
  it("keeps only the errors in the Hub's own files", () => {
    expect(
      hubDiagnostics(config, parseTscOutput(output)).map((d) => d.file),
    ).toEqual(["apps/web/src/hub/features/admin/AdminLayout.tsx"]);
  });

  it("leaves seam files to Kan, since they hold Kan's errors too", () => {
    const diagnostics = parseTscOutput(
      "apps/web/src/components/SideNavigation.tsx(10,3): error TS2741: Property 'role' is missing.",
    );

    expect(hubDiagnostics(config, diagnostics)).toEqual([]);
  });

  it("does not treat a look-alike path as ours", () => {
    const diagnostics = parseTscOutput(
      "apps/web/src/hubby/x.ts(1,1): error TS2304: Cannot find name 'x'.",
    );

    expect(hubDiagnostics(config, diagnostics)).toEqual([]);
  });

  it("keeps errors not tied to a file, since then nothing was checked", () => {
    const diagnostics = parseTscOutput(
      "error TS5083: Cannot read file 'tsconfig.json'.",
    );

    expect(hubDiagnostics(config, diagnostics)).toEqual(diagnostics);
  });
});

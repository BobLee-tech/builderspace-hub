import { beforeEach, describe, expect, it } from "vitest";

import type { Db } from "../db";
import { CLI_ACTOR, listAudit } from "../audit";
import { createHubTestDb } from "../testing/test-db";
import { DEFAULT_FUNCTION_COLORS } from "./function-colors.policy";
import { getFunctionColors, setFunctionColors } from "./settings.service";

let db: Db;

beforeEach(async () => {
  db = await createHubTestDb();
});

describe("function colours", () => {
  it("starts with the defaults", async () => {
    expect(await getFunctionColors(db)).toEqual(DEFAULT_FUNCTION_COLORS);
  });

  it("saves new colours, overwrites them, and logs each change", async () => {
    await setFunctionColors(db, CLI_ACTOR, {
      dev: "#9A86D1",
      ops: "#4FA3A5",
      marketing: "#C77F95",
    });
    await setFunctionColors(db, CLI_ACTOR, {
      dev: "#7C8796",
      ops: "#4FA3A5",
      marketing: "#C77F95",
    });

    expect(await getFunctionColors(db)).toEqual({
      dev: "#7C8796",
      ops: "#4FA3A5",
      marketing: "#C77F95",
    });
    const entries = await listAudit(db, { limit: 5, offset: 0 });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      action: "settings.function_colors_changed",
      summary: "职能颜色改为 开发 #7C8796、运营 #4FA3A5、营销 #C77F95",
    });
  });

  it("refuses a bad colour and changes nothing", async () => {
    await expect(
      setFunctionColors(db, CLI_ACTOR, {
        dev: "red",
        ops: "#4FA3A5",
        marketing: "#C77F95",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await getFunctionColors(db)).toEqual(DEFAULT_FUNCTION_COLORS);
  });
});

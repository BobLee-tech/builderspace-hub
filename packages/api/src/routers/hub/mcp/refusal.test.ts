import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { refusalMessage } from "./tools";

// Loading the tools loads the whole API router, whose import routes need a key.
vi.hoisted(() => {
  process.env.BETTER_AUTH_SECRET ??= "mcp-refusal-test";
});

describe("refusalMessage", () => {
  it("keeps the Hub's own Chinese message", () => {
    expect(
      refusalMessage(
        new TRPCError({ code: "FORBIDDEN", message: "没有执行这个操作的权限" }),
      ),
    ).toBe("没有执行这个操作的权限");
  });

  it("explains an English refusal by what it means", () => {
    expect(
      refusalMessage(
        new TRPCError({ code: "FORBIDDEN", message: "Permission denied" }),
      ),
    ).toBe("当前账号没有权限做这件事（Permission denied）");
  });

  it("uses the first problem the input check found", () => {
    const cause = z
      .object({ title: z.string().min(1, "标题要填写") })
      .safeParse({
        title: "",
      }).error;
    expect(
      refusalMessage(
        new TRPCError({ code: "BAD_REQUEST", message: "[…]", cause }),
      ),
    ).toBe("标题要填写");
  });

  it("passes on a refusal it has no words for", () => {
    expect(
      refusalMessage(
        new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Too big" }),
      ),
    ).toBe("Too big");
  });
});

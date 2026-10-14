import type { BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api";

import type { dbClient } from "@kan/db/client";
import { decideUserCreate, provisionUser } from "@kan/hub/access";
import { isSessionAllowed } from "@kan/hub/accounts";
import { HUB_GRANT_HEADER } from "@kan/hub/public";
import { rateLimitStorage } from "@kan/hub/rate-limit";
import { createLogger } from "@kan/logger";

const log = createLogger("hub-auth");

/**
 * Stricter limits than Better Auth's default (3 requests per 10 seconds per
 * IP on every sign-in and sign-up path), for the endpoints worth guessing
 * against. Counted per client IP and path, in the database.
 */
export const HUB_AUTH_RATE_LIMITS: {
  pathMatcher: (path: string) => boolean;
  window: number;
  max: number;
}[] = [
  // Password guessing: 5 tries a minute.
  { pathMatcher: (path) => path === "/sign-in/email", window: 60, max: 5 },
  // Registration needs a link; nobody legitimate tries often.
  { pathMatcher: (path) => path.startsWith("/sign-up"), window: 600, max: 5 },
  // Reset mails cost money and annoy the recipient.
  {
    pathMatcher: (path) =>
      path === "/forget-password" || path === "/request-password-reset",
    window: 600,
    max: 3,
  },
];

/**
 * BuilderSpace Hub's registration gate and suspension check, as a Better
 * Auth plugin.
 *
 * Better Auth runs database hooks contributed by plugins before the ones in
 * its own options (Kan's, in `hooks.ts`), and stops at the first that returns
 * false. So with this plugin installed an account can only be created by
 * someone presenting a live registration link for that exact address, whatever
 * the sign-up method.
 *
 * It also moves Better Auth's rate-limit counters into the database. Better
 * Auth keeps them in memory by default, and on serverless hosting every
 * instance would count on its own, letting guesses spread across them.
 * Plugin options only fill in what Kan's options leave unset, so turning rate
 * limiting off with DISABLE_RATE_LIMIT still works.
 */
export function hubAuthPlugin(db: dbClient): BetterAuthPlugin {
  return {
    id: "builderspace-hub",
    rateLimit: HUB_AUTH_RATE_LIMITS,
    init() {
      return {
        options: {
          rateLimit: { customStorage: rateLimitStorage(db) },
          databaseHooks: {
            user: {
              create: {
                async before(user, context) {
                  // Fail closed: if the check itself breaks, nobody gets in.
                  try {
                    const decision = await decideUserCreate(db, {
                      email: user.email,
                      token: context?.headers?.get(HUB_GRANT_HEADER) ?? null,
                      now: new Date(),
                    });

                    if (!decision.allowed) {
                      log.info(
                        { reason: decision.reason },
                        "Registration refused",
                      );
                      return false;
                    }
                  } catch (error) {
                    log.error({ err: error }, "Registration gate failed");
                    return false;
                  }
                },

                async after(user) {
                  // The user row is already committed and Better Auth has no
                  // transaction around this hook, so throwing here would leave
                  // an account that can neither finish nor retry sign-up.
                  // Provisioning is idempotent and is retried on first use.
                  try {
                    await provisionUser(db, {
                      userId: user.id,
                      email: user.email,
                      now: new Date(),
                    });
                  } catch (error) {
                    log.error(
                      { err: error, userId: user.id },
                      "Provisioning after registration failed; will retry",
                    );
                  }
                },
              },
            },
            session: {
              create: {
                async before(session) {
                  // Fail open: if this check breaks (say, a migration was not
                  // run), refusing every login would lock the whole team out.
                  // Suspension also deletes sessions and API keys, so a
                  // failure here never revives an existing session.
                  let allowed = true;
                  try {
                    allowed = await isSessionAllowed(db, session.userId);
                  } catch (error) {
                    log.error({ err: error }, "Suspension check failed");
                  }
                  if (!allowed) {
                    throw new APIError("FORBIDDEN", {
                      code: "HUB_ACCOUNT_SUSPENDED",
                      message: "这个账号已被停用，请联系管理员。",
                    });
                  }
                },
              },
            },
          },
        },
      };
    },
  };
}

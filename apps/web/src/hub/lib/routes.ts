import { HUB_JOIN_PATH } from "@kan/hub/public";

/**
 * Every path the Hub's own pages link to, in one place.
 */
export const hubRoutes = {
  /** Where a signed-in person lands. Becomes "/home" when the home page ships. */
  afterLogin: "/boards",
  login: "/login",
  signup: "/signup",
  join: HUB_JOIN_PATH,
} as const;

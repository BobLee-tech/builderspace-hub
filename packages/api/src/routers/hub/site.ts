import {
  connectSiteDb,
  exportSiteList,
  getSiteSummary,
  listSiteJoins,
  listSiteProjects,
  listSiteUpdates,
  listSiteVolunteers,
  reviewSiteProject,
  reviewSiteUpdate,
  sendVolunteerLink,
  siteExportInput,
  siteInputs,
  updateSiteVolunteer,
} from "@kan/hub/site";

import { createTRPCRouter } from "../../trpc";
import { hubProcedure, hubSiteProcedure, runHub } from "./procedures";

/**
 * `hub.site.*`: the back office's 官网 section, over the official website's
 * own database. 名单 (`site.people`) covers the volunteer and join lists;
 * 管理 (`site.review`) adds reviewing project cards and updates.
 */
export const siteRouter = createTRPCRouter({
  /** My website access, and whether the website's database is connected. */
  status: hubProcedure.query(({ ctx }) => ({
    access: ctx.siteAccess,
    connected: ctx.siteAccess !== null && connectSiteDb() !== null,
  })),

  summary: hubSiteProcedure("site.people").query(({ ctx }) =>
    runHub(() => getSiteSummary(ctx.site, ctx.siteActor)),
  ),

  projects: hubSiteProcedure("site.review")
    .input(siteInputs.projects)
    .query(({ ctx, input }) =>
      runHub(() => listSiteProjects(ctx.site, ctx.siteActor, input)),
    ),

  updates: hubSiteProcedure("site.review")
    .input(siteInputs.projects)
    .query(({ ctx, input }) =>
      runHub(() => listSiteUpdates(ctx.site, ctx.siteActor, input)),
    ),

  reviewProject: hubSiteProcedure("site.review")
    .input(siteInputs.review)
    .mutation(({ ctx, input }) =>
      runHub(() => reviewSiteProject(ctx.db, ctx.site, ctx.siteActor, input)),
    ),

  reviewUpdate: hubSiteProcedure("site.review")
    .input(siteInputs.review)
    .mutation(({ ctx, input }) =>
      runHub(() => reviewSiteUpdate(ctx.db, ctx.site, ctx.siteActor, input)),
    ),

  volunteers: hubSiteProcedure("site.people")
    .input(siteInputs.volunteers)
    .query(({ ctx, input }) =>
      runHub(() => listSiteVolunteers(ctx.db, ctx.site, ctx.siteActor, input)),
    ),

  /** Moving an application to 已录取 also mails a registration link; the result says how that went. */
  updateVolunteer: hubSiteProcedure("site.people")
    .input(siteInputs.volunteer)
    .mutation(({ ctx, input }) =>
      runHub(() => updateSiteVolunteer(ctx.db, ctx.site, ctx.siteActor, input)),
    ),

  /** Mails an accepted applicant a new registration link (owners and admins only). */
  sendVolunteerLink: hubSiteProcedure("site.people")
    .input(siteInputs.sendLink)
    .mutation(({ ctx, input }) =>
      runHub(() => sendVolunteerLink(ctx.db, ctx.site, ctx.siteActor, input)),
    ),

  joins: hubSiteProcedure("site.people")
    .input(siteInputs.joins)
    .query(({ ctx, input }) =>
      runHub(() => listSiteJoins(ctx.site, ctx.siteActor, input)),
    ),

  /** A whole list, filtered as on the page, for a spreadsheet; a mutation because it is logged. */
  export: hubSiteProcedure("site.people")
    .input(siteExportInput)
    .mutation(({ ctx, input }) =>
      runHub(() => exportSiteList(ctx.db, ctx.site, ctx.siteActor, input)),
    ),
});

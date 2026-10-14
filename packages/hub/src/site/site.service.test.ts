import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "../db";
import type { SiteDb } from "./site.db";
import type { SiteActor } from "./site.service";
import { listAudit } from "../audit";
import {
  createHubTestDb,
  createSiteTestDb,
  seedSiteJoin,
  seedSiteProject,
  seedSiteUpdate,
  seedSiteVolunteer,
} from "../testing/test-db";
import {
  exportSiteList,
  getSiteSummary,
  listSiteJoins,
  listSiteProjects,
  listSiteUpdates,
  listSiteVolunteers,
  reviewSiteProject,
  reviewSiteUpdate,
  updateSiteVolunteer,
} from "./site.service";
import {
  siteProjects,
  siteProjectUpdates,
  siteVolunteerApplications,
} from "./site.tables";

const now = new Date("2026-10-15T12:00:00Z");
const daysAgo = (days: number) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

let db: Db;
let site: SiteDb;

const actor = (siteAccess: SiteActor["siteAccess"]): SiteActor => ({
  userId: null,
  email: `${siteAccess ?? "nobody"}@example.test`,
  siteAccess,
});
const manager = actor("manage");
const lists = actor("people");
const nobody = actor(null);

const auditEntries = () => listAudit(db, { limit: 50, offset: 0 });

beforeEach(async () => {
  [db, site] = await Promise.all([createHubTestDb(), createSiteTestDb()]);
});

describe("who may see the website's data", () => {
  it("refuses someone without website access everywhere", async () => {
    await expect(getSiteSummary(site, nobody)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      listSiteVolunteers(site, nobody, { status: null, page: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      listSiteJoins(site, nobody, { supportersOnly: false, page: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      exportSiteList(db, site, nobody, {
        kind: "joins",
        supportersOnly: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps project review away from 名单", async () => {
    const project = await seedSiteProject(site);
    await expect(
      listSiteProjects(site, lists, { review: "pending", page: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      listSiteUpdates(site, lists, { review: "pending", page: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      reviewSiteProject(db, site, lists, {
        id: project.id,
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      reviewSiteUpdate(db, site, lists, {
        id: project.id,
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("getSiteSummary", () => {
  it("counts the queues and lists, and leaves review counts to reviewers", async () => {
    const project = await seedSiteProject(site);
    await seedSiteProject(site, { reviewStatus: "approved" });
    await seedSiteUpdate(site, project.id);
    const first = await seedSiteVolunteer(site);
    await seedSiteVolunteer(site);
    await updateSiteVolunteer(db, site, lists, {
      id: first.id,
      status: "contacted",
    });
    await seedSiteJoin(site, { supporter: true, createdAt: daysAgo(1) });
    await seedSiteJoin(site, { createdAt: daysAgo(30) });

    expect(await getSiteSummary(site, manager, now)).toEqual({
      reviews: { pendingProjects: 1, pendingUpdates: 1 },
      people: {
        volunteers: 2,
        newVolunteers: 1,
        joins: 2,
        recentJoins: 1,
        supporters: 1,
      },
      recentDays: 7,
    });
    expect((await getSiteSummary(site, lists, now)).reviews).toBeNull();
  });
});

describe("reviewing project cards", () => {
  it("lists the pending queue oldest first, and decided cards newest first", async () => {
    const older = await seedSiteProject(site, { createdAt: daysAgo(2) });
    const newer = await seedSiteProject(site, { createdAt: daysAgo(1) });

    const queue = await listSiteProjects(site, manager, {
      review: "pending",
      page: 1,
    });
    expect(queue.items.map((p) => p.id)).toEqual([older.id, newer.id]);
    expect(queue).toMatchObject({ total: 2, pageSize: 30 });

    await reviewSiteProject(db, site, manager, {
      id: older.id,
      decision: "approved",
    });
    await reviewSiteProject(db, site, manager, {
      id: newer.id,
      decision: "approved",
    });
    const approved = await listSiteProjects(site, manager, {
      review: "approved",
      page: 1,
    });
    expect(approved.items).toHaveLength(2);
  });

  it("approves a card on the website and logs who did it", async () => {
    const project = await seedSiteProject(site, { name: "CourseMate" });

    await reviewSiteProject(db, site, manager, {
      id: project.id,
      decision: "approved",
    });

    const [row] = await site
      .select({ review: siteProjects.reviewStatus })
      .from(siteProjects)
      .where(eq(siteProjects.id, project.id));
    expect(row?.review).toBe("approved");
    const [entry] = await auditEntries();
    expect(entry).toMatchObject({
      action: "site.project_reviewed",
      actorEmail: manager.email,
      entityId: project.id,
      summary: "官网项目卡「CourseMate」：待审核 → 已通过",
      detail: { from: "pending", to: "approved" },
    });
  });

  it("can take an approved card down again", async () => {
    const project = await seedSiteProject(site, { reviewStatus: "approved" });
    await reviewSiteProject(db, site, manager, {
      id: project.id,
      decision: "rejected",
    });
    const [entry] = await auditEntries();
    expect(entry?.summary).toContain("已通过 → 已驳回");
  });

  it("refuses an unknown card and logs nothing", async () => {
    await expect(
      reviewSiteProject(db, site, manager, {
        id: "00000000-0000-4000-8000-000000000000",
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await auditEntries()).toHaveLength(0);
  });

  it("refuses a malformed id or decision before touching the website", async () => {
    await expect(
      reviewSiteProject(db, site, manager, { id: "1", decision: "approved" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      reviewSiteProject(db, site, manager, {
        id: "00000000-0000-4000-8000-000000000000",
        decision: "pending" as never,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("reviewing progress updates", () => {
  it("lists them with their project's name and approves one", async () => {
    const project = await seedSiteProject(site, {
      name: "EchoAgent",
      reviewStatus: "approved",
    });
    const update = await seedSiteUpdate(site, project.id);

    const queue = await listSiteUpdates(site, manager, {
      review: "pending",
      page: 1,
    });
    expect(queue.items).toMatchObject([
      { id: update.id, projectName: "EchoAgent", kind: "demo" },
    ]);

    await reviewSiteUpdate(db, site, manager, {
      id: update.id,
      decision: "rejected",
    });
    const [row] = await site
      .select({ review: siteProjectUpdates.reviewStatus })
      .from(siteProjectUpdates)
      .where(eq(siteProjectUpdates.id, update.id));
    expect(row?.review).toBe("rejected");
    const [entry] = await auditEntries();
    expect(entry).toMatchObject({
      action: "site.update_reviewed",
      summary: "官网项目「EchoAgent」的一条进展：待审核 → 已驳回",
    });
  });

  it("refuses an unknown update", async () => {
    await expect(
      reviewSiteUpdate(db, site, manager, {
        id: "00000000-0000-4000-8000-000000000000",
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("following up on volunteers", () => {
  it("lists applications newest first and filters by state", async () => {
    const older = await seedSiteVolunteer(site, { createdAt: daysAgo(3) });
    const newer = await seedSiteVolunteer(site, { createdAt: daysAgo(1) });
    await updateSiteVolunteer(db, site, lists, {
      id: older.id,
      status: "interviewing",
    });

    const all = await listSiteVolunteers(site, lists, {
      status: null,
      page: 1,
    });
    expect(all.items.map((v) => v.id)).toEqual([newer.id, older.id]);
    const interviewing = await listSiteVolunteers(site, lists, {
      status: "interviewing",
      page: 1,
    });
    expect(interviewing).toMatchObject({ total: 1 });
  });

  it("moves an application along and keeps the notes out of the log", async () => {
    const volunteer = await seedSiteVolunteer(site, { nickname: "小林" });

    await updateSiteVolunteer(db, site, lists, {
      id: volunteer.id,
      status: "contacted",
      notes: "  周五下午面试，私信过了  ",
    });

    const [row] = await site
      .select({
        status: siteVolunteerApplications.status,
        notes: siteVolunteerApplications.opsNotes,
      })
      .from(siteVolunteerApplications)
      .where(eq(siteVolunteerApplications.id, volunteer.id));
    expect(row).toEqual({
      status: "contacted",
      notes: "周五下午面试，私信过了",
    });

    const [entry] = await auditEntries();
    expect(entry).toMatchObject({
      action: "site.volunteer_updated",
      summary: "志愿者申请（小林）：新申请 → 已联系，改了备注",
      detail: { from: "new", to: "contacted", notesChanged: true },
    });
    expect(JSON.stringify(entry)).not.toContain("周五");
  });

  it("clears the notes when they are emptied", async () => {
    const volunteer = await seedSiteVolunteer(site);
    await updateSiteVolunteer(db, site, lists, {
      id: volunteer.id,
      notes: "a note",
    });
    await updateSiteVolunteer(db, site, lists, {
      id: volunteer.id,
      notes: "   ",
    });
    const [row] = await site
      .select({ notes: siteVolunteerApplications.opsNotes })
      .from(siteVolunteerApplications)
      .where(eq(siteVolunteerApplications.id, volunteer.id));
    expect(row?.notes).toBeNull();
  });

  it("refuses an update with nothing in it, or notes that are too long", async () => {
    const volunteer = await seedSiteVolunteer(site);
    await expect(
      updateSiteVolunteer(db, site, lists, { id: volunteer.id }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "没有要修改的内容",
    });
    await expect(
      updateSiteVolunteer(db, site, lists, {
        id: volunteer.id,
        notes: "x".repeat(1001),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses an unknown application", async () => {
    await expect(
      updateSiteVolunteer(db, site, lists, {
        id: "00000000-0000-4000-8000-000000000000",
        status: "accepted",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the join list", () => {
  it("lists sign-ups and can keep only the club's supporters", async () => {
    await seedSiteJoin(site);
    const supporter = await seedSiteJoin(site, { supporter: true });

    const all = await listSiteJoins(site, lists, {
      supportersOnly: false,
      page: 1,
    });
    expect(all.total).toBe(2);
    const supporters = await listSiteJoins(site, lists, {
      supportersOnly: true,
      page: 1,
    });
    expect(supporters.items).toMatchObject([
      { id: supporter.id, fullName: "Full Name" },
    ]);
  });
});

describe("exporting a list", () => {
  it("returns every row the page's filter keeps and logs how many left", async () => {
    const contacted = await seedSiteVolunteer(site);
    await seedSiteVolunteer(site);
    await updateSiteVolunteer(db, site, lists, {
      id: contacted.id,
      status: "contacted",
    });
    await seedSiteJoin(site);
    await seedSiteJoin(site, { supporter: true });

    const volunteers = await exportSiteList(db, site, lists, {
      kind: "volunteers",
      status: null,
    });
    expect(volunteers.kind).toBe("volunteers");
    expect(volunteers.rows).toHaveLength(2);
    const onlyContacted = await exportSiteList(db, site, lists, {
      kind: "volunteers",
      status: "contacted",
    });
    expect(onlyContacted.rows).toHaveLength(1);
    const supporters = await exportSiteList(db, site, lists, {
      kind: "joins",
      supportersOnly: true,
    });
    expect(supporters.rows).toHaveLength(1);

    expect(
      (await auditEntries()).slice(0, 3).map((entry) => entry.summary),
    ).toEqual([
      "导出了官网的加入登记（只含支持社团申请的，1 条）",
      "导出了官网的志愿者申请（已联系，1 条）",
      "导出了官网的志愿者申请（2 条）",
    ]);
  });

  it("refuses an export request of the wrong shape", async () => {
    await expect(
      exportSiteList(db, site, lists, { kind: "events" } as never),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("when the website's database fails", () => {
  it("says so in one sentence and logs nothing", async () => {
    const broken = {
      select: () => {
        throw new Error("connect ECONNREFUSED");
      },
      transaction: () => Promise.reject(new Error("connect ECONNREFUSED")),
    } as unknown as SiteDb;
    const quiet = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(getSiteSummary(broken, manager)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "暂时连不上官网数据库，请稍后再试",
    });
    await expect(
      reviewSiteProject(db, broken, manager, {
        id: "00000000-0000-4000-8000-000000000000",
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(await auditEntries()).toHaveLength(0);
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});

import { z } from "zod";

import {
  addFormManager,
  createForm,
  deleteForm,
  deleteFormResponse,
  duplicateForm,
  exportResponses,
  findManagerCandidates,
  getFormDetail,
  listFormResponses,
  listForms,
  removeFormManager,
  saveForm,
  setFormStatus,
  summarizeResponses,
} from "@kan/hub/forms";
import { formAccessLevels, formStatuses } from "@kan/hub/public";

import { createTRPCRouter } from "../../trpc";
import { hubProcedure, runHub } from "./procedures";

/**
 * Forms as their managers see them, mounted at `hub.forms.*`: the list,
 * the builder, opening and closing, and reading the answers. Every procedure
 * is open to any signed-in member; who may do what is decided inside the
 * use cases. Answering a form is not here: it goes through
 * /api/hub/forms (see `forms/rest.ts`), because answers can hold personal
 * details and Kan's tRPC logging records every input.
 */

const id = z.string().min(1).max(32);
const formInput = z.object({ formPublicId: id });
const userInput = formInput.extend({ userId: z.string().uuid() });

export const formsRouter = createTRPCRouter({
  list: hubProcedure.query(({ ctx }) =>
    runHub(() => listForms(ctx.db, ctx.actor)),
  ),

  get: hubProcedure
    .input(formInput)
    .query(({ ctx, input }) =>
      runHub(() => getFormDetail(ctx.db, ctx.actor, input.formPublicId)),
    ),

  create: hubProcedure
    .input(z.object({ title: z.string().max(300) }))
    .mutation(({ ctx, input }) =>
      runHub(() => createForm(ctx.db, ctx.actor, input)),
    ),

  /** The builder sends the whole form; `definition` and `settings` are checked by the use case. */
  save: hubProcedure
    .input(
      formInput.extend({
        title: z.string().max(300),
        access: z.enum(formAccessLevels),
        definition: z.unknown(),
        settings: z.unknown(),
        closesAt: z.string().max(40).nullable(),
        maxResponses: z.number().int().nullable(),
        expectedUpdatedAt: z.string().max(40),
      }),
    )
    .mutation(({ ctx, input }) =>
      runHub(() => saveForm(ctx.db, ctx.actor, input)),
    ),

  setStatus: hubProcedure
    .input(
      formInput.extend({
        status: z.enum(formStatuses),
        expectedUpdatedAt: z.string().max(40).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      runHub(() => setFormStatus(ctx.db, ctx.actor, input)),
    ),

  duplicate: hubProcedure
    .input(formInput)
    .mutation(({ ctx, input }) =>
      runHub(() => duplicateForm(ctx.db, ctx.actor, input.formPublicId)),
    ),

  delete: hubProcedure
    .input(formInput)
    .mutation(({ ctx, input }) =>
      runHub(() => deleteForm(ctx.db, ctx.actor, input.formPublicId)),
    ),

  responses: hubProcedure
    .input(
      formInput.extend({
        page: z.number().int().min(1).max(10_000),
        sort: z.enum(["newest", "likes"]).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      runHub(() => listFormResponses(ctx.db, ctx.actor, input)),
    ),

  summary: hubProcedure
    .input(formInput)
    .query(({ ctx, input }) =>
      runHub(() => summarizeResponses(ctx.db, ctx.actor, input.formPublicId)),
    ),

  /** Every answer, for the CSV file the page builds. */
  export: hubProcedure
    .input(formInput)
    .query(({ ctx, input }) =>
      runHub(() => exportResponses(ctx.db, ctx.actor, input.formPublicId)),
    ),

  deleteResponse: hubProcedure
    .input(formInput.extend({ responsePublicId: id }))
    .mutation(({ ctx, input }) =>
      runHub(() => deleteFormResponse(ctx.db, ctx.actor, input)),
    ),

  candidates: hubProcedure
    .input(formInput.extend({ search: z.string().max(100) }))
    .query(({ ctx, input }) =>
      runHub(() => findManagerCandidates(ctx.db, ctx.actor, input)),
    ),

  addManager: hubProcedure
    .input(userInput)
    .mutation(({ ctx, input }) =>
      runHub(() => addFormManager(ctx.db, ctx.actor, input)),
    ),

  removeManager: hubProcedure
    .input(userInput)
    .mutation(({ ctx, input }) =>
      runHub(() => removeFormManager(ctx.db, ctx.actor, input)),
    ),
});

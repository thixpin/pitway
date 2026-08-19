import { z } from 'zod';

export const SCHEMA_VERSION = 1;

const schemaVersion = z.literal(SCHEMA_VERSION);

const milestoneId = z.string().regex(/^M\d{3}$/, 'milestone id must match M000');
const taskId = z.string().regex(/^T\d{3}$/, 'task id must match T000');
const criterionId = z.string().regex(/^AC\d{3}$/, 'criterion id must match AC000');
const checkId = z.string().regex(/^CT\d{3}$/, 'check id must match CT000');
const requirementId = z.string().regex(/^R\d{3}$/, 'requirement id must match R000');
const isoTimestamp = z.iso.datetime();
const sha256Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/, 'hash must match sha256:<64 hex>');

export const taskStatusSchema = z.enum([
  'planned',
  'waiting',
  'ready',
  'in_progress',
  'blocked',
  'review',
  'completed',
  'failed',
  'cancelled',
]);

export const milestoneStatusSchema = z.enum([
  'draft',
  'confirmed',
  'in_progress',
  'review',
  'completed',
  'cancelled',
]);

// Usage is measured, never estimated: absent runtime data is `null`, and totals
// accumulate across attempts.
export const usageSchema = z
  .strictObject({
    attempts: z.number().int().positive(),
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative(),
  })
  .nullable();

// AC019 task-side split: task usage carries token counts only — the attempts
// counter lives on the task itself, incremented at the in_progress boundary.
// Milestone-level planning/qa usage keeps the shared usageSchema unchanged.
export const taskUsageSchema = z
  .strictObject({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative(),
  })
  .nullable();

export const configSchema = z.strictObject({
  schema_version: schemaVersion,
});

export const stateSchema = z.strictObject({
  schema_version: schemaVersion,
  active_milestone: milestoneId.nullable(),
  milestones: z.array(milestoneId),
});

// AC001/T002: additive-optional per-check timeout, milliseconds, bounded to
// one hour; omitted means the caller's safe default (120000ms) applies.
// command-only by construction -- the strictObject discrimination on
// manual/review variants rejects it without any extra code.
const timeoutMsSchema = z.number().int().min(1).max(3_600_000);

const verificationCheckSchema = z.discriminatedUnion('type', [
  z.strictObject({
    id: checkId,
    criterion: criterionId,
    type: z.literal('command'),
    command: z.string().min(1),
    timeout_ms: timeoutMsSchema.optional(),
  }),
  z.strictObject({
    id: checkId,
    criterion: criterionId,
    type: z.literal('manual'),
    instruction: z.string().min(1),
  }),
  z.strictObject({
    id: checkId,
    criterion: criterionId,
    type: z.literal('review'),
    instruction: z.string().min(1),
  }),
]);

export const contractFrontmatterSchema = z.strictObject({
  schema_version: schemaVersion,
  id: milestoneId,
  title: z.string().min(1),
  status: milestoneStatusSchema,
  requirement: requirementId.nullable(),
  confirmed_at: isoTimestamp.nullable(),
  verification_approved_hash: sha256Hash.nullable(),
  acceptance_criteria: z
    .array(z.strictObject({ id: criterionId, text: z.string().min(1) }))
    .min(1),
  verification: z.array(verificationCheckSchema).min(1),
});

// relevant_files (legacy) and the context_files/write_scope pair are two
// mutually exclusive ways to scope a task; both are schema-optional so a
// task may declare either style, never both — see the superRefine below for
// the full five-case combination rule.
export const taskSchema = z
  .strictObject({
    id: taskId,
    objective: z.string().min(1),
    status: taskStatusSchema,
    depends_on: z.array(taskId),
    acceptance_criteria: z.array(z.string().min(1)).min(1),
    relevant_files: z.array(z.string().min(1)).optional(),
    context_files: z.array(z.string().min(1)).optional(),
    write_scope: z.array(z.string().min(1)).optional(),
    // AC011/T010: additive-optional -- when present, narrows the context
    // bundle's contractExcerpt.acceptanceCriteria to exactly these AC ids;
    // absent on every M001-M006 historical task, so omitting it leaves
    // bundle generation byte-for-byte unchanged (see context-bundle.ts).
    mapped_ac_ids: z.array(z.string().min(1)).optional(),
    verification: z.strictObject({
      strategy: z.enum(['tdd', 'command', 'manual', 'review']),
      detail: z.string().min(1),
    }),
    result: z
      .strictObject({ summary: z.string().min(1), evidence: z.string().min(1) })
      .nullable(),
    attempts: z.number().int().nonnegative().optional(),
    usage: taskUsageSchema,
  })
  .superRefine((task, ctx) => {
    const hasRelevant = task.relevant_files !== undefined;
    const hasContext = task.context_files !== undefined;
    const hasWriteScope = task.write_scope !== undefined;

    if (hasRelevant && (hasContext || hasWriteScope)) {
      const conflicting = [
        hasContext ? 'context_files' : null,
        hasWriteScope ? 'write_scope' : null,
      ].filter((field): field is string => field !== null);
      ctx.addIssue({
        code: 'custom',
        message: `relevant_files cannot be combined with ${conflicting.join('/')}: ambiguous scope declaration — use one style or the other`,
        path: ['relevant_files'],
      });
      return;
    }

    if (!hasRelevant && !hasContext && !hasWriteScope) {
      ctx.addIssue({
        code: 'custom',
        message: 'one of relevant_files or write_scope must be set',
        path: ['relevant_files'],
      });
      return;
    }

    if (hasContext && !hasWriteScope) {
      ctx.addIssue({
        code: 'custom',
        message:
          'context_files alone is incomplete: write_scope must be declared (the write boundary is undefined)',
        path: ['context_files'],
      });
      return;
    }

    if (hasWriteScope && hasContext) {
      const contextSet = new Set(task.context_files);
      const missing = task.write_scope!.filter((path) => !contextSet.has(path));
      if (missing.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `write_scope path(s) not present in context_files: ${missing.join(', ')}`,
          path: ['write_scope'],
        });
      }
    }
  });

export const tasksFileSchema = z.strictObject({
  schema_version: schemaVersion,
  tasks: z.array(taskSchema),
});

export const verificationResultsSchema = z.strictObject({
  schema_version: schemaVersion,
  results: z.array(
    z.strictObject({
      check: checkId,
      status: z.enum(['pass', 'fail']),
      at: isoTimestamp,
      evidence: z.string().min(1),
      recorded_by: z.enum(['command', 'developer']),
      // AC008/T002: additive-optional -- only command-executed entries carry
      // these (developer-recorded manual/review results never do); every
      // pre-existing entry without them still validates unchanged.
      duration_ms: z.number().int().nonnegative().optional(),
      termination_reason: z.enum(['exited', 'timeout', 'signal', 'spawn_error']).optional(),
    }),
  ),
});

export const usageFileSchema = z.strictObject({
  schema_version: schemaVersion,
  planning: usageSchema,
  qa: usageSchema,
});

export type PitwayConfig = z.infer<typeof configSchema>;
export type PitwayState = z.infer<typeof stateSchema>;
export type ContractFrontmatter = z.infer<typeof contractFrontmatterSchema>;
export type VerificationCheck = z.infer<typeof verificationCheckSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TasksFile = z.infer<typeof tasksFileSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;
export type VerificationResults = z.infer<typeof verificationResultsSchema>;
export type UsageFile = z.infer<typeof usageFileSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type TaskUsage = z.infer<typeof taskUsageSchema>;

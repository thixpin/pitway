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

export const configSchema = z.strictObject({
  schema_version: schemaVersion,
});

export const stateSchema = z.strictObject({
  schema_version: schemaVersion,
  active_milestone: milestoneId.nullable(),
  milestones: z.array(milestoneId),
});

const verificationCheckSchema = z.discriminatedUnion('type', [
  z.strictObject({
    id: checkId,
    criterion: criterionId,
    type: z.literal('command'),
    command: z.string().min(1),
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

export const taskSchema = z.strictObject({
  id: taskId,
  objective: z.string().min(1),
  status: taskStatusSchema,
  depends_on: z.array(taskId),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  relevant_files: z.array(z.string().min(1)),
  verification: z.strictObject({
    strategy: z.enum(['tdd', 'command', 'manual', 'review']),
    detail: z.string().min(1),
  }),
  result: z
    .strictObject({ summary: z.string().min(1), evidence: z.string().min(1) })
    .nullable(),
  usage: usageSchema,
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

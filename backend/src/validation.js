import { z } from 'zod';

export const observationSchema = z.strictObject({
  api_name: z.string().trim().min(1).max(100),
  response_time_ms: z.number().finite().nonnegative(),
  status_code: z.number().int().min(100).max(599),
  records_returned: z.number().int().nonnegative().optional()
});

export const listSchema = z.strictObject({
  status: z.enum(['active', 'resolved', 'all']).default('active'),
  api_name: z.string().trim().min(1).max(100).optional(),
  batch_id: z.uuid().optional(),
  severity: z.enum(['warning', 'critical']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1000000).default(0)
});

export function itemErrors(error) {
  return error.issues.map(issue => ({ field: issue.path.join('.') || '$', message: issue.message }));
}

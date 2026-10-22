import { z } from 'zod';

const policySchema = z.strictObject({
  responseTimeThresholdMs: z.number().finite().nonnegative().optional(),
  expectRecords: z.boolean().optional()
});

const environment = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_PATH: z.string().min(1).default('./data/monitor.db'),
  CORS_ORIGINS: z.string().default(''),
  API_POLICIES_JSON: z.string().default('{}'),
  LLM_MODE: z.enum(['openrouter', 'mock', 'fallback']).default('fallback'),
  OPENROUTER_API_KEY: z.string().default(''),
  OPENROUTER_MODEL: z.string().min(1).default('openai/gpt-4o-mini'),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(8000),
  LLM_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')
});

export function loadConfig(env = process.env) {
  const parsed = environment.parse(env);
  let policies;
  try { policies = z.record(z.string().min(1).max(100), policySchema).parse(JSON.parse(parsed.API_POLICIES_JSON)); }
  catch { throw new Error('API_POLICIES_JSON must be a JSON object of valid API policies'); }
  return {
    port: parsed.PORT, host: parsed.HOST, databasePath: parsed.DATABASE_PATH,
    corsOrigins: parsed.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean),
    policies, llmMode: parsed.LLM_MODE, openrouterKey: parsed.OPENROUTER_API_KEY,
    openrouterModel: parsed.OPENROUTER_MODEL, llmTimeoutMs: parsed.LLM_TIMEOUT_MS,
    llmConcurrency: parsed.LLM_CONCURRENCY, shutdownGraceMs: parsed.SHUTDOWN_GRACE_MS,
    logLevel: parsed.LOG_LEVEL
  };
}

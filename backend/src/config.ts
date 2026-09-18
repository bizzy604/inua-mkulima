/** Loads and validates runtime configuration without exposing secret values. */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    APP_ORIGIN: z
      .url()
      .refine(
        (value) => new URL(value).origin === value,
        "Use an origin without a trailing slash or path.",
      ),
    DATABASE_PATH: z.string().min(1),
    SESSION_DATABASE_PATH: z.string().min(1),
    SESSION_SECRET: z.string().min(32),
    DEMO_USERNAME: z.string().trim().min(1),
    DEMO_PASSWORD_HASH: z
      .string()
      .regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/),
    DEMO_DEALER_ID: z.string().min(1),
    DEMO_VERIFICATION_CODE: z.string().regex(/^\d{6}$/),
    RABBITMQ_URL: z
      .url()
      .refine((value) => ["amqp:", "amqps:"].includes(new URL(value).protocol)),
    LOKI_URL: z
      .url()
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
    LOG_DIR: z.string().min(1),
    LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
    COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
    TRUST_PROXY: z.enum(["0", "1"]).default("0"),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ORIGIN.startsWith("https:") && env.COOKIE_SECURE !== "true")
      ctx.addIssue({
        code: "custom",
        path: ["COOKIE_SECURE"],
        message: "HTTPS requires secure cookies.",
      });
    if (!["http:", "https:"].includes(new URL(env.APP_ORIGIN).protocol))
      ctx.addIssue({
        code: "custom",
        path: ["APP_ORIGIN"],
        message: "Use an HTTP or HTTPS origin.",
      });
    if (
      resolve(projectRoot, env.DATABASE_PATH) ===
      resolve(projectRoot, env.SESSION_DATABASE_PATH)
    )
      ctx.addIssue({
        code: "custom",
        path: ["SESSION_DATABASE_PATH"],
        message: "Session and business databases must be separate.",
      });
  });

export function parseConfig(environment: Record<string, string | undefined>) {
  const env = environmentSchema.parse(environment);
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    appOrigin: env.APP_ORIGIN,
    databasePath: resolve(projectRoot, env.DATABASE_PATH),
    sessionDatabasePath: resolve(projectRoot, env.SESSION_DATABASE_PATH),
    sessionSecret: env.SESSION_SECRET,
    demoUsername: env.DEMO_USERNAME,
    demoPasswordHash: env.DEMO_PASSWORD_HASH,
    demoDealerId: env.DEMO_DEALER_ID,
    demoVerificationCode: env.DEMO_VERIFICATION_CODE,
    rabbitmqUrl: env.RABBITMQ_URL,
    lokiUrl: env.LOKI_URL,
    logDir: resolve(projectRoot, env.LOG_DIR),
    logLevel: env.LOG_LEVEL,
    cookieSecure: env.COOKIE_SECURE === "true",
    trustProxy: env.TRUST_PROXY === "1",
  };
}
export type Config = ReturnType<typeof parseConfig>;
/** Reads `.env` and returns the validated configuration used by every process dependency. */
export function loadConfig(): Config {
  dotenv.config({ path: resolve(projectRoot, ".env"), quiet: true });
  return parseConfig(process.env);
}

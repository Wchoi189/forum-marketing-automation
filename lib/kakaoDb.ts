import pg from "pg";
import { ENV } from "../config/env.js";
import { logger } from "./logger.js";
import type { KakaoSkillPayload } from "./kakaoSkill.js";

let pool: pg.Pool | null = null;

function schema(): string {
  return ENV.KAKAO_DB_SCHEMA;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export async function ensureReady(): Promise<void> {
  if (!ENV.KAKAO_DB_ENABLED) return;

  pool = new pg.Pool({
    host: ENV.KAKAO_DB_HOST,
    port: ENV.KAKAO_DB_PORT,
    database: ENV.KAKAO_DB_NAME,
    user: ENV.KAKAO_DB_USER,
    password: ENV.KAKAO_DB_PASSWORD,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  const s = schema();
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${s}"`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "${s}".kakao_users (
        user_key        VARCHAR(255) PRIMARY KEY,
        first_seen      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        last_active     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        user_properties JSONB        NOT NULL DEFAULT '{}'
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "${s}".chat_history (
        id          BIGSERIAL    PRIMARY KEY,
        user_key    VARCHAR(255) REFERENCES "${s}".kakao_users(user_key),
        direction   VARCHAR(10)  NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
        utterance   TEXT,
        block_id    VARCHAR(100),
        intent      VARCHAR(50),
        entities    JSONB,
        payload     JSONB        NOT NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_kkch_user_key   ON "${s}".chat_history(user_key)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_kkch_created_at ON "${s}".chat_history(created_at)`
    );
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_kkch_intent
        ON "${s}".chat_history(intent)
        WHERE intent IS NOT NULL
    `);

    logger.info(
      { event: "kakao_db_ready", host: ENV.KAKAO_DB_HOST, schema: s },
      "[KakaoDb] Schema and tables ready"
    );
  } finally {
    client.release();
  }
}

export async function close(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ── Message logging ───────────────────────────────────────────────────────────

export async function logInbound(payload: KakaoSkillPayload): Promise<void> {
  if (!pool) return;

  const userKey = payload.userRequest.user.id;
  const utterance = payload.userRequest.utterance;
  const blockId = payload.userRequest.block?.id ?? null;
  const s = schema();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO "${s}".kakao_users (user_key)
       VALUES ($1)
       ON CONFLICT (user_key) DO UPDATE SET last_active = NOW()`,
      [userKey]
    );
    await client.query(
      `INSERT INTO "${s}".chat_history (user_key, direction, utterance, block_id, payload)
       VALUES ($1, 'INBOUND', $2, $3, $4)`,
      [userKey, utterance, blockId, payload]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function logOutbound(
  userKey: string,
  replyText: string,
  responsePayload: object
): Promise<void> {
  if (!pool) return;

  const s = schema();
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO "${s}".chat_history (user_key, direction, utterance, payload)
       VALUES ($1, 'OUTBOUND', $2, $3)`,
      [userKey, replyText, responsePayload]
    );
  } finally {
    client.release();
  }
}

// ── Dashboard stats ───────────────────────────────────────────────────────────

export type KakaoDbStats = {
  dbEnabled: boolean;
  totalUsers: number;
  totalMessages: number;
  inboundToday: number;
  topIntents: Array<{ intent: string; count: number }>;
};

export async function getStats(): Promise<KakaoDbStats> {
  const dbEnabled = ENV.KAKAO_DB_ENABLED && pool !== null;
  if (!pool) {
    return { dbEnabled, totalUsers: 0, totalMessages: 0, inboundToday: 0, topIntents: [] };
  }

  const s = schema();
  const [usersRes, msgsRes, todayRes, intentsRes] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM "${s}".kakao_users`),
    pool.query(`SELECT COUNT(*)::int AS n FROM "${s}".chat_history`),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM "${s}".chat_history
       WHERE direction = 'INBOUND' AND created_at >= CURRENT_DATE`
    ),
    pool.query(
      `SELECT intent, COUNT(*)::int AS count
       FROM "${s}".chat_history
       WHERE intent IS NOT NULL
       GROUP BY intent ORDER BY count DESC LIMIT 10`
    ),
  ]);

  return {
    dbEnabled,
    totalUsers: usersRes.rows[0].n,
    totalMessages: msgsRes.rows[0].n,
    inboundToday: todayRes.rows[0].n,
    topIntents: intentsRes.rows as Array<{ intent: string; count: number }>,
  };
}

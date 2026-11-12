import postgres from "postgres";

// 서버 전용. 운영 DB는 Vercel이 만든 Neon(Postgres) — 풀러 주소라 prepared statement를 끈다.
const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

// Vercel의 DB 연동은 DATABASE_URL(Neon) 또는 POSTGRES_URL을 넣어 준다. 로컬은 postgres://localhost/milestamp.
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "postgres://localhost/milestamp";

export const sql =
  globalForDb.sql ??
  postgres(url, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
  });

if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

export type EventKind = "handoff" | "mission" | "intro" | "stamp" | "summary";

export type EventRow = {
  id: string;
  car_id: string;
  kind: EventKind;
  place_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
};

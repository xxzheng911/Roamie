import { DurableObject } from "cloudflare:workers";
import { applyGuardCommand, type CounterStore, type GuardCommand, type StoredCharge } from "@/lib/abuse-guard-logic";

type SqlExec = {
  exec(query: string, ...bindings: unknown[]): Iterable<Record<string, unknown>>;
};

function sqlStore(sql: SqlExec): CounterStore {
  return {
    get(key) {
      const rows = [...sql.exec("SELECT value FROM counters WHERE bucket = ?", key)];
      return rows.length ? Number(rows[0].value) : 0;
    },
    set(key, value) {
      sql.exec("DELETE FROM counters WHERE bucket = ?", key);
      if (value > 0) sql.exec("INSERT INTO counters (bucket, value) VALUES (?, ?)", key, value);
    },
    getOperation(id) {
      const rows = [...sql.exec("SELECT payload FROM operations WHERE operation_id = ?", id)];
      if (!rows.length) return undefined;
      return JSON.parse(String(rows[0].payload)) as StoredCharge;
    },
    putOperation(id, value) {
      sql.exec("DELETE FROM operations WHERE operation_id = ?", id);
      sql.exec("INSERT INTO operations (operation_id, payload) VALUES (?, ?)", id, JSON.stringify(value));
    },
  };
}

/** SQLite-backed billing guard. One object per user, per IP, and one global object. */
export class AbuseGuard extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS counters (bucket TEXT PRIMARY KEY, value INTEGER NOT NULL)",
      );
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS operations (operation_id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    const command = (await request.json()) as GuardCommand;
    const result = this.ctx.storage.transactionSync(() =>
      applyGuardCommand(sqlStore(this.ctx.storage.sql), command),
    );
    return Response.json(result);
  }
}

// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { LifeStore } from "./store.ts";
import { LifeSnapshotSchema } from "../../../packages/core/agent-life/schema.ts";

const databaseURL = process.env.LIFE_TEST_DATABASE_URL;
describe.skipIf(!databaseURL)("PostgreSQL world authority (isolated schema)", () => {
  it("serializes workers, rolls back failed settlements, and resumes persisted actions after reconnect", async () => {
    const schema = `life_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({ connectionString: databaseURL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const options = { connectionString: databaseURL, options: `-c search_path=${schema}`, max: 8 };
    let pool = new pg.Pool(options);
    try {
      await pool.query("CREATE TABLE workspace (id uuid NOT NULL)");
      const migrations = new URL("../../../server/migrations/", import.meta.url);
      for (const file of (await readdir(migrations)).filter((f) => /^(57[4-9]|58[0-4])_.*\.up\.sql$/.test(f)).sort()) await pool.query(await readFile(new URL(file, migrations), "utf8"));
      const workspaceId = randomUUID();
      await pool.query("INSERT INTO workspace VALUES($1)", [workspaceId]);
      const store = new LifeStore(pool);
      const initialized = await Promise.all(Array.from({ length: 4 }, () => store.initialize(workspaceId)));
      const id = initialized[0]!;
      expect(new Set(initialized).size).toBe(1);
      expect((await pool.query("SELECT count(*)::int AS n FROM life_agent")).rows[0].n).toBe(20);
      await expect(store.initialize(randomUUID())).rejects.toThrow("life_workspace_missing");
      const other = randomUUID(); await pool.query("INSERT INTO workspace VALUES($1)", [other]);
      await expect(store.initialize(other)).rejects.toThrow("life_world_workspace_mismatch");
      const ticks = await Promise.all(Array.from({ length: 8 }, () => store.tick(id)));
      expect(ticks.filter((t) => t !== null)).toEqual([1]);
      expect((await pool.query("SELECT count(*)::int AS n FROM life_action WHERE status='running'")).rows[0].n).toBe(20);

      await pool.query("UPDATE life_world SET next_tick_at=clock_timestamp()-interval '1 second'");
      const before = (await pool.query("SELECT (SELECT sum(amount) FROM life_resource) AS amount,(SELECT sum(energy) FROM life_agent) AS energy,(SELECT count(*) FROM life_action) AS actions,(SELECT count(*) FROM life_event) AS events,tick FROM life_world")).rows[0];
      await pool.query("CREATE FUNCTION reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_event_failure'; END $$");
      await pool.query("CREATE TRIGGER fail_event BEFORE INSERT ON life_event FOR EACH ROW EXECUTE FUNCTION reject_event()");
      await expect(store.tick(id)).rejects.toThrow("injected_event_failure");
      const after = (await pool.query("SELECT (SELECT sum(amount) FROM life_resource) AS amount,(SELECT sum(energy) FROM life_agent) AS energy,(SELECT count(*) FROM life_action) AS actions,(SELECT count(*) FROM life_event) AS events,tick FROM life_world")).rows[0];
      expect(after).toEqual(before);
      await pool.query("DROP TRIGGER fail_event ON life_event");
      await pool.end(); pool = new pg.Pool(options);
      const restarted = new LifeStore(pool);
      expect(await restarted.initialize(workspaceId)).toBe(id);
      expect(await restarted.tick(id)).toBe(2);
      for (let i = 0; i < 70; i++) {
        await pool.query("UPDATE life_world SET next_tick_at=clock_timestamp()-interval '1 second'");
        await restarted.tick(id);
      }
      const audit = (await pool.query(`SELECT
        (SELECT count(*) FROM life_resource WHERE amount<0) AS negative,
        (SELECT count(*) FROM life_action a LEFT JOIN life_event e ON e.action_id=a.id WHERE a.status<>'running' AND e.action_id IS NULL) AS missing,
        (SELECT count(*) FROM (SELECT action_id FROM life_event WHERE action_id IS NOT NULL GROUP BY action_id HAVING count(*)>1) d) AS duplicate,
        (SELECT count(*) FROM life_action WHERE status='completed') AS completed`)).rows[0];
      expect(audit.negative).toBe("0"); expect(audit.missing).toBe("0"); expect(audit.duplicate).toBe("0"); expect(Number(audit.completed)).toBeGreaterThan(300);
      const snapshotSQL = (await readFile(new URL("../../../server/pkg/db/queries/agent_life.sql", import.meta.url), "utf8")).split("-- name: LockLifeWorldForDeletion")[0]!;
      const snapshot = LifeSnapshotSchema.parse((await pool.query(snapshotSQL, [workspaceId])).rows[0].snapshot);
      expect(snapshot.world?.tick).toBe(72); expect(snapshot.agents).toHaveLength(20); expect(snapshot.actions).toHaveLength(20);
      expect((await pool.query(snapshotSQL, [other])).rowCount).toBe(0);
      await expect(pool.query("UPDATE life_resource SET amount=-1")).rejects.toThrow();
      await expect(pool.query("INSERT INTO life_event SELECT * FROM life_event WHERE action_id IS NOT NULL LIMIT 1")).rejects.toThrow();
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  }, 60_000);
});

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { advanceTick, seedResidents, seedResources, type Simulation } from "../../../packages/core/agent-life/engine.ts";
import { LIFE_TICK_MS, LIFE_CAPACITY } from "../../../packages/core/agent-life/rules.ts";
import { AgentSchema, ResourceSchema, ActionSchema } from "../../../packages/core/agent-life/schema.ts";

async function load(client: PoolClient, worldId: string, tick: number): Promise<Simulation> {
  const agents = await client.query(`SELECT id, name, jsonb_build_object('x',x,'y',y) AS position, energy, fullness, social, personality, goal FROM life_agent WHERE world_id=$1 ORDER BY id`, [worldId]);
  const resources = await client.query("SELECT owner,kind,amount FROM life_resource WHERE world_id=$1 ORDER BY owner,kind", [worldId]);
  const actions = await client.query(`SELECT id,agent_id AS "agentId",intent,reason,started_tick::float8 AS "startedTick",due_tick::float8 AS "dueTick",status FROM life_action WHERE world_id=$1 AND status='running' ORDER BY agent_id`, [worldId]);
  const residents = AgentSchema.array().min(1).max(LIFE_CAPACITY).parse(agents.rows);
  return { tick, agents: residents, resources: ResourceSchema.array().parse(resources.rows), actions: ActionSchema.array().parse(actions.rows) };
}

export class LifeStore {
  constructor(private readonly pool: Pool) {}

  async initialize(workspaceId: string): Promise<string> {
    workspaceId = AgentSchema.shape.id.parse(workspaceId).toLowerCase();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='15s'");
      // A transaction advisory lock serializes the first seed before a world row exists.
      await client.query("SELECT pg_advisory_xact_lock(173121, 1)");
      const workspace = await client.query('SELECT id FROM workspace WHERE id=$1 FOR SHARE', [workspaceId]);
      if (!workspace.rowCount) throw new Error("life_workspace_missing");
      const existing = await client.query("SELECT id,workspace_id FROM life_world FOR UPDATE");
      if (existing.rowCount) {
        const world = existing.rows[0];
        if (world.workspace_id !== workspaceId) throw new Error("life_world_workspace_mismatch");
        await client.query("COMMIT");
        return world.id;
      }
      const id = randomUUID();
      await client.query("INSERT INTO life_world(id,workspace_id,tick_ms) VALUES($1,$2,$3)", [id, workspaceId, LIFE_TICK_MS]);
      const agents = seedResidents();
      for (const a of agents) await client.query(`INSERT INTO life_agent(world_id,id,name,x,y,energy,fullness,social,personality,goal) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, a.id, a.name, a.position.x, a.position.y, a.energy, a.fullness, a.social, a.personality, a.goal]);
      for (const r of seedResources(agents)) await client.query("INSERT INTO life_resource(world_id,owner,kind,amount) VALUES($1,$2,$3,$4)", [id, r.owner, r.kind, r.amount]);
      await client.query("INSERT INTO life_event(world_id,id,tick,kind,payload) VALUES($1,$2,0,'world_created',$3)", [id, randomUUID(), { residents: agents.length, rulesVersion: 1 }]);
      await client.query("COMMIT");
      return id;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  async tick(worldId: string): Promise<number | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='15s'");
      const row = await client.query("SELECT tick::float8 AS tick FROM life_world WHERE id=$1 FOR UPDATE", [worldId]);
      if (!row.rowCount) throw new Error("life_world_missing");
      // clock_timestamp is evaluated in a separate statement after lock acquisition.
      const due = await client.query("SELECT next_tick_at <= clock_timestamp() AS due FROM life_world WHERE id=$1", [worldId]);
      if (!due.rows[0].due) { await client.query("COMMIT"); return null; }
      const state = await load(client, worldId, row.rows[0].tick);
      const result = advanceTick(state, randomUUID);
      for (const action of result.completed) {
        const updated = await client.query("UPDATE life_action SET status=$3,completed_tick=$4 WHERE world_id=$1 AND id=$2 AND status='running'", [worldId, action.id, action.status, result.state.tick]);
        if (updated.rowCount !== 1) throw new Error("action_already_settled");
      }
      for (const a of result.state.agents) await client.query("UPDATE life_agent SET x=$3,y=$4,energy=$5,fullness=$6,social=$7 WHERE world_id=$1 AND id=$2", [worldId, a.id, a.position.x, a.position.y, a.energy, a.fullness, a.social]);
      for (const r of result.state.resources) await client.query("UPDATE life_resource SET amount=$4 WHERE world_id=$1 AND owner=$2 AND kind=$3", [worldId, r.owner, r.kind, r.amount]);
      for (const a of result.started) await client.query("INSERT INTO life_action(world_id,id,agent_id,intent,reason,started_tick,due_tick,status) VALUES($1,$2,$3,$4,$5,$6,$7,'running')", [worldId, a.id, a.agentId, a.intent, a.reason, a.startedTick, a.dueTick]);
      for (const e of result.events) await client.query("INSERT INTO life_event(world_id,id,tick,action_id,agent_id,kind,payload) VALUES($1,$2,$3,$4,$5,$6,$7)", [worldId, randomUUID(), result.state.tick, e.actionId, e.agentId, e.kind, e.payload]);
      await client.query("UPDATE life_world SET tick=$2,updated_at=clock_timestamp(),next_tick_at=clock_timestamp()+tick_ms*interval '1 millisecond' WHERE id=$1", [worldId, result.state.tick]);
      await client.query("COMMIT");
      return result.state.tick;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }
}

import { nextTownStep } from "./navigation";
import type { Agent, Proposal } from "./schema";
import type { Simulation } from "./engine";
import { LIFE_MAP, balance, samePosition } from "./rules";
import type { Activity, Memory, PlaceId, Profile, Town } from "./town-schema";

export const TOWN_PLACES = {
  home: { x: 2, y: 2, opens: 0, closes: 1440 }, farm: { ...LIFE_MAP.farm, opens: 360, closes: 1080 },
  forest: { ...LIFE_MAP.forest, opens: 360, closes: 1140 }, square: { ...LIFE_MAP.square, opens: 0, closes: 1440 },
  cafe: { x: 6, y: 5, opens: 420, closes: 1320 }, library: { x: 6, y: 2, opens: 480, closes: 1260 },
  shop: { x: 10, y: 4, opens: 480, closes: 1200 },
} as const;
export const TOWN_HOMES = [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 1, y: 4 }, { x: 2, y: 7 }];
const occupations = ["librarian", "farmer", "artist", "builder", "baker", "merchant"] as const;
const interests = ["reading", "nature", "art", "community", "cooking"] as const;
export function profileFor(agent: Agent, index: number): Profile {
  return { residentId: agent.id, occupation: occupations[index % occupations.length]!, background: "", interests: [interests[index % interests.length]!], home: index % 4 };
}
export function newTown(agents: Agent[]): Town {
  return { version: 1, revision: 0, profiles: agents.map(profileFor), memories: [], relationships: [], plans: [], activities: [], conversations: [], jobs: [],
    model: { mode: "rules", state: "rules", residentLimit: 5, dailyLimit: 100, budgetDay: "", calls: 0 } };
}
export function placePosition(place: PlaceId, profile: Profile) {
  return place === "home" ? TOWN_HOMES[profile.home]! : TOWN_PLACES[place];
}
export function placeOpen(place: PlaceId, tick: number) {
  const time = tick % 1440, site = TOWN_PLACES[place];
  return time >= site.opens && time < site.closes;
}
export function remember(town: Town, memory: Memory) {
  if (town.memories.some(m => m.residentId === memory.residentId && m.kind === memory.kind && m.sourceId === memory.sourceId)) return;
  town.memories.push(memory);
  const owned = town.memories.filter(m => m.residentId === memory.residentId);
  if (owned.length > 20) {
    const removable = owned.filter(m => m.kind !== "invitation" || !town.activities.some(a => a.id === m.sourceId && a.status !== "completed"));
    removable.sort((a, b) => a.importance - b.importance || a.tick - b.tick);
    const remove = removable[0] ?? owned[0]!;
    town.memories = town.memories.filter(m => m.id !== remove.id);
  }
}
export function retrieveMemories(town: Town, residentId: string, tick: number, otherId?: string, limit = 12) {
  return town.memories.filter(m => m.residentId === residentId).map(m => ({ memory: m,
    score: m.importance + Math.exp(-Math.max(0, tick - m.tick) / 1440) * 4 + (otherId && m.otherId === otherId ? 6 : 0),
  })).sort((a, b) => b.score - a.score || b.memory.tick - a.memory.tick).slice(0, limit).map(m => m.memory);
}
export function knowsActivity(town: Town, residentId: string, activityId: string) {
  return town.activities.some(a => a.id === activityId && a.organizerId === residentId)
    || town.memories.some(m => m.residentId === residentId && m.kind === "invitation" && m.sourceId === activityId);
}
export function wantsActivity(town: Town, agent: Agent, activity: Activity) {
  if (!knowsActivity(town, agent.id, activity.id)) return false;
  const profile = town.profiles.find(p => p.residentId === agent.id)!;
  return activity.organizerId === agent.id || profile.interests.includes(activity.interest)
    || town.relationships.some(r => r.residentId === agent.id && r.otherId === activity.organizerId && r.familiarity >= 20);
}
function approach(agent: Agent, to: { x: number; y: number }, reason: string): Proposal {
  return { intent: { kind: "MOVE", to: nextTownStep(agent.position, to) }, reason };
}
export function townProposal(state: Simulation, agent: Agent): Proposal | undefined {
  const town = state.town;
  if (!town || agent.energy < 30 || agent.fullness < 55 || balance(state.resources, agent.id, "food") < 2) return;
  const profile = town.profiles.find(p => p.residentId === agent.id)!;
  if (town.jobs.some(j => (j.residentId === agent.id || j.otherId === agent.id) && j.kind !== "plan" && ["queued", "running"].includes(j.status) && state.tick - j.createdTick < 30)) {
    return { intent: { kind: "REST" }, reason: "conversation_pending" };
  }
  const activity = town.activities.find(a => (a.status === "scheduled" || a.status === "active") && state.tick >= a.startTick - 20 && state.tick < a.endTick && wantsActivity(town, agent, a));
  if (activity) {
    const destination = placePosition(activity.place, profile);
    if (!samePosition(agent.position, destination)) return approach(agent, destination, "reach_activity");
    const partner = state.agents.find(other => other.id !== agent.id && samePosition(agent.position, other.position) && !recentMeeting(town, agent.id, other.id, state.tick));
    return partner ? { intent: { kind: "TALK", targetId: partner.id }, reason: "share_activity" } : { intent: { kind: "REST" }, reason: "attending_activity" };
  }
  const nearby = state.agents.filter(other => other.id !== agent.id && samePosition(agent.position, other.position));
  const hasNews = town.activities.some(a => a.status === "scheduled" && state.tick < a.startTick && knowsActivity(town, agent.id, a.id));
  const partner = nearby.find(other => !recentMeeting(town, agent.id, other.id, state.tick) && (hasNews || agent.social < 75));
  if (partner) return { intent: { kind: "TALK", targetId: partner.id }, reason: hasNews ? "share_activity" : "meet_neighbors" };
  const plan = town.plans.find(p => p.residentId === agent.id && p.day === Math.floor(state.tick / 1440));
  const slot = plan?.slots.find(s => state.tick % 1440 >= s.start && state.tick % 1440 < s.end);
  if (!slot || !placeOpen(slot.place, state.tick)) return;
  const destination = placePosition(slot.place, profile);
  if (!samePosition(agent.position, destination)) return approach(agent, destination, `daily_${slot.purpose}`);
  if (slot.purpose === "work" && slot.place === "farm" && balance(state.resources, agent.id, "food") < 8) return;
  if (slot.purpose === "work" && slot.place === "forest" && agent.energy >= 8 && balance(state.resources, "forest", "wood") >= 3) return { intent: { kind: "GATHER_WOOD" }, reason: "daily_work" };
  return { intent: { kind: "REST" }, reason: `daily_${slot.purpose}` };
}
function recentMeeting(town: Town, id: string, other: string, tick: number) {
  return town.relationships.some(r => r.residentId === id && r.otherId === other && tick - r.lastTick < 20);
}
export function dailyPlan(profile: Profile, day: number) {
  const work: PlaceId = profile.occupation === "farmer" ? "farm" : profile.occupation === "builder" ? "forest" : profile.occupation === "librarian" ? "library" : profile.occupation === "merchant" ? "shop" : "cafe";
  return { residentId: profile.residentId, day, source: "rules" as const, slots: [
    { start: 0, end: 420, place: "home" as const, purpose: "sleep" as const, reason: "" },
    { start: 420, end: 480, place: "cafe" as const, purpose: "socialize" as const, reason: "" },
    { start: 480, end: 720, place: work, purpose: "work" as const, reason: "" },
    { start: 720, end: 840, place: "square" as const, purpose: "socialize" as const, reason: "" },
    { start: 840, end: 1080, place: work, purpose: "work" as const, reason: "" },
    { start: 1080, end: 1260, place: profile.interests.includes("reading") ? "library" as const : "cafe" as const, purpose: profile.interests.includes("reading") ? "read" as const : "socialize" as const, reason: "" },
    { start: 1260, end: 1440, place: "home" as const, purpose: "rest" as const, reason: "" },
  ] };
}
export function beginTownTick(state: Simulation, nextId: () => string) {
  const town = state.town ??= newTown(state.agents), day = Math.floor(state.tick / 1440);
  town.jobs.forEach(j => { if (["queued", "running"].includes(j.status) && state.tick - j.createdTick > 120) { j.status = "error"; j.error = "expired"; const activity = town.activities.find(a => a.id === j.activityId); if (activity) { activity.status = "failed"; activity.decision = "model_failed"; } } });
  for (const profile of town.profiles) {
    if (!town.plans.some(p => p.residentId === profile.residentId && p.day === day)) {
      town.plans = town.plans.filter(p => p.residentId !== profile.residentId);
      town.plans.push(dailyPlan(profile, day));
    }
    const modelResident = town.profiles.indexOf(profile) < town.model.residentLimit;
    if (town.model.mode === "llm" && ["ready", "error"].includes(town.model.state) && modelResident && !town.jobs.some(j => j.kind === "plan" && j.residentId === profile.residentId && j.day === day)) {
      queueJob(town, { id: nextId(), residentId: profile.residentId, otherId: null, activityId: null, kind: "plan", text: "", day, createdTick: state.tick, status: "queued", lease: "", leaseUntil: 0, error: "" });
    }
  }
}
export function queueJob(town: Town, job: Town["jobs"][number]) {
  if (town.jobs.length >= 64) {
    const index = town.jobs.findIndex(j => j.status === "done" || j.status === "error");
    if (index < 0) return false;
    town.jobs.splice(index, 1);
  }
  town.jobs.push(job); return true;
}
function relationship(town: Town, id: string, other: string, tick: number) {
  let row = town.relationships.find(r => r.residentId === id && r.otherId === other);
  if (!row) { row = { residentId: id, otherId: other, familiarity: 0, trust: 0, lastTick: tick }; town.relationships.push(row); }
  row.familiarity = Math.min(100, row.familiarity + 5); row.trust = Math.min(100, row.trust + 1); row.lastTick = tick;
  if (town.relationships.length > 720) town.relationships.sort((a, b) => b.lastTick - a.lastTick).splice(720);
}
export function settleTownTalk(state: Simulation, from: Agent, to: Agent, nextId: () => string) {
  const town = state.town!;
  relationship(town, from.id, to.id, state.tick); relationship(town, to.id, from.id, state.tick);
  if (town.model.mode === "llm" && ["ready", "error"].includes(town.model.state) && town.profiles.findIndex(p => p.residentId === from.id) < town.model.residentLimit) {
    queueJob(town, { id: nextId(), residentId: from.id, otherId: to.id, activityId: null, kind: "dialogue", text: "", day: Math.floor(state.tick / 1440), createdTick: state.tick, status: "queued", lease: "", leaseUntil: 0, error: "" });
    return;
  }
  const news = town.activities.filter(a => a.status === "scheduled" && knowsActivity(town, from.id, a.id) && !knowsActivity(town, to.id, a.id)).slice(0, 3);
  const id = nextId();
  // Rules-mode lines are factual records, never presented as model-generated speech.
  town.conversations.push({ id, tick: state.tick, residentId: from.id, otherId: to.id, source: "rules", lines: [], activityIds: news.map(a => a.id) });
  const conversation = town.conversations.at(-1)!;
  conversation.lines.push({ speakerId: from.id, text: news.length ? news.map(a => a.title).join(" · ") : "" });
  for (const agent of [from, to]) remember(town, { id: nextId(), residentId: agent.id, tick: state.tick, kind: "meeting", sourceId: id, otherId: agent.id === from.id ? to.id : from.id, text: "", importance: 3, evidence: [] });
  for (const activity of news) remember(town, { id: nextId(), residentId: to.id, tick: state.tick, kind: "invitation", sourceId: activity.id, otherId: from.id, text: activity.title, importance: 8, evidence: [] });
  town.conversations = town.conversations.slice(-80);
}
export function finishTownTick(state: Simulation, nextId: () => string) {
  const town = state.town!;
  for (const activity of town.activities) {
    if (activity.status === "proposed" || activity.status === "declined" || activity.status === "failed") continue;
    activity.status = state.tick < activity.startTick ? "scheduled" : state.tick < activity.endTick ? "active" : "completed";
    if (activity.status !== "active") continue;
    for (const agent of state.agents) {
      const profile = town.profiles.find(p => p.residentId === agent.id)!;
      if (!activity.attendees.includes(agent.id) && wantsActivity(town, agent, activity) && samePosition(agent.position, placePosition(activity.place, profile))) {
        activity.attendees.push(agent.id);
        remember(town, { id: nextId(), residentId: agent.id, tick: state.tick, kind: "attended", sourceId: activity.id, otherId: activity.organizerId, text: activity.title, importance: 9, evidence: [] });
      }
    }
  }
}

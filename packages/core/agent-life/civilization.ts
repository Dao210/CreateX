import type { Simulation } from "./engine";
import type { Agent, ActionIntent, Proposal } from "./schema";
import { balance, samePosition } from "./rules";
import { nextTownStep } from "./navigation";
import {
  emptyCivilization, STORAGE_DESIGNS,
  type Civilization, type CivicProject, type CivicNews, type StorageVariant,
} from "./civilization-schema";

const SITES = [{ x: 8, y: 5 }, { x: 4, y: 5 }, { x: 6, y: 6 }];
const DAY = 1440;

export function civicState(state: Simulation): Civilization {
  const town = state.town;
  if (!town) throw new Error("town_required");
  return town.civilization ??= emptyCivilization();
}

function news(state: Simulation, nextId: () => string, project: CivicProject, residentId: string, kind: CivicNews["kind"], options: Partial<Pick<CivicNews, "amount" | "otherId" | "sourceId" | "evidence" | "rule">> = {}) {
  const civilization = civicState(state);
  const row: CivicNews = {
    id: nextId(), projectId: project.id, residentId, kind, tick: state.tick,
    amount: 0, otherId: null, sourceId: null, evidence: [], rule: null, ...options,
  };
  civilization.news.push(row);
  return row;
}

function member(project: CivicProject, residentId: string) {
  return project.members.find(row => row.residentId === residentId);
}

function values(state: Simulation, agent: Agent) {
  const profile = state.town!.profiles.find(row => row.residentId === agent.id);
  const communal = profile?.interests.includes("community") || profile?.interests.includes("cooking");
  return {
    cooperates: !!communal || agent.personality.sociability >= 50,
    equal: !!communal || agent.personality.sociability >= agent.personality.diligence,
    builder: profile?.occupation === "builder" || agent.personality.diligence >= 65,
  };
}

function join(state: Simulation, project: CivicProject, agent: Agent, nextId: () => string) {
  if (member(project, agent.id)) return;
  project.declinedBy = project.declinedBy.filter(id => id !== agent.id);
  project.members.push({
    residentId: agent.id, joinedTick: state.tick, wood: 0, labor: 0, deposited: 0,
    withdrawn: 0, withdrawalDay: Math.floor(state.tick / DAY), todayWithdrawn: 0, lastMaintenance: 0,
  });
  if (!project.knownBy.includes(agent.id)) project.knownBy.push(agent.id);
  const evidence = civicState(state).news.filter(row => row.projectId === project.id && row.residentId === agent.id).slice(-2).map(row => row.id);
  news(state, nextId, project, agent.id, "joined", { evidence });
}

function createProject(state: Simulation, agent: Agent, variant: StorageVariant, prototypeId: string, nextId: () => string) {
  const civilization = civicState(state);
  const position = SITES[civilization.projects.length];
  if (!position) return;
  const equal = values(state, agent).equal;
  const project: CivicProject = {
    id: nextId(), organizerId: agent.id, prototypeId, variant, position: { ...position },
    status: "proposed", createdTick: state.tick, completedTick: null, knownBy: [agent.id], declinedBy: [], members: [],
    wood: 0, labor: 0, food: 0, condition: 100,
    rule: { revision: 1, distribution: equal ? "equal" : "contribution", maintenance: "volunteer", enactedTick: state.tick, supporters: [agent.id] },
    lastReviewTick: state.tick, lastGatheringDay: -1, gatheringIds: [], gatheringsCompleted: 0,
  };
  civilization.projects.push(project);
  news(state, nextId, project, agent.id, "proposed", {
    amount: balance(state.resources, agent.id, "food"), rule: structuredClone(project.rule),
    evidence: state.town!.memories.filter(row => row.residentId === agent.id).slice(-3).map(row => row.id),
  });
  join(state, project, agent, nextId);
}

export function shareCivicKnowledge(state: Simulation, from: Agent, to: Agent, sourceId: string, nextId: () => string) {
  const civilization = civicState(state);
  for (const project of civilization.projects) {
    if (!project.knownBy.includes(from.id) || project.knownBy.includes(to.id)) continue;
    project.knownBy.push(to.id);
    news(state, nextId, project, to.id, "discovered", { otherId: from.id, sourceId });
  }
  for (const debate of civilization.debates) {
    if (debate.status === "open" && debate.knownBy.includes(from.id) && !debate.knownBy.includes(to.id)) debate.knownBy.push(to.id);
  }
}

export function beginCivilizationTick(state: Simulation, nextId: () => string) {
  const civilization = civicState(state);
  const minute = state.tick % DAY;
  const awake = minute >= 420 && minute < 1200;

  for (const suggestion of civilization.suggestions) {
    if (suggestion.status !== "pending") continue;
    const agent = state.agents.find(row => row.id === suggestion.residentId);
    const prototype = civilization.prototypes.find(row => row.id === suggestion.prototypeId);
    if (!agent || !prototype) throw new Error("invalid_prototype_suggestion");
    if (!awake || agent.energy < 30 || agent.fullness < 50) continue;
    const accepted = values(state, agent).cooperates && civilization.projects.length < SITES.length;
    suggestion.status = accepted ? "accepted" : "declined";
    if (accepted) createProject(state, agent, prototype.variant, prototype.id, nextId);
  }

  // A resident notices their own surplus and a shared workplace through local experience.
  if (awake && civilization.projects.length === 0) {
    const organizer = state.agents.find(agent => {
      const familiar = state.town!.relationships.some(row => row.residentId === agent.id && row.familiarity >= 5);
      const atWorkplace = samePosition(agent.position, { x: 9, y: 2 }) || samePosition(agent.position, { x: 3, y: 6 });
      return atWorkplace && familiar && values(state, agent).cooperates && balance(state.resources, agent.id, "food") >= 4 && agent.energy >= 45;
    });
    if (organizer) {
      const prototype = { id: nextId(), authorId: null, name: "", variant: "light" as const, createdTick: state.tick };
      civilization.prototypes.push(prototype);
      createProject(state, organizer, prototype.variant, prototype.id, nextId);
    }
  }

  for (const project of civilization.projects) {
    for (const agent of state.agents) {
      const distance = Math.abs(agent.position.x - project.position.x) + Math.abs(agent.position.y - project.position.y);
      if (distance <= 1 && !project.knownBy.includes(agent.id)) {
        project.knownBy.push(agent.id);
        news(state, nextId, project, agent.id, "discovered");
      }
      if (!awake || !project.knownBy.includes(agent.id) || member(project, agent.id)) continue;
      const approach = values(state, agent);
      if (approach.cooperates && agent.energy >= 35 && agent.fullness >= 45 && distance <= 1) join(state, project, agent, nextId);
      else if (!approach.cooperates && distance <= 1 && !project.declinedBy.includes(agent.id)) {
        project.declinedBy.push(agent.id);
        news(state, nextId, project, agent.id, "declined");
      }
    }
    if (project.status === "proposed" && project.members.length >= 2) {
      project.status = "gathering";
      project.rule.supporters = project.members.map(row => row.residentId);
    }
    if (project.status === "active" && state.tick % (60 * STORAGE_DESIGNS[project.variant].shelter) === 0) {
      project.condition = Math.max(0, project.condition - 1);
      if (project.condition === 0) project.status = "paused";
    }
    reviewRules(state, project, nextId);
    scheduleGathering(state, project, nextId);
  }
  resolveDebates(state, nextId);
}

function reviewRules(state: Simulation, project: CivicProject, nextId: () => string) {
  const civilization = civicState(state);
  if (project.status !== "active" || state.tick - project.lastReviewTick < DAY || project.members.length < 3) return;
  if (civilization.debates.some(row => row.projectId === project.id && row.status === "open")) return;
  const reviewer = project.members.find(row => {
    const agent = state.agents.find(person => person.id === row.residentId)!;
    return samePosition(agent.position, project.position) && values(state, agent).equal !== (project.rule.distribution === "equal");
  });
  if (!reviewer) return;
  if (civilization.debates.length >= 24) {
    const closed = civilization.debates.findIndex(row => row.status !== "open");
    if (closed < 0) return;
    civilization.debates.splice(closed, 1);
  }
  const debate = {
    id: nextId(), projectId: project.id, proposerId: reviewer.residentId,
    distribution: project.rule.distribution === "equal" ? "contribution" as const : "equal" as const,
    maintenance: project.rule.maintenance === "volunteer" ? "rotation" as const : "volunteer" as const,
    createdTick: state.tick, expiresTick: state.tick + DAY, status: "open" as const,
    knownBy: [reviewer.residentId], votes: [],
  };
  civilization.debates.push(debate);
  project.lastReviewTick = state.tick;
  news(state, nextId, project, reviewer.residentId, "rule_proposed", { sourceId: debate.id });
}

function resolveDebates(state: Simulation, nextId: () => string) {
  const civilization = civicState(state);
  for (const debate of civilization.debates) {
    if (debate.status !== "open") continue;
    const project = civilization.projects.find(row => row.id === debate.projectId)!;
    for (const row of project.members) {
      const agent = state.agents.find(person => person.id === row.residentId)!;
      if (samePosition(agent.position, project.position) && !debate.knownBy.includes(agent.id)) debate.knownBy.push(agent.id);
      if (!debate.knownBy.includes(agent.id) || debate.votes.some(vote => vote.residentId === agent.id)) continue;
      const approve = values(state, agent).equal === (debate.distribution === "equal");
      debate.votes.push({ residentId: agent.id, approve, tick: state.tick });
      news(state, nextId, project, agent.id, "rule_voted", { amount: approve ? 1 : 0, sourceId: debate.id });
    }
    const supporters = debate.votes.filter(row => row.approve).map(row => row.residentId);
    if (supporters.length >= Math.ceil(project.members.length * 2 / 3)) {
      debate.status = "adopted";
      project.rule = { revision: project.rule.revision + 1, distribution: debate.distribution, maintenance: debate.maintenance, enactedTick: state.tick, supporters };
      news(state, nextId, project, debate.proposerId, "rule_adopted", { amount: project.rule.revision, sourceId: debate.id, rule: structuredClone(project.rule) });
    } else if (state.tick >= debate.expiresTick || debate.votes.length === project.members.length) {
      debate.status = "rejected";
      news(state, nextId, project, debate.proposerId, "rule_rejected", { sourceId: debate.id });
    }
  }
}

function scheduleGathering(state: Simulation, project: CivicProject, nextId: () => string) {
  const day = Math.floor(state.tick / DAY);
  if (project.status !== "active" || project.members.length < 3 || project.lastGatheringDay >= day || state.tick % DAY < 480 || state.tick % DAY > 1000) return;
  if (state.town!.activities.length >= 30) {
    const old = state.town!.activities.findIndex(activity => ["completed", "declined", "failed"].includes(activity.status)
      && !state.town!.jobs.some(job => job.activityId === activity.id));
    if (old < 0) return;
    state.town!.activities.splice(old, 1);
  }
  const organizer = project.members.find(row => {
    const profile = state.town!.profiles.find(p => p.residentId === row.residentId);
    return profile?.interests.includes("community") || profile?.interests.includes("cooking");
  });
  if (!organizer) return;
  const startTick = day * DAY + 1110;
  const id = nextId();
  state.town!.activities.push({ id, organizerId: organizer.residentId, title: "邻里共食会", interest: "community", place: "square", startTick, endTick: startTick + 60, status: "scheduled", decision: "shared_interest", attendees: [] });
  project.gatheringIds = [...project.gatheringIds.slice(-29), id];
  project.lastGatheringDay = day;
  news(state, nextId, project, organizer.residentId, "gathering", { sourceId: id });
}

function toward(agent: Agent, project: CivicProject, reason: string): Proposal {
  return { intent: { kind: "MOVE", to: nextTownStep(agent.position, project.position) }, reason };
}

export function civilizationProposal(state: Simulation, agent: Agent): Proposal | undefined {
  const civilization = civicState(state);
  const minute = state.tick % DAY;
  // Shared reserves remain a survival option outside the normal collaboration schedule.
  if (agent.energy >= 8 && agent.fullness < 65 && balance(state.resources, agent.id, "food") < 1) {
    const reserve = civilization.projects.find(project => project.knownBy.includes(agent.id) && canWithdraw(state, project, agent));
    if (reserve) return samePosition(agent.position, reserve.position)
      ? { intent: { kind: "WITHDRAW_FOOD", projectId: reserve.id }, reason: "shared_food" }
      : toward(agent, reserve, "shared_food");
  }
  if (minute < 420 || minute >= 1200 || agent.energy < 30 || agent.fullness < 50) return;
  const food = balance(state.resources, agent.id, "food");
  for (const project of civilization.projects) {
    if (!project.knownBy.includes(agent.id)) continue;
    const owned = member(project, agent.id);
    if (!owned) {
      if (values(state, agent).cooperates && food >= 2 && project.status !== "abandoned" && !samePosition(agent.position, project.position)) return toward(agent, project, "consider_cooperation");
      continue;
    }
    const atSite = samePosition(agent.position, project.position);
    const design = STORAGE_DESIGNS[project.variant];
    const propose = (kind: "DELIVER_WOOD" | "BUILD" | "STORE_FOOD" | "WITHDRAW_FOOD" | "MAINTAIN", reason: string): Proposal =>
      atSite ? { intent: { kind, projectId: project.id }, reason } : toward(agent, project, reason);
    if ((project.status === "active" || project.status === "paused") && project.condition < 60 && balance(state.resources, agent.id, "wood") >= 1) {
      const assigned = project.rule.maintenance !== "rotation" || project.members[Math.floor(state.tick / DAY) % project.members.length]?.residentId === agent.id;
      if (assigned) return propose("MAINTAIN", "maintain_shared_store");
    }
    if (project.status === "active") {
      if (food < 2 && canWithdraw(state, project, agent)) return propose("WITHDRAW_FOOD", "shared_food");
      if (food >= 5 && project.food < design.capacity) return propose("STORE_FOOD", "share_surplus");
      continue;
    }
    if (!values(state, agent).cooperates || food < 2 || !["gathering", "building"].includes(project.status)) continue;
    if (project.wood < design.wood) {
      if (balance(state.resources, agent.id, "wood") >= 3) return propose("DELIVER_WOOD", "deliver_materials");
      const forest = { x: 9, y: 6 };
      return samePosition(agent.position, forest)
        ? { intent: { kind: "GATHER_WOOD" }, reason: "gather_shared_materials" }
        : { intent: { kind: "MOVE", to: nextTownStep(agent.position, forest) }, reason: "gather_shared_materials" };
    }
    if (project.labor < design.labor) return propose("BUILD", "build_shared_store");
  }
  return;
}

export function canWithdraw(state: Simulation, project: CivicProject, agent: Agent) {
  const owned = member(project, agent.id);
  if (!owned || project.status !== "active" || project.food < 1) return false;
  const today = owned.withdrawalDay === Math.floor(state.tick / DAY) ? owned.todayWithdrawn : 0;
  const quota = project.rule.distribution === "equal" ? 5 : 2 + Math.min(4, Math.floor(owned.labor / 6) + Math.floor(owned.wood / 3));
  return today < quota && balance(state.resources, agent.id, "food") < 8;
}

export function civicActionFeasible(state: Simulation, agent: Agent, intent: ActionIntent) {
  if (!("projectId" in intent)) return false;
  const project = civicState(state).projects.find(row => row.id === intent.projectId);
  if (!project || !member(project, agent.id) || !samePosition(agent.position, project.position) || agent.energy < 8) return false;
  const design = STORAGE_DESIGNS[project.variant];
  switch (intent.kind) {
    case "DELIVER_WOOD": return ["gathering", "building"].includes(project.status) && project.wood < design.wood && balance(state.resources, agent.id, "wood") >= 3;
    case "BUILD": return ["gathering", "building"].includes(project.status) && project.wood >= design.wood && project.labor < design.labor;
    case "STORE_FOOD": return project.status === "active" && project.food < design.capacity && balance(state.resources, agent.id, "food") >= 4;
    case "WITHDRAW_FOOD": return canWithdraw(state, project, agent);
    case "MAINTAIN": return ["active", "paused"].includes(project.status) && project.condition < 100 && balance(state.resources, agent.id, "wood") >= 1;
    default: return false;
  }
}

export function settleCivicAction(state: Simulation, agent: Agent, intent: ActionIntent, sourceId: string, nextId: () => string) {
  if (!("projectId" in intent) || !civicActionFeasible(state, agent, intent)) throw new Error("invalid_civic_action");
  const project = civicState(state).projects.find(row => row.id === intent.projectId)!;
  const owned = member(project, agent.id)!;
  const design = STORAGE_DESIGNS[project.variant];
  const inventory = (kind: "wood" | "food") => state.resources.find(row => row.owner === agent.id && row.kind === kind)!;
  switch (intent.kind) {
    case "DELIVER_WOOD": {
      const amount = Math.min(3, design.wood - project.wood);
      inventory("wood").amount -= amount;
      project.wood += amount;
      owned.wood += amount;
      news(state, nextId, project, agent.id, "delivered", { amount, sourceId });
      break;
    }
    case "BUILD": {
      const previous = project.labor;
      project.labor++;
      owned.labor++;
      project.status = project.labor >= design.labor ? "active" : "building";
      if (project.status === "active") {
        project.completedTick = state.tick;
        news(state, nextId, project, agent.id, "completed", { amount: design.capacity, sourceId });
      } else if (Math.floor(project.labor * 4 / design.labor) !== Math.floor(previous * 4 / design.labor)) {
        news(state, nextId, project, agent.id, "construction", { amount: Math.floor(project.labor * 100 / design.labor), sourceId });
      }
      break;
    }
    case "STORE_FOOD": {
      const amount = Math.min(2, design.capacity - project.food, inventory("food").amount - 2);
      inventory("food").amount -= amount;
      project.food += amount;
      owned.deposited += amount;
      news(state, nextId, project, agent.id, "deposited", { amount, sourceId });
      break;
    }
    case "WITHDRAW_FOOD": {
      const amount = 1;
      inventory("food").amount += amount;
      project.food -= amount;
      if (owned.withdrawalDay !== Math.floor(state.tick / DAY)) {
        owned.withdrawalDay = Math.floor(state.tick / DAY);
        owned.todayWithdrawn = 0;
      }
      owned.todayWithdrawn += amount;
      owned.withdrawn += amount;
      news(state, nextId, project, agent.id, "withdrawn", { amount, sourceId });
      break;
    }
    case "MAINTAIN":
      inventory("wood").amount--;
      project.condition = Math.min(100, project.condition + 25);
      project.status = "active";
      owned.lastMaintenance = state.tick;
      news(state, nextId, project, agent.id, "maintenance", { amount: 25, sourceId });
      break;
  }
  agent.energy = Math.max(0, agent.energy - 3);
}

export function finishCivilizationTick(state: Simulation, previous: Simulation, nextId: () => string) {
  for (const project of civicState(state).projects) {
    const completed = project.gatheringIds.filter(id => state.town!.activities.some(activity => activity.id === id && activity.status === "completed" && activity.attendees.length >= 3));
    const newlyCompleted = completed.filter(id => previous.town?.activities.find(activity => activity.id === id)?.status !== "completed");
    if (newlyCompleted.length) {
      const before = project.gatheringsCompleted;
      project.gatheringsCompleted += newlyCompleted.length;
      if (before < 3 && project.gatheringsCompleted >= 3) {
        news(state, nextId, project, project.organizerId, "tradition", { amount: 3, evidence: completed.slice(-3) });
      }
    }
  }
}

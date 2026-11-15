// Adapted from 夺旗Agent游戏 v4.0 by 黄仲生. See SOURCE.md.
const FORMAT_VERSION = "1.0";
const GAME_VERSION = "12-rts-1.0";
const TICK_SECONDS = 0.25;
const TICK_MS = TICK_SECONDS * 1000;
const MAP_W = 100;
const MAP_H = 50;
const BASE_W = 15;
const CAPTURE_SECONDS = 3;
const MATCH_TIME_LIMIT_SECONDS = 8 * 60;
const DEFAULT_MATCH_SEED = 12027;
const ARENA_SEEDS = [12027, 34891, 76103];
const ARENA_SPEED_OPTIONS = new Set([10, 30, 100, 300]);
const DEFAULT_ARENA_SPEED = 30;
const BATTLE_SCALE_STEP = 0.1;
const MIN_BATTLE_SCALE = 0.6;
const MAX_BATTLE_SCALE = 1.5;
const MIN_WORKSPACE_HEIGHT = 590;
const UNIT_VISUAL_SCALE = 2;
const ARROW_DURATION_MS = 180;
const MELEE_SWING_DURATION_MS = 220;
const DAMAGE_FLOAT_DURATION_MS = 700;
const TEAM_LABEL = { red: "红方", blue: "蓝方" };
const UNIT_LABEL = {
  heavy_infantry: "重甲步兵",
  cavalry: "骑兵",
  archer: "弓箭手",
};
const FLAG_STATE_LABEL = {
  AT_HOME: "在家",
  CARRIED: "被携带",
  DROPPED: "掉落",
};
const ENHANCEMENT_LABEL = {
  standard: "标准模式",
  cavalry: "强化骑兵",
  heavy_infantry: "强化步兵",
  archer: "强化弓箭手",
};
const UNIT_STATS = {
  heavy_infantry: {
    maxHp: 300,
    damage: 20,
    speed: 2,
    range: 2,
    moveAttack: true,
  },
  cavalry: { maxHp: 100, damage: 20, speed: 5, range: 2, moveAttack: true },
  archer: { maxHp: 50, damage: 30, speed: 2, range: 5, moveAttack: false },
};

const BASE_SPAWN_AREAS = {
  red: { minX: 1, maxX: 14, minY: 3, maxY: 47 },
  blue: { minX: 85, maxX: 98, minY: 3, maxY: 47 },
};

const FLAG_ANCHORS = {
  red: { x: 7, y: 25 },
  blue: { x: 92, y: 25 },
};
const ROUTE_UPPER_LANE_20 = "UPPER_LANE_20";

function makeBaselineStrategy(teamId, teamName, side) {
  void side;
  const mirroredGuard = "距己方旗位最近敌人";
  return {
    format_version: FORMAT_VERSION,
    game_version: GAME_VERSION,
    enhancement_mode: "standard",
    team: { team_id: teamId, team_name: teamName },
    strategies: {
      heavy_infantry: {
        rules: [
          rule(
            "heavy_stop_carrier",
            "拦截敌方持旗者",
            100,
            cond("enemy.has_flag_carrier", "==", true),
            moveToward("敌方持旗者"),
            attack("ATTACK_ENEMY_FLAG_CARRIER"),
            special("NONE"),
          ),
          rule(
            "heavy_return_flag",
            "归还己方掉落旗",
            90,
            cond("own_flag.state", "==", "DROPPED"),
            moveToward("己方旗帜当前位置"),
            attack("ATTACK_NEAREST_ENEMY"),
            special("RETURN_OWN_DROPPED_FLAG"),
          ),
          rule(
            "heavy_guard",
            "守住己方旗区",
            45,
            always(),
            { type: "GUARD", target: "己方旗位", radius: 4 },
            attack("ATTACK_NEAREST_ENEMY"),
            special("NONE"),
          ),
        ],
      },
      cavalry: {
        rules: [
          rule(
            "cav_deliver",
            "持旗后立刻回家",
            100,
            cond("self.is_flag_carrier", "==", true),
            { type: "RETURN_TO_OWN_FLAG" },
            attack("ATTACK_NEAREST_ENEMY"),
            special("DELIVER_FLAG"),
          ),
          rule(
            "cav_chase_carrier",
            "追击敌方持旗者",
            95,
            cond("enemy.has_flag_carrier", "==", true),
            moveToward("敌方持旗者"),
            attack("ATTACK_ENEMY_FLAG_CARRIER"),
            special("NONE"),
          ),
          rule(
            "cav_pick_dropped",
            "拾取掉落敌旗",
            85,
            cond("enemy_flag.state", "==", "DROPPED"),
            { type: "GO_TO_DROPPED_FLAG", target: "敌方旗帜当前位置" },
            attack("ATTACK_NEAREST_ENEMY"),
            special("PICK_UP_ENEMY_DROPPED_FLAG"),
          ),
          rule(
            "cav_capture",
            "进入敌旗区夺旗",
            70,
            cond("enemy_flag.state", "==", "AT_HOME"),
            { type: "GO_TO_ENEMY_FLAG" },
            attack("NO_ATTACK"),
            special("CAPTURE_ENEMY_FLAG"),
          ),
          rule(
            "cav_pressure",
            "压迫最近敌人",
            25,
            always(),
            moveToward("最近敌人"),
            attack("ATTACK_NEAREST_ENEMY"),
            special("NONE"),
          ),
        ],
      },
      archer: {
        rules: [
          rule(
            "archer_shoot_carrier",
            "优先射击敌方持旗者",
            100,
            cond("enemy.has_flag_carrier", "==", true),
            { type: "FOLLOW", target: "敌方持旗者", distance: 4 },
            attack("ATTACK_ENEMY_FLAG_CARRIER"),
            special("NONE"),
          ),
          rule(
            "archer_focus_low",
            "集火低血量敌人",
            80,
            always(),
            { type: "FOLLOW", target: mirroredGuard, distance: 5 },
            attack("ATTACK_LOWEST_HP_ENEMY"),
            special("NONE"),
          ),
          rule(
            "archer_hold",
            "没有目标时守住中线",
            10,
            always(),
            { type: "GUARD", target: "地图中央", radius: 8 },
            attack("ATTACK_NEAREST_ENEMY"),
            special("NONE"),
          ),
        ],
      },
    },
  };
}

function rule(
  id,
  name,
  priority,
  condition,
  movement,
  attackIntent,
  specialIntent,
) {
  return {
    id,
    name,
    enabled: true,
    priority,
    condition,
    movement,
    attack: attackIntent,
    special: specialIntent,
  };
}

function always() {
  return { all: [] };
}

function cond(source, operator, value) {
  return { source, operator, value };
}

function moveToward(target) {
  return { type: "MOVE_TOWARD", target };
}

function attack(type) {
  return { type };
}

function special(type) {
  return { type };
}

function newMatch(
  seed = DEFAULT_MATCH_SEED,
  strategies = {
    red: makeBaselineStrategy("red_baseline", "Red Baseline", "red"),
    blue: makeBaselineStrategy("blue_baseline", "Blue Baseline", "blue"),
  },
) {
  const enhancementModes = {
    red: enhancementModeOf(strategies.red),
    blue: enhancementModeOf(strategies.blue),
  };
  const match = {
    time: 0,
    tick: 0,
    seed,
    rng: seededRandom(seed),
    status: "idle",
    result: null,
    strategies,
    enhancementModes,
    units: [],
    flags: {
      red: makeFlag("red"),
      blue: makeFlag("blue"),
    },
    decisions: {},
    logs: [],
    effects: [],
    arrows: [],
    meleeAttacks: [],
  };

  for (const team of ["red", "blue"]) {
    for (const unitType of ["heavy_infantry", "cavalry", "archer"]) {
      const stats = enhancedUnitStats(unitType, enhancementModes[team]);
      const pos = pickBaseSpawn(match, team);
      const unit = {
        id: `${team}_${unitType}`,
        team,
        unitType,
        x: pos.x,
        y: pos.y,
        renderX: pos.x,
        renderY: pos.y,
        animation: null,
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        damage: stats.damage,
        baseSpeed: stats.speed,
        range: stats.range,
        moveAttack: stats.moveAttack,
        attackCooldown: 0,
        shootLockTicks: 0,
        isAttacking: false,
        lastMovedAt: -999,
        lastAttackerId: null,
        lastAttackedAt: -999,
        deathCount: 0,
        respawnRemaining: 0,
        state: "ALIVE",
        isCapturing: false,
        captureProgress: 0,
        isFlagCarrier: false,
        carriedFlagTeam: null,
        lastTarget: null,
      };
      match.units.push(unit);
    }
  }
  addLog(match, "对局已重置，等待开始。");
  addLog(
    match,
    `强化配置：红方${ENHANCEMENT_LABEL[enhancementModes.red]}，蓝方${ENHANCEMENT_LABEL[enhancementModes.blue]}。`,
  );
  return match;
}

function enhancementModeOf(strategy) {
  return Object.prototype.hasOwnProperty.call(
    ENHANCEMENT_LABEL,
    strategy?.enhancement_mode,
  )
    ? strategy.enhancement_mode
    : "standard";
}

function enhancedUnitStats(unitType, enhancementMode) {
  const stats = { ...UNIT_STATS[unitType] };
  if (enhancementMode !== unitType) return stats;
  if (unitType === "cavalry") stats.speed *= 2;
  if (unitType === "heavy_infantry") stats.maxHp *= 2;
  if (unitType === "archer") stats.range *= 2;
  return stats;
}

function makeFlag(team) {
  const anchor = FLAG_ANCHORS[team];
  return {
    team,
    state: "AT_HOME",
    anchor: { ...anchor },
    x: anchor.x,
    y: anchor.y,
    carrierId: null,
    droppedAtTick: null,
  };
}

function tickMatch(match, options = {}) {
  if (match.result) return;
  match.tick += 1;
  match.time += TICK_SECONDS;

  for (const unit of match.units) {
    if (unit.attackCooldown > 0)
      unit.attackCooldown = Math.max(0, unit.attackCooldown - TICK_SECONDS);
    if (unit.shootLockTicks > 0) unit.shootLockTicks -= 1;
  }

  const snapshot = buildSnapshot(match);
  for (const unit of match.units) unit.isAttacking = false;
  const intents = [];
  for (const unit of match.units) {
    if (unit.state === "ALIVE") {
      intents.push(resolveDecision(match, snapshot, unit));
    }
  }

  resolveFlagActionsAtTickStart(match, intents);
  const movementPlans = intents.map((decision) =>
    planMovement(match, decision),
  );
  resolveAttacksAtTickStart(match, intents, movementPlans);
  settleDeaths(match);
  for (const plan of movementPlans) commitMovement(match, plan);
  updateCaptureProgress(match, intents);
  updateRespawns(match);
  resolveVictory(match, options);
  if (!match.result && match.time >= MATCH_TIME_LIMIT_SECONDS) {
    finishMatch(
      match,
      {
        winner: "draw",
        method: "时间上限",
        text: "8 分钟时间到，双方未分胜负，平局。",
      },
      options,
    );
  }
  pruneEffects(match);
}

function buildSnapshot(match) {
  return {
    time: match.time,
    flags: globalThis.structuredClone(match.flags),
    units: match.units.map((unit) => ({
      id: unit.id,
      team: unit.team,
      unit_type: unit.unitType,
      x: unit.x,
      y: unit.y,
      hp: unit.hp,
      hp_percent: unit.hp / unit.maxHp,
      is_alive: unit.state === "ALIVE",
      state: unit.state,
      is_flag_carrier: unit.isFlagCarrier,
      is_capturing: unit.isCapturing,
      capture_progress: unit.captureProgress,
      respawn_remaining: unit.respawnRemaining,
      death_count: unit.deathCount,
      respawn_round: Math.min(unit.deathCount, 3),
      moved_last_1s:
        unit.state === "ALIVE" && match.time - unit.lastMovedAt <= 1,
      is_attacking: unit.state === "ALIVE" && unit.isAttacking,
      attacked_last_1s:
        unit.state === "ALIVE" && match.time - unit.lastAttackedAt <= 1,
      last_attacker_id: unit.lastAttackerId,
      last_attacked_age: match.time - unit.lastAttackedAt,
    })),
  };
}

function resolveDecision(match, snapshot, unit) {
  const teamStrategy = match.strategies[unit.team];
  const rules = [...(teamStrategy.strategies[unit.unitType]?.rules || [])]
    .filter((item) => item.enabled !== false)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const matchedRules = rules.filter((ruleItem) =>
    evaluateCondition(ruleItem.condition, unit, snapshot),
  );
  const matched = matchedRules[0] || null;
  const reason = matched ? "命中规则" : "没有匹配规则";

  const decision = {
    unitId: unit.id,
    unit,
    rule: matched,
    movement: matched?.movement || { type: "HOLD_POSITION" },
    attack: matched?.attack || { type: "NO_ATTACK" },
    special: matched?.special || { type: "NONE" },
    movementTarget: null,
    attackTarget: null,
    matchedRules,
    observationFacts: matched
      ? collectMatchedConditionFacts(matched.condition, unit, snapshot)
      : [],
    failure: "",
    reason,
  };

  if (matched) {
    decision.movementTarget =
      decision.movement?.coordinate ||
      selectTarget(
        match,
        unit,
        decision.movement?.target ||
          targetFromMoveType(decision.movement?.type),
      );
    decision.attackTarget = selectAttackTarget(match, unit, decision.attack);
    addLog(match, `${unitName(unit)} 触发「${matched.name}」。`, true);
  }
  decision.actionMode = unit.moveAttack
    ? "MOVE_AND_ATTACK"
    : unit.shootLockTicks > 0
      ? "SHOOTING_LOCK"
      : canAttackAtTickStart(match, unit, decision)
        ? "ATTACK_ONLY"
        : "MOVE_ONLY";
  match.decisions[unit.id] = simplifyDecision(decision, match);
  return decision;
}

function canAttackAtTickStart(match, unit, decision) {
  const target = decision.attackTarget;
  return Boolean(
    !capturesEnemyFlagAtTickStart(match, decision) &&
      target &&
      target.state === "ALIVE" &&
      target.hp > 0 &&
      unit.attackCooldown <= 0 &&
      dist(unit, target) <= unit.range + 0.02,
  );
}

function evaluateCondition(condition, unit, snapshot, depth = 0) {
  if (!condition) return true;
  if (depth > 3) return false;
  if (Array.isArray(condition.all))
    return condition.all.every((item) =>
      evaluateCondition(item, unit, snapshot, depth + 1),
    );
  if (Array.isArray(condition.any))
    return condition.any.some((item) =>
      evaluateCondition(item, unit, snapshot, depth + 1),
    );
  if (condition.not)
    return !evaluateCondition(condition.not, unit, snapshot, depth + 1);

  const actual = readConditionValue(condition.source, unit, snapshot);
  const expected = condition.value;
  switch (condition.operator) {
    case "==":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case ">":
      return actual > expected;
    case ">=":
      return actual >= expected;
    case "<":
      return actual < expected;
    case "<=":
      return actual <= expected;
    default:
      return false;
  }
}

function collectMatchedConditionFacts(
  condition,
  unit,
  snapshot,
  facts = [],
  negated = false,
) {
  if (!condition || facts.length >= 3) return facts;
  if (Array.isArray(condition.all)) {
    for (const item of condition.all) {
      collectMatchedConditionFacts(item, unit, snapshot, facts, negated);
      if (facts.length >= 3) break;
    }
    return facts;
  }
  if (Array.isArray(condition.any)) {
    const matchedBranch = condition.any.find((item) =>
      evaluateCondition(item, unit, snapshot),
    );
    if (matchedBranch)
      collectMatchedConditionFacts(
        matchedBranch,
        unit,
        snapshot,
        facts,
        negated,
      );
    return facts;
  }
  if (condition.not)
    return collectMatchedConditionFacts(
      condition.not,
      unit,
      snapshot,
      facts,
      !negated,
    );
  if (!condition.source) return facts;
  facts.push({
    source: condition.source,
    operator: condition.operator,
    expected: condition.value,
    actual: readConditionValue(condition.source, unit, snapshot),
    negated,
  });
  return facts;
}

function readConditionValue(source, unit, snapshot) {
  const enemy = unit.team === "red" ? "blue" : "red";
  const ownFlag = snapshot.flags[unit.team];
  const enemyFlag = snapshot.flags[enemy];
  const aliveEnemies = snapshot.units.filter(
    (item) => item.team !== unit.team && item.is_alive,
  );
  const aliveAllies = snapshot.units.filter(
    (item) => item.team === unit.team && item.is_alive && item.id !== unit.id,
  );
  const nearestEnemy = aliveEnemies.length
    ? minBy(aliveEnemies, (item) => dist(unit, item))
    : null;
  const otherAliveUnits = snapshot.units.filter(
    (item) => item.id !== unit.id && item.is_alive,
  );
  const nearestUnit = otherAliveUnits.length
    ? minBy(otherAliveUnits, (item) => dist(unit, item))
    : null;
  const ownFlagPosition = flagPositionInSnapshot(snapshot, unit.team);
  const enemyFlagPosition = flagPositionInSnapshot(snapshot, enemy);
  const globalUnitValue = readGlobalUnitCondition(source, unit, snapshot);
  if (globalUnitValue.found) return globalUnitValue.value;

  const table = {
    "game.time": snapshot.time,
    "self.hp": unit.hp,
    "self.hp_percent": unit.hp / unit.maxHp,
    "self.is_flag_carrier": unit.isFlagCarrier,
    "self.is_capturing": unit.isCapturing,
    "self.capture_progress": unit.captureProgress,
    "self.death_count": unit.deathCount,
    "self.attack_ready": unit.attackCooldown <= 0,
    "self.zone": zoneOf(unit.x),
    "self.x": unit.x,
    "self.y": unit.y,
    "self.distance_to_own_flag_anchor": dist(unit, FLAG_ANCHORS[unit.team]),
    "self.distance_to_enemy_flag_anchor": dist(unit, FLAG_ANCHORS[enemy]),
    "nearest_enemy.distance": nearestEnemy ? dist(unit, nearestEnemy) : 999,
    "nearest_enemy.unit_type": nearestEnemy ? nearestEnemy.unit_type : "none",
    "nearest_unit.id": nearestUnit ? nearestUnit.id : "none",
    "nearest_unit.relation": nearestUnit
      ? nearestUnit.team === unit.team
        ? "ALLY"
        : "ENEMY"
      : "none",
    "nearest_unit.unit_type": nearestUnit ? nearestUnit.unit_type : "none",
    "nearest_unit.distance": nearestUnit ? dist(unit, nearestUnit) : 999,
    "nearby_enemy.count": aliveEnemies.filter((item) => dist(unit, item) <= 5)
      .length,
    "nearby_ally.count": aliveAllies.filter((item) => dist(unit, item) <= 5)
      .length,
    "ally.heavy_infantry.is_alive": aliveAllies.some(
      (item) => item.unit_type === "heavy_infantry",
    ),
    "ally.cavalry.is_alive": aliveAllies.some(
      (item) => item.unit_type === "cavalry",
    ),
    "ally.archer.is_alive": aliveAllies.some(
      (item) => item.unit_type === "archer",
    ),
    "enemy.any_death_count": snapshot.units
      .filter((item) => item.team !== unit.team)
      .reduce((max, item) => Math.max(max, item.death_count), 0),
    "enemy_near_enemy_flag.count": aliveEnemies.filter(
      (item) => dist(item, FLAG_ANCHORS[enemy]) <= 5,
    ).length,
    "enemy.all_alive_near_enemy_flag":
      aliveEnemies.length > 0 &&
      aliveEnemies.every((item) => dist(item, FLAG_ANCHORS[enemy]) <= 5),
    "ally.recently_attacked": snapshot.units.some(
      (item) => item.team === unit.team && item.last_attacked_age <= 3,
    ),
    "enemy.has_flag_carrier": aliveEnemies.some((item) => item.is_flag_carrier),
    "ally.has_flag_carrier":
      aliveAllies.some((item) => item.is_flag_carrier) || unit.isFlagCarrier,
    "own_flag.state": ownFlag.state,
    "enemy_flag.state": enemyFlag.state,
    "own_flag.x": ownFlagPosition.x,
    "own_flag.y": ownFlagPosition.y,
    "enemy_flag.x": enemyFlagPosition.x,
    "enemy_flag.y": enemyFlagPosition.y,
    "own_flag.is_at_home": ownFlag.state === "AT_HOME",
    "enemy_flag.is_at_home": enemyFlag.state === "AT_HOME",
    "own_flag.is_dropped": ownFlag.state === "DROPPED",
    "enemy_flag.is_dropped": enemyFlag.state === "DROPPED",
    "self.in_enemy_flag_zone": dist(unit, FLAG_ANCHORS[enemy]) <= 1,
    "self.in_own_flag_zone": dist(unit, FLAG_ANCHORS[unit.team]) <= 1,
  };
  return table[source];
}

function readGlobalUnitCondition(source, unit, snapshot) {
  const match =
    /^(ally|enemy)\.(heavy_infantry|cavalry|archer)\.(hp|respawn_round|moved_last_1s|is_attacking|attacked_last_1s|is_flag_carrier|x|y|distance_to_self|distance_to_own_flag|distance_to_enemy_flag|distance_to_own_flag_zone|distance_to_enemy_flag_zone)$/.exec(
      source || "",
    );
  if (!match) return { found: false, value: undefined };

  const [, relation, unitType, field] = match;
  const ownTeam = unit.team;
  const enemy = enemyTeam(ownTeam);
  const targetTeam = relation === "ally" ? ownTeam : enemy;
  const target = snapshot.units.find(
    (item) => item.team === targetTeam && item.unit_type === unitType,
  );
  if (!target) return { found: true, value: undefined };

  const ownFlagPosition = flagPositionInSnapshot(snapshot, ownTeam);
  const enemyFlagPosition = flagPositionInSnapshot(snapshot, enemy);
  const values = {
    hp: target.hp,
    respawn_round: target.respawn_round,
    moved_last_1s: target.moved_last_1s,
    is_attacking: target.is_attacking,
    attacked_last_1s: target.attacked_last_1s,
    is_flag_carrier: target.is_flag_carrier,
    x: target.x,
    y: target.y,
    distance_to_self: dist(unit, target),
    distance_to_own_flag: dist(target, ownFlagPosition),
    distance_to_enemy_flag: dist(target, enemyFlagPosition),
    distance_to_own_flag_zone: dist(target, FLAG_ANCHORS[ownTeam]),
    distance_to_enemy_flag_zone: dist(target, FLAG_ANCHORS[enemy]),
  };
  return { found: true, value: values[field] };
}

function flagPositionInSnapshot(snapshot, team) {
  const flag = snapshot.flags[team];
  if (flag.state === "CARRIED") {
    return (
      snapshot.units.find((item) => item.id === flag.carrierId) || flag.anchor
    );
  }
  return { x: flag.x, y: flag.y };
}

function targetFromMoveType(type) {
  if (type === "RETURN_TO_OWN_FLAG") return "己方旗位";
  if (type === "GO_TO_ENEMY_FLAG") return "敌方旗位";
  if (type === "GO_TO_DROPPED_FLAG") return "敌方旗帜当前位置";
  return null;
}

function selectAttackTarget(match, unit, attackIntent) {
  const attackType =
    typeof attackIntent === "string" ? attackIntent : attackIntent?.type;
  const explicitTarget =
    typeof attackIntent === "object" ? attackIntent.target : null;
  const enemies = aliveUnits(match, enemyTeam(unit.team));
  if (!enemies.length) return null;
  if (explicitTarget) {
    const target = selectTarget(match, unit, explicitTarget);
    if (
      target &&
      target.team === enemyTeam(unit.team) &&
      target.state === "ALIVE" &&
      target.hp > 0
    )
      return target;
  }
  if (attackType === "ATTACK_ENEMY_FLAG_CARRIER")
    return enemies.find((item) => item.isFlagCarrier) || null;
  if (attackType === "ATTACK_RECENT_ALLY_ATTACKER")
    return recentlyAttackingEnemy(match, unit.team);
  if (attackType === "ATTACK_LOWEST_HP_ENEMY")
    return minBy(enemies, (item) => item.hp / item.maxHp);
  if (attackType === "ATTACK_ENEMY_THREATENING_ALLY_FLAG_CARRIER") {
    const carrier = aliveUnits(match, unit.team).find(
      (item) => item.isFlagCarrier,
    );
    return carrier ? minBy(enemies, (item) => dist(item, carrier)) : null;
  }
  if (attackType === "ATTACK_NEAREST_ENEMY" || attackType === "ATTACK")
    return minBy(enemies, (item) => dist(unit, item));
  return null;
}

function selectTarget(match, unit, targetName) {
  const enemy = enemyTeam(unit.team);
  const enemies = aliveUnits(match, enemy);
  const allies = aliveUnits(match, unit.team);
  const targetMap = {
    己方旗位: FLAG_ANCHORS[unit.team],
    敌方旗位: FLAG_ANCHORS[enemy],
    地图中央: { x: 50, y: 25 },
    当前所在格: unit,
    己方旗帜当前位置: match.flags[unit.team],
    敌方旗帜当前位置: match.flags[enemy],
    最近敌人: minBy(enemies, (item) => dist(unit, item)),
    最远敌人: maxBy(enemies, (item) => dist(unit, item)),
    生命值最低的敌人: minBy(enemies, (item) => item.hp / item.maxHp),
    生命值最高的敌人: maxBy(enemies, (item) => item.hp / item.maxHp),
    最近的敌方重甲兵: minBy(
      enemies.filter((item) => item.unitType === "heavy_infantry"),
      (item) => dist(unit, item),
    ),
    最近的敌方骑兵: minBy(
      enemies.filter((item) => item.unitType === "cavalry"),
      (item) => dist(unit, item),
    ),
    最近的敌方弓箭手: minBy(
      enemies.filter((item) => item.unitType === "archer"),
      (item) => dist(unit, item),
    ),
    敌方持旗者: enemies.find((item) => item.isFlagCarrier),
    友方持旗者: allies.find((item) => item.isFlagCarrier),
    友方重甲步兵: allies.find((item) => item.unitType === "heavy_infantry"),
    友方骑兵: allies.find((item) => item.unitType === "cavalry"),
    友方弓箭手: allies.find((item) => item.unitType === "archer"),
    最近攻击友方的敌人: recentlyAttackingEnemy(match, unit.team),
    距己方旗位最近敌人: minBy(enemies, (item) =>
      dist(item, FLAG_ANCHORS[unit.team]),
    ),
  };
  return targetMap[targetName] || null;
}

function capturesEnemyFlagAtTickStart(match, decision) {
  const unit = decision.unit;
  const enemy = enemyTeam(unit.team);
  return (
    decision.special?.type === "CAPTURE_ENEMY_FLAG" &&
    !unit.isFlagCarrier &&
    match.flags[enemy].state === "AT_HOME" &&
    dist(unit, FLAG_ANCHORS[enemy]) <= 1
  );
}

function planMovement(match, decision) {
  const unit = decision.unit;
  const plan = {
    decision,
    unit,
    fromX: unit.x,
    fromY: unit.y,
    toX: unit.x,
    toY: unit.y,
    target: null,
    isCapturing: false,
  };
  if (unit.state !== "ALIVE") return plan;
  if (!unit.moveAttack && decision.actionMode !== "MOVE_ONLY") return plan;
  const move = decision.movement || { type: "HOLD_POSITION" };

  if (capturesEnemyFlagAtTickStart(match, decision)) {
    plan.isCapturing = true;
    decision.failure = "正在夺旗，停止移动与攻击";
    return plan;
  }

  if (move.type === "HOLD_POSITION") return plan;

  let target = decision.movementTarget;
  if (
    (move.type === "GO_TO_ENEMY_FLAG" || move.type === "RETURN_TO_OWN_FLAG") &&
    move.route === ROUTE_UPPER_LANE_20
  ) {
    target = upperLaneTarget(unit, target, move.type, move.lane_offset ?? 20);
  }
  if (
    move.type === "GUARD" &&
    target &&
    dist(unit, target) <= (move.radius ?? 3)
  )
    return plan;
  if (
    move.type === "FOLLOW" &&
    target &&
    dist(unit, target) <= (move.distance ?? 3)
  )
    return plan;
  if (move.type === "MOVE_AWAY_FROM" && target)
    target = awayPoint(unit, target);
  if (!target) {
    decision.failure = "移动目标无效";
    return plan;
  }

  const speed = unit.baseSpeed * (unit.isFlagCarrier ? 0.75 : 1);
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.0001) return plan;
  const step = Math.min(speed * TICK_SECONDS, distance);
  plan.toX = clamp(unit.x + (dx / distance) * step, 0, MAP_W - 1);
  plan.toY = clamp(unit.y + (dy / distance) * step, 0, MAP_H - 1);
  plan.target = target;
  return plan;
}

function commitMovement(match, plan) {
  const { unit, decision, fromX, fromY, toX, toY, target, isCapturing } = plan;
  if (unit.state !== "ALIVE") return;
  unit.isCapturing = isCapturing;
  if (!isCapturing) unit.captureProgress = 0;
  if (Math.hypot(toX - fromX, toY - fromY) < 0.0001) return;
  unit.x = toX;
  unit.y = toY;
  unit.lastMovedAt = match.time;
  animateUnitTo(unit, fromX, fromY, toX, toY);
  unit.lastTarget = target;
  decision.plannedMovement = { x: toX, y: toY };
}

function upperLaneTarget(unit, finalTarget, moveType, laneOffset) {
  if (!finalTarget) return null;
  const laneY = clamp(finalTarget.y - laneOffset, 0, MAP_H - 1);
  const midX = MAP_W / 2;
  const midLanePoint = { x: midX, y: laneY };
  if (dist(unit, midLanePoint) > 0.01) return midLanePoint;
  if (moveType === "RETURN_TO_OWN_FLAG") return finalTarget;
  const targetLanePoint = { x: finalTarget.x, y: laneY };
  if (dist(unit, targetLanePoint) > 0.01) return targetLanePoint;
  return finalTarget;
}

function resolveAttacksAtTickStart(match, intents, movementPlans) {
  const planByUnitId = new Map(
    movementPlans.map((plan) => [plan.unit.id, plan]),
  );
  const attacks = [];
  for (const decision of intents) {
    const unit = decision.unit;
    const target = decision.attackTarget;
    const plan = planByUnitId.get(unit.id);
    if (!unitCanAttackAtTickStart(unit, target, decision, plan)) continue;
    attacks.push({ unit, target, damage: unit.damage });
  }

  const attacksByTarget = new Map();
  for (const attackEvent of attacks) {
    const { unit, target, damage } = attackEvent;
    if (unit.unitType === "archer") {
      match.arrows.push(
        makeTimedCombatEffect(
          match,
          {
            from: { x: unit.x, y: unit.y },
            to: { x: target.x, y: target.y },
            team: unit.team,
          },
          ARROW_DURATION_MS,
        ),
      );
    } else {
      match.meleeAttacks.push(
        makeTimedCombatEffect(
          match,
          {
            from: { x: unit.x, y: unit.y },
            to: { x: target.x, y: target.y },
            team: unit.team,
            unitType: unit.unitType,
          },
          MELEE_SWING_DURATION_MS,
        ),
      );
    }
    unit.isAttacking = true;
    unit.attackCooldown = 1;
    if (unit.unitType === "archer") unit.shootLockTicks = 2;
    addLog(
      match,
      `${unitName(unit)} 攻击 ${unitName(target)}，造成 ${damage} 伤害。`,
    );
    const grouped = attacksByTarget.get(target.id) || [];
    grouped.push(attackEvent);
    attacksByTarget.set(target.id, grouped);
  }

  for (const grouped of attacksByTarget.values()) {
    const target = grouped[0].target;
    const totalDamage = grouped.reduce(
      (total, attackEvent) => total + attackEvent.damage,
      0,
    );
    target.hp = Math.max(0, target.hp - totalDamage);
    target.lastAttackerId = grouped[grouped.length - 1].unit.id;
    target.lastAttackedAt = match.time;
    match.effects = match.effects.filter(
      (effect) => effect.targetId !== target.id,
    );
    match.effects.push(
      makeTimedCombatEffect(
        match,
        {
          targetId: target.id,
          x: target.x,
          y: target.y,
          text: `-${totalDamage}`,
        },
        DAMAGE_FLOAT_DURATION_MS,
      ),
    );
  }
}

function unitCanAttackAtTickStart(unit, target, decision, movementPlan) {
  return Boolean(
    unit.state === "ALIVE" &&
      !movementPlan?.isCapturing &&
      (unit.moveAttack || decision.actionMode === "ATTACK_ONLY") &&
      target &&
      target.state === "ALIVE" &&
      target.hp > 0 &&
      unit.attackCooldown <= 0 &&
      dist(unit, target) <= unit.range + 0.02,
  );
}

function makeTimedCombatEffect(match, effect, durationMs) {
  const startedAt = match.time * 1000;
  return {
    ...effect,
    startedAt,
    durationMs,
    expiresAtRealTime: startedAt + durationMs,
    expiresAtTick: match.tick + Math.ceil(durationMs / TICK_MS) + 1,
  };
}

function settleDeaths(match) {
  for (const unit of match.units) {
    if (unit.state !== "ALIVE" || unit.hp > 0) continue;
    unit.deathCount += 1;
    unit.state = unit.deathCount >= 4 ? "ELIMINATED" : "RESPAWNING";
    unit.respawnRemaining =
      unit.deathCount === 1
        ? 5
        : unit.deathCount === 2
          ? 10
          : unit.deathCount === 3
            ? 20
            : 0;
    unit.hp = 0;
    unit.isCapturing = false;
    unit.captureProgress = 0;
    unit.attackCooldown = 0;
    unit.shootLockTicks = 0;
    unit.isAttacking = false;
    if (unit.isFlagCarrier) {
      const flag = match.flags[unit.carriedFlagTeam];
      flag.state = "DROPPED";
      flag.carrierId = null;
      flag.x = unit.x;
      flag.y = unit.y;
      flag.droppedAtTick = match.tick;
      addLog(match, `${unitName(unit)} 阵亡，${TEAM_LABEL[flag.team]}旗掉落。`);
      unit.isFlagCarrier = false;
      unit.carriedFlagTeam = null;
    } else {
      addLog(
        match,
        `${unitName(unit)} 阵亡。${unit.state === "ELIMINATED" ? "永久出局。" : `${unit.respawnRemaining} 秒后重生。`}`,
      );
    }
  }
}

function resolveFlagActionsAtTickStart(match, intents) {
  for (const decision of intents) {
    const unit = decision.unit;
    const specialType = decision.special?.type;
    if (specialType === "DROP_CARRIED_FLAG")
      dropCarriedFlag(match, unit, "主动放下旗帜");
    if (specialType === "PICK_UP_FLAG")
      pickUpFlag(match, unit, decision.special.flag);
    if (specialType === "PICK_UP_ENEMY_DROPPED_FLAG")
      pickUpFlag(match, unit, "ENEMY");
    if (specialType === "RETURN_OWN_DROPPED_FLAG")
      returnOwnDroppedFlag(match, unit);
  }
}

function pickUpFlag(match, unit, flagSide) {
  if (unit.isFlagCarrier) return;
  const flagTeam =
    flagSide === "OWN"
      ? unit.team
      : flagSide === "ENEMY"
        ? enemyTeam(unit.team)
        : null;
  if (!flagTeam) return;
  const flag = match.flags[flagTeam];
  const canPickOwn =
    flagSide === "OWN" &&
    (flag.state === "AT_HOME" || flag.state === "DROPPED");
  const canPickEnemy = flagSide === "ENEMY" && flag.state === "DROPPED";
  if ((!canPickOwn && !canPickEnemy) || !isTouching(unit, flag)) return;
  carryFlag(match, unit, flag);
  addLog(match, `${unitName(unit)} 举起了${TEAM_LABEL[flagTeam]}旗。`);
}

function returnOwnDroppedFlag(match, unit) {
  const flag = match.flags[unit.team];
  if (flag.state !== "DROPPED" || !isTouching(unit, flag)) return;
  resetFlag(flag);
  addLog(match, `${unitName(unit)} 归还了本方旗帜。`);
}

function dropCarriedFlag(match, unit, reason) {
  if (!unit.isFlagCarrier || !unit.carriedFlagTeam) return;
  const flag = match.flags[unit.carriedFlagTeam];
  flag.state = "DROPPED";
  flag.carrierId = null;
  flag.x = unit.x;
  flag.y = unit.y;
  flag.droppedAtTick = match.tick;
  addLog(
    match,
    `${unitName(unit)} ${reason}，${TEAM_LABEL[flag.team]}旗掉落。`,
  );
  unit.isFlagCarrier = false;
  unit.carriedFlagTeam = null;
}

function updateCaptureProgress(match, intents) {
  for (const unit of aliveUnits(match)) {
    const enemy = enemyTeam(unit.team);
    const flag = match.flags[enemy];
    const decision = intents.find((item) => item.unitId === unit.id);
    const wantsCapture = decision?.special?.type === "CAPTURE_ENEMY_FLAG";
    if (
      wantsCapture &&
      !unit.isFlagCarrier &&
      flag.state === "AT_HOME" &&
      dist(unit, flag.anchor) <= 1 &&
      !decision.attackTarget
    ) {
      unit.isCapturing = true;
      unit.captureProgress += TICK_SECONDS;
      if (unit.captureProgress >= CAPTURE_SECONDS) {
        carryFlag(match, unit, flag);
        unit.isCapturing = false;
        unit.captureProgress = 0;
        addLog(
          match,
          `${unitName(unit)} 完成 3 秒夺旗，拿到${TEAM_LABEL[enemy]}旗。`,
        );
      }
    } else if (!unit.isFlagCarrier) {
      unit.isCapturing = false;
      unit.captureProgress = 0;
    }
  }
}

function updateRespawns(match) {
  for (const unit of match.units) {
    if (unit.state !== "RESPAWNING") continue;
    unit.respawnRemaining = Math.max(0, unit.respawnRemaining - TICK_SECONDS);
    if (unit.respawnRemaining > 0) continue;
    const pos = pickBaseSpawn(match, unit.team);
    unit.x = pos.x;
    unit.y = pos.y;
    snapUnitRender(unit);
    unit.hp = unit.maxHp;
    unit.state = "ALIVE";
    addLog(match, `${unitName(unit)} 在己方基地重生。`);
  }
}

function pickBaseSpawn(match, team) {
  const candidates = [];
  const area = BASE_SPAWN_AREAS[team];
  for (let x = area.minX; x <= area.maxX; x += 1) {
    for (let y = area.minY; y <= area.maxY; y += 1) {
      const cell = { x, y };
      if (dist(cell, FLAG_ANCHORS[team]) <= 2) continue;
      candidates.push(cell);
    }
  }
  if (!candidates.length) return { ...FLAG_ANCHORS[team] };
  return candidates[Math.floor(match.rng() * candidates.length)];
}

function resolveVictory(match, options = {}) {
  const wins = [];
  for (const unit of aliveUnits(match)) {
    if (
      unit.isFlagCarrier &&
      unit.carriedFlagTeam === enemyTeam(unit.team) &&
      dist(unit, FLAG_ANCHORS[unit.team]) <= 1
    ) {
      wins.push({
        winner: unit.team,
        method: "夺旗",
        text: `${TEAM_LABEL[unit.team]}交付敌旗获胜`,
      });
    }
  }
  for (const team of ["red", "blue"]) {
    // Temporary respawns must not erase a team's remaining lives. A team loses
    // only after all three units have exhausted their four total lives.
    if (
      match.units
        .filter((unit) => unit.team === team)
        .every((unit) => unit.state === "ELIMINATED")
    ) {
      wins.push({
        winner: enemyTeam(team),
        method: "团灭",
        text: `${TEAM_LABEL[enemyTeam(team)]}团灭对手获胜`,
      });
    }
  }
  const uniqueTeams = [...new Set(wins.map((item) => item.winner))];
  if (!uniqueTeams.length) return;
  const result =
    uniqueTeams.length > 1
      ? {
          winner: "draw",
          method: "同 Tick 平局",
          text: "双方同一 Tick 满足胜利条件，平局。",
        }
      : wins[0];
  finishMatch(match, result, options);
}

function finishMatch(match, result, options = {}) {
  match.result = result;
  match.status = "finished";
  void options;
  syncUnitRenderPositions(match);
  addLog(match, `对局结束：${match.result.text}`);
}

function carryFlag(match, unit, flag) {
  flag.state = "CARRIED";
  flag.carrierId = unit.id;
  flag.droppedAtTick = null;
  unit.isFlagCarrier = true;
  unit.carriedFlagTeam = flag.team;
}

function resetFlag(flag) {
  flag.state = "AT_HOME";
  flag.carrierId = null;
  flag.droppedAtTick = null;
  flag.x = flag.anchor.x;
  flag.y = flag.anchor.y;
}

function animateUnitTo(unit, fromX, fromY, toX, toY) {
  void fromX;
  void fromY;
  unit.renderX = toX;
  unit.renderY = toY;
}

function snapUnitRender(unit) {
  unit.renderX = unit.x;
  unit.renderY = unit.y;
  unit.animation = null;
}

function syncUnitRenderPositions(match) {
  for (const unit of match.units) snapUnitRender(unit);
}

function pruneEffects(match) {
  const active = (effect) => match.tick < effect.expiresAtTick;
  match.effects = match.effects.filter(active);
  match.arrows = match.arrows.filter(active);
  match.meleeAttacks = match.meleeAttacks.filter(active);
}

function addLog(match, text, quiet = false) {
  if (quiet && match.tick % 4 !== 0) return;
  match.logs.push(`${formatTime(match.time)} ${text}`);
}

function simplifyDecision(decision, match) {
  return {
    tick: match.tick,
    rule: decision.rule
      ? `${decision.rule.name} (${decision.rule.priority})`
      : "无",
    rule_name: decision.rule?.name || "",
    rule_priority: decision.rule?.priority ?? 0,
    matched_rules: (decision.matchedRules || []).map((ruleItem) => ({
      name: ruleItem.name,
      priority: ruleItem.priority || 0,
    })),
    observation_facts: decision.observationFacts || [],
    movement: decision.movement?.type || "HOLD_POSITION",
    movement_target: readableTarget(decision.movementTarget),
    attack: decision.attack?.type || "NO_ATTACK",
    attack_target: decision.attackTarget
      ? unitName(decision.attackTarget)
      : "无",
    action_mode: decision.actionMode || "MOVE_ONLY",
    special: decision.special?.type || "NONE",
    special_flag: decision.special?.flag || "",
    reason: decision.failure || decision.reason,
  };
}

function readableTarget(target) {
  if (!target) return "无";
  if (target.id) return unitName(target);
  return `(${Math.round(target.x)}, ${Math.round(target.y)})`;
}

function unitName(unit) {
  return `${TEAM_LABEL[unit.team]}${UNIT_LABEL[unit.unitType]}`;
}

function unitShort(type) {
  return type === "heavy_infantry" ? "步" : type === "cavalry" ? "骑" : "弓";
}

function unitById(id, match) {
  return match.units.find((unit) => unit.id === id);
}

function aliveUnits(match, team = null) {
  return match.units.filter(
    (unit) => unit.state === "ALIVE" && (!team || unit.team === team),
  );
}

function recentlyAttackingEnemy(match, team) {
  const recentAllies = match.units
    .filter(
      (unit) =>
        unit.team === team &&
        unit.lastAttackerId &&
        match.time - unit.lastAttackedAt <= 3,
    )
    .sort((a, b) => b.lastAttackedAt - a.lastAttackedAt);
  for (const ally of recentAllies) {
    const attacker = unitById(ally.lastAttackerId, match);
    if (attacker?.state === "ALIVE") return attacker;
  }
  return null;
}

function enemyTeam(team) {
  return team === "red" ? "blue" : "red";
}

function isTouching(a, b) {
  return dist(a, b) <= 1;
}

function zoneOf(x) {
  if (x <= 14) return "own_or_red_base";
  if (x >= 85) return "blue_base";
  return "center";
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function minBy(items, fn) {
  if (!items.length) return null;
  return items.reduce(
    (best, item) => (fn(item) < fn(best) ? item : best),
    items[0],
  );
}

function maxBy(items, fn) {
  if (!items.length) return null;
  return items.reduce(
    (best, item) => (fn(item) > fn(best) ? item : best),
    items[0],
  );
}

function awayPoint(unit, target) {
  return {
    x: clamp(unit.x + (unit.x - target.x), 0, MAP_W - 1),
    y: clamp(unit.y + (unit.y - target.y), 0, MAP_H - 1),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

export {
  newMatch,
  tickMatch,
  makeBaselineStrategy,
  FORMAT_VERSION,
  GAME_VERSION,
  TICK_SECONDS,
  UNIT_STATS,
  FLAG_ANCHORS,
};

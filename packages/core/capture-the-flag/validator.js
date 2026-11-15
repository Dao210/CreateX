// Adapted from 夺旗Agent游戏 v4.0 by 黄仲生. See SOURCE.md.
const FORMAT_VERSION = "1.0";
const GAME_VERSION = "12-rts-1.0";
const UNIT_TYPES = ["heavy_infantry", "cavalry", "archer"];
const VALID_ENHANCEMENT_MODES = new Set([
  "standard",
  "cavalry",
  "heavy_infantry",
  "archer",
]);
const UNIT_LABEL = {
  heavy_infantry: "重甲步兵",
  cavalry: "骑兵",
  archer: "弓箭手",
};
const VALID_MOVES = new Set([
  "MOVE_TOWARD",
  "MOVE_AWAY_FROM",
  "FOLLOW",
  "GUARD",
  "INTERCEPT",
  "HOLD_POSITION",
  "RETURN_TO_OWN_FLAG",
  "GO_TO_ENEMY_FLAG",
  "GO_TO_DROPPED_FLAG",
]);
const VALID_ATTACKS = new Set([
  "ATTACK",
  "ATTACK_NEAREST_ENEMY",
  "ATTACK_LOWEST_HP_ENEMY",
  "ATTACK_ENEMY_FLAG_CARRIER",
  "ATTACK_ENEMY_THREATENING_ALLY_FLAG_CARRIER",
  "ATTACK_RECENT_ALLY_ATTACKER",
  "NO_ATTACK",
]);
const VALID_SPECIALS = new Set([
  "CAPTURE_ENEMY_FLAG",
  "PICK_UP_ENEMY_DROPPED_FLAG",
  "RETURN_OWN_DROPPED_FLAG",
  "PICK_UP_FLAG",
  "DROP_CARRIED_FLAG",
  "DELIVER_FLAG",
  "NONE",
]);
const VALID_FLAG_SIDES = new Set(["OWN", "ENEMY"]);
const VALID_ROUTES = new Set(["UPPER_LANE_20"]);
const VALID_OPERATORS = new Set(["==", "!=", ">", ">=", "<", "<="]);
const GLOBAL_UNIT_FIELDS = [
  "hp",
  "respawn_round",
  "moved_last_1s",
  "is_attacking",
  "attacked_last_1s",
  "is_flag_carrier",
  "x",
  "y",
  "distance_to_self",
  "distance_to_own_flag",
  "distance_to_enemy_flag",
  "distance_to_own_flag_zone",
  "distance_to_enemy_flag_zone",
];
const VALID_CONDITION_SOURCES = new Set([
  "game.time",
  "self.hp",
  "self.hp_percent",
  "self.is_flag_carrier",
  "self.is_capturing",
  "self.capture_progress",
  "self.death_count",
  "self.attack_ready",
  "self.zone",
  "self.x",
  "self.y",
  "self.distance_to_own_flag_anchor",
  "self.distance_to_enemy_flag_anchor",
  "nearest_enemy.distance",
  "nearest_enemy.unit_type",
  "nearest_unit.id",
  "nearest_unit.relation",
  "nearest_unit.unit_type",
  "nearest_unit.distance",
  "nearby_enemy.count",
  "nearby_ally.count",
  "ally.heavy_infantry.is_alive",
  "ally.cavalry.is_alive",
  "ally.archer.is_alive",
  "enemy.any_death_count",
  "enemy_near_enemy_flag.count",
  "enemy.all_alive_near_enemy_flag",
  "ally.recently_attacked",
  "enemy.has_flag_carrier",
  "ally.has_flag_carrier",
  "own_flag.state",
  "enemy_flag.state",
  "own_flag.x",
  "own_flag.y",
  "enemy_flag.x",
  "enemy_flag.y",
  "own_flag.is_at_home",
  "enemy_flag.is_at_home",
  "own_flag.is_dropped",
  "enemy_flag.is_dropped",
  "self.in_enemy_flag_zone",
  "self.in_own_flag_zone",
]);
for (const relation of ["ally", "enemy"]) {
  for (const unitType of UNIT_TYPES) {
    for (const field of GLOBAL_UNIT_FIELDS)
      VALID_CONDITION_SOURCES.add(`${relation}.${unitType}.${field}`);
  }
}
const VALID_TARGETS = new Set([
  "己方旗位",
  "敌方旗位",
  "地图中央",
  "当前所在格",
  "己方旗帜当前位置",
  "敌方旗帜当前位置",
  "最近敌人",
  "最远敌人",
  "生命值最低的敌人",
  "生命值最高的敌人",
  "最近的敌方重甲兵",
  "最近的敌方骑兵",
  "最近的敌方弓箭手",
  "敌方持旗者",
  "友方持旗者",
  "友方重甲步兵",
  "友方骑兵",
  "友方弓箭手",
  "最近攻击友方的敌人",
  "距己方旗位最近敌人",
]);

function validateStrategy(strategy) {
  const errors = [];
  if (!boundedJSON(strategy))
    return ["Strategy exceeds the structural limits."];
  if (!strategy || typeof strategy !== "object" || Array.isArray(strategy))
    return ["策略必须是 JSON 对象。"];
  if (strategy.format_version !== FORMAT_VERSION)
    errors.push("format_version 必须为 1.0。");
  if (strategy.game_version !== GAME_VERSION)
    errors.push(`game_version 必须为 ${GAME_VERSION}。`);
  if (
    strategy.enhancement_mode !== undefined &&
    !VALID_ENHANCEMENT_MODES.has(strategy.enhancement_mode)
  ) {
    errors.push(
      "enhancement_mode 必须是 standard、cavalry、heavy_infantry 或 archer。",
    );
  }
  if (!strategy.team || typeof strategy.team !== "object") {
    errors.push("缺少 team。");
  } else {
    if (!isNonEmptyString(strategy.team.team_id))
      errors.push("缺少 team.team_id。");
    if (!isNonEmptyString(strategy.team.team_name))
      errors.push("缺少 team.team_name。");
  }
  if (!strategy.strategies || typeof strategy.strategies !== "object") {
    errors.push("缺少 strategies。");
    return errors;
  }

  for (const type of UNIT_TYPES) {
    const rules = strategy.strategies?.[type]?.rules;
    if (!Array.isArray(rules)) {
      errors.push(`${UNIT_LABEL[type]} 缺少 rules。`);
      continue;
    }
    if (rules.length > 20)
      errors.push(`${UNIT_LABEL[type]} 规则不能超过 20 条。`);
    for (const [index, item] of rules.entries()) {
      validateRule(item, `${UNIT_LABEL[type]} 第 ${index + 1} 条规则`, errors);
    }
  }
  if (JSON.stringify(strategy).length > 256 * 1024)
    errors.push("策略文件超过 256KB。");
  return errors;
}

function validateRule(rule, label, errors) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    errors.push(`${label} 必须是对象。`);
    return;
  }
  if (!isNonEmptyString(rule.id)) errors.push(`${label} 缺少 id。`);
  if (typeof rule.name==="string"&&rule.name.length>64) errors.push(`${label} name must be at most 64 characters.`);
    if (!isNonEmptyString(rule.name)) errors.push(`${label} 缺少 name。`);
  if (
    !Number.isFinite(rule.priority) ||
    rule.priority < 1 ||
    rule.priority > 100
  )
    errors.push(`${rule.name || label} priority 必须在 1-100。`);
  if (rule.enabled !== undefined && typeof rule.enabled !== "boolean")
    errors.push(`${rule.name || label} enabled 必须是布尔值。`);
  validateCondition(rule.condition, `${rule.name || label} condition`, errors);
  validateMovement(rule.movement, rule.name || label, errors);
  validateAttack(rule.attack, rule.name || label, errors);
  validateSpecial(rule.special, rule.name || label, errors);
}

function validateMovement(movement, label, errors) {
  if (!movement || typeof movement !== "object" || Array.isArray(movement)) {
    errors.push(`${label} movement 必须是对象。`);
    return;
  }
  if (!VALID_MOVES.has(movement.type))
    errors.push(`${label} movement.type 非法。`);
  if (movement.target !== undefined && !VALID_TARGETS.has(movement.target))
    errors.push(`${label} movement.target 非法。`);
  if (movement.target !== undefined && movement.coordinate !== undefined)
    errors.push(
      `${label} movement.target 与 movement.coordinate 不能同时使用。`,
    );
  if (movement.coordinate !== undefined) {
    const coordinate = movement.coordinate;
    if (
      !coordinate ||
      typeof coordinate !== "object" ||
      Array.isArray(coordinate) ||
      !Number.isFinite(coordinate.x) ||
      !Number.isFinite(coordinate.y)
    ) {
      errors.push(`${label} movement.coordinate 必须是含有限 x、y 的对象。`);
    } else {
      if (
        coordinate.x < 0 ||
        coordinate.x > 99 ||
        coordinate.y < 0 ||
        coordinate.y > 49
      ) {
        errors.push(
          `${label} movement.coordinate 必须在地图范围 x: 0-99、y: 0-49 内。`,
        );
      }
      if (movement.type !== "MOVE_TOWARD")
        errors.push(`${label} movement.coordinate 只能用于 MOVE_TOWARD。`);
    }
  }
  if (
    movement.distance !== undefined &&
    (!Number.isFinite(movement.distance) || movement.distance < 0)
  )
    errors.push(`${label} movement.distance 必须是非负数字。`);
  if (
    movement.radius !== undefined &&
    (!Number.isFinite(movement.radius) || movement.radius < 0)
  )
    errors.push(`${label} movement.radius 必须是非负数字。`);
  if (movement.route !== undefined && !VALID_ROUTES.has(movement.route))
    errors.push(`${label} movement.route 非法。`);
  if (
    movement.lane_offset !== undefined &&
    (!Number.isFinite(movement.lane_offset) || movement.lane_offset < 0)
  )
    errors.push(`${label} movement.lane_offset 必须是非负数字。`);
}

function validateAttack(attack, label, errors) {
  if (!attack || typeof attack !== "object" || Array.isArray(attack)) {
    errors.push(`${label} attack 必须是对象。`);
    return;
  }
  if (!VALID_ATTACKS.has(attack.type))
    errors.push(`${label} attack.type 非法。`);
  if (attack.target !== undefined && !VALID_TARGETS.has(attack.target))
    errors.push(`${label} attack.target 非法。`);
}

function validateSpecial(special, label, errors) {
  if (!special || typeof special !== "object" || Array.isArray(special)) {
    errors.push(`${label} special 必须是对象。`);
    return;
  }
  if (!VALID_SPECIALS.has(special.type))
    errors.push(`${label} special.type 非法。`);
  if (special.type === "PICK_UP_FLAG" && !VALID_FLAG_SIDES.has(special.flag)) {
    errors.push(`${label} PICK_UP_FLAG 的 special.flag 必须为 OWN 或 ENEMY。`);
  }
  if (special.type !== "PICK_UP_FLAG" && special.flag !== undefined) {
    errors.push(`${label} 只有 PICK_UP_FLAG 可以使用 special.flag。`);
  }
}

function validateCondition(
  condition,
  label,
  errors,
  depth = 0,
  count = { value: 0 },
) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
    errors.push(`${label} 必须是对象。`);
    return;
  }
  if (depth > 3) {
    errors.push(`${label} 嵌套深度不能超过 3。`);
    return;
  }
  if (Array.isArray(condition.all)) {
    for (const item of condition.all)
      validateCondition(item, `${label}.all`, errors, depth + 1, count);
    return;
  }
  if (Array.isArray(condition.any)) {
    for (const item of condition.any)
      validateCondition(item, `${label}.any`, errors, depth + 1, count);
    return;
  }
  if (condition.not) {
    validateCondition(condition.not, `${label}.not`, errors, depth + 1, count);
    return;
  }

  count.value += 1;
  if (count.value > 8) errors.push(`${label} 基础条件不能超过 8 个。`);
  if (!VALID_CONDITION_SOURCES.has(condition.source))
    errors.push(`${label}.source 非法。`);
  if (!VALID_OPERATORS.has(condition.operator))
    errors.push(`${label}.operator 非法。`);
  if (!["string", "number", "boolean"].includes(typeof condition.value))
    errors.push(`${label}.value must be a string, number or boolean.`);
  if (!Object.prototype.hasOwnProperty.call(condition, "value"))
    errors.push(`${label}.value 缺失。`);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export { validateStrategy, FORMAT_VERSION, GAME_VERSION };

function boundedJSON(value) {
  const stack = [[value, 0]];
  let nodes = 0;
  while (stack.length) {
    const [item, depth] = stack.pop();
    if (++nodes > 6000 || depth > 12) return false;
    if (typeof item === "string" && item.length > 128) return false;
    if (typeof item === "number" && !Number.isFinite(item)) return false;
    if (item && typeof item === "object")
      for (const child of Object.values(item)) stack.push([child, depth + 1]);
  }
  return true;
}

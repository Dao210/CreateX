# Strategy 编写指南

Strategy 是一个 JSON 文件，用来描述三个兵种在比赛中的自动行为。每个单位每个 Tick 会读取战场状态，然后在自己的 `rules` 里选择优先级最高且条件满足的规则执行。

## 顶层结构

```json
{
  "format_version": "1.0",
  "game_version": "12-rts-1.0",
  "enhancement_mode": "cavalry",
  "team": {
    "team_id": "策略文件名",
    "team_name": "策略文件名"
  },
  "strategies": {
    "heavy_infantry": { "rules": [] },
    "cavalry": { "rules": [] },
    "archer": { "rules": [] }
  }
}
```

`team_id` 和 `team_name` 建议使用策略文件名，不要依赖 JSON 里手写的其他名字。客户端和云端上传时也会以文件名作为策略编号。

## 兵种强化选择

每个策略只能通过顶层 `enhancement_mode` 选择一种强化模式。合法写法如下：

```json
"enhancement_mode": "standard"
```

```json
"enhancement_mode": "cavalry"
```

```json
"enhancement_mode": "heavy_infantry"
```

```json
"enhancement_mode": "archer"
```

| 值 | 界面显示 | 实际效果 |
|---|---|---|
| `standard` | 标准模式 | 不强化，全部使用基础属性 |
| `cavalry` | 强化骑兵 | 骑兵速度由 5 提升到 10 格/秒 |
| `heavy_infantry` | 强化步兵 | 步兵最大生命、出生生命和重生生命由 300 提升到 600 |
| `archer` | 强化弓箭手 | 弓箭手攻击范围由 5 提升到 10 格 |

旧策略没有 `enhancement_mode` 字段时自动使用 `standard`，因此仍然合法。强化选项在一局开始时读取并固定；红蓝双方可以使用不同强化模式进行对战。

## 规则结构

### 弓箭手行动互斥

弓箭手每个策略 Tick（`0.25 秒`）只能执行移动或攻击之一。即使规则同时写了 `movement` 和 `attack`，引擎也会在 Tick 开始时判断：目标已在射程内且攻击冷却完成时，弓箭手原地攻击；否则弓箭手可以移动，但本 Tick 不会攻击。移动后进入射程必须等到下一个 Tick 才能射箭。

射箭会占用当前 Tick 和紧随的下一个 Tick，共 2 Tick（`0.5 秒`）射击硬直；这段时间引擎会强制禁止移动和再次攻击。射箭后攻击冷却为 4 Tick（`1 秒`），因此硬直结束后可以移动，但未到 1 秒前仍不能射下一箭。

### 单位位置与重叠

单位使用连续二维坐标移动，内部保留完整小数精度。每个 Tick 会直接朝策略目标前进，横向、纵向和斜向的真实移动距离都等于速度乘 Tick 时长，因此斜向不增加速度。单位没有碰撞体积，也不占格；策略可以让任意友军或敌军移动到同一坐标，其他单位不会挡住移动或重生。每局开始和每次重生时，单位都会在己方基地内随机合法位置出现，策略不能指定出生坐标。

### 移动到指定坐标

策略可以为 `MOVE_TOWARD` 指定一个固定坐标作为移动目标：

```json
{
  "type": "MOVE_TOWARD",
  "coordinate": { "x": 50, "y": 25 }
}
```

坐标使用连续数值，地图范围为 `x: 0–99`、`y: 0–49`。`movement.coordinate` 只能用于 `MOVE_TOWARD`，且不能与 `movement.target` 同时出现。它表示一个单独目标点，不支持任意自定义多路径点数组。

### Tick 结算顺序

### 旗帜操作指令

旗帜不会因单位接触而自动拾取或归还。策略需要在 `special` 中显式指定旗帜操作：

```json
{ "type": "PICK_UP_FLAG", "flag": "OWN" }
```

在己方旗帜在家或掉落的位置 1 格内举起己方旗帜。

```json
{ "type": "PICK_UP_FLAG", "flag": "ENEMY" }
```

在掉落敌旗的位置 1 格内举起敌旗。敌旗在家时仍只能使用 `CAPTURE_ENEMY_FLAG` 并完成 3 秒夺旗，不能直接举起。

```json
{ "type": "DROP_CARRIED_FLAG" }
```

放下当前持有的任意旗帜。持有己方或敌方旗帜都会使移动速度降低 25%。

每个 `0.25 秒` Tick 先以开始时的完整全局快照选中规则、目标和移动终点；接着以开始位置同时判定所有攻击；攻击伤害同时生效，死亡单位不会执行移动；最后所有幸存单位的移动终点一起提交。因此策略不能依赖同 Tick 内某个单位先移动、先死亡或先扣血的执行顺序。

每条规则格式如下：

```json
{
  "id": "unique_rule_id",
  "name": "给人看的规则名",
  "enabled": true,
  "priority": 100,
  "condition": {
    "source": "enemy.has_flag_carrier",
    "operator": "==",
    "value": true
  },
  "movement": {
    "type": "MOVE_TOWARD",
    "target": "敌方持旗者"
  },
  "attack": {
    "type": "ATTACK_ENEMY_FLAG_CARRIER"
  },
  "special": {
    "type": "NONE"
  }
}
```

## 优先级

- `priority` 范围是 1 到 100。
- 数字越大越先执行。
- 同一兵种内，建议把紧急规则放到 90 以上，例如拦截敌方持旗者。
- 默认规则通常放在 10 到 30，例如巡逻、跟随或冲向旗位。

## 条件写法

### 双方全局合法信息

策略可以读取本局时间，以及红蓝双方六个单位的统一状态。字段使用相对阵营命名：`ally` 永远表示当前策略所属方，`enemy` 永远表示对方，所以同一份策略切换红蓝方后不需要改字段。

本局时间：

```json
{ "source": "game.time", "operator": ">=", "value": 30 }
```

单位字段格式为：

```text
{ally|enemy}.{heavy_infantry|cavalry|archer}.{field}
```

例如判断敌方骑兵过去 1 秒是否移动：

```json
{ "source": "enemy.cavalry.moved_last_1s", "operator": "==", "value": true }
```

每个双方单位都开放以下字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `hp` | 数字 | 当前生命值，死亡或等待重生时为 0 |
| `respawn_round` | 整数 | 当前重生轮次，范围 0–3；永久出局后仍为 3 |
| `moved_last_1s` | 布尔值 | 过去 1 秒内是否发生实际位置变化 |
| `is_attacking` | 布尔值 | 上一策略 Tick 是否实际成功发动攻击 |
| `attacked_last_1s` | 布尔值 | 过去 1 秒内是否受到攻击 |
| `is_flag_carrier` | 布尔值 | 当前是否持有任意旗帜 |
| `x` | 数字 | 当前横坐标，保留完整小数精度 |
| `y` | 数字 | 当前纵坐标，保留完整小数精度 |
| `distance_to_self` | 数字 | 该单位到当前执行策略单位的直线距离 |
| `distance_to_own_flag` | 数字 | 到己方旗帜当前位置的直线距离 |
| `distance_to_enemy_flag` | 数字 | 到敌方旗帜当前位置的直线距离 |
| `distance_to_own_flag_zone` | 数字 | 到己方固定旗区中心的直线距离 |
| `distance_to_enemy_flag_zone` | 数字 | 到敌方固定旗区中心的直线距离 |

`distance_to_own_flag` 和 `distance_to_enemy_flag` 跟随旗帜实际位置变化；旗帜被单位携带时，距离按持旗单位的位置计算。带 `_zone` 的字段始终按固定旗区中心计算。

坐标与距离字段示例：

```json
{ "source": "enemy.archer.distance_to_self", "operator": "<=", "value": 15 }
```

上例可合法判断敌方弓箭手是否在自身 15 格内。`enemy.archer.x`、`enemy.archer.y` 可读取该弓箭手的精确位置；自身坐标使用 `self.x`、`self.y`。双方旗帜坐标使用 `own_flag.x`、`own_flag.y`、`enemy_flag.x`、`enemy_flag.y`，旗帜被携带时会跟随持旗单位。

除自身外最近的存活单位使用以下字段：`nearest_unit.id`、`nearest_unit.relation`、`nearest_unit.unit_type`、`nearest_unit.distance`。其中 `relation` 为 `ALLY`、`ENEMY` 或 `none`。

最简单条件：

```json
{
  "source": "nearest_enemy.distance",
  "operator": "<=",
  "value": 3
}
```

判断冲在最前面的敌人兵种：

```json
{
  "source": "nearest_enemy.unit_type",
  "operator": "==",
  "value": "cavalry"
}
```

`nearest_enemy.unit_type` 只表示当前最近存活敌人的兵种，可用值为 `heavy_infantry`、`cavalry`、`archer`、`none`。

判断队友是否仍然存活：

```json
{
  "source": "ally.cavalry.is_alive",
  "operator": "==",
  "value": false
}
```

同类字段还有 `ally.heavy_infantry.is_alive` 和 `ally.archer.is_alive`。判断敌方是否整体龟缩在自己旗位附近，可使用 `enemy.all_alive_near_enemy_flag == true`。

多个条件同时满足：

```json
{
  "all": [
    { "source": "ally.has_flag_carrier", "operator": "==", "value": true },
    { "source": "enemy.has_flag_carrier", "operator": "==", "value": false }
  ]
}
```

多个条件满足任意一个：

```json
{
  "any": [
    { "source": "self.hp_percent", "operator": "<=", "value": 0.3 },
    { "source": "nearby_enemy.count", "operator": ">=", "value": 2 }
  ]
}
```

永远满足的默认条件：

```json
{
  "all": []
}
```

## 常见策略组合

### 敌方持旗时全员拦截

```json
{
  "condition": { "source": "enemy.has_flag_carrier", "operator": "==", "value": true },
  "movement": { "type": "MOVE_TOWARD", "target": "敌方持旗者" },
  "attack": { "type": "ATTACK_ENEMY_FLAG_CARRIER" },
  "special": { "type": "NONE" }
}
```

### 我方持旗时护送

```json
{
  "condition": { "source": "ally.has_flag_carrier", "operator": "==", "value": true },
  "movement": { "type": "FOLLOW", "target": "友方持旗者", "distance": 2 },
  "attack": { "type": "ATTACK_ENEMY_THREATENING_ALLY_FLAG_CARRIER" },
  "special": { "type": "NONE" }
}
```

### 骑兵夺旗

```json
{
  "condition": { "source": "enemy_flag.state", "operator": "==", "value": "AT_HOME" },
  "movement": { "type": "GO_TO_ENEMY_FLAG" },
  "attack": { "type": "NO_ATTACK" },
  "special": { "type": "CAPTURE_ENEMY_FLAG" }
}
```

### 骑兵走上路夺旗或回家

`GO_TO_ENEMY_FLAG` 和 `RETURN_TO_OWN_FLAG` 可以增加上路路线字段：

```json
{
  "movement": {
    "type": "GO_TO_ENEMY_FLAG",
    "route": "UPPER_LANE_20",
    "lane_offset": 20
  }
}
```

上路由路径点控制而不是格子移动。单位会以连续直线移动到每个路径点，任意两点之间允许自然斜向，但斜向不会增加移动速度。

这表示单位去敌旗时，先前往地图中线的上路线点。当前地图旗位 y 坐标是 25，因此 `lane_offset: 20` 时该点约为 `(50, 5)`；然后前往敌旗上方的路径点，最后前往敌旗。

持旗回家时使用同一个路线字段：先前往地图中线的上路线点，再自然斜向前往己方旗位。

### 骑兵持旗回家

```json
{
  "condition": { "source": "self.is_flag_carrier", "operator": "==", "value": true },
  "movement": { "type": "RETURN_TO_OWN_FLAG" },
  "attack": { "type": "NO_ATTACK" },
  "special": { "type": "DELIVER_FLAG" }
}
```

## 重要限制

- 移动目标和攻击目标是分开的。`attack.target` 可选；对 `ATTACK` 或 `ATTACK_NEAREST_ENEMY` 指定合法单位目标后，会优先攻击该目标。未指定 `attack.target` 时，仍按 `attack.type` 的默认选敌逻辑执行。
- `attack.target` 只能使用 Schema 中已有的单位目标，例如 `"最近的敌方弓箭手"`、`"最近的敌方骑兵"`、`"最近的敌方重甲兵"`。目标必须存活且进入本兵种攻击范围，攻击才会生效。
- 如果想“优先靠近敌方骑兵，但路上先打挡路单位”，可以不写 `attack.target`，并写：
  - `movement.target = "最近的敌方骑兵"`
  - `attack.type = "ATTACK_NEAREST_ENEMY"`
- 当前支持 `UPPER_LANE_20` 上路路线，但不支持任意自定义路径点数组。
- 不要修改 `strategy-validator.js` 之外的主程序能力来适配某个策略，除非老师明确要求修改游戏规则。

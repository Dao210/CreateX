# Siege 林地战役

入口为 `/{slug}/siege/campaign`，从工作区 Siege 工坊进入。运行、存储和检查命令见 [Siege 工作区集成](siege-integration-plan.md)。

战役包含八关、五种武器及六类敌人。建造、升级、出售、障碍清理和目标集火使用 core 规则；Rapier 负责旋转炮台、真实炮弹与接触伤害。胜利要求本关全部波次和援军出场并清空剩余敌人；城堡归零立即失败。

改装只影响新部署，已部署实例保持蓝图和战斗统计。完成波次后保存金币、城堡生命、障碍状态、炮台及冻结蓝图；离开、刷新后从最近波间断点重新开始，需主动继续。账号与工作区切换隔离本机记录。无效断点拒绝恢复，历史星级独立保留。

| 模块 | 位置 |
| --- | --- |
| 关卡、经济、蓝图及断点校验 | `packages/core/siege/campaign.ts` |
| 路径预计算与选敌 | `packages/core/siege/routes.ts` |
| 多炮台物理世界 | `packages/views/siege/campaign/engine.ts` |
| 布阵与操作 | `packages/views/siege/campaign/campaign-app.tsx` |
| 战场绘制 | `packages/views/siege/campaign/painter.ts` |
| 平台存档适配 | `packages/views/siege/campaign/storage.ts` |
| 认证浏览器验收 | `e2e/siege/campaign.spec.ts` |

敌人上限 40、炮弹上限 96，满额延后生成；特效最多 40 个，导出事件最多 2,000 条并标记截断。战斗记录由玩家主动导出，不自动上传。真实手机性能、跨设备同步和玩家体验需单独验收。

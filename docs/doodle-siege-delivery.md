# Doodle Siege 验收范围

运行与模块规范见 [Siege 工作区集成](siege-integration-plan.md)。工坊是 `/{slug}/siege`，战役是 `/{slug}/siege/campaign`，使用 Auro 的 Web/Desktop 布局、成员权限和构建发布。

验收覆盖参数炮台尺寸与真实性能、自主绘图和手动部件确认、蓝图保存与冲突恢复、固定物理步进、真实碰撞、三波试验、战役断点恢复，以及账号/工作区隔离。真实识别模型需另行授权测试；显式 fixture 只用于已知样例协议回归。

共享逻辑在 core，Canvas/Rapier 在 views，宿主 API 留在应用层。图片唯一来源为 `packages/views/siege/assets`；素材来源及生成记录见 [原画说明](siege-art/README.md)。

浏览器测试使用根 TestApiClient 创建隔离账号与工作区。测试通过不代表真实手机帧率、玩家胜率或原生 Mobile 客户端验收；性能需在主项目的生产构建上单独测量。

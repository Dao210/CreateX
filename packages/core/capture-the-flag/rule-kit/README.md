# 夺旗策略规则包

原作：黄仲生。游戏协议 `12-rts-1.0`；策略格式 `1.0`。

先阅读 gameplay-guide.md，再阅读 strategy-authoring-guide.md、strategy-schema.json 和 examples/。
生成合法 JSON，保存为 .strategy 或 .json，在 Weavea World 的夺旗页面导入。

用 Node.js 22 或更新版本校验：

```sh
node validate.mjs my.strategy
```

每个策略包含重甲步兵、骑兵、弓箭手，每兵种最多 20 条规则。每个字符串字段最多 128 字符，规则名最多 64 字符。不要发明未开放的字段或动作。

草稿私有。报名会公开所选版本的完整源码给当前世界成员，并冻结该版本。
当前正式赛是世界内不同成员的单局赛，固定种子 12027，480 秒超时平局。
本地试炼不会计入正式排名。服务器运行正式比赛，整批结束后发布 Glicko-2 排行榜。
作者修改策略会生成新版本；既有比赛及公开版本保持原内容。

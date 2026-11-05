# 文档索引

本文档集按 Spec-Driven Development（SDD）的职责组织：先写清楚用户需要什么，再描述系统如何实现，最后明确数据契约和关键交互设计。需求、实现与格式发生变化时，应更新对应的权威文档，而不是复制一份说明。

## 文档清单

| 文档 | 角色 | 主要读者 |
| --- | --- | --- |
| [product-specification.md](./product-specification.md) | 产品需求规格：范围、用户可见行为、约束和验收条件 | 产品、用户、开发者 |
| [project-guide.md](./project-guide.md) | 系统设计：目录职责、运行上下文、数据流和修改入口 | 开发者、coding agent |
| [answer-json-contract.md](./answer-json-contract.md) | 答案输入/输出契约：字段、类型、校验和生成要求 | 用户、AI、开发者 |
| [question-export-contract.md](./question-export-contract.md) | 题库 JSON 与作业 Markdown 导出契约 | 用户、开发者 |
| [answer-fill-design.md](./answer-fill-design.md) | 答案回填的定位、注入、验证、保存和报告设计 | 开发者 |

根目录 [README](../README.md) 是面向初次使用者的安装和快速操作指南；根目录 [AGENTS.md](../AGENTS.md) 是面向 coding agent 和贡献者的工作约定；[CHANGELOG](../CHANGELOG.md) 记录已发布版本的变化。

仓库还提供[题库转复习 Markdown skill](../.agents/skills/pintia-review-markdown/SKILL.md)：使用时必须提供题库 JSON，答案 JSON 可选。安装和使用方法见[根目录 README](../README.md)。

## 命名和维护规则

- 使用小写 kebab-case 文件名，并在名称中说明文档角色：`*-specification.md`（需求规格）、`*-contract.md`（接口/数据契约）、`*-design.md`（特定流程设计）。架构入口沿用项目约定的 `project-guide.md`。
- 每个主题只保留一份权威说明；README 提供摘要并链接权威文档，不复制完整技术细节。
- 代码行为是事实来源。修改文档前核对实现；修改用户行为、数据结构、消息、权限或回填流程时，同一变更更新相应文档。
- 只有存在持续维护价值的需求、设计或契约才进入此目录；临时计划、重复规约和过期说明不作为项目文档保留。

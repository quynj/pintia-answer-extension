# 项目导览与系统架构

本文面向维护者和 coding agent，说明扩展的组成、主要数据流、边界和修改入口。用户行为需求见[产品需求规格](./product-specification.md)，操作步骤见根目录 README，字段细节以各契约文档为准。

## 项目是什么

这是一个不依赖前端框架的 Chrome/Edge Manifest V3 扩展。进入 Pintia 页面时可自动检测题目；答案生成、答案回填和作业导出由用户主动发起。扩展不绕过登录、不读取隐藏答案。

## 目录和运行上下文

```text
manifest.json                 扩展权限、后台、弹窗和内容脚本声明
src/
  background/                 Service Worker：消息路由、配置、模型请求、下载
  content/
    content.ts                页面入口：消息、检测与流程协调
    assistant/                助手面板 UI、日志、标签页与导出操作
    extraction/                Pintia API 提取、归一化与作答回顾格式化
    answer/                    按题目定位、答案注入、验证与保存
    question-types.ts          内容脚本间共享的题型标签和判断
  popup/                      工具栏弹窗：检测状态、助手切换、更新提示
  settings/                   AI 配置页面
  shared/                     显式导出的共享类型、数据契约、Prompt 和配置默认值
scripts/                      构建与测试入口
tests/                        纯逻辑回归测试
dist/                         生成的扩展包；不可手工编辑或提交
docs/                         契约、设计和开发文档
```

后台、内容脚本、弹窗和设置页是不同的浏览器上下文。源码通过 TypeScript ES modules 明确依赖；esbuild 为各入口打包成浏览器可加载的经典脚本。浏览器不加载 `src/` 中的 TypeScript 源码。

## 功能数据流

### Pintia 页面识别与题库导出

1. `src/content/content.ts` 接收扩展消息、协调自动检测、渐进式题目更新和页面内缓存。
2. `src/content/extraction/api-extractor.ts` 读取当前页面可见的 Pintia API 资源，并请求题集和题目；列表型题目逐题更新助手，并复用后台 `chrome.storage.session` 中有效期 10 分钟的详情缓存。`src/content/extraction/review-submissions.ts` 解析作答记录及平台评测状态；`src/content/extraction/extractor-common.ts` 负责题型归一化、图片和题目结构处理。
3. 归一化的题目进入助手面板、题库 JSON、作业 Markdown 或兼容答案契约的「我的答案」JSON 导出。
4. `docs/question-export-contract.md` 描述导出数据格式；不得推断或生成平台未返回的标准答案。

### AI 答案与校验/回填

1. `src/content/assistant/assistant-panel.ts` 管理助手状态和答题流程；`src/content/assistant/assistant-panel.template.html` 与 `assistant-panel.css` 定义面板结构和样式；HTML 片段由构建时内嵌，不作为独立扩展资源发布。面板以标签页组织答题、题目导出和日志；答题页的「生成题型」仅筛选提示词/AI 输入，「回填题型」仅筛选答案写入，操作日志只在日志标签页显示并最多保留 200 条；`src/content/assistant/assistant-log.ts` 管理会话内日志，`src/content/assistant/review-export-panel.ts` 负责作业列表与批量导出操作；使用 `src/shared/prompt-builder.ts` 生成模型输入。
2. `src/background/service-worker.ts` 处理 `ask-ai` 消息、调用用户配置的模型，并在答案复核时调用共享校验逻辑。
3. `src/shared/answer-contract.ts` 校验模型答案和粘贴答案；`src/content/answer/answer-runner.ts` 按题目 ID 定位控件、注入答案并验证结果。答题文本框支持答案 JSON；当前 URL 能唯一匹配编程题时也可切换为直接粘贴代码。
4. 回填和保存可能改变用户作答；保持明确的用户操作、题型筛选、失败报告及现有自动保存默认行为。
5. 消息、答案字段和题型规则见 `docs/answer-json-contract.md` 与 `docs/answer-fill-design.md`。

### 弹窗和设置

- `src/popup/popup.ts` 通过 Runtime/Tabs 消息查询题集状态、切换助手和显示 Release 更新信息。
- `src/settings/settings.ts` 负责编辑 AI 服务配置，通过后台消息保存；密钥只保存在扩展本地存储。后台发给 Pintia 内容脚本的配置会隐藏密钥，仅提供是否已配置的状态供助手面板启用 AI 选项。

## 重要边界与约定

- 浏览器权限和外部网络请求须遵守最小权限；增加权限或数据去向时同时更新 README 与产品需求规格。
- `chrome.runtime` 消息的发送方和后台处理器是共同维护的接口。修改消息时搜索所有发送方和接收方，不要让错误变成成功形状的响应。
- `chrome.storage.local` 的配置也是持久化接口。新增字段需有明确类型、默认值和旧存储值兼容策略。
- 题目详情缓存仅放在 `chrome.storage.session`，由后台校验 Pintia 页面消息、按 10 分钟过期；缓存不包含提交记录，强制重新检测会绕过缓存。
- Pintia 响应和页面 DOM 均视为不可信输入。答案回填必须以唯一 `problemId` 定位，不以题干或选项文字模糊匹配。
- 脚本模块只通过导入/导出共享能力，不使用隐式全局命名空间来规避类型边界。
- 业务类型从 `src/shared/types.ts` 显式导入，避免把类型声明暴露为全局名称。
- 类型定义尽量描述业务契约；外部 API 的不确定字段应在边界解析、校验后转为内部类型，避免把 `any` 扩散到业务逻辑。

## 开发流程

```bash
npm ci
npm test
npm run typecheck
npm run build
git diff --check
```

构建后在 Chrome/Edge 加载 `dist/`，不能加载源码目录。发布工作流也只打包 `dist/`。

涉及 Pintia DOM、页面请求或回填时，在测试页面验证；不得在真实作业上试验保存行为。

## 修改入口速查

| 需求 | 主要入口 | 相关契约/文档 |
|---|---|---|
| 题目提取、题型归一、图片 | `src/content/extraction/api-extractor.ts`、`src/content/extraction/extractor-common.ts` | `docs/question-export-contract.md` |
| AI 输入和默认回答 Prompt | `src/shared/prompt-builder.ts` | `docs/answer-json-contract.md` |
| AI 配置默认值/兼容 | `src/shared/ai-config.ts`、`src/background/service-worker.ts` | `AGENTS.md` |
| 答案 JSON 校验 | `src/shared/answer-contract.ts` | `docs/answer-json-contract.md` |
| 答案输入、验证和保存 | `src/content/answer/answer-runner.ts` | `docs/answer-fill-design.md` |
| 作业回顾及我的答案导出 | `src/content/assistant/review-export-panel.ts`、`src/content/extraction/review-submissions.ts`、`src/content/extraction/review-markdown.ts` | `docs/question-export-contract.md`、`docs/answer-json-contract.md` |
| 助手操作日志 | `src/content/assistant/assistant-log.ts` | 始终写入日志控制台，面板内存保存，关闭面板清空 |
| 助手面板和操作流程 | `src/content/assistant/assistant-panel.ts`、`src/content/content.ts` | `README.md`、`docs/product-specification.md` |
| 扩展消息、模型请求、下载 | `src/background/service-worker.ts` | 搜索消息类型的所有调用方 |
| 构建、扩展入口或发布包 | `scripts/`、`manifest.json`、`.github/workflows/release.yml` | 本文、`AGENTS.md` |

## 发布流程

发布新版本时先更新 `manifest.json` 中的版本号，并创建匹配的 `vX.Y.Z` 标签。GitHub Actions 会校验标签与清单版本，运行测试、类型检查和构建，将 `dist/` 打包为 ZIP 并创建 GitHub Release。扩展弹窗读取该 Release 的版本信息，但不会自动替换或安装用户本地目录。

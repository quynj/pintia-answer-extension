# Agent 指引

## 项目约定

- 本项目是 Vue 3、TypeScript、Vite 驱动的浏览器端静态刷题页；当前没有后端 API、路由、全局状态库或持久化层。
- 开始改动前阅读 [docs/SDD.md](./docs/SDD.md) 和相关源码；README 说明面向使用者的行为与运行命令。
- 保持改动聚焦。不要引入服务端、网络同步或浏览器存储，除非需求明确要求并同步更新隐私说明与 SDD。
- 不要把导入的答案解释为权威标准答案；本地作答不自动判分，代码答案不执行。

## 代码边界

- 页面组合与跨功能协调放在 `src/App.vue`；题库行为放在 `src/features/library/`，练习状态和交互放在 `src/features/practice/`。
- 跨题库/练习复用的数据解析和领域类型放在 `src/features/common/practice-data.ts`；练习会话类型放在 `src/features/practice/types.ts`。
- Vue 视图负责展示和发出操作事件，不在视图内重复实现 JSON 解析或数据合并。
- Markdown 内容统一使用 `MarkdownContent.vue` / `utils/markdown.ts` 渲染与净化。图片 URL 必须维持 HTTPS 限制和现有 referrer 策略。
- 延续现有 TypeScript 类型、Vue composable、命名及样式模式；避免无依据的类型断言、宽泛异常捕获和静默失败。用户可见错误通过现有 notice 流程报告。

## 测试与交付

- 数据解析、题库合并改动优先补充 `tests/practice-data.test.js`；题库导入/配对改动补充 `tests/question-library.test.js`；练习状态改动补充 `tests/practice-session.test.js`。
- 完成后至少运行 `npm test` 与 `npm run typecheck`；影响生产构建或依赖解析时再运行 `npm run build`。
- 修改用户可见行为、数据约束、安全/隐私边界或发布流程时，同步更新 [README.md](./README.md) 和 [docs/SDD.md](./docs/SDD.md)。
- 不修改无关文件，不覆盖已有工作区改动；除非用户明确要求，不创建提交。

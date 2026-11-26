# 题间 · 个人刷题室

基于 Vue 3、TypeScript 和 Vite 的独立静态刷题页。支持本平台目录中的题库与配套答案 JSON，也支持导入当前仓库导出的题库 JSON 和答案 JSON。

## 代码结构

- `src/App.vue`：应用入口，协调题库页与练习页、当前题库选择和提示信息。
- `src/features/library/`：题库页、导入配对、合并和题库选择状态。
- `src/features/practice/`：刷题页、作答状态和练习会话恢复。
- `src/features/common/practice-data.ts`：题库与答案解析、题库合并和随机抽题等共享数据逻辑。
- `src/features/practice/types.ts`：练习题、作答和会话快照类型。
- `src/components/MarkdownContent.vue`、`src/utils/markdown.ts`：Markdown 渲染与内容净化。
- `src/styles/common.css`：应用共用的设计变量、布局和响应式样式。
- `tests/`：数据解析、题库管理和练习会话测试。

题库页通过组件事件把文件交给题库功能层处理，不直接解析数据。平台题库目录位于 [`public/question-banks/`](./public/question-banks/)；`catalog.json` 登记题库 JSON 和配套答案 JSON 的地址。

当前项目没有后端 API，题库、答案和练习状态均在当前标签页内存中管理。目录载入层与练习逻辑分离，未来数据源可以提供兼容的清单和 JSON 格式。更完整的系统规格与开发约定见 [SDD](./docs/SDD.md) 和 [AGENTS.md](./AGENTS.md)；可供扩展导出与刷题室复用的题干清洗规范见[仓库文档](../docs/pintia-question-cleaning-rules.md)。

## 本地开发

需要 Node.js 22.18 或更新版本。

从仓库根目录运行：

```bash
cd practice-room
npm ci
npm run dev
npm test
npm run typecheck
npm run build
```

`npm run build` 将静态页面输出到 `dist/`。从仓库根目录向 `main` 分支推送 `practice-room/` 或 Pages 工作流改动后，GitHub Actions 会运行测试、类型检查和构建，并将 `practice-room/dist/` 发布到本仓库的 GitHub Pages 项目站：

<https://quynj.github.io/pintia-answer-extension/>

首次部署前，在仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。工作流使用本仓库的 `GITHUB_TOKEN` 和 Pages OIDC 权限，不需要另配跨仓库 PAT。

## 使用范围

- 本平台题库会从 `public/question-banks/catalog.json` 自动载入，并按题目 ID 关联配套答案。题库列表支持标题搜索和分类筛选；本地导入与合并题库会分别标记。筛选不清除已选题库，“全选当前结果”只操作当前可见项。也可多选导入题库和答案 JSON，优先按 `problemSetId` 自动配对，缺少 ID 时按文件名匹配；也可分别导入答案，或勾选多个题库合并为一套。合并时按 `problemId` 去重，重复项保留首次出现的题目和答案。
- 题库管理与刷题页面分离。刷题页支持单题作答或在全题总览中直接逐题作答、提交；每题答案可随时独立显示或隐藏，不要求先完成作答。点击完成进度会弹出题号状态窗口，重做本题集会清空当前题组的作答记录并保留题组。
- 随机组题的抽题数默认等于勾选题型的题目数量之和，调整题型后会同步更新；也可打乱当前题组。
- 题干按 `content`、`apiData.description`、`prompt`、`title` 的顺序清洗选择；已知平台样例/模板题干会跳过，SQL 模板前缀会在正文有效时剥离。支持保留换行的 Markdown、代码块、KaTeX 数学公式和 HTTPS 图片；程序填空可直接在题干代码块的空位中作答。
- 进度总览区分未作答、作答中、正确、错误、部分正确、待判定和需自行核对。只有导入记录带平台评测状态时才进行保守比对：单选、多选和判断题的答案可用于判断；填空答案不一致时显示待判定；部分正确只采用平台明确标记。主观题、程序题不自动比对。
- 可随时显示或隐藏单题参考答案；全题总览中也可逐题独立显示或隐藏。
- 显示题库总分和题目分值；题库未提供时会明确显示“未提供”。
- 导入的“我的答案”是个人作答记录，不会被当作通用标准答案；作答仅保存在当前页面内存中，不会发送到 Pintia 或写入站点存储。
- 题库、答案和作答仅在当前浏览器标签页内处理，不写入站点存储。渲染题目图片时，浏览器会向题库提供的 HTTPS 图片地址发出请求；不会随请求发送答案。代码答案仅供编辑和自评，不会执行。

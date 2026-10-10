# Pintia 学习辅助工具

Pintia 学习辅助工具是面向 Chrome 和 Edge 的 Manifest V3 浏览器扩展，支持提取当前题集题目、导出结构化题库，并在用户主动操作后调用兼容的 AI 服务生成答案或将符合约定的答案写入 PTA 页面。

本工具遵循站点登录和浏览器权限机制，不读取隐藏答案。模型生成内容可能存在错误；回填前应检查 JSON 格式、答案内容和所选题型。

## 安装

1. 打开 Chrome 的 `chrome://extensions`，或打开 Edge 的扩展管理页。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本项目根目录。
4. 在同一个浏览器中打开 `https://pintia.cn/`，登录后进入具体作业的题目列表页。
5. 等待题目页面加载完成，点击工具栏中的「Pintia 学习辅助工具」即可使用。

进入含题集数据的 Pintia 页面后会自动检测题目，并自动显示答案助手；同一题集只自动检测一次，切换题型不会重复请求。助手默认收起为 P 图标，展开/收起状态会在下次进入题集时恢复。扩展弹窗中的「检测题集」仍可手动重新检测并刷新结果。

扩展弹窗提供「检测题集」和「打开/关闭答案助手」功能；通过弹窗切换只会隐藏或显示面板，不会清除本次页面状态。点击面板标题栏的「×」关闭时，若 AI 任务正在准备或生成，助手会先提示并在确认后取消任务；若已有答案内容，也会提示关闭后不会保留。收起面板不会影响进行中的任务或答案。

答案助手面板中的「自动回填并保存」控制 AI 生成后的自动回填保存，以及单一题型手动回填后的是否保存；关闭时 AI 只载入答案供核对，单一题型手动回填只修改页面。若手动回填的答案实际包含多种可回填题型，即使关闭该开关，也会在开始前提示并征求确认；确认后按题型逐批保存，避免 Pintia 切换分类时拦截导航或丢失未保存答案。自动回填和提示词都只覆盖面板当前勾选的题型；默认选中全部题型，全选时覆盖整套题中的可回填题型。编程题和简答题当前不支持页面回填。可在助手面板开启本次 AI 诊断日志，查看阶段、耗时和错误类别；日志仅保留在当前页面会话，不记录题目、答案或密钥。高级设置默认收起，答案复核默认关闭；启用后，模型先生成初稿，再重新解题并审阅初稿，复核结果作为最终答案。单次模型请求默认最多等待 60 秒，可在高级设置中调整为 10–300 秒；初稿和复核各自计时，因此复核开启时总等待时间可能接近两倍上限。AI 自动回填仅在最终答案返回并通过格式校验后执行；复核未完成或复核结果校验失败时不会自动回填或保存，编辑区保留第一阶段草稿。复核结果还会对照题目 ID、题号、题型、题目顺序和可确认的选择题选项标识进行校验。复核模型默认复用主模型配置，也可单独配置。答案复核不能保证答案正确；自动回填仍可能保存错误答案，请谨慎启用。

答案助手可通过标题栏移动，并可拖动右下角调整窗口大小。

## 发布

发布版本时，先将 [manifest.json](manifest.json) 中的 `version` 更新为新版本并提交，然后创建并推送对应的版本标签。例如：

```bash
git tag v1.0.3
git push origin v1.0.3
```

推送 `v*` 标签会触发 GitHub Actions。工作流会检查标签版本是否与 `manifest.json` 一致，打包 `manifest.json` 和 `src/`，并创建带有自动生成发布说明的 GitHub Release。生成的 ZIP 可直接通过 Chrome 或 Edge 扩展管理页加载。

## 登录与页面提示

扩展不会直接读取或要求用户复制 Cookie，而是在 Pintia 页面内使用 `fetch` 的 `credentials: include` 携带当前站点登录态。

弹窗会根据检测结果给出不同提示：

- **当前页面不是 Pintia**：请切换至 `https://pintia.cn/` 的作业题目页面。
- **页面尚未就绪**：刷新 Pintia 页面，待页面加载完成后重新检测。
- **尚未进入作业题目页**：请进入具体作业的题目列表页，而非 Pintia 首页、课程首页或其他页面。
- **未检测到有效登录状态**：在当前 `pintia.cn` 标签页登录账号，刷新作业页面后再检测。若仍失败，确认浏览器没有拦截该站点 Cookie，并确认登录的是有权访问该作业的账号。
- **当前页面未检测到题目**：确认题目已加载；如问题仍存在，请刷新页面后重新检测。

如果扩展更新后出现「页面尚未就绪」，请刷新已打开的 Pintia 标签页，使新版内容脚本生效。

## 项目文档

- [产品说明](docs/product.md)
- [答案回填设计](docs/answer-fill-design.md)
- [答案 JSON 契约](docs/answer-json-contract.md)
- [开发规约](docs/development-guidelines.md)

## 目录结构

```text
.
├── docs/                     # 项目说明、设计与开发规约
│   ├── answer-fill-design.md
│   ├── answer-json-contract.md
│   ├── development-guidelines.md
│   └── product.md
├── manifest.json             # 扩展入口和权限配置
├── src/
│   ├── shared/                # 跨运行环境共用的配置与提示词
│   │   ├── ai-config.js       # AI 默认配置及旧配置迁移判断
│   │   ├── answer-contract.js # AI 答案 JSON 契约校验
│   │   └── prompt-builder.js  # 唯一的默认提示词与题目输入构造
│   ├── background/
│   │   └── service-worker.js  # 配置存储、模型请求和扩展页面消息
│   ├── content/               # 注入 Pintia 页面运行的功能模块
│   │   ├── assistant-panel.js # 助手面板交互
│   │   ├── answer-runner.js   # 答案校验、定位、回填、验证和保存
│   │   ├── api-extractor.js   # 接口发现、请求和 JSON/Protobuf 解析
│   │   ├── content.js         # 页面消息编排和结果缓存
│   │   └── extractor-common.js# 字段归一和题目去重
│   ├── settings/              # AI 配置扩展页面
│   │   ├── settings.html
│   │   ├── settings.css
│   │   └── settings.js
│   └── popup/                 # 工具栏弹窗
│       ├── popup.html
│       ├── popup.css
│       └── popup.js
└── README.md
```

## 导出格式

```json
{
  "title": "作业名称",
  "source": "https://pintia.cn/...",
  "extraction": "api",
  "summaries": {
    "MULTIPLE_CHOICE": { "total": 38, "totalScore": 76 }
  },
  "exportedAt": "2026-09-18T00:00:00.000Z",
  "questions": [
    {
      "number": 1,
      "type": "multiple_choice",
      "prompt": "题目文本",
      "content": "题目原始 Markdown 内容",
      "options": ["选项 A", "选项 B"],
      "images": [
        {
          "url": "https://images.ptausercontent.com/example.jpg",
          "markdownPath": "~/example.jpg",
          "location": "content",
          "index": 42
        }
      ]
    }
  ]
}
```

扩展读取页面已经请求过的 `/api/problem-sets/{problemSetId}/problem-summaries` 和 `/api/problem-sets/{problemSetId}/exam-problems` 接口。

- `problem-summaries` 返回哪些题型，扩展就按题型请求对应的 `exam-problems` 数据，并根据分页信息补齐后续页面。
- 接口可能返回 JSON 或 Protobuf 二进制，扩展会自动选择对应解析方式。
- 题型会归一为 `single_choice`、`multiple_choice`、`true_false`、`fill_blank`、`programming`、`short_answer` 等。
- 每道题会同时保留归一化字段和接口返回的完整原始对象 `apiData` 供导出使用；发送给 AI 时包含题号、ID、题型、题干、选项及必要的图片引用。填空题额外包含题目文本字段（标题、描述、题干、内容等）和 `fillInTheBlankProblemConfig`，避免只依赖可能不完整的单个字段；其他题型不传完整接口配置，避免冗余字段。
- `content` 保留题目原始 Markdown；`images` 汇总题目文本字段及选项中的 Markdown 图片，提供完整访问 URL、原始 Markdown 路径、图片所在字段和 Markdown 字符偏移。`location` 为题目文本字段名（如 `content`、`description`）或 `option`；选项图片还包含从 0 开始的 `optionIndex`。`~/...` 图片路径会映射至 `https://images.ptausercontent.com/...`，已有绝对 URL 保持原样。导出保留完整图片元数据；AI 输入仅携带 URL、位置及必要的选项索引，不会下载图片或把图片内容发送给 AI。
- `extraction` 固定为 `api`。
- 如果 Pintia 更换接口名称，可在 `src/content/api-extractor.js` 的 `API_HINTS` 中补充规则。

## 免责声明

本工具仅供个人学习与技术交流使用。使用者应自行确认使用本工具符合所在课程及平台的相关规定，并对使用本工具产生的内容、操作及后果负责。AI 生成内容可能存在错误，开发者不对其准确性或完整性作出保证。

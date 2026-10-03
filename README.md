# Pintia 学习辅助工具

Pintia 学习辅助工具是一个运行在用户浏览器中的 Chrome / Edge Manifest V3 扩展。它帮助用户整理当前已打开题集的题目、生成结构化题库文件，并在用户主动操作后调用兼容的 AI 服务生成答案，或将符合约定的答案写入 PTA 页面。

工具不绕过登录或站点权限，不读取隐藏答案。模型生成内容可能不准确，用户应在回填前检查 JSON、答案内容和题型勾选状态。

## 安装

1. 打开 Chrome 的 `chrome://extensions`，或打开 Edge 的扩展管理页。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本项目根目录。
4. 在同一个浏览器中打开 `https://pintia.cn/`，登录后进入具体作业的题目列表页。
5. 等待题目页面加载完成，点击工具栏中的「Pintia 学习辅助工具」即可使用。

检测结果会暂存在当前 Pintia 页面中。下载时复用检测结果，不会重复请求；再次点击「检测题库」才会刷新。

扩展弹窗只提供「检测题库」和「打开助手面板」。题库导出、Prompt 复制、AI 分析和答案回填都可在页面助手中完成；从助手面板的「AI 配置」入口可打开配置页，不必重新点击扩展。

AI 配置页可选开启「API 返回后自动回填并保存」。开启后，点击「API 辅助分析」会校验模型返回的答案，并按当前勾选题型回填和触发页面保存；关闭时仍需检查答案后手动回填。自动模式可能直接保存错误答案，请谨慎启用。

助手面板可拖动标题栏移动，也可从右下角拖动调整宽高。

## 登录与页面提示

扩展不会直接读取或要求用户复制 Cookie，而是在 Pintia 页面内使用 `fetch` 的 `credentials: include` 携带当前站点登录态。

弹窗会根据检测结果给出不同提示：

- **不是 Pintia 页面**：请切换到 `https://pintia.cn/` 页面。
- **页面尚未准备好**：刷新 Pintia 页面，等待加载完成后再检测。
- **还没有打开作业题目页**：请进入具体作业的题目列表页，而不是 Pintia 首页、课程首页或其他页面。
- **未检测到有效登录状态**：在当前 `pintia.cn` 标签页登录账号，刷新作业页面后再检测。若仍失败，确认浏览器没有拦截该站点 Cookie，并确认登录的是有权访问该作业的账号。
- **当前页面没有可导出的题目**：确认题目已经加载；必要时刷新页面并重新检测。

如果扩展更新后出现「页面尚未准备好」，请先刷新已经打开的 Pintia 标签页，让新的内容脚本生效。

## 项目文档

- [产品说明](docs/product.md)
- [答案回填设计](docs/answer-fill-design.md)
- [答案 JSON 契约](docs/answer-json-contract.md)

## 目录结构

```text
.
├── docs/                     # 产品与回填设计文档
│   ├── answer-fill-design.md
│   ├── answer-json-contract.md
│   └── product.md
├── manifest.json             # 扩展入口和权限配置
├── src/
│   ├── shared/                # 跨运行环境共用的配置与提示词
│   │   ├── ai-config.js       # AI 默认配置及旧配置迁移判断
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
      "options": ["选项 A", "选项 B"]
    }
  ]
}
```

扩展读取页面已经请求过的 `/api/problem-sets/{problemSetId}/problem-summaries` 和 `/api/problem-sets/{problemSetId}/exam-problems` 接口。

- `problem-summaries` 返回哪些题型，扩展就按题型请求对应的 `exam-problems` 数据，并根据分页信息补齐后续页面。
- 接口可能返回 JSON 或 Protobuf 二进制，扩展会自动选择对应解析方式。
- 题型会归一为 `single_choice`、`multiple_choice`、`true_false`、`fill_blank`、`programming`、`short_answer` 等。
- 每道题会同时保留归一化字段和接口返回的完整原始对象 `apiData`，发送给 AI 时使用完整接口数据，避免选项或题目配置丢失。
- `extraction` 固定为 `api`。
- 如果 Pintia 更换接口名称，可在 `src/content/api-extractor.js` 的 `API_HINTS` 中补充规则。

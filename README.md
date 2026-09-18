# Pintia 学习辅助工具

一个本地运行的 Chrome / Edge Manifest V3 扩展，用于辅助整理和学习 Pintia 作业题目。它可以读取当前作业中的题目数据，导出结构化题目文件，也可以在用户主动选择后，将指定题目发送给兼容 OpenAI Chat Completions 或 Responses API 的第三方模型进行 AI 辅助分析。

题目解析、文件生成、配置和 API Key 保存都在浏览器本地完成。只有用户主动使用 AI 功能时，选定的题目才会发送到已配置的模型服务。本项目不自动提交作业，不绕过登录或权限，不获取隐藏答案，也不代替用户完成需要本人判断的学习过程。

## 工具定位

本工具定位为 Pintia 作业的本地学习辅助工具，主要提供以下能力：

- **题目整理**：读取当前作业已经请求的题目数据，按题型归一化并保留原始接口结构。
- **结构化导出**：将题目、选项、题型、分数和原始接口数据导出为 JSON，便于个人复习、归档或二次处理。
- **AI 辅助分析**：由用户选择题型并主动发起请求，使用自定义模型服务生成答案或分析结果。
- **本地优先**：题目检测和文件生成在浏览器本地完成，模型地址、提示词和密钥保存在扩展本地存储中。

它不是自动答题器、作业提交器或 Pintia 数据抓取服务。AI 输出应作为学习参考，提交作业前请由用户自行核对。

## 安装与使用

1. 打开 Chrome 的 `chrome://extensions`，或打开 Edge 的扩展管理页。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本项目根目录。
4. 在同一个浏览器中打开 `https://pintia.cn/`，登录后进入具体作业的题目列表页。
5. 等待题目页面加载完成，点击工具栏中的「Pintia 学习辅助工具」。
6. 点击「检测题库」，确认识别数量后，可点击「下载当前题库」导出题目数据。
7. 如需 AI 辅助分析，进入「AI 配置」，选择 API 类型，填写 API 地址、模型名称、API Key 和提示词；返回主页面后选择要发送的题型，再点击「AI 辅助分析」。

检测结果会暂存在当前 Pintia 页面中。下载时复用检测结果，不会重复请求；再次点击「检测题库」才会刷新。

### AI 配置

- 默认使用 Chat Completions，地址为 `https://api.openai.com/v1/chat/completions`；也可以切换到 Responses API 并填写 `https://api.openai.com/v1/responses` 或其他兼容服务地址。
- API Key 写入 `chrome.storage.local`，不会写入题库文件，也不会发送给 Pintia 页面。
- 首次保存某个模型服务地址时，浏览器会请求连接该站点的扩展权限。
- Chat Completions 请求使用 `messages`，Responses API 请求使用 `instructions`、`model` 和 `input`。默认提示词只要求最终答案；如需解析过程，可直接在提示词中写明。两种协议都支持标准文本响应。

## 登录与页面提示

扩展不会直接读取或要求用户复制 Cookie，而是在 Pintia 页面内使用 `fetch` 的 `credentials: include` 携带当前站点登录态。

弹窗会根据检测结果给出不同提示：

- **不是 Pintia 页面**：请切换到 `https://pintia.cn/` 页面。
- **页面尚未准备好**：刷新 Pintia 页面，等待加载完成后再检测。
- **还没有打开作业题目页**：请进入具体作业的题目列表页，而不是 Pintia 首页、课程首页或其他页面。
- **未检测到有效登录状态**：在当前 `pintia.cn` 标签页登录账号，刷新作业页面后再检测。若仍失败，确认浏览器没有拦截该站点 Cookie，并确认登录的是有权访问该作业的账号。
- **当前页面没有可导出的题目**：确认题目已经加载；必要时刷新页面并重新检测。

如果扩展更新后出现「页面尚未准备好」，请先刷新已经打开的 Pintia 标签页，让新的内容脚本生效。

## 目录结构

```text
.
├── manifest.json             # 扩展入口和权限配置
├── src/
│   ├── background/
│   │   └── service-worker.js # 本地读取配置并请求第三方模型
│   ├── content/               # 注入 Pintia 页面运行的脚本
│   │   ├── content.js         # 消息编排和结果缓存
│   │   ├── api-extractor.js   # 接口发现、请求和 JSON/Protobuf 解析
│   │   └── extractor-common.js# 字段归一和题目去重
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

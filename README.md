# Pintia 题库下载器

一个本地运行的 Chrome / Edge Manifest V3 扩展，用于把当前 Pintia 作业中的题目导出为 JSON 文件。

所有解析和文件生成都在浏览器本地完成，不会上传题目内容。本项目不包含自动提交、绕过登录或获取隐藏答案的功能。

## 安装与使用

1. 打开 Chrome 的 `chrome://extensions`，或打开 Edge 的扩展管理页。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本项目根目录。
4. 在同一个浏览器中打开 `https://pintia.cn/`，登录后进入具体作业的题目列表页。
5. 等待题目页面加载完成，点击工具栏中的「Pintia 题库下载器」。
6. 点击「检测题库」，确认识别数量后，再点击「下载当前题库」。

检测结果会暂存在当前 Pintia 页面中。下载时复用检测结果，不会重复请求；再次点击「检测题库」才会刷新。

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
- `extraction` 固定为 `api`。
- 如果 Pintia 更换接口名称，可在 `src/content/api-extractor.js` 的 `API_HINTS` 中补充规则。

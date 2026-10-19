# 题库导出格式

答案助手导出的题库为 JSON 文件，包含题集摘要和题目列表。示例：

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

## 数据来源与处理

- 扩展读取 Pintia 页面已经请求过的 `/api/problem-sets/{problemSetId}/problem-summaries` 和 `/api/problem-sets/{problemSetId}/exam-problems` 接口。接口可能返回 JSON 或 Protobuf；扩展会按题型和分页提取题目。
- `extraction` 固定为 `api`。题型会归一为 `single_choice`、`multiple_choice`、`true_false`、`fill_blank`、`programming`、`short_answer` 等标准值。
- 单选和多选选项分别可能来自 `problemConfig.multipleChoiceProblemConfig.choices` 和 `problemConfig.multipleChoiceMoreThanOneAnswerProblemConfig.choices`；两种配置都会归一到 `options`。复制提示词或请求 AI 时，如果选择题没有提取到选项，会提示缺失题号并停止，避免发送不完整题目。
- 每道题会保留归一化字段及接口返回的完整原始对象 `apiData`。`content` 保留原始 Markdown；具体字段随题型和 Pintia 返回数据而异。
- `images` 汇总题目文本和选项中的 Markdown 图片。每项包含可访问的 `url`、原始 `markdownPath`、所在字段 `location` 和 Markdown 字符偏移 `index`；选项图片还包含从 0 开始的 `optionIndex`。`~/...` 路径会映射至 `https://images.ptausercontent.com/...`，绝对 URL 保持原样。
- 导出保留完整图片元数据。发送给 AI 的题目输入仅携带图片 URL、位置及必要的选项索引，不会下载图片或发送图片文件内容。
- 只有用户主动请求 AI 生成答案时，所选题型的题目数据才会发送到配置的模型服务。填空题的 AI 输入会额外携带相关题目文本字段和填空配置；其他题型不会携带完整接口配置。

若 Pintia 更换相关接口名称，可在 `src/content/api-extractor.js` 的 `API_HINTS` 中更新匹配规则。

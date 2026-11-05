# 题库导出契约

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
      "type": "MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER",
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

- 扩展读取题型摘要 `/api/problem-sets/{problemSetId}/problem-summaries`，再按题型请求 `/api/problem-sets/{problemSetId}/exam-problems?exam_id={examId}&problem_type={type}`。即使页面刷新后尚未发出或无法观察到题目接口请求，扩展也会根据当前题集 ID 主动读取摘要和题目；编程题、SQL 编程题、程序填空题和主观题使用对应考试的 `/exam-problem-list` 及 `/exam-problems/{problemId}` 接口读取列表和详情。接口可能返回 JSON 或 Protobuf；扩展会按题型和分页提取题目。
- `extraction` 固定为 `api`。`type` 保持 Pintia 原始大写题型值，例如 `MULTIPLE_CHOICE`、`MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER`、`TRUE_OR_FALSE`、`FILL_IN_THE_BLANK`、`FILL_IN_THE_BLANK_FOR_PROGRAMMING`、`PROGRAMMING`、`SQL_PROGRAMMING` 和 `SUBJECTIVE`。平台别名 `SINGLE_CHOICE` 和 `TRUE_FALSE` 分别规范为 Pintia 类型 `MULTIPLE_CHOICE` 和 `TRUE_OR_FALSE`；其他类型原样保留。
- 单选和多选选项分别可能来自 `problemConfig.multipleChoiceProblemConfig.choices` 和 `problemConfig.multipleChoiceMoreThanOneAnswerProblemConfig.choices`；两种配置都会归一到 `options`。复制提示词或请求 AI 时，如果选择题没有提取到选项，会提示缺失题号并停止，避免发送不完整题目。
- 每道题会保留归一化字段及接口返回的完整原始对象 `apiData`。`content` 保留题干文本；具体字段随题型和 Pintia 返回数据而异。HTML 图片会转换为 Markdown 图片，填空题会按需补充空位占位符。
- `apiData` 保留接口返回的完整原始对象；题目 `type` 及答案 JSON 的 `type` 均使用 Pintia 大写题型值。`PROGRAMMING` 与 `SQL_PROGRAMMING` 都按编程题方式生成提示词和输入代码。
- `images` 汇总题目文本和选项中的 Markdown 或 HTML 图片。每项包含可访问的 `url`、原始 `markdownPath`、所在字段 `location` 和文本字符偏移 `index`；选项图片还包含从 0 开始的 `optionIndex`。`~/...` 路径会映射至 `https://images.ptausercontent.com/...`，绝对 URL 保持原样。Markdown 导出会保留题干中的图片；图片仅出现在其他文本字段时，也会补入题干。
- 填空题和程序填空题的 AI 输入会按各自 `problemConfig` 中的 `blanks[].index` 在题干对应位置插入带编号的空位标记；程序填空题会优先使用详情中的 `description`，保留代码和题目要求。
- 导出保留完整图片元数据。发送给 AI 的题目输入仅携带图片 URL、位置及必要的选项索引，不会下载图片或发送图片文件内容。
- 只有用户主动请求 AI 生成答案时，所选题型的题目数据才会发送到配置的模型服务。填空题和程序填空题的 AI 输入会额外携带相关题目文本字段和填空配置；其他题型不会携带完整接口配置。

若 Pintia 更换相关接口名称，可在 `src/content/extraction/api-extractor.ts` 的 `API_HINTS` 中更新匹配规则。

## 导出 Markdown

导出页在题集概览页或具体题目页识别当前 `problemSetId`，请求 `/api/problem-sets/{problemSetId}/exams` 获取题集名称和考试 ID，并默认勾选当前题目集；概览页只读取元信息，不读取摘要或完整题目。选中题集可直接导出 Markdown、「我的答案」JSON 或题库 JSON。需要导出其他题集时，用户可主动点击「加载题目集」读取可访问列表，再勾选额外题集；多选后会单独显示已选题集清单。列表在当前页面内复用，手动再次加载不会重复请求列表、显示重复题目集或清空现有选择。用户导出已选题集时，扩展先读取摘要，仅请求摘要中数量大于零的题型。常规题型直接请求 `/api/problem-sets/{problemSetId}/exam-problems`，并通过 `exam_id` 和 `problem_type` 查询；编程题、SQL 编程题、程序填空题和主观题先请求 `/api/problem-sets/{problemSetId}/exam-problem-list`（携带 `exam_id` 和 `problem_type`），再按列表中每个子题目的 ID 请求 `/api/problem-sets/{problemSetId}/exam-problems/{problemSetProblemId}` 详情。详情中的 `description` 优先作为实际题目内容，避免导出通用模板 `content`。详情在扩展会话内按题集、考试、题型及子题 ID 缓存 10 分钟，过期后重新请求；手动重新检测会绕过缓存。Markdown 和答案 JSON 还会按题型读取最近提交记录；列表型题目需对每个子题 ID 分别请求 `/api/exams/{examId}/problem-sets/{problemSetId}/last-submissions?problem_type={type}&problem_set_problem_id={problemId}`，避免只返回该题型最后一道详情题的提交。题库 JSON 则导出题目数据及摘要，不包含提交记录。

每套作业可导出一个 Markdown 文件、一个「我的答案」JSON 文件或一个题库 JSON 文件。Markdown 按面板显示的题型名称分组，包含题干、选项和评测标记；可选择是否包含平台返回的最近作答，默认包含。普通题型的作答仅在平台返回可关联的最近提交记录时导出；Markdown 回顾不显示主观题、编程题及 SQL 编程题的作答正文，但仍导出题目正文和可识别的评测标记。题库 JSON 使用 `problemSetId`、题目集元信息、题型摘要及题目列表，与原有题库导出格式兼容，不附带最近提交字段。作答选项不代表标准答案；这些导出均不查找或推断标准答案。

「我的答案」JSON 按每个非空题型读取最近提交接口，并以 `submissionDetails[].problemSetProblemId` 关联至题目；保留有可用且符合[答案 JSON 契约](./answer-json-contract.md)的最近作答，覆盖单选、多选、判断、填空、程序填空、编程、SQL 编程、主观题及接口返回的其他题型。没有提交记录、没有可提取答案或答案形状不兼容的题目会略过，并在助手日志中报告略过数。导出结构为 `problemSetId` 和 `answers`，可直接粘贴到「答题」页。程序题答案中的换行会原样保留。

填空题按 `fillBlankConfig.blanks[].index` 在题干对应位置插入前后留有空格的下划线，确保横线与相邻文字之间仍可正确显示；有原始填空标记时会先移除标记，并避免拼接标题、描述和正文造成重复。填空题不显示普通题型选项。编程题、SQL编程题和主观题会分别显示。导出 `PROGRAMMING`、`SQL_PROGRAMMING` 和 `SUBJECTIVE` 题型时，会读取题目列表及详情。`judgeResponseContents` 等响应中只有能关联到具体题目且明确表示正确或错误的状态才会标记；其余显示“未评测/未知”。Markdown 图片中的 `~/...` 地址会转换为 `https://images.ptausercontent.com/...` 在线地址，不下载图片。

选择多套题目集时，面板显示“题集间隔”，范围为 0–10000 毫秒，默认 300 毫秒，设置保存在扩展本地存储。Markdown、我的答案 JSON 和题库 JSON 三种导出共用该间隔，只在一套题目集的导出完成后、开始下一套前等待。另有“题目详情间隔”，范围为 0–10000 毫秒，默认 1000 毫秒，用于这三种导出中列表型题目（普通编程、SQL 编程、程序填空和主观题）逐题请求详情及最近作答之间的等待；自动识别也使用该设置。

导出设置直接显示在「导出」页，不需要展开折叠项。「包含作答内容」仅控制 Markdown 是否显示最近作答；「我的答案 JSON」始终导出可用的最近提交答案。

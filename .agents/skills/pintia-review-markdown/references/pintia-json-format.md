# Pintia 题库与答案 JSON 数据格式

本文件是 `pintia-review-markdown` skill 的随附参考资料。该 skill 独立安装时，只需保留 `SKILL.md`、本文件及其所引用的本地模板文件。

## 题库 JSON

题库是 JSON 对象，主要字段如下：

| 字段 | 含义 |
| --- | --- |
| `title` | 题库/题集标题，可用于 Markdown 标题。 |
| `problemSetName` | 题集名称；若存在，优先用于展示题集名称。 |
| `problemSetId` | 题集 ID；用于核对可选答案 JSON 是否属于同一题集。 |
| `source` | 题集或题目来源 URL；存在且有效时可作为跳转链接。 |
| `summaries` | 各题型摘要；不是逐题内容，不可用于编造缺失题目。 |
| `questions` | 题目数组，按该数组原始顺序整理。 |

题目对象常见字段：

| 字段 | 含义 |
| --- | --- |
| `id` | Pintia 题目 ID；与答案 JSON 的 `problemId` 精确匹配。 |
| `number` / `questionNumber` | 原题号；保留原值，不用来替代题目 ID。 |
| `type` | Pintia 原始题型，通常为大写字符串。 |
| `content` | 题干或原始 Markdown 内容；通常优先作为题干来源。 |
| `prompt` | 题干文本的备用来源。 |
| `title` | 标题或备用题干来源。 |
| `options` | 选项数组；顺序即选项顺序。选项元素可能是字符串。 |
| `images` | 图片元数据数组。`url` 为可访问地址，`markdownPath` 为原路径，`location` 表示图片所在字段，`optionIndex` 表示选项图片所属的从 0 开始的选项索引。 |
| `apiData` / `problemConfig` | 接口原始数据及题型配置；需要读取填空位置时使用。 |

### 题型

| Pintia `type` | 含义 | Markdown 处理重点 |
| --- | --- | --- |
| `MULTIPLE_CHOICE` | 单选 | 保留全部选项及顺序。 |
| `MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER` | 多选 | 保留全部选项及顺序；不要误写成单选。 |
| `TRUE_OR_FALSE` | 判断 | 保留判断题干；不要凭空增加答案。 |
| `FILL_IN_THE_BLANK` | 普通填空 | 依据空位索引将占位线放回题干。 |
| `FILL_IN_THE_BLANK_FOR_PROGRAMMING` | 程序填空 | 保留代码/题干及空位在代码中的原始位置和顺序。 |
| `PROGRAMMING` | 普通编程 | 保留题意、代码样例和限制；答案代码使用围栏代码块。 |
| `SQL_PROGRAMMING` | SQL 编程 | 保留 SQL 题意和代码样例；答案使用代码围栏。 |
| `SUBJECTIVE` | 主观题 | 保留题意及可用答案；不声称支持页面回填。 |

平台别名 `SINGLE_CHOICE` 对应单选，`TRUE_FALSE` 对应判断。其他未列出的类型保留原始 `type`，不要猜测转换。

## 填空题位置

普通填空与程序填空的空位配置分别通常位于：

- `apiData.problemConfig.fillInTheBlankProblemConfig.blanks`
- `apiData.problemConfig.fillInTheBlankForProgrammingProblemConfig.blanks`

部分题目也可能直接提供 `problemConfig` 下的配置或 `fillBlankConfig`。每个空位的 `index` 是相应题干候选文本中的字符偏移位置，不是题号；用它确定空位在原题干中的位置。输出时按索引从小到大呈现，答案数组（若有）按该顺序解释。题库可能已在文本中包含填空标记（如 `@@ [] (索引)`）或输入框标记；不要将这些内部标记原样当作可读题干，也不要二次插入导致多出空位。

重建位置时，选择能容纳所有索引的原始文本字段；优先保留明确标记空位的文本。每个空在索引所指位置插入带前后空格的占位线（例如 ` ________ `），不移动题干其他文本。若索引越界、缺失、位于 Markdown 图片/链接内部，或无法确认对应文本字段，则不要猜位置：保留可读原文，并在题干末尾按配置顺序列出空位占位线，简短说明原位置无法可靠还原。

若没有可用空位配置，保留题干中原有的下划线或填空标记；不要根据题意推算空位数量或位置。

## 图片与代码

- 图片可内嵌于 `content`、`prompt`、选项文本中，也可能只出现在 `images`。优先保留原文中的图片 Markdown；元数据图片只有在原文缺少该图时才补入。
- 对 `location: "option"` 的图片，使用 `optionIndex` 关联至对应选项；不要放成无关联的题干图片。
- Pintia `~/path/to/image` 路径可以转换为 `https://images.ptausercontent.com/path/to/image`，路径分段做 URL 编码；绝对 URL 保持原样。不请求、下载或替换远程图片。
- 题干中的代码、程序填空和代码答案应使用 Markdown 围栏展示。原样保留内容与换行；若内容中反引号较长，使用更长的围栏，避免截断。

## 答案 JSON 与平台状态

答案 JSON 的基本结构为：

```json
{
  "problemSetId": "题集 ID 或 null",
  "answers": [
    {
      "questionNumber": 1,
      "problemId": "题目 ID",
      "type": "MULTIPLE_CHOICE",
      "answer": "B",
      "problemStatus": "PROBLEM_ACCEPTED"
    }
  ]
}
```

每个答案项的 `problemId` 应与题库题目 `id` 精确相同；同一题集时 `problemSetId` 应一致。`questionNumber` 用于展示，不能作为优先匹配键。`type` 保留 Pintia 原始题型。`answer` 会随题型变化：单选为字符串，多选为字符串数组，判断为布尔值，填空和程序填空为字符串数组，编程/SQL 编程/主观题通常为字符串。答案 JSON 是已有作答数据，不是标准答案数据。

`problemStatus` 是可选字段，常见取值如下：

| 值 | 可呈现的含义 |
| --- | --- |
| `PROBLEM_NO_ANSWER` | 平台状态为未作答。 |
| `PROBLEM_SUBMITTED` | 已提交；该状态本身不能证明正确或错误。 |
| `PROBLEM_WRONG_ANSWER` | 平台判定该作答错误。 |
| `PROBLEM_ACCEPTED` | 平台判定该作答通过/正确。 |

将 `problemStatus` 仅用于它所在答案项的状态说明，并只在 `problemId` 与题库题目 `id` 精确匹配时合并。缺失、未知或无法匹配的状态应显示为未知/未提供；不得根据题目答案内容、题型、其他题目状态或题号推断正确性。

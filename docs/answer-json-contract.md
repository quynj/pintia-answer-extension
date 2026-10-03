# 答案 JSON 契约

## 顶层结构

答案必须是 JSON 对象，包含 `problemSetId` 和 `answers`：

```json
{
  "problemSetId": "2103814750050508800",
  "answers": [
    {
      "questionNumber": 1,
      "problemId": "2103815555000360960",
      "type": "single_choice",
      "answer": "B"
    }
  ]
}
```

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `problemSetId` | 字符串或 `null` | 表示整套题集。若页面已有题集 ID 且答案中也提供了非空 ID，两者必须一致。 |
| `answers` | 数组 | 每个元素对应一题。 |
| `questionNumber` | 数字或 `null` | 用于报告和显示；不用于定位题目。 |
| `problemId` | 非空字符串 | PTA 当前题目的唯一 ID；用于导航后的精确 DOM 定位。必须原样提供。 |
| `type` | 字符串 | 使用下表中的标准题型值。 |
| `answer` | 随题型变化 | 按下表提供。 |

对象可以含其他字段，但当前解析器不会用它们定位题目或执行回填。

## 支持题型和答案值

| `type` | `answer` 类型 | 示例 | 执行行为 |
| --- | --- | --- | --- |
| `single_choice` | 非空字符串 | `"B"` | 定位 `input-radio-option-{problemId}-{answer}` 并点击。 |
| `multiple_choice` | 字符串数组，元素非空且不重复 | `["A", "C"]` | 将所有选项同步到该目标集合，含取消多余选项。 |
| `true_false` | 布尔值 | `true` | `true` 映射为 `TRUE`，`false` 映射为 `FALSE`。 |
| `fill_blank` | 字符串数组 | `["Java", "Spring Boot"]` | 数组下标对应 `data-blank-index`。 |
| `programming` | 当前不限制答案形状 | `"..."` | 不回填，逐题标记为跳过。 |
| `short_answer` | 当前不限制答案形状 | `"..."` | 不回填，逐题标记为跳过。 |

多选和填空可传空数组；多选数组不允许重复选项。填空数组的每个元素必须是字符串。

## 完整示例

```json
{
  "problemSetId": "2103814750050508800",
  "answers": [
    {
      "questionNumber": 1,
      "problemId": "2103815555000360960",
      "type": "single_choice",
      "answer": "B"
    },
    {
      "questionNumber": 2,
      "problemId": "2103815555000360961",
      "type": "multiple_choice",
      "answer": ["A", "C"]
    },
    {
      "questionNumber": 3,
      "problemId": "2103815555000360962",
      "type": "true_false",
      "answer": false
    },
    {
      "questionNumber": 4,
      "problemId": "2103815555000360963",
      "type": "fill_blank",
      "answer": ["Java", "Spring Boot"]
    }
  ]
}
```

## 校验和失败时机

以下问题会在回填启动前拒绝整个答案对象：非法 JSON、顶层类型错误、题集 ID 不匹配、`answers` 不是数组、题目项格式错误、重复 `problemId`、缺少题号/ID/题型/答案字段，或受支持题型的答案类型不正确。

JSON 通过校验后，某题仍可能因导航、题目根节点、选项/空位控件、验证或保存问题而单题失败。单题执行失败不会使整个任务崩溃，具体结果会出现在执行报告。

当前勾选框会筛选复制 Prompt、API 分析和答案回填。答案中未勾选的受支持题型会在报告中标记为 `skipped: true`，原因是 `question type not selected`。编程题、简答题和未知题型也会被跳过。

## 生成要求

- 返回纯 JSON，不要 Markdown 代码块、解释文字或注释。
- `problemId` 必须来自题目数据，不得根据题号推测或生成。
- 每个 `problemId` 在 `answers` 中只能出现一次。
- 使用标准 `type` 值，不要输出本地化题型名称。
- 判断答案必须使用 JSON 布尔值，不要使用字符串 `"true"` 或 `"false"`。
- 填空答案顺序必须与 PTA 空位索引顺序一致。

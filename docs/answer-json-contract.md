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
      "type": "MULTIPLE_CHOICE",
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
| `type` | 字符串 | 使用 Pintia 返回的原始题型值，保持大写及拼写原样。 |
| `answer` | 随题型变化 | 按下表提供。 |

对象可以含其他字段，但当前解析器不会用它们定位题目或执行回填。

## 支持题型和答案值

| `type` | `answer` 类型 | 示例 | 执行行为 |
| --- | --- | --- | --- |
| `MULTIPLE_CHOICE` | 非空字符串 | `"B"` | Pintia 单选题；定位 `input-radio-option-{problemId}-{answer}` 并点击。 |
| `MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER` | 字符串数组，元素非空且不重复 | `["A", "C"]` | Pintia 多选题；将所有选项同步到该目标集合，含取消多余选项。 |
| `TRUE_OR_FALSE` | 布尔值 | `true` | `true` 映射为 `TRUE`，`false` 映射为 `FALSE`。 |
| `FILL_IN_THE_BLANK` | 字符串数组 | `["Java", "Spring Boot"]` | 数组下标对应 `data-blank-index`。如果题目提供 `fillInTheBlankProblemConfig.blanks`，数组长度必须与其空位数量一致，并按 `index` 顺序排列。 |
| `FILL_IN_THE_BLANK_FOR_PROGRAMMING` | 字符串数组 | `["ellipse", "center", "0 auto"]` | 按 `fillInTheBlankForProgrammingProblemConfig.blanks` 的 `index` 顺序逐空作答；程序填空题暂不支持页面回填。 |
| `PROGRAMMING` | 非空字符串 | `"print('hello')"` | 按题目 ID 在题目容器中定位代码编辑器，并逐字输入到操作前记录的光标位置；若页面无题目容器，单题答案回退到页面唯一可见的代码编辑器，多题答案则只处理 URL 中与题目 ID 匹配的当前页题目。 |
| `SQL_PROGRAMMING` | 非空字符串 | `"SELECT id FROM students;"` | 与 `PROGRAMMING` 使用相同的题目定位和逐字输入流程。 |
| `SUBJECTIVE` | 字符串 | `"..."` | 不回填，逐题标记为跳过。 |

多选可传空数组，数组不允许重复选项。填空数组的每个元素必须是字符串；有空位配置时必须为每个空位提供一个答案。

`type` 直接使用 Pintia 的题型值，不做自建类型转换：单选为 `MULTIPLE_CHOICE`，多选为 `MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER`，判断为 `TRUE_OR_FALSE`，普通填空为 `FILL_IN_THE_BLANK`，程序填空为 `FILL_IN_THE_BLANK_FOR_PROGRAMMING`，编程题为 `PROGRAMMING`，SQL 编程题为 `SQL_PROGRAMMING`，主观题为 `SUBJECTIVE`。程序填空题和普通填空题均按空位顺序返回字符串数组；程序填空题当前不支持页面回填。编程题与 SQL 编程题共用代码生成和页面输入流程；主观题可生成答案，但当前不支持页面回填。其他题型保留接口返回的原始 `type`，未实现回填时会标记为跳过。

## 完整示例

```json
{
  "problemSetId": "2103814750050508800",
  "answers": [
    {
      "questionNumber": 1,
      "problemId": "2103815555000360960",
      "type": "MULTIPLE_CHOICE",
      "answer": "B"
    },
    {
      "questionNumber": 2,
      "problemId": "2103815555000360961",
      "type": "MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER",
      "answer": ["A", "C"]
    },
    {
      "questionNumber": 3,
      "problemId": "2103815555000360962",
      "type": "TRUE_OR_FALSE",
      "answer": false
    },
    {
      "questionNumber": 4,
      "problemId": "2103815555000360963",
      "type": "FILL_IN_THE_BLANK",
      "answer": ["Java", "Spring Boot"]
    },
    {
      "questionNumber": 5,
      "problemId": "2103815555000360964",
      "type": "PROGRAMMING",
      "answer": "print('hello')"
    },
    {
      "questionNumber": 6,
      "problemId": "2103815555000360965",
      "type": "SQL_PROGRAMMING",
      "answer": "SELECT id FROM students;"
    },
    {
      "questionNumber": 7,
      "problemId": "2103815555000360966",
      "type": "SUBJECTIVE",
      "answer": "根据题目要求作答。"
    }
  ]
}
```

## 校验和失败时机

以下问题会在回填启动前拒绝整个答案对象：非法 JSON、顶层类型错误、题集 ID 不匹配、`answers` 不是数组、题目项格式错误、重复 `problemId`、缺少题号/ID/题型/答案字段，或受支持题型的答案类型不正确。

JSON 通过校验后，某题仍可能因导航、题目根节点、选项/空位控件、验证或保存问题而单题失败。单题执行失败不会使整个任务崩溃，具体结果会出现在执行报告。

当前所选题型会筛选提示词内容、AI 答案生成请求和答案回填范围。答案中未选择的受支持题型会在报告中标记为 `skipped: true`，原因是 `question type not selected`。`SUBJECTIVE` 和未知题型可以参与 AI 生成，但页面回填会被跳过。编程题和 SQL 编程题题干通过题目列表及详情接口获取；复制提示词或请求 AI 前要求所选编程题均已读取完整题干并选择了实现语言，所选语言会加入提示词。扩展不会自动切换 PTA 编辑器的编程语言，用户需要手动选择与助手中所选语言一致的语言。两种编程题回填都会按题目 ID 在题目容器中定位代码编辑器，并向操作前记录的光标位置逐字输入；如果页面没有题目容器，单题答案可回退到页面唯一可见的编辑器；答案里有多道编程题时，会按 URL 中与题目 ID 完全匹配的项只处理当前页题目，其他题目标记为跳过。请在助手操作前将光标放到对应编辑器中，点击助手面板后编辑器无需继续保持焦点。未能定位当前页问题时会显示明确失败原因。

## 生成要求

- 返回纯 JSON，不要 Markdown 代码块、解释文字或注释。
- `problemId` 必须来自题目数据，不得根据题号推测或生成。
- 每个 `problemId` 在 `answers` 中只能出现一次。
- `type` 必须原样使用输入题目中的 Pintia 原始题型值，包括大写和下划线；不要改成自建别名或本地化名称。
- 判断答案必须使用 JSON 布尔值，不要使用字符串 `"true"` 或 `"false"`。
- 填空答案顺序必须与 PTA 空位索引顺序一致。
- 填空题输入包含空位配置时，答案数组长度必须与配置中的 `blanks` 数量一致，不可遗漏空位。
- 程序填空题的 `answer` 必须为字符串数组，长度与 `fillInTheBlankForProgrammingProblemConfig.blanks` 一致，并按 `index` 顺序填写。
- 填空题的 `content` 会按 `fillBlankConfig.blanks[].index` 重建，并使用 `【填空1】`、`【填空2】` 等标记明确空位位置；答案数组按这些标记的编号顺序填写。`fillBlankConfig.blanks` 已按原索引顺序排列，每项的 `number` 与 `content` 标记一致，原始字符 `index` 不再传入 AI，避免与插入标记后的内容位置混淆。
- 填空题的 `questionText` 保留原始字段供补充阅读，但字段可能缺少空位、互相重复，或包含题目模板说明；确定空位位置和顺序时以带编号标记的 `content` 为准，并结合 `questionText` 及 `images` 阅读题意和要求。

## AI 复核结果校验

启用答案复核时，扩展会在采用复核结果前再次检查 JSON 契约，并与本次输入题目逐一对照：题目数量、ID、题号、题型及顺序必须一致。对于已提取到选项列表的选择题（`MULTIPLE_CHOICE` 和 `MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER`），答案必须使用按选项顺序对应的字母标识（A、B、C……），不能用选项正文代替。校验失败时保留第一阶段草稿、禁用自动回填，并在助手中说明复核未完成；校验只验证结构和可定位性，不判断答案知识内容是否正确。

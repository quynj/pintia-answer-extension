(() => {
  const api = globalThis.PintiaPrompt = globalThis.PintiaPrompt || {};

  const outputRules = `请根据提供的题目数据，逐题分析并给出答案。

## 输出要求
你必须严格按照以下 JSON 格式输出：

{
  "problemSetId": "题集ID",
  "answers": [
    {
      "questionNumber": 1,
      "problemId": "题目ID",
      "type": "single_choice",
      "answer": "B"
    }
  ]
}

### 字段说明

- problemSetId：整套题目的 ID，必须从输入数据中获取并原样返回；输入数据没有提供时填写 null。它代表整个练习/题集，不代表单独的一道题。
- questionNumber：题目在当前题集中的题号，必须使用输入数据中的题号，不要自行重新编号；输入数据没有提供时填写 null。
- problemId：PTA 中当前题目的唯一 ID，必须从输入题目数据中获取并原样返回；输入数据没有提供时填写 null，不允许自行生成、修改、猜测或使用 problemSetId 代替。这是后续自动定位 PTA 页面题目 DOM 所使用的关键字段。
- type：必须使用以下标准值之一：single_choice、multiple_choice、true_false、fill_blank、programming、short_answer、answer。
- answer 根据题型使用对应格式：single_choice 为字符串，例如 "A"；multiple_choice 为字符串数组，例如 ["A", "C", "D"]；true_false 为布尔值 true 或 false；fill_blank 为字符串数组，并按照空格在题目中出现的顺序排列；programming 和 answer 根据题目要求返回对应答案；short_answer 为字符串。

## 特别要求

1. problemId 必须与输入数据中的题目 ID 完全一致。
2. 不得通过 questionNumber 推测 problemId。
3. 不得修改、截断或格式化 problemId。
4. 每一道输入题目都应对应 answers 中的一条记录。
5. answers 中的题目顺序必须与输入题目顺序保持一致。
6. 不要遗漏题目。
7. 不要添加输入数据中不存在的题目。
8. questionNumber、problemId、type 必须与输入数据对应。
9. 如果无法确定答案，也必须保留该题，并根据实际情况填写答案；不要删除该题。
10. 最终输出必须是合法 JSON。
11. 不要输出 Markdown 代码块。
12. 不要输出任何解释、分析、前缀或后缀。
13. JSON 中不要包含注释。

## 示例

输入题目：

题目1：
- questionNumber: 1
- problemId: "2103815555000360960"
- type: "single_choice"
- options: A. Java B. Python C. Go D. Rust

题目2：
- questionNumber: 2
- problemId: "2102669809786097700"
- type: "multiple_choice"
- options: A. Java B. Python C. Go D. Rust

题目3：
- questionNumber: 3
- problemId: "2102669809786097664"
- type: "true_false"

题目4：
- questionNumber: 4
- problemId: "2103820707421806592"
- type: "fill_blank"

正确的输出格式：

{
  "problemSetId": "123456789",
  "answers": [
    { "questionNumber": 1, "problemId": "2103815555000360960", "type": "single_choice", "answer": "B" },
    { "questionNumber": 2, "problemId": "2102669809786097700", "type": "multiple_choice", "answer": ["A", "C"] },
    { "questionNumber": 3, "problemId": "2102669809786097664", "type": "true_false", "answer": true },
    { "questionNumber": 4, "problemId": "2103820707421806592", "type": "fill_blank", "answer": ["Java", "Spring Boot"] }
  ]
}

现在开始处理输入的题目数据，并严格按照上述要求输出 JSON。`;

  api.systemPrompt = outputRules;

  api.buildInput = (title, questions, problemSetId) => {
    const questionData = {
      problemSetId: problemSetId ?? null,
      questions: questions.map((question) => ({
        questionNumber: question.number ?? null,
        problemId: question.id ?? question.apiData?.id ?? question.apiData?.problem_id ?? question.apiData?.question_id ?? null,
        type: question.type,
        prompt: question.prompt,
        options: question.options || [],
        optionLabels: (question.options || []).length <= 26
          ? (question.options || []).map((_, index) => String.fromCharCode(65 + index))
          : [],
        images: question.images || [],
        data: question.apiData || question
      }))
    };
    return [
      `题库：${title || 'Pintia 题库'}`,
      '',
      '以下是题集 ID 和题目数据：',
      JSON.stringify(questionData, null, 2)
    ].join('\n');
  };

  api.build = (title, questions, problemSetId, prompt = outputRules) =>
    `${api.buildInput(title, questions, problemSetId)}\n\n${prompt}`;
})();

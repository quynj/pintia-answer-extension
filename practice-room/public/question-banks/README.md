# 平台题库目录

此目录用于存放刷题室随站点发布的题库 JSON、配套答案 JSON 和 `catalog.json` 清单。当前清单包含 10 套 MySQL 和 12 套 Java 题库及其配套作答记录；这些记录仅供复习参考，不代表平台权威标准答案。新增内容前，请确认适合公开发布。

`catalog.json` 格式：

```json
{
  "categories": [
    { "id": "database.mysql", "name": "MySQL" }
  ],
  "banks": [
    {
      "id": "stable-bank-id",
      "categoryIds": ["database.mysql"],
      "questionBankUrl": "stable-bank-id/questions.json",
      "answerUrl": "stable-bank-id/answers.json"
    }
  ]
}
```

分类在 `categories` 中定义一次，每个题库通过 `categoryIds` 引用；未提供分类时显示为“未分类”。清单中的数据地址可以是相对清单的路径，也可以是 HTTPS URL；本地开发时允许同源 HTTP 地址。题库使用刷题室支持的题库 JSON 格式，答案使用对应的答案 JSON 格式。题目和答案仍按 `problemId` 精确关联。载入后的答案作为配套参考内容展示，不代表平台权威标准答案。

刷题室通过统一的目录载入函数读取清单和数据文件。未来接入后端或云端题库时，可由数据源返回同一清单结构及兼容的题库/答案 JSON，无需改动题目练习逻辑。任何远端数据源都应继续遵守项目隐私和数据安全约定。

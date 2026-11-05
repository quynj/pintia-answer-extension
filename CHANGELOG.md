# 更新日志

## v1.6.0

### 中文

- AI 生成答案校验通过后，会按已选「回填题型」自动回填并保存；手动回填也会保存。
- 新增题库转复习 Markdown skill，可将导出的题库 JSON 整理成复习题库；答案 JSON 可选。
- Markdown 作答导出支持展示各题型可关联的最近提交，编程和 SQL 编程作答以代码块显示。

### English

- Validated AI-generated answers are now automatically filled and saved for the selected question types. Manual answer filling also saves changes.
- Added a review Markdown skill that turns exported question-bank JSON into a study/review bank; answer JSON is optional.
- Markdown exports can show the latest associated submissions across question types, with programming and SQL answers displayed as code blocks.

## v1.5.0

### 中文

- 新增「我的答案 JSON」导出，可将平台返回且符合答案格式的最近作答直接用于答题页；无可用答案或格式不兼容的题目会略过，不推断标准答案。
- 列表型题目改为逐题加载，已加载题目可立即用于提示词和 AI 生成；题目详情在扩展会话中缓存 10 分钟，手动重新检测会强制刷新。
- 编程题页面新增当前题代码输入框，可将粘贴的代码直接回填到唯一匹配的当前题目。

### English

- Added a “My Answers JSON” export containing the latest platform-submitted answers that match the answer format. Answers can be pasted into the answering panel; unavailable or incompatible answers are skipped, and no correct answers are inferred.
- List-based questions now load incrementally, so loaded questions can be used in prompts and AI generation immediately. Question details are cached for 10 minutes per extension session; manual re-detection forces a refresh.
- Added a code input for the current programming question, allowing pasted code to be filled into the uniquely matched question.

## v1.4.0

- 新增作业作答回顾 Markdown 导出，可选择是否包含平台返回的最近作答，并显示可识别的评测状态；无法确认时标记为未评测，不推断标准答案。
- 将扩展源码迁移至严格类型检查的 TypeScript，并加入自动化测试、构建脚本和发布前验证。
- 重组项目需求、架构及数据契约文档，明确答案回填与保存行为。

## v1.3.1

- 修复判断题在某些题目中获取不到题干信息的情况
- 移除助手面板顶部多余的当前页面提示

## v1.3.0

- 新增助手全局自动显示控制和题目提取进度提示。
- 新增题目详情请求间隔设置，并将其与多题集导出间隔分开。

## v1.2.0

- 新增程序填空题页面回填：按代码编辑区域中的输入框顺序填写答案，并逐空验证。

## v1.1.0

- 新增程序填空题支持：可提取题目、按空位生成答案并校验答案数量。
- 改进题目页刷新后的题目提取，并完善程序填空题的 Markdown 导出。

## v1.0.7

- 登录后进入任意 Pintia 页面自动打开助手面板；仅在题集概览页和题目页自动识别当前题目集。
- 改进题集识别及 Markdown 导出，可在助手面板中选择并导出多个题目集。
- 优化题目集页面切换时助手面板与当前题集状态的处理。

## v1.0.6

- 新增作业 Markdown 导出：支持从 Pintia 题集页导出题目，并直接下载为 Markdown 文件。
- 完善题目提取与 AI 答案格式校验：强化多选题、填空题、编程题和 SQL 编程题的题型识别和输出规则。
- 修正答案契约与提示词：严格保留 Pintia 原始题型值、problemId、questionNumber 和题目顺序，避免错题、漏题和题型误写。
- 增加 `downloads` 权限，支持浏览器下载导出的 Markdown 文件。

## v1.0.5

- 修复多选题选项未从 Pintia 题目配置中提取的问题。
- 选择题选项缺失时，阻止复制提示词或请求 AI，并显示对应题号。

## v1.0.4

- 新增 GitHub 最新 Release 检查，在扩展弹窗提示可用更新。
- 更新结果缓存 6 小时，并支持手动重新检查。
- 提供 Release 页面入口；本地目录加载的扩展需用户下载、解压并重新加载，不会自动安装更新。

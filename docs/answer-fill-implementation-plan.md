# Pintia 第二阶段：答案回填实现方案

## 1. 目标

第二阶段的核心目标是：

- 把 AI / 网页端模型返回的标准答案，转换成可执行的页面动作
- 在当前 Pintia 题目页面中按题型自动回填
- 不自动提交、不保存、不绕过页面校验
- 支持逐题执行、暂停、继续、跳过和失败重试
- 能在 SPA 单页应用场景下稳定识别当前题目并在页面更新后重定位

该阶段不要求“完美自动提交”，而要求“稳定、可控、可恢复地模拟正常用户输入行为”。

---

## 2. 总体思路

整个回填流程分为五个层次：

1. 题目识别：定位当前题目容器
2. 答案解析：把 AI 结果转成结构化 answer
3. DOM 定位：在当前题目容器中找到对应输入元素
4. 回填执行：模拟用户输入/点击动作
5. 状态验证：确认成功写入并检测页面切题或提交状态

核心原则：

- 不是直接改页面内存状态
- 不是依赖全局 class 或脆弱选择器
- 是通过可见 DOM + 真实事件 + 容器级重定位来完成
- 对 SPA 页面用 MutationObserver 监听变化
- 对失败状态做重试和暂停

---

## 3. 统一答案结构

在第一阶段中，AI 输出最终都应该被规范成统一结构：

```json
{
  "questionId": "xxx",
  "questionNumber": 1,
  "type": "single_choice",
  "source": "web-ai",
  "status": "parsed",
  "answer": "B",
  "rawText": "B",
  "confidence": "medium"
}
```

或者是：

```json
{
  "questionId": "yyy",
  "questionNumber": 2,
  "type": "multiple_choice",
  "source": "api",
  "status": "parsed",
  "answer": ["A", "C"],
  "rawText": "A,C",
  "confidence": "high"
}
```

为了保证回填逻辑一致，所有模块都必须使用同一份标准结构，不允许在自动填题阶段再分别处理不同来源的数据格式。

---

## 4. 题目识别与容器定位

### 4.1 目标

在 SPA 页面中稳定找到当前题目的 DOM 容器，而不是盲目在全局搜索。

### 4.2 定位优先级

推荐优先级如下：

1. 当前题目唯一编号 / 题号
2. 题干文本中出现的稳定关键词
3. 当前题目容器的最近祖先节点
4. 与题型绑定的稳定属性（data-*、name、id、role、aria-label）
5. 最后才使用 class / 样式类兜底

### 4.3 容器定义

每道题都应通过“当前题目容器”作为入口：

```js
const currentQuestion = {
  root: HTMLElement,
  number: 1,
  type: 'single_choice',
  titleText: '题目文本',
  answerTargets: []
};
```

也就是说，所有后续回填操作都应该在 `currentQuestion.root` 内部进行，而不是在整个页面中遨游搜节点。

### 4.4 定位策略

- 先找题目标题
- 向上找最近的题目容器
- 在该容器内查找：
  - radio / checkbox / textarea / input / label
- 如果找不到，则用更保守的文本 + 选项匹配

### 4.5 关键事实

不能依赖全局唯一 class，因为前端框架和组件复用常常导致：

- class 名无序变化
- 组件复用导致同名元素大量重复
- 路由切换导致节点被重建

因此要以“容器 + 语义 + 稳定属性”为核心。

---

## 5. 背景与 SPA 场景下的 DOM 稳定性处理

### 5.1 核心难点

SPA 页面通常会出现以下状态：

- 题目切换时节点被重建
- 三者同时存在：旧节点、占位节点、新节点
- 动态渲染导致选项或 input 在短时间内不稳定
- 组件在数据更新后重新绑定事件

### 5.2 解决办法：MutationObserver

需要对当前题目容器或根节点设置监听：

```js
const observer = new MutationObserver(() => {
  // 页面发生重渲、节点变化、属性变化
  // 重新确认当前题目是否仍然有效
});

observer.observe(rootNode, {
  childList: true,
  subtree: true,
  attributes: true,
  characterData: true
});
```

监听内容包括：

- childList
- subtree
- attributes
- characterData

### 5.3 处理策略

- 发现节点被替换：暂停当前动作并重定位
- 发现页面切题：记录当前题已结束，进入下一题逻辑
- 发现题目容器失效：`isConnected === false` 时重新定位
- 发现快速多次更新：等待稳定窗口再执行填写

### 5.4 稳定窗口

建议在操作前加入“静态窗口”机制：

```js
await waitForStableDom(root, 150);
```

这样在页面正在更新、输入事件还没稳定时，不会立刻 `click()` 或 `value = ...`，从而减少失效动作。

---

## 6. 题型回填策略

### 6.1 单选题

目标：选中正确选项

推荐方式：

- 先定位选项列表
- 找到与答案匹配的 label 或 radio
- 触发点击
- 如元素是 input，则修改 `checked` 并 dispatch `input` / `change`

```js
function fillSingleChoice(root, answer) {
  const target = findChoiceTarget(root, answer);
  if (!target) return false;
  if (target.tagName === 'INPUT') {
    target.checked = true;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    target.click();
  }
  return true;
}
```

注意：

- 优先点击 label，而不是直接修改私有状态
- 不要直接强行 `setAttribute('checked', 'true')` 作为唯一方案

### 6.2 多选题

目标：选中多个选项

策略：

- 解析 `answer` 为数组
- 遍历选项列表
- 对命中的每个选项执行相同的事件链
- 不要一次性全部写完，最好逐个执行，以减少状态冲突

```js
function fillMultipleChoice(root, answers) {
  for (const answer of answers) {
    const target = findChoiceTarget(root, answer);
    if (!target) continue;
    target.click();
  }
  return true;
}
```

### 6.3 判断题

目标：选择正确/错误

策略：

- 处理 true / false 两种值
- 优先匹配文本或按钮语义
- 如果页面用 radio，直接点击对应 radio

### 6.4 填空题

目标：将答案写入对应输入框

策略：

- 找到当前题目容器内所有可编辑输入框
- 按顺序按答案数组赋值
- 对每个 input 触发：
  - focus
  - value = text
  - input
  - change
  - blur

```js
function fillBlank(root, answers) {
  const inputs = getBlankInputs(root);
  answers.forEach((value, index) => {
    const input = inputs[index];
    if (!input) return;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return true;
}
```

### 6.5 编程题

目标：写入代码

策略：

- 识别 textarea / code editor / contenteditable / monaco editor 容器
- 若是 textarea：直接设置 value
- 若是 contenteditable：
  - focus
  - set textContent
  - dispatch input / paste / change
- 若第三方编辑器：优先尝试可见 textarea 或原生 input 容器

### 6.6 简答题

策略：

- 识别 textarea / input / contenteditable
- 直接设置文本并触发事件

---

## 7. 自动回填的执行模型

### 7.1 状态机

自动回填推荐使用状态机：

```text
idle
  -> detect
  -> prepare
  -> fill
  -> verify
  -> next
  -> paused
  -> completed
  -> failed
```

关键状态：

- `detect`: 检测当前题目是否有效
- `prepare`: 获取题目容器和目标元素
- `fill`: 执行回填
- `verify`: 校验是否已写入成功
- `next`: 检测是否切到下一题
- `paused`: 等待用户继续
- `failed`: 产出错误日志

### 7.2 执行流程

```js
async function executeAutoFill(task) {
  setState('detect');
  const current = await locateCurrentQuestion();
  if (!current) return pause('题目未定位');

  setState('prepare');
  const answer = findAnswerForCurrentQuestion(task.answers, current.number);
  if (!answer) return skip('当前题无答案');

  setState('fill');
  const success = fillByType(current.root, current.type, answer);
  if (!success) return fail('回填失败');

  setState('verify');
  const ok = validateFill(current.root, current.type, answer);
  if (!ok) return retry('写入校验失败');

  setState('next');
  await waitForNextQuestionOrPause();
}
```

---

## 8. 校验机制

回填动作不能只看“写入代码执行了”，还必须验证真实生效。

### 8.1 单选/判断/多选

校验：

- `input.checked === true`
- label 状态更新
- 页面 UI 是否已展示选中状态

### 8.2 填空/简答/编程

校验：

- `input.value === expected`
- `textarea.value === expected`
- `contenteditable.textContent` 包含答案

### 8.3 验证失败处理

如果验证失败：

- 记录日志：当前题号、题型、目标元素、答案
- 暂停并提示用户
- 允许“重试 / 跳过 / 停止”

---

## 9. 页面切题与状态检测

### 9.1 为什么必须检测切题

在 SPA 中，当前题目可能在填完后立即切换。若不检测，插件会继续在旧节点上执行，导致错误。

### 9.2 检测手段

- 检测题目标题是否发生变化
- 检测题号是否增加
- 检测当前题目容器是否失效
- 检测下一题按钮是否出现
- 检测页面是否出现“提交成功/已完成”的状态

### 9.3 推荐状态判断

- 页面已切题：自动进入下一题
- 题目已提交：结束
- 题目还未完成：等待
- 题目已卡死：暂停并提示

---

## 10. 错误处理与重试

### 10.1 常见错误

- 题目容器找不到
- 当前节点已失效
- 选项不匹配
- 输入框不存在
- 页面刚渲染未稳定
- 页面切题失败
- 编辑器容器不是原生 input/textarea

### 10.2 重试策略

- 最多重试 2~3 次
- 每次重试前重新定位
- 若重试仍失败则暂停
- 允许人为确认后继续

### 10.3 日志输出

建议输出格式：

```json
{
  "questionNumber": 3,
  "type": "single_choice",
  "status": "retry",
  "reason": "current root is disconnected",
  "attempt": 2,
  "timestamp": "2026-09-19T00:00:00.000Z"
}
```

---

## 11. 用户控制面板要求

自动填题功能必须具有用户可见控制：

- 开始回填
- 暂停
- 继续
- 跳过当前题
- 停止当前任务
- 查看日志
- 查看当前题解析结果

对用户而言，关键不是“黑盒自动跑”，而是“我可以看见它在做什么，并在任何时刻暂停”。

---

## 12. 实施先后顺序

### 第一批先做

- 单选题
- 判断题
- 填空题
- 逐题自动回填
- 验证机制
- 暂停/继续/停止

### 第二批再做

- 多选题
- 简答题
- 编程题
- 复杂编辑器兼容
- 页面切题检测

### 第三批扩展

- 历史答案缓存
- 用户确认模式
- 失败题重试列表
- 自动导出本次流程日志

---

## 13. 最终结论

第二阶段最重要的不是“快速写几个 `document.querySelector`”，而是：

- 先定位当前题目容器
- 再在该容器内找到真实可交互元素
- 用真实事件进行回填
- 用状态验证确认写入成功
- 用 MutationObserver 和题目切换检测保证 SPA 场景下稳定运行

这是一个典型的“基于 DOM 的稳健自动化”方案，适合 Pintia 这种前端框架驱动的单页作业页面。

如果执行时仍出现页面不稳定问题，最根本的修正方法不是“加更多全局选择器”，而是：

- 进一步缩小定位范围
- 增加当前题目容器的稳定性约束
- 在渲染更新时重定位
- 对失败状态做明确定义和重试

这类方案对 SPA 页面和框架化渲染环境最稳，也最符合“用户可控、可暂停、不自动提交”的安全边界。

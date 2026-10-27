---
name: release
description: '为此 Chrome/Edge 扩展准备并发布 GitHub Release。用户要求发布版本、升级版本号或创建版本标签时使用。'
argument-hint: '可选版本：patch、minor、major 或明确的 x.y.z'
user-invocable: true
---

# 发布版本

准备 SemVer 版本，推送版本提交和标签，并验证 GitHub Actions 工作流已创建 Release 及其发布文件。

## 仓库发布约定

- 扩展版本号以 `manifest.json` 中的 `version` 为准。
- 发布说明维护在 `CHANGELOG.md` 中。
- `.github/workflows/release.yml` 在推送匹配 `v*` 的标签时运行，检查标签版本与 manifest 版本一致，打包 `manifest.json` 和 `src`，并生成 GitHub Release 及自动生成的说明。
- 除非工作流不可用且用户授权备用方案，否则不得手动创建或编辑 GitHub Release。

## 流程

1. 检查当前分支、上游分支、远程仓库、完整工作区状态和差异、`manifest.json`、`CHANGELOG.md`、发布工作流，以及现有 Git 标签和 Release。
2. 区分可发布变更与无关或属于用户的变更。不得将无关变更放进发布提交。如果工作区中存在归属或发布范围不明确的变更，应暂停并询问用户。
3. 确认目标版本。如果用户指定了 `patch`、`minor`、`major` 或明确版本号，则按要求执行；否则根据自上个版本以来的变更，推断满足需求的最小 SemVer 升级：
   - 破坏性行为或 API 变更：major
   - 向后兼容的用户可见功能：minor
   - Bug 修复或维护更新：patch
   如果变更范围导致版本升级类型不明确，应先询问。不得复用已有标签或 Release 版本。
4. 运行仓库中可用且相关的测试、语法检查和构建/打包验证。发布前解决与任务相关的失败；明确报告无法运行的检查。
5. 将 `manifest.json` 更新为选定的 `x.y.z` 版本，并在 `CHANGELOG.md` 顶部添加对应的 `## vX.Y.Z` 小节。准确、简洁地总结用户可见变更。
6. 检查准确的暂存区差异，并确认：
   - manifest 版本与去掉前缀 `v` 后的标签版本一致；
   - 更新日志使用对应的 `vX.Y.Z` 标题；
   - 不包含无关文件、机密或凭据；
   - `git diff --check` 通过。
7. 为发布变更创建 Conventional Commit，通常使用 `chore(release): vX.Y.Z`。
8. 将发布提交推送到当前分支配置的上游分支；如果未配置上游，则推送到 `origin <当前分支>`。绝不强制推送。如果推送被拒绝或分支已分叉，应暂停，不得改写历史。
9. 在发布提交上创建附注标签 `vX.Y.Z`，并且只将该标签推送到 `origin`。如果该标签已在本地或远程存在，应暂停；不得移动或覆盖标签。
10. 使用 `gh` 检查由标签触发的 Actions 运行，并在可能时等待结果。验证 GitHub Release 已创建，且包含 `pintia-answer-extension-vX.Y.Z.zip`。如果无法观察工作流运行状态，应报告标签已推送但发布仍待完成，不得提前宣称发布成功。
11. 向用户报告版本号、发布提交和标签、工作流/Release 状态、已执行的验证及任何限制。

不得 amend 既有提交、强制推送、删除标签，也不得从有未处理变更或范围不明确的工作区发布版本。

---
name: release
description: '为此 Chrome/Edge 扩展准备并发布 GitHub Release。用户要求发布版本、升级版本号或创建版本标签时使用。'
argument-hint: '可选版本：patch、minor、major 或明确的 x.y.z'
user-invocable: true
---

# 准备发布版本

准备 SemVer 版本和双语更新日志，通过 PR 合并后由 GitHub Actions 自动创建 Release。

## 仓库发布约定

- 扩展版本号以 `manifest.json` 中的 `version` 为准。
- 发布说明维护在 `CHANGELOG.md` 中。
- 每个新版本的更新日志均须提供中文和英文内容；不要求为本次发布追溯翻译既有版本。
- 扩展相关 PR 应包含 `manifest.json` 版本号和 `CHANGELOG.md` 双语版本说明。
- `.github/workflows/release.yml` 在扩展相关改动合并到 `main` 后运行，校验新版本和更新日志，运行测试、类型检查和构建，打包 `dist/`，并创建版本标签与 GitHub Release。
- 工作流只写入标签和 Release，不向受保护的 `main` 推送提交；不得手动重复创建标签或 Release。
- 除非工作流不可用且用户授权备用方案，否则不得手动创建或编辑 GitHub Release。

## 流程

1. 检查当前分支、完整工作区状态和差异、`manifest.json`、`CHANGELOG.md`、发布工作流，以及现有 Git 标签和 Release。
2. 区分本次可发布变更与无关或属于用户的变更。若工作区变更归属或发布范围不明确，应暂停并询问用户。
3. 确认目标版本。如果用户指定了 `patch`、`minor`、`major` 或明确版本号，则按要求执行；否则根据自上个版本以来的变更，推断满足需求的最小 SemVer 升级：
   - 破坏性行为或 API 变更：major
   - 向后兼容的用户可见功能：minor
   - Bug 修复或维护更新：patch
   如果升级类型不明确，应先询问。不得复用已有标签或 Release 版本。
4. 在功能 PR 中将 `manifest.json` 更新为选定的 `x.y.z` 版本，并在 `CHANGELOG.md` 顶部添加对应的 `## vX.Y.Z` 中英文小节，准确简洁地总结用户可见变化。
5. 运行相关测试、类型检查、构建和 `git diff --check`；检查差异不包含无关文件或机密。
6. 按仓库贡献流程通过 PR 合并版本变更，不要在 `main` 上直接修改、推送提交或手动创建版本标签。
7. 合并后用 `gh` 检查 Actions 运行，验证 GitHub Release 已创建且包含 `pintia-answer-extension-vX.Y.Z.zip`。如果无法观察工作流运行状态，应说明发布仍待完成，不得提前宣称成功。

不得 amend 既有提交、强制推送、删除或移动标签，也不得从有未处理变更或范围不明确的工作区发布版本。

# 贡献指南

欢迎为本仓库添砖加瓦！本文带你从准备开发环境、了解项目和认领工作，一步步完成修改并向上游仓库提交 Pull Request（PR）。浏览器扩展和个人刷题室的开发约定分别见根目录 [`AGENTS.md`](./AGENTS.md) 和 [`practice-room/AGENTS.md`](./practice-room/AGENTS.md)。

## 1. Fork 仓库并准备 Git

点击 **Fork**，将仓库复制到自己的账号下。后续把自己的 Fork 称为 `origin`，上游仓库 `quynj/pintia-answer-extension` 称为 `upstream`。


## 2. 克隆 Fork 并关联上游

将下面的 `<你的 GitHub 用户名>` 替换为自己的用户名；如果 Fork 时更改了仓库名，也请相应修改 URL：

```bash
git clone https://github.com/<你的 GitHub 用户名>/pintia-answer-extension.git
cd pintia-answer-extension
git config --local user.name "你的名字"
git config --local user.email "你的邮箱"
git remote add upstream https://github.com/quynj/pintia-answer-extension.git
git remote -v
```

邮箱可使用 GitHub 已验证邮箱，或 GitHub 提供的 noreply 邮箱。也可以将 `--local` 改为 `--global`，为当前系统上的所有仓库设置同一身份。运行 `git config --local --list` 可查看仓库配置。

确认 `origin` 指向自己的 Fork，`upstream` 指向本仓库。之后可用以下命令同步上游：


## 3. 了解项目并确认工作范围

开始编码前：

1. 阅读根目录 [`README.md`](./README.md)，了解扩展用途、安装方式和用户可见行为。
2. 阅读 [`docs/README.md`](./docs/README.md)，按改动范围阅读对应需求、架构、数据契约或设计文档。涉及个人刷题室时，也先读 [`practice-room/README.md`](./practice-room/README.md)、[`practice-room/AGENTS.md`](./practice-room/AGENTS.md) 和 [`practice-room/docs/SDD.md`](./practice-room/docs/SDD.md)。
3. 在 GitHub 的 **Issues** 和 **Pull requests** 中搜索相关关键词，确认是否已有相同问题、讨论或正在进行的实现。若没有对应 Issue，较大的功能或行为变更建议先开 Issue 讨论范围；小型文档修正可直接开始。
4. 阅读本指南的验证要求，确认变更对应的测试、类型检查和构建命令。

不要直接在 `main` 上开发。先同步上游，再从最新 `main` 创建一个描述本次工作的分支：

```bash
git fetch upstream
git switch main
git pull --ff-only upstream main
git push origin main
git switch -c feat/short-description
```

分支名建议使用 `feat/<topic>`、`fix/<topic>`、`docs/<topic>` 或 `chore/<topic>`。文档专属分支只改文档，不混入代码改动。

## 4. 实现、验证并提交

尽量围绕 Issue 或已讨论的范围做最小且完整的修改。先找到真实实现入口和调用方；数据格式、浏览器 API、消息或存储变更要检查所有读写方，并同步更新直接相关的测试和权威文档。不要提交密钥、题库或答案等与本次变更无关的数据、调试产物及构建产物。Commit提交消息遵循Conventional Commits规范，可直接仓库的使用 `commit-push` skill。

按改动范围运行检查，并在 PR 中如实记录结果：

| 改动范围 | 检查命令 |
| --- | --- |
| 浏览器扩展源码 | 在仓库根目录运行 `npm test`、`npm run typecheck`、`npm run build`、`git diff --check` |
| 个人刷题室 | 在 `practice-room/` 目录运行 `npm test`、`npm run typecheck`、`npm run build`；回到仓库根目录运行 `git diff --check` |
| 仅文档 | 在仓库根目录运行 `git diff --check` |

浏览器扩展的代码改动还应在 Chrome/Edge 中验证相关页面；涉及 Pintia 时只使用测试题集，绝不在真实作业上测试答案保存。不要把构建检查描述成浏览器或 Pintia 手动验证。

检查差异并提交：

```bash
git status --short
git diff --check
git diff
git add path/to/changed-file
git commit -m "描述本次改动"
git push -u origin feat/short-description
```

## 5. 向上游仓库提交 PR

在 GitHub 打开自己的 Fork，选择刚推送的分支，点击 **Contribute → Open pull request**（或 **Compare & pull request**）。确认 PR 的目标仓库为 `quynj/pintia-answer-extension`、目标分支为 `main`，来源为自己的 Fork 和工作分支。

PR 描述请说明：

- 解决的问题和改动目的；
- 主要实现内容，以及需要审查者留意的行为或数据兼容性；
- 实际运行过的测试、类型检查、构建和手动验证；
- 关联 Issue（如有）；界面变更可附截图。

提交后留意 CI 和审查意见；按反馈继续在同一工作分支提交并推送更新。不要绕过失败检查或审查要求。

## 6. 合并规则与部署说明

- `main` 是受保护的主分支。普通协作者的 PR 至少需要 **1 位其他协作者批准**；新提交会使旧审批失效。普通协作者不能强推或删除 `main`。
- `main` 的保护规则要求 `validate-release-metadata` 状态检查通过。该检查会在所有 PR 阶段运行；非扩展改动会直接通过，扩展改动则须更新版本和更新日志。刷题室 Pages 工作流在合并后运行，不能代替 PR 审查或合并前检查。
- 合并到 `main` 后，若 PR 改动了 `practice-room/**` 或 `.github/workflows/deploy-pages.yml`，GitHub Actions 会验证并部署个人刷题室。影响扩展源码或构建产物的 PR 合并后会由 Release 工作流打包发布；详见下方发布说明。
- 合并后可删除已完成的远端工作分支，并在本地同步上游 `main`。

coding agent 仅在用户明确授权时创建提交或推送分支；否则完成修改和检查后，将变更交由用户审阅。

## 浏览器扩展发布

影响扩展源码或构建产物的 PR 应同时更新 `manifest.json` 版本号和 `CHANGELOG.md` 中对应的中英文版本说明。修复通常递增 patch，兼容功能通常递增 minor，破坏性变更递增 major。

此类 PR 合并到 `main` 后，Release 工作流会校验版本与更新日志，运行测试、类型检查和构建，打包扩展并创建匹配的版本标签及 GitHub Release。工作流只需创建标签和 Release，不会向受保护的 `main` 推送提交；不要手动重复创建同一版本的标签或 Release。

## 变更与安全边界

- 更新代码行为时同步更新直接相关的测试和权威文档；用户可见行为变化也应更新相应 README。
- 不提交密钥、个人 API Key、调试产物或与改动无关的文件。
- 保持改动聚焦；不要覆盖他人已有工作区改动，也不要在未获明确授权时创建提交或执行发布。

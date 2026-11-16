# 贡献指南

本文面向本仓库的开发者、贡献者和 coding agent，说明从创建分支到合并和部署的流程。代码与刷题室的详细开发约定分别见根目录 [`AGENTS.md`](./AGENTS.md) 和 [`practice-room/AGENTS.md`](./practice-room/AGENTS.md)。

## 分支与 Pull Request

- `main` 是受保护的主分支。不要直接在 `main` 上开发或推送；从最新的 `main` 创建工作分支，并通过 Pull Request（PR）合并。
- 普通协作者的 PR 至少需要 **1 位其他协作者批准**，新提交会使旧审批失效。仓库管理员可以绕过传统分支保护的全部要求；管理员也应优先通过 PR 合并，并自行检查变更。普通协作者不能强推或删除 `main`。
- 当前没有配置 PR 必需的状态检查。扩展发布工作流会在所有 PR 阶段运行 metadata 检查；非扩展改动会直接通过，扩展改动则须更新版本和更新日志。若要阻止未通过检查的 PR 合并，管理员还需在 `main` 的保护规则中将 `validate-release-metadata` 设为必需状态检查。刷题室 Pages 工作流在合并后运行，不能代替 PR 审查或合并前检查。
- 分支名建议使用 `feat/<topic>`、`fix/<topic>`、`docs/<topic>` 或 `chore/<topic>`。文档专属分支只改文档，不混入代码改动。

典型流程：

```bash
git switch main
git pull --ff-only origin main
git switch -c feat/short-description

# 修改文件并运行相关检查
git add path/to/changed-file
git commit -m "描述本次改动"
git push -u origin feat/short-description
```

随后在 GitHub 上创建目标分支为 `main` 的 PR。PR 描述应说明改动目的、主要内容和已运行的检查；界面改动可附截图。获得一位其他协作者批准后再合并。合并后更新本地 `main`，并删除不再需要的工作分支。

coding agent 仅在用户明确授权时创建提交或推送分支；否则完成修改和检查后，将变更交由用户审阅。

## 提交前验证

按改动范围运行相关检查，并在 PR 中如实列出结果。

### 浏览器扩展（仓库根目录）

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

### 个人刷题室

在仓库根目录执行：

```bash
cd practice-room
npm test
npm run typecheck
npm run build
```

### 仅文档改动

```bash
git diff --check
```

不要把未运行的测试写成已通过，也不要把构建检查描述为浏览器或 Pintia 手动验证。

## 个人刷题室部署

合并到 `main` 后，若 PR 改动了 `practice-room/**` 或 `.github/workflows/deploy-pages.yml`，GitHub Actions 会运行刷题室测试、类型检查和构建，并将构建产物部署到 GitHub Pages。PR 阶段不会触发正式部署；可在仓库 Actions 页面查看部署结果。

## 浏览器扩展发布

影响扩展源码或构建产物的 PR 应同时更新 `manifest.json` 版本号和 `CHANGELOG.md` 中对应的中英文版本说明。修复通常递增 patch，兼容功能通常递增 minor，破坏性变更递增 major。

此类 PR 合并到 `main` 后，Release 工作流会校验版本与更新日志，运行测试、类型检查和构建，打包扩展并创建匹配的版本标签及 GitHub Release。工作流只需创建标签和 Release，不会向受保护的 `main` 推送提交；不要手动重复创建同一版本的标签或 Release。

## 变更与安全边界

- 更新代码行为时同步更新直接相关的测试和权威文档；用户可见行为变化也应更新相应 README。
- 不提交密钥、个人 API Key、调试产物或与改动无关的文件。
- 保持改动聚焦；不要覆盖他人已有工作区改动，也不要在未获明确授权时创建提交或执行发布。

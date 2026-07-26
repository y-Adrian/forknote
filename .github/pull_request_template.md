## Related Issue

<!-- 必填：合并前必须关联 Issue。填写编号，或使用 Fixes/Closes/Resolves #N -->
Related Issue: #___

## Summary

<!-- 简要说明本次改动解决什么问题、为什么需要改 -->

## Test plan

<!--
  打开 PR 前必须完成本地验证；打开时勾选项仍须全部为未勾选（- [ ]）。
  CI「Require checklists start unchecked」在 opened/reopened 时若发现 - [x] 会失败。
  打开后立刻按 Test report 结果编辑为 - [x]。合并前「Require test plan passed」要求全部勾选。

  只写人工产品 / UI 验证步骤。不要把 `npx tsc --noEmit`、`npm run build`、typecheck 或 Build
  写成 Test plan 勾选项——类型检查与生产构建已由 CI「Build」工作流强制执行。
-->
- [ ] 
- [ ] 

## Test report

<!--
  必填：打开 PR 前已完成测试，在此写清证据（环境、测了什么、怎么测、结果）。
  不要空着或推测；未测过的项不要写成通过。
-->

### Environment

- OS / browser (or N/A for docs-only): 
- Branch / commit under test: 
- How verified (manual UI / script / file review): 

### Results

| Item | How tested | Result |
| --- | --- | --- |
| … | … | Pass / Fail |
| … | … | Pass / Fail |

### Notes

<!-- 失败项、跳过原因、后续跟进；无则写 None -->

<!--
  Review：无需手动勾选。
  CI「Require reviews resolved」会自动检测未 Resolve 的评审对话；
  若仓库变量 REQUIRE_APPROVING_REVIEW=true，还会要求至少 1 个真人 Approve。
  每个 PR 只允许 1 个 commit（Require single commit）。
-->

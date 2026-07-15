# Project Agent Instructions

- This repository is auto-merge by default. After completing and validating a
  change, push the branch, update or open the pull request, mark it ready if
  needed, and merge it without asking for additional permission.
- Keep commits and pull requests small and frequent so the GitHub activity
  trail stays active.
- Do not auto-merge if validation fails, the branch has unresolved conflicts,
  GitHub blocks the merge, or a higher-priority instruction requires stopping.
- Treat every worktree and local branch as durable until its intended changes
  are committed and pushed. Never reset, prune, overwrite, or delete a
  worktree that contains uncommitted or unpushed changes.
- Before worktree cleanup, fetch the remote and verify that the worktree is
  clean, every intended commit exists on the pushed branch, the pull request
  contains the complete diff, and the merged commit is reachable from
  `origin/main`. If any step fails, preserve the branch and worktree and report
  the recovery path instead of discarding work.

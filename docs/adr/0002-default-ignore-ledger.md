# Default-ignore the ledger

`.memory/` is local project state for one checkout, not a clone-shared team wiki. Kiro and OpenCode on the same machine share it because the files sit in the project directory, not because git carries them. A fresh clone starts empty unless the owner force-adds files. Tracking-by-default was rejected: this is a personal tool, dream should not dirty git status, and secrets are less likely to be committed. Differs from kuitos by path (project `.memory/` vs `~/.claude/projects/<hash>`), not by being in git.

# Claude Code での切り替え

- `EnterWorktree` に `path` として `git w-p <branch>` の出力を渡す。`name` は使わない。`name` は `.claude/worktrees/` に素の worktree を作り、持ち込みも `.tmp` の共有も行わない。
- `EnterWorktree` が受け付けるのは、セッションを起動したリポジトリ（またはその内側にあるリポジトリ）の worktree だけである。別のリポジトリの worktree は、`git -C <path>` と絶対パスで操作する。
- 別の worktree へ移る前と、いま居る worktree を消す前は、`ExitWorktree` を `action: "keep"` で呼んで起動ディレクトリへ戻る。この経路で入った worktree は `ExitWorktree` では消えないので、削除は `git w-rm` で行う。
- Bash でプロジェクトの外へ `cd` しても作業ディレクトリは戻されるので、`EnterWorktree` を使わない場合は `cd` に頼らず `git -C` と絶対パスを使う。

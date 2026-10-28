# Git identity

| 項目 | 正本と状態 |
|---|---|
| スコープ名とエイリアス | `identity/scope.ts` |
| 保存されたプロファイル | `~/.mev/identity.json` |
| 管理される静的なGit設定 | `~/.config/git/config` |
| 有効なオーバーレイ | `~/.gitconfig` |
| リポジトリへの固定 | 現在のリポジトリの`.git/config`。linked worktreeが共有の設定に解決されるよう、`git config --local`経由で書き込む。 |
| ユースケース | `app/identity.ts`が、表示、設定、切り替え、固定、固定の解除を扱う。 |

Gitのターゲットは、静的なXDG設定を所有する。identityの切り替えは、選択された`user.name`と`user.email`を、変更可能なオーバーレイに書き込み、identityと無関係な既存のオーバーレイの値は保持する。固定は、同じキーをオーバーレイではなく、リポジトリローカルの設定に書き込む。Gitは、`.git/config`、`~/.gitconfig`、`~/.config/git/config`の順に優先して解決するため、固定は、解除されるまで、その後のグローバルな切り替えをすべて覆い隠す。

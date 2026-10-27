---
name: worktree
description: Git worktree の作成、作業場所の切り替え、既定ブランチへの追従、後片付けを mev の git エイリアス（`git w-a` など）で行う。worktree を作る・使う・消す依頼や、ブランチを分けて別の作業場所で進める依頼で使用する。
---

# worktree

mev の worktree エイリアスは、素の `git worktree` に、作成直後からビルドできる状態、main worktree と共有する `.tmp`、git-crypt リポジトリでの checkout、片付けの安全ゲートを加える。worktree の作成と削除はこのエイリアスで行い、`git worktree add` / `remove` を直接使わない。

## 前提

`git config --get-regexp '^alias\.w-'` が `w-a` などを返すこと。返らなければ mev の git 設定が配備されていないので、ユーザーに `mev make git` の実行を求めて止まる。bare リポジトリは対象外。

worktree は main worktree の隣に `<リポジトリ名>-<ブランチ名の / を - にしたもの>` として作られる。どの worktree から実行しても配置と結果は同じ。

## 操作

| コマンド | 結果 |
| --- | --- |
| `git w-a <branch...> [--from <ref>]` | worktree を作る。ローカルにあるブランチはそのまま、リモートにだけあるブランチは追跡付き、どちらにも無いブランチは `origin` を fetch したうえで `origin/<既定ブランチ>` から upstream なしで作る。`--from <ref>` は新しいブランチをその ref から作り、fetch しない。main worktree の ignore 対象を持ち込み、`.tmp` を main worktree の `.tmp` へのリンクにする |
| `git w-p [worktree]` | worktree の絶対パスを1行だけ出す。引数なしは main worktree |
| `git w-ls` | 一覧と状態。`↑`/`↓` は upstream との差、`dirty` は未コミット変更、`(gone)` は upstream の削除、`(locked)` / `(prunable)` は git の登録状態 |
| `git w-mv <worktree> <suffix>` | ディレクトリ名を `<リポジトリ名>-<suffix>` に変える。ブランチ名は変えない |
| `git w-rm <worktree...> [-f]` | worktree を消し、ブランチは残す。`-f` は未コミット変更ごと消す |
| `git w-td [-n]` | origin で削除されたブランチの worktree とブランチを消し、main worktree の既定ブランチを fast-forward する。`-n` は判定だけを出す |
| `git rb-o-h` | 現在のブランチを `origin/HEAD`（既定ブランチ）へ rebase する |

`<worktree>` はパス、ブランチ名、suffix、ディレクトリ名のどれでもよい。複数に一致すると候補を示して止まるので、パスで指定し直す。

## 開始

1. ブランチ名を、リポジトリの規約（`AGENTS.md`、`CLAUDE.md`、ユーザーの指示）に従って決める。規約が無ければユーザーに問う。
2. `git w-a <branch>` を実行する。別のブランチの上に積み上げる場合だけ `--from <ref>` を付ける。
3. `git w-p <branch>` で絶対パスを得る。
4. 作業場所をそのパスへ移す。セッションの作業ディレクトリを既存の worktree へ切り替える機能を持つホストではそれを使う。Claude Code では [Claude Code での切り替え](references/claude-code.md) を読む。その機能が無いホストでは、以降のコマンドをそのパスを作業ディレクトリとして実行し、ファイルは絶対パスで扱う。

`w-a` が止まったときの扱い:

| 出力 | 扱い |
| --- | --- |
| `already checked out at` / `already the worktree for branch` | 既存の worktree を `git w-p <branch>` で得て使う |
| `would not be ignored` | 示された規則と対処をユーザーに伝えて止まる |
| `git fetch origin failed` | ネットワークを確認する。fetch せずに作ることをユーザーが承認した場合だけ `--from <ref>` を付けて再実行する |
| `need a start point` | 起点にする ref をユーザーに問い、`--from <ref>` を付ける |

## 作業中

- `.tmp` は main worktree の `.tmp` そのものである。コンテキスト資料はここに置き、worktree ごとに複製しない。worktree を消しても残る。
- 持ち込まれた依存や生成物は、作成時点の main worktree のものである。このブランチで生成元（`project.yml`、`Podfile`、lockfile など）が main worktree と異なる場合は、リポジトリの手順で再生成してからビルドする。
- 初回の `git push` で `origin/<branch>` が upstream になる。`w-td` はこの upstream の削除を片付けの根拠にするので、ブランチ名と異なる名前のリモートブランチへ push しない。
- 既定ブランチへの追従は `git fetch origin` の後に `git rb-o-h` で行う。既定ブランチは main worktree が checkout しているので、linked worktree で checkout しない。

## 終了

| 状況 | 操作 |
| --- | --- |
| マージ後にリモートのブランチが削除された | `git w-td -n` で対象と skip 理由を確認し、`git w-td` を実行する |
| 作業を放棄する | `git w-rm <worktree>` を実行する。ブランチも消す場合は、ユーザーの承認を得てから main worktree で `git branch -D <branch>` を実行する |
| 後で再開する | 何もしない。`git w-ls` と `git w-p` で戻れる |

- 消す worktree をセッションの作業場所にしている場合は、先に作業場所を main worktree へ戻す。エイリアスは呼び出し元が立っている worktree の削除を拒否するが、`git -C` で別の場所から実行するとその拒否が効かない。
- `git w-rm -f` と `git branch -D` は、未コミット変更と push していないコミットを失わせる。ユーザーの承認なしに使わない。
- `w-td` が skip した worktree は、その理由（未コミット変更、locked、upstream が origin でないなど）をユーザーに伝え、別の手段で消さない。

## 並列作業

複数の作業を herdr のタブごとに別のエージェントで並行させる場合は、worktree-crew プラグインの `wc-01-assemble` を使う。配置規約が同じなので、そこで作られた worktree もこのスキルのエイリアスで扱える。

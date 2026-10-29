# 使い方

公開されている`mev` CLIとそのエイリアス、およびユーザーから見える挙動のコマンドリファレンス。

## プロビジョニング

| コマンド | 動作 |
|---|---|
| `mev make <target...>` (`mk`) | 選択したロールをデプロイし、不足しているパッケージをインストールし、activationを適用する。 |
| `mev create` (`cr`) | `optional`でない登録済みのすべてのターゲットをプロビジョニングする。 |
| `mev sync` (`s`) | 古くなった、`optional`でないターゲットだけを適用する。 |
| `mev update` | 最新のmevのリリースをインストールし、続けて`sync`を実行する。 |
| `mev list` (`ls`) | 登録済みのターゲットを一覧表示する。 |

```bash
mev make git
mev make git shell
mev create
mev sync
mev update
```

Homebrewパッケージを宣言する、選択されたターゲットには、PATH上で`brew`が使えることが必要である。前提条件の検査に失敗すると、プロビジョニングの状態が変わる前に終了コード1で終了する。実行ファイルが利用できない場合は、Homebrewのインストールとシェルのセットアップの手順を報告する。Homebrewパッケージを宣言しないターゲットと、古くなったターゲットがない`sync`は、Homebrewを必要としない。`create`と`sync`は、検査の後に不要になったプロビジョニングの状態を整理する。これには、no-opのsyncによる整理も含まれる。

プロビジョニングは、内部の設定ファイルの検査ではなく、ユーザーが管理するリソースを報告する。`changed`はprobeが変更を観測したこと、`current`はリソースがすでに正しい状態だったこと、`applied`は状態の差分を独立にprobeすることなく操作が成功したことを意味する。失敗は、それによってブロックされた依存リソースを特定する。変更されたリソースと失敗したリソースは個別に列挙され、macOSの設定のような大きなコレクションのうち変更のない要素は、件数でまとめて示される。明示的なパスは個別に表示されたままである。

TTYでの進捗は一時的である。完了したターゲットの結果と最終的な件数はログに残る。エージェントプラグインの進捗は、実行中の各クライアントの操作、プラグインまたはマーケットプレイス、経過時間を示す。リリースバイナリの進捗は、実行中の各バイナリ、現在のフェーズ、判明している場合は解決済みのタグ、そのフェーズの経過時間を示す。リダイレクトされた出力には、プラグインとリリースバイナリの操作の開始、および同じ結果が、アニメーションやANSI制御シーケンスなしで記録される。no-opの`sync`は、再適用が必要なターゲットがないことと、直近に成功した適用と一致しているターゲット定義および管理対象のアセットの数を報告する。アプリが所有する設定ファイルは、宣言されたキーを強制しつつ、アプリケーションが書き込んだキーを保持する。フェーズの境界と結果の意味は[provisioning.md](architecture/provisioning.md)を参照。

### アップグレード

`--upgrade`（`-u`）は、latestを前提とする項目を更新する。`make`と`create`は選択したターゲットの集合にこれを適用し、`sync`はすでに古くなったとして選択されたターゲットにだけ適用する。選択されたターゲットのインストール済みのHomebrewのformulaとcaskはアップグレードされる。mevは`brew update`を実行しない。

アップグレードは、ターゲットのシグネチャを変えず、syncの選択も広げない。固定されたエントリは変更されず、通常のプロビジョニングの実行は、アップグレードモードを必要とせずに、宣言されたエージェントプラグインをインストールして有効化する。

## mevの更新

`mev update`は、公開されている最新のGitHub Releaseを解決する。インストール済みのバージョンは実行中のバイナリから、リリースのバージョンは`v`付きのタグから得る。検証済みのより新しいリリースがあれば、インストール済みのコマンドをアトミックに置き換える。同じバージョンの場合も、公開されているSHA256と照合し、バイトが異なれば再インストールする。ローカルのほうが新しいバージョンは、ダウングレードされずに保持される。

検査または置き換えが成功したあと、`update`はインストール済みのパスそのものを通して`sync`を実行する。`mev update --upgrade`（`-u`）は`sync --upgrade`を実行する。syncを直接呼び出した場合と同じく、これが影響するのは、すでに古くなったとして選択されたターゲットだけである。更新に失敗した場合は古いバイナリのsyncを実行せず、syncに失敗した場合は、新しいバイナリをインストールしたまま残して、直接の再試行に備える。

更新には、インストール済みのスタンドアロンのリリース、または`bun run up`でインストールしたバンドルが必要である。`bun e update`によるソースの直接実行は、ソースファイルやBunのランタイムがインストール済みのコマンドと取り違えられないよう拒否される。

## リポジトリのワークスペース

| コマンド | 動作 |
|---|---|
| `mev make grove` | Groveをインストールし、`gv replace`を通して`~/Desktop/grove.toml`を置き換える。 |
| `mev config ssh-host <alias>` | マシンごとのGitHub SSH hostを、次のsyncのために保存する。 |
| `gv sync` | GitHubの認証後に、カタログからリポジトリを同期する。 |
| `git clone ...` / `g clone ...` | 管理された対話的なシェル関数を通して、Groveのcloneキャッシュを使う。 |
| `command git clone ...` | ネイティブのGitを明示的に使う。 |
| `git cl <url>... -- <options>...` | 共通のcloneオプションで、複数のURLを一括でcloneする。 |
| `git rf-cl <clone arguments>` | リポジトリの`references/`ディレクトリから、Groveを通してcloneする。 |

リポジトリのcloneと更新は`gv sync`が担い、プロビジョニングはどちらも行わない。Groveが使えない場合、対話的なcloneの経路は、そのインストール方法を報告して、ステータス127で終了する。

埋め込みの`grove/grove.toml`アセットは、個人のリポジトリのカタログである。リポジトリの追加、削除、名前の変更は、mevのリリースで配布されるアセットの編集であり、各マシンは`mev update`でそれを取り込み、`gv sync`で新しいリポジトリをcloneする。このアセットは`gv replace`を提供するGroveのリリースを固定しており、インストール済みの`gv`のバージョンが固定と異なれば、古い場合に限らず、同じ実行の中で置き換えられる。

レンダリングでは、標準のGitHub SSHリモートをマシンごとのSSH hostに書き換え、その結果を`gv replace`に渡す。Groveは、カタログから去るリポジトリの移動とゴミ箱への移動、およびoriginの付け替えを、ネットワークを使わずに収束させ、すべてが収束した場合に限って`~/Desktop/grove.toml`を自ら置き換える。収束を妨げるものがあれば、Groveはその理由を報告し、ファイルはそのまま残り、ターゲットは失敗する。成功した実行でのGroveの報告は、通知として表示される。

`~/Desktop/grove.toml`はmevが生成するベースであり、マシンごとの追加は`~/Desktop/grove.override.toml`（`gv add --override`）に置く。ベースへ直接書き込んだ追加は、次の`gv replace`で去るリポジトリになる。クリーンなcheckoutはゴミ箱へ移され、ローカルにしかない状態を持つcheckoutは、それが解消されるまでターゲットを失敗させる。

`~/Desktop/grove.override.toml`はmevの管理外であり、mevはこれを決して作成せず、読み取らず、書き込まない。Groveが各マシンで、レンダリングされたベースの上にこれをマージする。仕事用のリポジトリとその`removed`の宣言はここに置かれるため、オーバーライドを持たないマシンは個人のカタログだけを管理する。

```bash
gh auth login --hostname github.com --git-protocol ssh --web
cd ~/Desktop
gv sync
```

## ターゲットの一覧表示

```bash
mev list
mev ls
```

## 設定

| コマンド | 動作 |
|---|---|
| `mev config agents` (`cf ag`) | AGENTS.mdのセクションを切り替える。 |
| `mev config skills` (`cf sk`) | coderのスキルを切り替える。 |
| `mev config zed` (`cf zd`) | Zedの設定のオーバーライドを切り替える。 |
| `mev config <surface> --clear` | 選択した設定対象のすべてのエントリを無効にする。 |
| `mev config ssh-host <alias>` (`cf sh`) | 有効なOpenSSHのhostエイリアスを保存し、影響を受けるsyncの状態を無効化する。 |

選択コマンドは、`--clear`が指定されない限り、対話的な複数選択を使う。カタログとマニフェストの意味は[config.md](config.md)にある。

## Git identity

| コマンド | 動作 |
|---|---|
| `mev user` (`us`) | identityのサブコマンドを一覧表示する。 |
| `mev user show` | 保存されているidentityと有効なidentityを表示する。有効なidentityには、現在のリポジトリが固定されている場合は`git --local`、そうでない場合は`git --global`のラベルを付ける。 |
| `mev user set` | identityを対話的に設定する。 |
| `mev switch personal` / `work` (`sw`) | 選択したidentityをグローバルのオーバーレイ`~/.gitconfig`へ書き込む。現在のリポジトリがローカルで固定されている場合は、その固定が変更を覆い隠すため警告する。 |
| `mev switch <scope> -w` / `--write` | identityを、オーバーレイではなく現在のリポジトリの`.git/config`へ固定する。gitリポジトリの外では失敗する。 |
| `mev switch -u` / `--unset` | 現在のリポジトリの固定を解除し、再びグローバルのidentityに従うようにする。冪等であり、解除後に有効になるidentityを報告する。gitリポジトリの外では失敗する。 |

`make git`は静的な`~/.config/git/config`を管理し、切り替えは可変のオーバーレイを管理し、固定はリポジトリローカルの設定を管理する。リポジトリローカルの設定は、gitがその両方より優先して解決する。

## worktree

| コマンド | 動作 |
|---|---|
| `git w-a <branch...> [--from <ref>]` | worktreeを追加する。新しいブランチは、fetchした`origin/<default>`から、またはfetchせずに`<ref>`から始まる。 |
| `git w-ls` | worktreeと状態を一覧表示する。 |
| `git w-mv <worktree> <suffix>` | linked worktreeを移動する。 |
| `git w-rm <worktree...>` | linked worktreeを削除し、そのブランチは残す。 |
| `git w-td [-n]` | originのブランチが削除されたworktreeを片付ける。`-n`はプレビューする。 |
| `git w-p [worktree]` | worktreeのパスを出力する。 |
| `wcd [worktree]` | worktreeへ移動する。引数なしの場合はmain worktreeへ戻る。 |

worktreeの配置、起点、持ち込まれるignore対象のファイル、共有の`.tmp`、片付けの安全ゲートは[architecture/worktrees.md](architecture/worktrees.md)にある。

## submoduleの削除

`git sb-d <path>`は、登録済みでリポジトリ相対のsubmoduleパスをちょうど1つだけ、Gitが所有するモジュールストレージを含めて削除する。選択は、リポジトリ内のカレントディレクトリに依存しない。オプション、pathspecパターン、パストラバーサル、曖昧な登録、想定外のストレージは、変更の前に失敗する。部分的に失敗した場合は、完了した操作と、残っている状態の場所を報告する。

## 文書変換

| コマンド | 動作 |
|---|---|
| `md2pdf <input>` | ファイルまたはディレクトリをPDFに変換する。 |
| `pdf2md <input>` | UTF-8のテキストをMarkdownとして抽出する。 |

```bash
mev make shell
md2pdf README.md
md2pdf docs -o exported
md2pdf notes.md --css print.css --margin-top 20mm
pdf2md report.pdf
```

| コマンド | オプション |
|---|---|
| `md2pdf` | `--output-dir`/`-o`、`--css`/`-c`、4つのマージンのオプション |
| `pdf2md` | `--output-dir`/`-o` |

ディレクトリの変換では相対的なツリーが保たれ、出力ディレクトリが指定されない場合の既定は`document_outputs`ディレクトリになる。`pdf2md`はテキストを抽出するだけで、意味的なMarkdown構造は推測しない。変換の境界は[document.md](architecture/document.md)を参照。

## グローバルフラグ

| フラグ | 動作 |
|---|---|
| `--help`、`-h` | コマンドのヘルプを表示する。 |
| `--version` | バイナリのバージョンを出力する。 |

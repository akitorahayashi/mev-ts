# mev-ts

## プロジェクト概要

`mev`はmacOS向けのLocal IaCで、BunとTypeScriptで構築されている。このリポジトリの設定を、個人マシンのセットアップの正本として扱う。ロール単位の設定アセット（dotfiles、ツール設定）をdeploy storeへデプロイし、必要なHomebrewパッケージをインストールし、宣言された出力に対するactivationを、symlinkへの置き換えか冪等なホストコマンドのパイプラインの実行によって適用する。リリース版のインストールではコンパイル済みの単一バイナリを配布し、cloneからの`bun run up`ではBun向けの単一ファイルのJavaScriptバンドルを`mev`としてインストールする。

## ディレクトリ構成

```
src/
  main.ts        CLIのエントリポイント
  errors.ts      型付きのエラー階層
  app/           ユースケースのオーケストレーション（identity、SSH hostの変更、リリースの自己更新、config-selection/上のconfig-toggle.ts）
  agent-plugin/  Claude Code/Codexのマーケットプレイスカタログ、インストール済みプラグインのインベントリ、インストールと有効化の操作
  assets/        埋め込みの設定アセットとアセットレジストリ（コード生成: registry.generated.ts）
  brew/          BrewfileによるHomebrewの一括インストール
  coder/         Coderのセクション/スキルのカタログ、マニフェスト、レンダラー
  cli/
    commands/    コマンドごとに1クラス。registry.tsに列挙される。内部コマンド（hidden）はrunInternalCommandを共有する
      config/    defineConfigCommandで作る設定トグルのコマンドと、GitHub SSH hostの設定（エイリアスは`cf`）
    tty/         ANSIスタイル、文字列レンダラー（table.ts、namespace-overview.tsを含む）、transient-block.ts（注入されたストリーム上のアニメーション付きの進捗）、対話的なトグルのプロンプト
  config-selection/ 共有のconfig-selectionマニフェストのパーサー/リゾルバー
  defaults/      macOS defaultsマニフェストのパーサーとプロトコルのヘルパー
  duti/          dutiのファイル関連付けの状態のprobeと、適用の操作
  editor/        エディター拡張のリストとインストールの操作
  git/           app/internalのコマンドが共有するGitの設定とコマンドのヘルパー
  github/        GitHubリリースのダウンロードと、マシンごとのSSH hostエイリアスのストア
  grove/         マシンごとのSSH hostによるGroveカタログのレンダリングと、`gv validate`の検査
  host/          CommandRunner、Context、HostPath。parse.ts（parsed-unknownのアサーションと、ラベル付きJSONのframing。どちらも送出するエラークラスを受け取る）、yaml.ts（YAMLの読み込みとシリアライズ）、toml.ts（TOMLの読み込みとシリアライズ）、json.ts（JSONオブジェクトの読み込みとシリアライズ）、jsonc.ts（JSONCの読み込みと、コメントを保つ編集）、declared-merge.ts（アプリが所有する設定ファイル向けの、declared-keysのマージと構造的等価性）、transaction.ts（アトミックなステージングとswap-transactionのenvelope）、atomic-file.ts（アトミックな書き込み、変更時のみの書き込み）、regular-file.ts（通常ファイルの整合処理）、command-run.ts（サブプロセスのstep/capture、LC_ALL固定）、https-download.ts（堅牢化したcurlによるダウンロード）、managed-links.ts（共有のsymlink整合処理）、deployed-file.ts（デプロイ済み優先の読み取り）、task-pool.ts（上限付きの並行実行）、cleanup-error.ts（クリーンアップエラーの合成）
  identity/      Git identityのスコープの列挙型と、ディスク上のストア
  internal/
    document/    Pandoc/Popplerによる変換と、ブラウザーによるPDFのレンダリング
    gh/          GitHub CLIのラッパー
    git/         Gitのラッパー（ブランチ、clone、submodule、worktree）
  pipx/          pipxのinstall、inject、post-installの操作
  pnpm/          fnmのランタイム経由でのpnpmグローバルパッケージのインストールと削除
  provisioning/
    activation/  Activation DSLの語彙、kindごとのレジストリ（kinds.ts）、kindごとのランナー、reconcile envelope、マニフェストのローダー
    targets/     プロビジョニングのターゲットごとに1ファイル
    signature.ts パッケージ、activationの意図、埋め込みアセットから導出する、ターゲットのセマンティックなシグネチャ
    applied.ts   成功したシグネチャを`~/.mev/applied/{target}`へアトミックに保存するストア
    role-state.ts アセット単位で、埋め込み版とデプロイ済み版のロールを比較する共有処理
    resource-outcome.ts ユーザーが管理するリソースのステータスとリデューサー
    scan.ts      シグネチャとロール状態のドリフトの並行分類
  version-pin.ts pipx、pnpm、リリースバイナリが共有する、`latest`か固定かの方針
  zed/           Zedのオーバーライドカタログ、選択マニフェスト、設定レンダラー
scripts/
  generate-assets.ts  アセットのコード生成: src/assets/config/を走査し、registry.generated.tsを出力する
tests/                CLI、ファイルシステム、サブプロセス、ネットワークの挙動の統合テスト
```

モジュールが`app/`から独自の`src/<domain>/`ディレクトリへ昇格するのは、2つ目のユースケースがそれを必要とするとき、または外部依存（ツールのプロトコル、ワイヤフォーマット、永続化されたファイル形式）をラップするときに限る。後者については`identity/`、`pipx/`、`duti/`、`editor/`、`github/`を参照。

サプライチェーンの参照では、信頼できるファーストパーティのソースを、サードパーティのソースと区別する。`akitorahayashi`が所有するGitHub ActionsとGitでホストされる依存は、信頼できるメンテナンス更新を手軽に行えるよう、レビュー済みのメジャータグまたはリリースタグを使う。ファーストパーティのエージェントプラグインのマーケットプレイスは例外で、そのSSHソースは、不足しているプラグインをインストールするために`main`を追跡する。一方、インストール済みのプラグインは、明示的な`--upgrade`の実行でのみアップグレードされ、暗黙にはアップグレードされない。また、カタログがアンインストール対象として明示的に列挙した場合に限って削除される。有効化はアップグレードの関心事ではない。宣言されたプラグインは実行のたびに、インストール済みかつ有効な状態へ収束する。インストール済みでも無効なプラグインは何も寄与しないためである。サードパーティのGitHub Actionsはバージョンコメント付きの完全なコミットSHAを使い、サードパーティのGitでホストされる依存は不変の完全なコミットを使う。

## テスト

ユニットテストは、`src/`配下のソースの隣に`*.test.ts`ファイルとして置かれ、ファイルシステム、プロセス、ネットワークへのアクセスを伴わない純粋なロジックを検証する。統合テストは`tests/`配下にあり、ファイルシステム、CLIのルーティング、サブプロセス、ネットワークの挙動を検証する。サンドボックスの規約、フェイクの注入規則、CIの構成はdocs/testing.mdにある。

## 中核概念

### 3フェーズのプロビジョニング

`runMake()`は、ターゲットが宣言したホストの可変状態を保護したうえで、3つの逐次フェーズ（`deployRole()`、`installPackages()`、`runActivation()`）を宣言順に実行する。フェーズの仕組みと保全の境界はdocs/architecture/provisioning.mdを参照。

### Activation DSL

`activation/`はプロビジョニング作業のための内部DSLである。ターゲットは`activation/index.ts`からファクトリをimportし、`kinds.ts`は各`Activation`のkindをそのハンドラーへ対応付ける。ディスパッチ、ビルド時のアセット検証、レジストリのテストは、いずれもこの対応のルックアップである。`src/<tool>/`配下のcapabilityモジュール（`pipx/`、`pnpm/`、`duti/`、`editor/`、`agent-plugin/`、`github/`、`grove/`）は、各外部ツールのプロトコルを所有し、`Context`を受け取る。activationはcapabilityをimportしてよいが、その逆は決して許されない。

kindごとの表と、整合処理およびマニフェストの仕組みはdocs/architecture/activation.mdを参照。

### プロビジョニングのターゲット

各ターゲットは`provisioning/targets/`内のファイルで、`provisioning/registry.ts`に登録される。レジストリのテスト（`src/provisioning/registry.test.ts`）が、登録済みのすべてのターゲットについてアセットの存在とセレクターの一意性を検証するため、ターゲットを追加しても新しいテストファイルは要らない。ターゲットの構造と、`make`/`create`/`sync`がレジストリから選択を導出する方法はdocs/architecture/targets.mdを参照。

### Semantic Sync

`sync`は`fullSetupTargets()`をスキャンし、古くなったターゲットだけを1回の`runMake()`呼び出しに渡す。古くなったと判定されるのは、シグネチャの不一致、または埋め込みロールとデプロイ済みロールのアセット間にドリフトがある場合である。シグネチャのハッシュ化の仕組みと、コマンドactivationが自身の宣言的な意図をそこへ反映する方法はdocs/architecture/targets.mdを参照。

### CLI

`main.ts`は、`cli/commands/registry.ts`に列挙されたコマンドを登録する（上の「ディレクトリ構成」を参照）。コマンドのディスパッチ、`CommandLineError`/`AppError`/`ProvisioningError`の終了コードの対応付け、エラーの分類はdocs/architecture/cli.mdと`src/errors.ts`にある。

### 主要な型

- `Context`: `{ home, commands: CommandRunner, assets: AssetSource, basePath, tmpRoot }`。すべてのプロビジョニング呼び出しを通じて注入され、`createContext()`が組み立てる。テストは`createContext()`を呼ぶ代わりに、`tests/fixtures/`経由で手書きのフェイクを渡す。`basePath`/`tmpRoot`/環境変数の読み取りの仕組みと`CommandRunner.run`の契約はdocs/architecture/host.mdを参照。
- `AssetRef`: `{ key }`。`key`は`src/assets/config/`配下の埋め込みパスで、`deployRoot`（`.mev/roles`、`mevRoot`から導出）配下のdeploy storeのサブパスも兼ねる。
- `HostPath`: 適用時に`context.home`を基準に解決される論理パス。
- `mevRoot`（`host/path.ts`、値は`.mev`）: mevが管理するすべてのパスをその下で所有する、単一のルート`~/.mev`の唯一の正本。配下には、deploy store（`deployRoot`）、生成されたエンティティと選択マニフェスト（coder、zed）、エージェントプラグインのソースの状態、identityの状態、symlink用のディレクトリ（`alias/`、`hooks/`、`rtk/`）がある。`host/path.ts`は`mevPath(...segments)`もエクスポートする。これは`mevRoot`の上にmevが所有するサブパスを組み立てる唯一のビルダーであり、そのため、mevが管理するホストのパスはすべて`mevRoot`から導出され、どの呼び出し箇所も`.mev`のリテラルや別のルートをハードコードしない。
- `Target` / `MakePlan`: ターゲットは、正規名、エイリアス、ロール、パッケージ、`Activation[]`をまとめる。`planMake()`は、選択されたターゲットを、ターゲット名の帰属を保ったまま重複排除した1つのプランにマージする。ターゲットの完全な構造と、`create`/`sync`の選択における`optional`フラグの役割はdocs/architecture/targets.mdを参照。
- `Activation`、`ActivationDescription`、`CommandScope`は`activation/contract.ts`で、`ResourceOutcome`は`provisioning/resource-outcome.ts`で定義される。

### アセットのコード生成

`registry.generated.ts`は、`scripts/generate-assets.ts`が`src/assets/config/`から生成する。手で編集しない。`pree`/`pretest`/`pretest:unit`/`pretest:integration`/`pretypecheck`/`precheck`の各フックで再生成され、`buildMev`もコンパイルの前に再生成するため、バイナリが古いレジストリを埋め込むことはない。埋め込み形式とレジストリの古さの検査はdocs/architecture/assets.mdを参照。

## 文書の責務

- AGENTS.md: ソースの地図、横断的な不変条件、参照先。全体像をつかむための層。
- README.md: インストール、ローカル開発のセットアップ、最小限の使い方の紹介。入口。
- docs/architecture/: プロビジョニングの設計と仕組み。3フェーズのエンジン、activation DSL、ターゲット、Semantic Sync、CLIのディスパッチとエラーのモデル、アセットの埋め込み、identity、文書変換。ファイルごとの索引はdocs/architecture/README.mdを参照。
- docs/config.md: `mev config`の選択サブシステム。カタログ、マニフェスト、オプトイン／オプトアウトの極性、Zedの設定マージのアルゴリズム。
- docs/usage.md: 完全なコマンドリファレンス。すべてのサブコマンド、エイリアス、フラグと、それぞれの挙動。
- docs/testing.md: テストの設計と層の一覧。
- CONTRIBUTING.md: リポジトリの範囲と、ローカルタスクの窓口。

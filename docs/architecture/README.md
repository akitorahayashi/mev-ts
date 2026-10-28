# アーキテクチャ

`mev`はmacOS向けのLocal IaCである。リポジトリの設定が正本であり、コンパイル済みのバイナリは、自身がデプロイする設定アセットを内包している。

## プロビジョニングのフェーズ

| フェーズ | 責務 |
|---|---|
| Preserve | ロールによって置き換えられる前に、ホストの可変状態を保護する。 |
| Deploy | 選択されたロールのアセットを、deploy storeで整合させる。 |
| Install | 必要なHomebrewパッケージを解決する。 |
| Activate | 宣言された各activationを、ターゲットの順に適用する。 |

## 層の構成

| 領域 | 責務 |
|---|---|
| `cli/` | 引数のパース、コマンドのルーティング、終了コード、ターミナルのレンダリング |
| `app/` | identityと設定選択のユースケースのオーケストレーション |
| `provisioning/` | ターゲット、activation、シグネチャ、プロビジョニングのフェーズ |
| `agent-plugin/` | Claude CodeとCodexのインベントリ、およびマーケットプレイスのプロトコル |
| `coder/`、`zed/`、`config-selection/` | カタログ、マニフェスト、選択に応じて生成される設定 |
| `brew/`、`defaults/`、`duti/`、`editor/`、`pipx/`、`pnpm/` | 外部ツールのプロトコル |
| `host/` | Context、サブプロセス、ファイル、パース、トランザクション、共有されるホストの境界 |
| `assets/`、`identity/`、`git/`、`internal/` | 埋め込みアセット、Git identity、Gitのヘルパー、文書とGitの隠しコマンド |

## 文書

- [cli.md](cli.md): コマンドのルーティングと、エラーおよび終了コードの契約
- [provisioning.md](provisioning.md): 保全とプロビジョニングのフェーズ
- [targets.md](targets.md): ターゲットの構造、シグネチャ、Semantic Sync
- [activation.md](activation.md): Activation DSLと、共有される実行の境界
- [agent-plugins.md](agent-plugins.md): プラグインの所有権と整合処理
- [app-owned-config.md](app-owned-config.md): 宣言されたキーの所有権と、デプロイ時の保護
- [command-pipeline.md](command-pipeline.md): コマンドactivationの語彙
- [release.md](release.md): リリースバイナリと、リモートインストーラーの安全性
- [worktrees.md](worktrees.md): worktreeの配置と、後片付けの安全性
- [host.md](host.md): ContextとCommandRunnerの契約
- [assets.md](assets.md): アセットの埋め込みとdeploy store
- [identity.md](identity.md): Git identityの所有権
- [document.md](document.md): Markdown/PDF変換の境界

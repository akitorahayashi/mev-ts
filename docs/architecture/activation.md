# Activation DSL

ターゲットは、`provisioning/activation/`のファクトリでプロビジョニングの作業を宣言する。ランタイムは、1つのレジストリを通じて`Activation['kind']`でディスパッチする。

## kind一覧

| kind | ファクトリ | 契約 |
|---|---|---|
| `file` | `link(source, dest)` | デプロイ済みの1つのアセットをsymlinkとして整合させる。 |
| `groveConfig` | `groveConfig(source, dest)` | マシンごとのGitHub hostでカタログをレンダリングし、インストール済みの`gv replace`に渡す。Groveが去るリポジトリを収束させて配置先を書き込み、その報告は通知になる。固定の更新を新しい`gv`で検査するため、配置先がすでにレンダリングと一致していても毎回実行する。 |
| `tree` | `linkTree(prefix, dest)` | デプロイ済みのアセットのプレフィックスをミラーし、管理対象の古いリンクを削除する。 |
| `defaults` | `applyDefaults(configKey)` | 宣言されたmacOSのdefaultsマニフェストを適用する。 |
| `duti` | `applyDuti(configKey)` | 宣言されたファイルの関連付けを適用する。 |
| `pipx` | `applyPipx(configKey)` | pipxのツール、injection、post-install、明示的な削除を整合させる。 |
| `pnpm` | `applyPnpm(configKey)` | グローバルなpnpmパッケージと、明示的な削除を整合させる。 |
| `editorExtensions` | `installExtensions(command, configKey)` | エディターの宣言済みの拡張機能を整合させる。 |
| `coderAgents` | `coderAgents(sectionsPrefix, dests)` | 選択された埋め込みのエージェントセクションを、複数の配置先へ展開する。 |
| `coderSkills` | `coderSkills(skillsPrefix, targetDirs)` | 選択された埋め込みのスキルファイルを、複数の配置先へ展開する。 |
| `agentPlugins` | `installAgentPlugins(configKey, pathPrefix)` | 宣言されたClaude CodeとCodexのプラグインを整合させる。[agent-plugins.md](agent-plugins.md)を参照。 |
| `zedSettings` | `zedSettings(base, overridesPrefix, dest)` | ベースのアセットと選択されたオーバーライドから、設定を構築する。 |
| `declaredKeys` | `declaredKeys(source, dest, format)` | アプリが所有する文書で、宣言されたキーを強制する。[app-owned-config.md](app-owned-config.md)を参照。 |
| `command` | `runCommand({ label, reads?, steps })` | 順序付きの宣言的なホストコマンドのパイプラインを実行する。[command-pipeline.md](command-pipeline.md)を参照。 |
| `release` | `releaseBinaries(binaries)` | バージョン付きのリリースバイナリを整合させる。[release.md](release.md)を参照。 |
| `remoteInstaller` | `remoteInstaller(options)` | 完全性をレビュー済みのリモートインストーラーを実行する。[release.md](release.md)を参照。 |

## kindのレジストリ

`kinds.ts`は、各kindのdescription、ランナー、参照されるアセット、ビルド時のパーサーの正本である。ディスパッチ、アセットの検証、レジストリのテストは同じテーブルを参照するため、kindの追加は、union型とレジストリに対する1回の変更で済む。

## reconcile envelope

複数の項目を扱うkindは、次の境界を共有する:

| 段階 | 契約 |
|---|---|
| 宣言 | 項目を解決する。宣言の失敗はactivationを中止させる。 |
| ステップの構築 | 共有状態をprobeし、項目ごとに1つのステップを作る。probeの失敗はactivationを中止させる。 |
| 実行 | 項目ごとの失敗を分離し、独立した他の項目は続行する。 |
| 報告 | 各probe結果を、ユーザーが管理するリソースの結果に変換する。 |
| 並行性 | 既定は直列で、独立した作業の並列化はオプトインである。 |

`coderAgents`と`coderSkills`は、このenvelopeを使わないが、展開には同じ項目ごとの失敗の境界を適用する。

## 結果の契約

activationは、`ActivationDescription`と`ResourceOutcome[]`を返す。descriptionは、ユーザー向けの対象を示し、必要に応じて、変更のないメンバーを集約してよいコレクションを特定する。各結果は、影響を受けたパス、設定、パッケージ、関連付け、ランタイム、プラグイン、その他の管理対象のリソースを示す。レポートが持つのは、この結果のコレクション、そのdescription、省略可能な通知だけである。activation全体の失敗は、そのactivationを示す失敗の結果で表し、ブロックされたリソースは、同じコレクションの中に理由を保持する。ステップごとの中間のprobe結果は、整合処理の内部にとどまる。

| ステータス | 意味 |
|---|---|
| `changed` | probeが、リソースの変更を確認した。 |
| `unchanged` | probeが、リソースがすでに最新であったことを確認した。 |
| `applied` | 操作は成功したが、その背後にある状態の変化は、独立には観測できなかった。 |
| `failed` | リソースを整合させられなかった。 |
| `blocked` | 前提条件または先行するリソースが、整合を妨げた。 |

activationとターゲットのステータスは、結果から導出される。失敗は、ブロック、観測された変更、適用された操作、変更のない結果よりも優先される。内部のロール名、マニフェスト、シグネチャ、適用済みマーカーは成功リソースではない。それらの失敗は、フェーズの文脈とともに引き続き表示される。

## マニフェストと選択の境界

マニフェストに基づくkindは、ビルド時に、適用時と同じパーサーでデプロイ済みのアセットを解析する。共有のバージョンマニフェストは、`latest`か、厳密な固定を使う。`latest`はアップグレードモードのときにだけ再解決され、削除は常に明示的である。選択マニフェストと、そのオプトイン／オプトアウトの極性は、[docs/config.md](../config.md)が所有する。

## capabilityの境界

capabilityモジュールは、外部ツールのプロトコル、出力形式、プラットフォームの状態のprobeを所有する。activationモジュールは`Context`を通じてcapabilityに依存し、capability層はactivationの契約をインポートしない。これにより、外部プロトコルの変更がActivation DSLに入り込まない。

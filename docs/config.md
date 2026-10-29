# 設定

`mev config`（`cf`）は、選択可能な設定対象と、マシンごとのGitHub SSH hostを管理する。コマンドの構文は[usage.md](usage.md)、activationの契約は[architecture/activation.md](architecture/activation.md)にある。

## 選択可能な設定対象

| 設定対象 | カタログのソース | マニフェスト | キー | 極性 |
|---|---|---|---|---|
| AGENTS.mdのセクション | `catalog.yml`の順序 | `~/.mev/coder/agents-sections.yml` | `disabled` | オプトアウト |
| Coderのスキル | デプロイ済みのスキルのディレクトリ | `~/.mev/coder/skills-selection.yml` | `disabled` | オプトアウト |
| Zedのオーバーライド | デプロイ済みの`<name>.json`ファイル | `~/.mev/zed/overrides-selection.yml` | `enabled` | オプトイン |

スキルとZedのオーバーライドは、ファイルシステムから導出される。AGENTS.mdのセクションは、これに加えて、カタログのエントリと、同じディレクトリにあるセクションファイルとが1対1で対応することを必要とする。欠けているエントリ、余分なエントリ、重複したエントリがある場合は失敗する。

## 選択マニフェスト

各マニフェストは、名前のリストを持つキーを1つだけ含むYAMLのマッピングである:

```yaml
disabled:
  - some-section-name
```

| 条件 | オプトアウトの設定対象 | オプトインの設定対象 |
|---|---|---|
| マニフェストが存在しない | カタログのすべてのエントリが有効 | 有効なエントリなし |
| 名前が列挙されている | 無効 | 有効 |
| 構造または名前のリストが不正 | `ProvisioningError`で拒否する | `ProvisioningError`で拒否する |
| 名前が現在のカタログにない | プロンプトの前に警告する | プロンプトの前に警告する |
| `--clear` | 現在のカタログを無効として書き込む | マニフェストを削除する |

リゾルバーは、保存するキーを設定対象のポリシーから導出する。そのため、オプトアウトのリストがオプトインのリストとして解釈されることはない。

選択が変更されると、マニフェストを保存する前に、その選択を所有するターゲットの適用済みマーカーが無効化される。そのため、次の`sync`で、選択された出力が再生成される。キャンセルした場合と、有効なエントリが変わらない場合は、マーカーが保持される。無効化に失敗した場合、マニフェストは変更されない。その後の書き込みに失敗すると、ターゲットは古くなった状態のまま安全に残ることがある。

## Zed設定のマージ

デプロイされる`settings.json`は、ベースのアセットに、有効なオーバーライドをカタログの順に重ねたものである。

| 段階 | 規則 |
|---|---|
| オーバーライドの結合 | 選択したフラグメントをディープマージする。競合するリーフのパスは、双方の所有者を示して失敗する。 |
| ベースの適用 | オーバーライドの値は、それが定義するすべてのパスで優先される。 |
| 検証 | オーバーライドのフラグメントは、`__proto__`、`constructor`、`prototype`を拒否する。 |

## GitHub SSH host

| 状態 | 挙動 |
|---|---|
| ストア | `~/.mev/ssh-host`。1行にOpenSSHの`Host`エイリアスを1つ書く。 |
| 有効な値 | 英字、数字、`.`、`_`、`-`。 |
| ストアが存在しない | `github.com`を使う。 |
| ストアの形式が不正 | 失敗する。黙ってフォールバックすることは決してない。 |
| 影響を受けるプロビジョニング | Groveがエイリアスをレンダリングし、agent-pluginの登録がそれをトランスポートとして使う。 |

```text
github-personal
```

GitHub SSH hostを保存すると、影響を受ける適用済みマーカーが無効化され、次の`sync`が、レンダリング済みのURLとマーケットプレイスの登録を整合させる。Groveのカタログは新しいエイリアスで再レンダリングされ、groveターゲットの`gv replace`が、originが古いURLと一致する既存のcheckoutのoriginを付け替える。

## エージェントプラグインのカタログ

埋め込みのカタログは、Claude CodeとCodex向けに、マーケットプレイスとプラグイン名を宣言する。エントリは、列挙したすべてのクライアントに対して同じマーケットプレイスを宣言する。マーケットプレイス名は既定でリポジトリ名になり、`name`が必要なのは、マーケットプレイスのメタデータが別の名前を使う場合だけである。

```yaml
marketplaces:
  - repo: akitorahayashi/agent-device
    clients: [claude, codex]
    plugins: [agent-device, diff-verify]
  - repo: akitorahayashi/xlsx
    clients: [claude, codex]
    plugins: [xlsx]
```

削除は明示的である:

```yaml
marketplaces:
  - repo: akitorahayashi/agent-device
    clients: [claude]
    plugins: [agent-device]
    uninstall: [diff-verify]

removed_marketplaces:
  - repo: akitorahayashi/comment-review
    clients: [claude]
```

プラグインのライフサイクル、ソースの所有権、検証は、[architecture/agent-plugins.md](architecture/agent-plugins.md)に記載している。

## カタログの拡張

| 設定対象 | 追加するもの |
|---|---|
| Zedのオーバーライド | `src/assets/config/zed/overrides/`の下に置く`<name>.json`ファイル。 |
| スキル | デプロイ済みのスキルのソースの下に置く、スキルのサブディレクトリ。 |
| AGENTS.mdのセクション | `<name>.md`ファイルと、`catalog.yml`のエントリ1つ。 |

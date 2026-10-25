# Codex

## 典拠

- [Subagents](https://developers.openai.com/codex/multi-agent)
- [Configuration reference](https://developers.openai.com/codex/config-reference)

Codexのカスタムエージェントは、起動されるセッション向けの単独のTOML設定レイヤーである。

## 配置場所

| パス | スコープ |
| --- | --- |
| `.codex/agents/<agent>.toml` | 現在のプロジェクト |
| `~/.codex/agents/<agent>.toml` | ユーザー |

1つのファイルが1つのエージェントを定義する。`name`フィールドが正であり、ファイル名をそれに一致させるのが最も分かりやすい慣例である。

## 必須フィールド

```toml
name = "code_mapper"
description = "委譲されたタスクに関係する実行経路を特定する、読み取り専用のコードベース探索エージェント。"
sandbox_mode = "read-only"
developer_instructions = """
実際の実行経路を追跡し、ファイル参照を添えた簡潔な根拠を返す。
ファイルを編集せず、委譲された範囲外の変更を提案しない。
"""
```

| フィールド | 目的 |
| --- | --- |
| `name` | エージェントを起動または参照するときに使う識別 |
| `description` | Codexがそのエージェントを使う場面についての、人間向けの案内 |
| `developer_instructions` | 起動されるセッションの不変の振る舞い |

ファイルには、`model`、`model_reasoning_effort`、`sandbox_mode`、`mcp_servers`、`skills.config`を含む、Codexがサポートする他の設定キーも含められる。

## 継承

カスタムファイルが`model`または`model_reasoning_effort`を定義している場合は、その値が優先される。そうでない場合、Codexは各値を、明示的な起動時の設定、対応する`[agents]`の既定値、親セッションの順に解決する。

省略された他のセッション設定は、親から継承する。親のターンで行われた実行時の権限とサンドボックスの選択は外側の境界として残り、Codexが子を起動するときに再適用される。

より少ない権限で足りるエージェントは、より狭い`sandbox_mode`を宣言する。エージェント定義は、有効な親が許可する範囲を超えるサンドボックスに依存しない。

## グローバルなサブエージェント設定

グローバルおよびプロジェクトのCodex設定では、次を設定できる。

```toml
[agents]
enabled = true
max_concurrent_threads_per_session = 4
default_subagent_model = "<model-id>"
default_subagent_reasoning_effort = "medium"
interrupt_message = true
```

| フィールド | 効果 |
| --- | --- |
| `enabled` | マルチエージェントのツールを有効または無効にする |
| `max_concurrent_threads_per_session` | 同時に開く、起動済みエージェントのスレッド数の上限 |
| `default_subagent_model` | より具体的な設定がない場合の、子の既定のモデル |
| `default_subagent_reasoning_effort` | 子の既定の推論の強度 |
| `interrupt_message` | モデルから見える中断メッセージを記録するか省略するか |

Codexには、汎用の`default`、実装中心の`worker`、読み取りが主体の`explorer`のエージェントが含まれる。これらのロールで必要な責務や設定を表現できない場合に、カスタム定義が正当化される。

## 委譲

Codexは、直接の依頼、または該当するプロジェクトやスキルの指示の後に委譲する。委譲プロンプトには、作業の分担、独立性の前提、統合の前にすべてのエージェントの完了が必要かどうか、結果の形式を記す。

読み取りが主体の探索、テスト実行、ログ分析、独立したレビュー観点は、並行作業に適している。共有ファイルへの同時編集は適していない。

## 検証

- 宣言した名前でエージェントを起動するようCodexに依頼し、生成されたエージェントのスレッドを確認する。
- 宣言したサンドボックス、MCP、スキルの設定を働かせるタスクを使う。
- 結果が宣言した出力に従い、親が最終的な統合を行うことを確認する。
- TOMLの読み込みエラーや未知のエージェントのエラーは表面化させ、組み込みのエージェントで黙って代替しない。

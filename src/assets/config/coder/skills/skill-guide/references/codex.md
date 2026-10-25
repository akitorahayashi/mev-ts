# Codex

Codexは、設定を`SKILL.md`の外、スキルのディレクトリ内の`agents/openai.yaml`に置き、そのファイルを自身で読むため、モデルへの指示は含まれない。このファイルは`interface`、`policy`、`dependencies`の3つのセクションを持ち、文字列の値は引用符で囲み、キーは囲まない。

## スキルの配置場所

| パス | スコープ |
| --- | --- |
| `.agents/skills/<skill-name>/SKILL.md` | それを含むプロジェクト |
| `~/.agents/skills/<skill-name>/SKILL.md` | すべてのプロジェクト |

## スキルを呼び出せる主体

| 想定する呼び出し元 | `agents/openai.yaml` |
| --- | --- |
| モデルとユーザー | `policy.allow_implicit_invocation: true`(既定) |
| ユーザーのみ、`$<skill-name>`を入力して | `policy.allow_implicit_invocation: false` |

CodexはClaude Codeの`disable-model-invocation`を読まない。そのため、両方のツールで明示的な呼び出しに限定するスキルは、ここで`policy.allow_implicit_invocation: false`を設定し、Claude Codeのフィールドを`SKILL.md`に残す。

## スキルの表示のされ方

| フィールド | 受け付ける値 |
| --- | --- |
| `interface.display_name` | スキルの一覧やチップに表示されるタイトル |
| `interface.short_description` | 素早く目を通せる25〜64文字 |
| `interface.icon_small` | スキルのディレクトリからの相対パス。`./assets/`の下に置く |
| `interface.icon_large` | スキルのディレクトリからの相対パス。`./assets/`の下に置く |
| `interface.brand_color` | `#RRGGBB` |
| `interface.default_prompt` | スキルを`$<skill-name>`として名指しする1文。ユーザーがスキルから開始したときに挿入される |

## スキルが必要とするもの

`dependencies.tools[]`の各エントリは、次を取る。

| フィールド | 受け付ける値 |
| --- | --- |
| `type` | `mcp`(唯一サポートされるカテゴリ) |
| `value` | `github`などのサーバー識別子 |
| `description` | そのサーバーが必要な理由 |
| `transport` | `url`を読む`streamable_http`、または`command`を読む`stdio` |
| `url` | `streamable_http`サーバーのエンドポイント |
| `command` | `stdio`サーバーの起動コマンド |

## 委譲

`agents/openai.yaml`は、サブエージェントを設定しない。Codexのマルチエージェントのツールとカスタムエージェントは、スキルのパッケージとは独立して、ホストとプロジェクトの設定から提供される。共有スキルは、委譲を機能で記述し、委譲が使えない場合のメインセッションでの同等の挙動を述べる。Codexのツール識別子には依存しない。

## 例

```yaml
interface:
  display_name: "Release Audit"
  short_description: "リリースブランチの未リリースのマイグレーションを確認する"
  icon_small: "./assets/icon-small.svg"
  icon_large: "./assets/icon-large.png"
  brand_color: "#3B82F6"
  default_prompt: "$release-audit を使用して、現在のブランチがリリース可能かどうかを確認してください。"

dependencies:
  tools:
    - type: "mcp"
      value: "github"
      description: "GitHub MCPサーバー"
      transport: "streamable_http"
      url: "https://api.githubcopilot.com/mcp/"

policy:
  allow_implicit_invocation: false
```

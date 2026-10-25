# Claude Code

Claude Codeは、これらの設定を`SKILL.md`のフロントマターから読んで自身で処理するため、モデルへの指示は含まれない。`license`や`compatibility`のような、共通仕様のフィールドで、Claude Codeが処理しないものは、エラーなしに無視される。共通仕様のルールに加えて、予約語の`anthropic`または`claude`を含む`name`は拒否される。

## スキルの配置場所

| パス | スコープ |
| --- | --- |
| `.claude/skills/<skill-name>/SKILL.md` | それを含むプロジェクト |
| `~/.claude/skills/<skill-name>/SKILL.md` | すべてのプロジェクト |

## スキルを呼び出せる主体

| 想定する呼び出し元 | フロントマター |
| --- | --- |
| モデルとユーザー | どちらのフィールドも不要 |
| ユーザーのみ、`/<skill-name>`を入力して | `disable-model-invocation: true` |
| モデルのみ、Skillツール経由 | `user-invocable: false` |

## スキルが実行される場所

| 意図 | フロントマター |
| --- | --- |
| 現在の会話に展開する | `context`を省略する(既定) |
| タスク通知として報告を返すサブエージェントで実行する | `context: fork` |
| 戻るまでターンをブロックするサブエージェントで実行する | `context: fork`と`background: false` |
| サブエージェントの種類を選ぶ | `agent: Explore`、または`.claude/agents/`下のエントリを含む任意のエージェントの種類 |

`agent`と`background`は、`context: fork`にのみ適用される。

## スキルが使えるもの

| フィールド | 受け付ける値 |
| --- | --- |
| `model` | `haiku`、`sonnet`、`opus`、`fable`、完全なモデルID、または親の会話のモデルを使う`inherit` |
| `effort` | `low`、`medium`、`high`、`xhigh`、`max`。モデルのサポートによる |
| `allowed-tools` | `Read, Grep, Bash(git log:*)`のように、カンマ区切りの文字列またはYAMLリストで指定するツールのパターン |
| `disallowed-tools` | `allowed-tools`と同じ形式。除外は、ユーザーが次のメッセージを送ると解除される |

## スキルが読み込まれる時期と表示のされ方

| フィールド | 受け付ける値 | 効果 |
| --- | --- | --- |
| `when_to_use` | 自由なテキスト | スキルのSkillツールの説明に付加される |
| `paths` | カンマ区切りの文字列またはYAMLリストのglobパターン | モデルが一致するファイルに触れたときにのみ、スキルが読み込まれる |
| `hooks` | `settings.json`のフックと同じ形 | スキルがアクティブな間に登録されるフック |
| `argument-hint` | 自由なテキスト | スラッシュコマンド名の後に表示されるプレースホルダー |
| `shell` | `bash`(全プラットフォームでの既定)または`powershell` | `!`コマンドブロックのシェル |

## 例

```yaml
---
name: release-audit
description: リリースブランチに未リリースのマイグレーションがないか監査する。ブランチがリリース可能かどうかをユーザーが尋ねたときに使用する。
disable-model-invocation: true
context: fork
agent: Explore
model: opus
allowed-tools: Read, Grep, Bash(git log:*)
---
```

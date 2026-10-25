# Claude Code

## 典拠

- [Create plugins](https://code.claude.com/docs/en/plugins)
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [Discover and install plugins](https://code.claude.com/docs/en/discover-plugins)

## 標準のレイアウト

```text
<plugin-root>/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── <skill>/SKILL.md
├── agents/
│   └── <agent>.md
├── hooks/
│   └── hooks.json
├── output-styles/
├── bin/
├── scripts/
├── settings.json
├── .mcp.json
└── .lsp.json
```

マニフェストは任意である。存在しない場合、Claude Codeはディレクトリ名からプラグイン名を導き、既定の場所にあるコンポーネントを発見する。配布するプラグインは、安定した識別とメタデータのために、通常はマニフェストを含める。

`.claude-plugin/`の中に置くのは`plugin.json`のみである。スキル、エージェント、フック、スクリプト、サーバー、実行ファイル、設定は、プラグインルートに置いたままにする。プラグインルートの`CLAUDE.md`は、プロジェクトのコンテキストとして読み込まれない。

## コンポーネント

| コンポーネント | 既定の場所 | 挙動 |
| --- | --- | --- |
| スキル | `skills/<name>/SKILL.md` | 補助ファイルを持つ、ユーザーまたはモデルが呼び出す機能 |
| コマンド | `commands/*.md` | 旧来のフラットなスキル。新しいプラグインは`skills/`を使う |
| エージェント | `agents/*.md` | 特化した、委譲されるサブエージェント |
| フック | `hooks/hooks.json` | イベントで起動される挙動 |
| MCPサーバー | `.mcp.json` | 外部のツールやサービスへの接続 |
| LSPサーバー | `.lsp.json` | 言語サーバーの設定 |
| 出力スタイル | `output-styles/*.md` | 応答の提示方法の定義 |
| 実行ファイル | `bin/` | 有効な間、BashツールのPATHに追加されるコマンド |
| 設定 | `settings.json` | 有効なエージェントなど、サポートされるプラグインの既定値 |

実験的なコンポーネントは、スキーマが変わる可能性があるため、プラグインが必須とする機能から切り離しておく。

プラグインのスキルとエージェントは、`/comment-review:review-pr`や`comment-review:pr-reviewer`のように、プラグインの名前空間の下に現れる。

## マニフェスト

`<plugin-root>/.claude-plugin/plugin.json`はJSONである。存在する場合、必須のフィールドは`name`のみである。

```json
{
  "name": "comment-review",
  "version": "1.0.0",
  "description": "プルリクエストをレビューし、承認された指摘を公開する。",
  "author": {
    "name": "Example Author"
  },
  "repository": "https://github.com/example/comment-review",
  "keywords": ["review", "github"]
}
```

`name`はケバブケースの識別子で、コンポーネントの名前空間を所有する。`displayName`、`version`、`description`、`author`、`homepage`、`repository`、`license`、`keywords`はメタデータである。任意の`$schema`フィールドはエディターでの検証を可能にするが、Claude CLIのバリデーターの代わりにはならない。

`dependencies`はプラグインの依存関係を宣言する。各エントリは、プラグイン名の文字列、または`name`と任意の`version`、任意の`marketplace`を持つオブジェクトである。名前だけの依存関係は、既定で同じマーケットプレイスから解決され、依存元のプラグインと一緒にインストールされる。`version`は、依存元のプラグインが特定のリリース済みの依存先バージョンを意図的に必要とする場合にのみ使う。

カスタムのコンポーネントの場所には、`skills`、`commands`、`agents`、`hooks`、`mcpServers`、`lspServers`、`outputStyles`を使う。パスはプラグインルートからの相対で、`./`で始まり、サポートされる場合は配列にできる。マニフェストのフィールドがコンポーネントのパスを定義すると、そのコンポーネントの発見はマニフェストが所有する。既定のレイアウトとカスタムのレイアウトが暗黙に混在することはない。

カスタムのレイアウトが実際の複雑さを取り除く場合を除き、既定の場所を使う。

## 実行時のパス

| 変数 | 所有 |
| --- | --- |
| `${CLAUDE_PLUGIN_ROOT}` | インストール済みのプラグインのバージョンに同梱されるファイル |
| `${CLAUDE_PLUGIN_DATA}` | 永続的な生成ファイル、依存関係、キャッシュ |
| `${CLAUDE_PROJECT_DIR}` | アクティブなプロジェクトのファイル |

スキルとエージェントの内容は、これらの変数を置換できる。フックのコマンドとMCPまたはLSPの設定は、文書化されたコマンド、引数、環境変数、URL、ヘッダー、ワークスペースのフィールドで置換をサポートする。

他のホストと共有するスキルは、自身の補助ファイルにスキル相対のMarkdownリンクを使う。`${CLAUDE_PLUGIN_ROOT}`は、Claude固有の内容と、スキルのディレクトリ外にあるプラグインルートのファイルのために残す。

サポートされる場合は、引数の配列形式またはexec形式を優先する。シェル形式のコマンドでは、置換されたパスを引用符で囲む。

## キャッシュの挙動

マーケットプレイスからのインストールでは、各プラグインのバージョンが`~/.claude/plugins/cache`にコピーされる。実行時の場所は、ソースのチェックアウトではない。

- プラグインルートの外へたどる参照は、インストール後に失敗する。
- プラグインのコードと同梱の設定は、実行時には変更できないまま保つ。
- 更新でバージョン付きのルートが変わるため、永続的な状態には`${CLAUDE_PLUGIN_DATA}`を使う。
- 依存関係のキャッシュは、同梱の依存関係のマニフェストを永続コピーと比較し、プラグインの更新がレビュー済みの再インストールを起動できるようにする。
- セッション中の更新では、フックとサーバー接続が新しいバージョンに切り替わるために`/reload-plugins`が必要である。長期間動作する一部のコンポーネントは、新しいセッションを必要とする。

## プラグインエージェントの制約

プラグインが同梱するエージェントには、エージェント固有の`permissionMode`、`mcpServers`、`hooks`は渡されない。Claude Codeは、セキュリティのために、それらのフロントマターのフィールドを無視する。これらの機能は、セッションまたはプラグインレベルの設定が所有する。

## 開発時の検証

1. `claude plugin validate <plugin-root> --strict`を実行する。
2. `claude --plugin-dir <plugin-root>`で読み込む。
3. すべてのスキルとエージェントを、プラグインスコープの名前で呼び出す。
4. 管理された環境で、フックを起動し、各MCPまたはLSPサーバーに接続する。
5. スキル以外のコンポーネントを変更した後は、`/reload-plugins`を実行する。
6. ローカルのマーケットプレイスからインストールし、キャッシュされたコピーから代表的な呼び出しを繰り返す。

インストールするのは、信頼できるプラグインのソースのみとする。プラグインは、ユーザーの権限で任意のコマンドを実行できる。

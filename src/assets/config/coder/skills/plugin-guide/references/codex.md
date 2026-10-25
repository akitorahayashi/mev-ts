# CodexとChatGPT

## 典拠

- [Plugins](https://developers.openai.com/codex/plugins)
- [Skills and plugins](https://developers.openai.com/codex/skills-and-plugins)
- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [Build skills](https://developers.openai.com/codex/build-skills)

OpenAIプラグインは、サポートされるChatGPTとCodexの面で共有される、インストール可能なバンドルである。スキル、ポータブルなエージェント、コネクタ、MCPサーバー、フック、スケジュールされたタスクのテンプレート、ブラウザー拡張、アセットを含められる。Codex CLIは、設定済みのマーケットプレイスからのプラグインの閲覧とインストールをサポートする。インストール済みの同梱スキルとツールは、新しいセッションで利用できる。

## 標準のレイアウト

```text
<plugin-root>/
├── .codex-plugin/
│   └── plugin.json
├── skills/
│   └── <skill>/SKILL.md
├── agents/
│   └── <agent>.md
├── hooks/
│   └── hooks.json
├── .app.json
├── .mcp.json
└── assets/
```

すべてのOpenAIプラグインは`.codex-plugin/plugin.json`を持つ。`.codex-plugin/`の中に置くのは`plugin.json`のみである。スキル、フック、アセット、`.mcp.json`、`.app.json`は、プラグインルートに置いたままにする。

## コンポーネント

| コンポーネント | 既定の場所 | 挙動 |
| --- | --- | --- |
| スキル | `skills/<name>/SKILL.md` | ChatGPTまたはCodexが読み込む、再利用可能なワークフロー |
| エージェント | `agents/<name>.md` | サポートするホストの面で読み込まれる、ポータブルな同梱エージェント |
| フック | `hooks/hooks.json` | プラグインが有効で信頼されているときに読み込まれるライフサイクルフック |
| MCPサーバー | `.mcp.json` | ツールとコンテキスト用の、同梱のサーバー設定 |
| アプリのマッピング | `.app.json` | コネクタ型のプラグインが使う、登録済みのMCPサーバー接続 |
| アセット | `assets/` | アイコン、ロゴ、スクリーンショット、プレゼンテーション用の素材 |

コネクタはMCPサーバーを基盤とし、サポートされるChatGPTの面ではカスタムUIを含められる。Codexは、アクティブな面がプラグインをサポートする場合に、同梱のスキルとMCPツールを使える。

OpenAIプラグインは、ポータブルなAgent Pluginのエージェントを`agents/`の下に同梱し、マニフェストの`agents`フィールドで宣言できる。これらの同梱されたMarkdownのエージェントは、`.codex/agents/`または`~/.codex/agents/`の下にあるCodexのカスタムエージェントのTOMLとは別物である。カスタムエージェントのモデル、サンドボックス、ツールの設定は、ホストまたはプロジェクトの設定のままとなる。同梱の共有スキルは、アクティブなホストがサポートする場合は同梱エージェントへ委譲でき、委譲が使えない面については、メインセッションでの同等の挙動を記述する。

## マニフェスト

`<plugin-root>/.codex-plugin/plugin.json`は、プラグインを識別し、同梱のコンポーネントを指し示し、インストールの面のメタデータを提供する。

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "再利用可能なスキルとMCPサーバーをまとめる。",
  "skills": "./skills/",
  "agents": ["./agents/reviewer.md"],
  "mcpServers": "./.mcp.json",
  "hooks": "./hooks/hooks.json",
  "apps": "./.app.json",
  "interface": {
    "displayName": "My Plugin",
    "shortDescription": "再利用可能なスキルとMCPサーバー",
    "category": "Productivity",
    "composerIcon": "./assets/icon.png"
  }
}
```

`name`、`version`、`description`がプラグインを識別する。`author`、`homepage`、`repository`、`license`、`keywords`は、公開者と発見のためのメタデータを提供する。`skills`、`agents`、`mcpServers`、`hooks`、`apps`は、同梱のコンポーネントを指し示す。`interface`は、`displayName`、説明、カテゴリ、既定のプロンプト、アイコン、ロゴ、スクリーンショットなどの表示用メタデータを制御する。

## パスのルール

マニフェストのパスは、プラグインルートからの相対で、`./`で始まる。可能な場合は、視覚的なアセットを`./assets/`の下に置く。同梱のスキルのフォルダには`skills`、ポータブルな同梱エージェントの定義には`agents`、`.mcp.json`には`mcpServers`、ライフサイクルフックには`hooks`、`.app.json`にある登録済みのMCPサーバーのマッピングには`apps`を使う。

同梱のスキルは、自身の補助ファイルを、スキルのディレクトリからの相対のMarkdownリンクで参照する。それらのファイルに、プラグインルートの変数やスキルのディレクトリのプレースホルダーは使わない。

Codexのプラグインのフックは、同梱ファイル用の`${PLUGIN_ROOT}`と、書き込み可能な永続的な状態用の`${PLUGIN_DATA}`を受け取る。フックのコマンドは、シェル形式を使う場合、置換されたパスを引用符で囲む。

同梱のstdioのMCPサーバーでは、`cwd`を`"."`のようなプラグインルートからの相対パスに設定し、同梱のコマンド引数をその作業ディレクトリからの相対に保つ。Codexは、相対のMCPの`cwd`を、インストール済みのプラグインルートに対して解決する。MCPの`command`と`args`のフィールドでは、`${PLUGIN_ROOT}`や`${PLUGIN_DATA}`は展開されない。

## ローカルのマーケットプレイス

リポジトリのマーケットプレイスは`$REPO_ROOT/.agents/plugins/marketplace.json`に置く。個人用のマーケットプレイスは`~/.agents/plugins/marketplace.json`に置く。ChatGPTは、旧来との互換性のある、`$REPO_ROOT/.claude-plugin/marketplace.json`のリポジトリマーケットプレイスも読む。

```json
{
  "name": "local-repo",
  "interface": {
    "displayName": "Local Repo Plugins"
  },
  "plugins": [
    {
      "name": "my-plugin",
      "source": {
        "source": "local",
        "path": "./plugins/my-plugin"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

`source.path`は、`.agents/plugins/`ではなく、マーケットプレイスルートからの相対で解決される。ローカルのパスは、そのマーケットプレイスルートの内側に収める。ローカルのソースには、`"./plugins/my-plugin"`のような単純な文字列も使える。

Codex CLIは、次のコマンドでマーケットプレイスのソースを管理する。

```bash
codex plugin marketplace add <source>
codex plugin marketplace list
codex plugin marketplace upgrade
codex plugin marketplace remove <marketplace-name>
```

マーケットプレイスのソースには、ローカルのディレクトリ、GitHubの短縮形、HTTPまたはHTTPSのGit URL、SSHのGit URL、Gitのスパースチェックアウトを使える。

## ソースの種類

| source | 用途 |
| --- | --- |
| `local` | ローカルのマーケットプレイスルートの下に置かれたプラグイン |
| `url` | Gitリポジトリのルートに置かれたプラグイン |
| `git-subdir` | Gitリポジトリのサブディレクトリに置かれたプラグイン |
| `npm` | JavaScriptレジストリのパッケージとして配布されるプラグイン |

Gitを基盤とするエントリは、`ref`または`sha`のセレクタを使う。NPMのエントリは、`package`、任意の`version`、任意のHTTPSの`registry`を使う。Codexは、ライフサイクルスクリプトを実行せずにパッケージをダウンロードする。

## インストールとキャッシュ

ChatGPTは、マーケットプレイスのプラグインを`~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/`にインストールする。ローカルのプラグインでは、`$VERSION`は`local`である。ChatGPTは、マーケットプレイスのエントリから直接ではなく、キャッシュのパスにあるインストール済みのコピーを読み込む。

プラグインの有効状態は`~/.codex/config.toml`に保存される。プラグインをインストールまたは有効化した後は、同梱のスキルやツールが使えることを期待する前に、新しいCodexセッションを開始する。

## MCPサーバーとフック

`mcpServers`は、サーバーマップを直接含むか、ラップされた`mcp_servers`オブジェクトを含む`.mcp.json`ファイルを指す。ユーザーは、Codexの設定にある`plugins.<plugin>.mcp_servers.<server>`の下で、同梱のMCPサーバーの有効化や無効化と、プラグインスコープのMCPツールの承認ポリシーの調整を行える。

プラグインのフックは、管理対象外のフックである。プラグインのインストールや有効化では、そのフックは自動的には信頼されず、ユーザーが現在のフック定義をレビューして信頼するまで、Codexはそれらをスキップする。マニフェストで`hooks`が省略された場合、Codexは既定の`hooks/hooks.json`を確認する。

## 開発時の検証

1. リポジトリまたは個人用のマーケットプレイスからインストールする。
2. ChatGPTのデスクトップアプリを再起動するか、新しいCodex CLIセッションを開始する。
3. サポートされるプラグインブラウザーまたはマーケットプレイスの一覧にプラグインが表示されることを確認する。
4. 同梱の各スキルを呼び出し、管理された環境でMCPツールやフックを検証する。
5. マーケットプレイスのソースを更新し、インストールまたはアップグレードを繰り返して、想定するバージョンとキャッシュのレイアウトを検証する。

# Claude Codeマーケットプレイス

## 典拠

- [Create and distribute a plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
- [Discover and install plugins](https://code.claude.com/docs/en/discover-plugins)
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference)

マーケットプレイスは、インストール可能なプラグインのカタログである。マーケットプレイスを追加するとカタログが登録され、プラグインをインストールすると、選択したプラグインがClaude Codeのキャッシュにコピーされる。

## ルートの分離

```text
<marketplace-root>/
├── .claude-plugin/
│   └── marketplace.json
└── plugin/
    └── <plugin-root>/
        ├── .claude-plugin/plugin.json
        ├── skills/
        └── agents/
```

マーケットプレイスの`source`のパスは、`.claude-plugin/`ではなくマーケットプレイスルートから解決される。プラグインのマニフェストのコンポーネントのパスは、選択したプラグインルートから解決される。これらは別々のパスの領域である。

## 最小のカタログ

```json
{
  "name": "example-tools",
  "description": "exampleチームが保守するClaude Codeプラグイン。",
  "owner": {
    "name": "Example Team"
  },
  "plugins": [
    {
      "name": "comment-review",
      "source": "./plugin/comment-review",
      "description": "プルリクエストをレビューし、承認された指摘を公開する。"
    }
  ]
}
```

マーケットプレイスは、一意の`name`、オーナーのメタデータ、`plugins`配列を持つ。各プラグインのエントリには`name`と`source`が必須である。相対のsourceは`./`で始まる。

## ソースの種類

| source | 用途 |
| --- | --- |
| 相対パス | マーケットプレイスのリポジトリ内に置かれたプラグイン |
| `github` | GitHubリポジトリ。refまたは完全なSHAでの固定も可 |
| `url` | GitリポジトリのURL。refまたは完全なSHAでの固定も可 |
| `git-subdir` | Gitリポジトリのサブディレクトリに含まれるプラグイン |
| `npm` | npmパッケージとバージョンで配布されるプラグイン |

マーケットプレイスのソースは`marketplace.json`の所在を示す。各プラグインのエントリのソースは、そのプラグインの所在を独立して示す。信頼とピン留めの判断は、両方の層に適用される。

## strictモード

`strict`の既定値は`true`である。

| 値 | 権限 |
| --- | --- |
| `true` | プラグインの`plugin.json`がその定義を所有する。マーケットプレイスのエントリはコンポーネントを補足できる |
| `false` | マーケットプレイスのエントリが完全な定義となり、プラグインは競合するコンポーネントを宣言しない |

自分で所有するプラグインには、既定値を使う。`strict: false`は、マーケットプレイスが意図的に生のファイルをキュレーションし、公開するコンポーネントの全体を所有する場合にのみ使う。

## バージョンの解決

Claude Codeは、利用できる最初のソースから、インストール済みのバージョンを解決する。

1. プラグインの`plugin.json`の`version`
2. マーケットプレイスのプラグインエントリの`version`
3. ソースのGitコミットSHA
4. バージョンやGitコミットの情報を持たないソースの場合は`unknown`

明示的なセマンティックバージョンは、その値が変わったときにのみ更新を生む。レビュー済みのリリースサイクルに向いている。明示的なバージョンを省略すると、Gitコミットが各更新を識別し、継続的に配布される社内のプラグインに向いている。

Gitのソースは、所有するリポジトリの信頼ポリシーに従う。不変の完全なコミットSHAは、サードパーティのソースに再現性を与える。リポジトリが移動する参照を明示的に許可している場合は、信頼できる自社のソースに、レビュー済みのリリースタグやメジャータグが適切なこともある。

## ローカル配布のテスト

```text
claude plugin validate <marketplace-root> --strict
claude plugin marketplace add <marketplace-root>
claude plugin install <plugin-name>@<marketplace-name>
```

このテストでは、次を確認する。

- カタログが解析でき、想定するプラグインルートを特定している
- ソースのパスが、コピーされた配布物の内側にとどまっている
- 選択したstrictモードの下で、プラグインのマニフェストとマーケットプレイスのエントリが合成される
- インストール後に、名前空間付きのコンポーネントが現れる
- インストール済みのキャッシュのコピーが、同梱のスクリプトを実行し、同梱のアセットを見つけられる
- 選択したバージョンが、リリース戦略に従って変わる

テストの後、同じソースからインストール済みのプラグインを更新し、想定するバージョンが発見できることを確認する。`--plugin-dir`による直接のテストは、このインストールのテストの代わりにならない。

## 配布のセキュリティ

マーケットプレイスとプラグインのソースは、信頼されたコードの配布経路である。インストールのコマンドを共有する前に、カタログの所有者、ソースの出所、バージョンのピン、依存関係のインストール、実行ファイルのコンポーネント、要求される資格情報をレビューする。

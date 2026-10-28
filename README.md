# mev

`mev`はmacOS向けのLocal IaCで、BunとTypeScriptで構築されている。

## インストール

プロビジョニングのターゲットがHomebrewパッケージを宣言する場合はHomebrewが必要であり、`mev`はHomebrewをブートストラップしない。macOSを新規にインストールした環境では、先にHomebrewを入れる:

```bash
/bin/bash -c "$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Homebrewインストーラーが表示する「Next steps」は、シェルのPATHを設定する手順である。新しいターミナルセッションが`brew`を見つけられるようにするには、この手順を適用しなければならない。新しいターミナルを開くと、更新後のシェル設定が読み込まれる。現在のターミナルで、推奨される`eval "$(.../bin/brew shellenv)"`コマンドを実行すると、再起動せずにすぐHomebrewを使えるようになる。このセットアップは[Homebrewのインストールガイド](https://docs.brew.sh/Installation#post-installation-steps)で説明されている。Homebrewが使えるようになったら:

```bash
brew --version
```

`mev`は、Apple SiliconとIntelのmacOS向けに、コンパイル済みの単一バイナリとして配布される:

```bash
/bin/bash -c "$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/akitorahayashi/mev-ts/main/install.sh)"
```

このスクリプトは、ホストのアーキテクチャ向けのリリースバイナリをダウンロードし、そのSHA256チェックサムを検証して、`~/.local/bin/mev`にインストールする。インストールしたバイナリのバージョンとインストール先を報告する。`MEV_INSTALL_DIR`でインストール先を上書きでき、`MEV_VERSION=vX.Y.Z`で最新版ではなく特定のリリースに固定できる。次のコマンドは、既定のインストール先ディレクトリを現在のターミナルセッションで使えるようにしたうえで、プロビジョニングを始める:

```bash
export PATH="$HOME/.local/bin:$PATH"
mev --version
mev create
```

検証済みのバイナリは、アトミックに公開される前に、インストール先のファイルシステム上でステージされ、バージョンがprobeされる。準備に失敗しても既存のコマンドはそのまま残る。コマンドの配置先がsymlinkまたは通常ファイルでない場合は、拒否される。

`MEV_INSTALL_DIR`にカスタムの値を指定した場合、インストーラーはそのディレクトリを使ったPATH設定のコマンドを表示する。`:`はPATHのエントリの区切りなので、`:`を含むインストール先ディレクトリは、ダウンロードやインストールの前に拒否される。インストーラーはシェルの設定ファイルを編集せず、親シェルのPATHも変更しない。`mev`のインストールやバージョンの確認にHomebrewは不要である。Homebrewが必要になるプロビジョニングの実行は、プロビジョニングの状態を変更する前にHomebrewを確認する。

インストール済みのリリース版では、1つのコマンドで、更新と環境の整合を行える:

```bash
mev update
mev update --upgrade
```

`update`は、公開されている最新のリリースを解決し、必要に応じて、検証したうえでインストール済みのコマンドをアトミックに置き換え、そのパスそのものから`sync`を実行する。`--upgrade`を付けた形は、既存のアップグレードの意図を`sync`へ引き渡す。

## 開発

cloneから、依存関係をインストールしてソースから実行する:

```bash
bun install
bun e --version
MEV_INSTALL_DIR="$HOME/.local/bin" bun run up
export PATH="$HOME/.local/bin:$PATH"
mev --version
```

`bun run up`は、開発用cloneのローカルインストールの経路である。埋め込みアセットレジストリを再生成し、Bun向けの単一ファイルのJavaScriptバンドルをビルドして、`mev`としてインストールする。これにより、そのパスにインストール済みのスタンドアロンのリリースバイナリは置き換えられる。まだBunがないマシンでは、リリースのインストーラーが引き続きクリーンインストールの経路になる。ローカル検証のタスクの全体像はCONTRIBUTING.mdにある。

## 使い方

```bash
mev create                      # 環境全体をプロビジョニングする
mev sync                        # 前回の実行以降に変わったものだけを再適用する
mev update                      # 最新のリリースをインストールしてからsyncする
```

`create`は、`optional`なターゲットを除く登録済みのすべてのターゲットを、デプロイ、パッケージのインストール、activationの各フェーズに通して実行する。`sync`は同じターゲットを再スキャンし、宣言された状態またはデプロイ済みのアセットが変わったものだけを再適用する。コマンドリファレンスの全体（`make`、`sync`、`update`、`config`、`list`、`user`/`switch`、変換のエイリアス`md2pdf`/`pdf2md`）はdocs/usage.mdにある。プロビジョニングの仕組みはdocs/architecture/provisioning.md、activation DSLはdocs/architecture/activation.md、`mev config`の設定対象の選択はdocs/config.mdにある。

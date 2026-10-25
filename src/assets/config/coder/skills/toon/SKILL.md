---
name: toon
description: JSONファイル、APIレスポンス、データベースの行、検索結果、構造化ログなど、JSON互換の構造化データを調べるタスクでは、常にTOON CLIを使用する。このスキルは、そのデータがエージェントのコンテキストに入る前に適用する。
compatibility: toon CLIが必要。NDJSONのslurpとフィールドの射影にはjqも必要
---

# TOON

## 目的

TOONは、構造化データの読み取りに必要なトークンを減らすための、JSONデータモデルの一時的で可逆な表現である。

JSONは正式なファイル形式および交換形式のままとする。TOONは、調査のための読み取り用の表面としてのみ使う。

## 入力の正規化

TOONは、改行区切りのJSON(NDJSON/JSONL)ではなく1つのJSON値を受け付ける。そのため、NDJSONはエンコード前に配列へslurpする。

```sh
jq -s '.' events.ndjson | toon
```

タスクがデータの一部しか必要としない場合は、エンコード前に、入力を必要な行とフィールドに絞る。

```sh
jq '{items: [.items[] | {id, name, status}]}' response.json | toon
```

## 構造化データの読み取り

ワークフローでは、元のJSONを先にエージェントのコンテキストへ読み込まず、CLIが出力するTOONを読む。

```sh
toon large-response.json
curl -fsSL https://api.example.com/items | toon
```

タスクの間、保持する必要がある変換済みデータは、現在のコマンド列が所有するシステムの一時ディレクトリの下に書く。

```sh
scratch="$(mktemp -d -t toon.XXXXXX)"
cleanup() {
  status=$?
  rm -rf "$scratch"
  exit "$status"
}
trap cleanup EXIT
toon large-response.json --stats -o "$scratch/large-response.toon"
```

タスクが比較を必要とする場合を除き、元のJSON全体とそのTOON表現の両方は読まない。

## 検証

`toon`コマンドは、既定で厳格なデコードを行う。厳格なデコードは、配列の要素数、インデント、ヘッダー、エスケープを検証するため、上流のツールが出力した不正なTOONの入力はただちに表面化する。

不正なTOONを受け入れるために`--no-strict`を使わない。CLIが利用できない場合や変換に失敗した場合は、黙ってフォールバックせず、そのまま表面化させる。

## 必須の構文

オブジェクトは`key: value`を使い、ネストは2スペースのインデントで表す。

```toon
user:
  id: 1
  name: Alice
  active: true
```

プリミティブの配列は、要素数を宣言する。

```toon
tags[3]: rust,cli,macos
```

オブジェクトの一様な配列は、行数とフィールドの順序を1度だけ宣言する。

```toon
users[2]{id,name,active}:
  1,Alice,true
  2,Bob,false
```

`[N]`は配列の要素数である。`{fields}`は、後続のすべての行のフィールドの順序を定義する。

別の型として解釈されうる文字列や、構造を表す文字を含む文字列は、引用符で囲む。

```toon
version: "123"
enabled: "true"
note: "hello, world"
```

これらのルールは、既存のTOON出力を読むときや、例を解釈するときに重要である。タスクがJSONのままで済む場合は、TOONの作成の工程を導入しない。

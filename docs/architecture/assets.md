# アセットの埋め込み

アセットのディレクトリは、デプロイ可能な設定の正本である。

| 境界 | 契約 |
|---|---|
| ソース | `src/assets/config/{role}/`配下のファイル。ロール直下の`Brewfile`は、ターゲットのHomebrew要件である。 |
| コード生成 | `scripts/generate-assets.ts`が、内容とソースツリーのハッシュを`registry.generated.ts`に埋め込む。 |
| ランタイム | `AssetSource`が生成されたマップを読む。未知のキーは`ProvisioningError`で失敗する。 |
| ターゲットの宣言 | `keysByPrefix`が、埋め込まれたレジストリからアセットの集合を導出する。 |
| deploy store | `AssetRef.key`は、`~/.mev/roles/`配下の相対パスでもある。 |

## deploy store

デプロイされたアセットはすべて`~/.mev/roles/{key}`配下にある。`file`と`tree`のactivationは、そのdeploy storeへリンクする。生成されるパスと管理されるパスは、`host/path.ts`の`mevRoot`という唯一の正本から導出される。

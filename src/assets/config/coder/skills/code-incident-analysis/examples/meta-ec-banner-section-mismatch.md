# ECバナー取得完了時のクラッシュ調査

## 結論

コード上で再現する。

画面にセクションが1つもない状態で、ECバナーの表示位置であるsection 8を再読み込みしたことがクラッシュ原因である（[`MetaViewController.reloadECBannerSection()`](../bluerose/Swift/Controllers/Collection/MetaViewController.swift#L1253)）。

[`fix/crashlytics-0e51c61c`](https://github.com/playjp-wowow-renewal/wod_ios/tree/fix/crashlytics-0e51c61c) の存在確認は、このクラッシュに対する必要な修正である。同じ処理を持つ[`WatchDetailViewController`](../bluerose/Swift/Controllers/Collection/WatchDetailViewController.swift#L444)にも同じ確認が必要である。

## 原因

この処理には、名前の似た2つの値がある。

| 値 | 意味 | クラッシュ時 |
|---|---|---:|
| [`sections`](../bluerose/Swift/Controllers/Collection/MetaViewController.swift#L199) | 最終的に表示するセクションの並び | ECバナーはindex 8 |
| [`collectionView.numberOfSections`](../bluerose/Swift/Controllers/Collection/MetaViewController.swift#L2198) | CollectionViewが現在持っているセクション数 | 0 |

index 8は9番目のセクションを表す。現在のセクション数が0なら9番目は存在しないため、`reloadSections(8)`は`NSInternalInconsistencyException`を発生させる。

元の実装は[`sections.firstIndex(of: .ECBanner)`](../bluerose/Swift/Controllers/Collection/MetaViewController.swift#L1254)だけを確認し、CollectionViewにその位置が存在するかを確認していなかった。

## 発生順序

1. [`MediaContainerViewController.updateMeta(meta:)`](../bluerose/Swift/Controllers/Collection/MediaMeta/MediaContainerViewController.swift#L469)が、481行目で`MetaViewController`を生成する。
2. [`MetaViewController.init(meta:metaDetailPresenter:)`](../bluerose/Swift/Controllers/Collection/MetaViewController.swift#L753)は、756行目で`meta`を設定する。この設定により、[`meta`のsetter](../bluerose/Swift/Controllers/Collection/MetaViewController.swift#L260)から`reloadData()`、`loadData()`の順に呼ばれる。
3. [`loadData()`](../bluerose/Swift/Controllers/Collection/MetaViewController.swift#L1165)は、LinearAssetなら1237行目から`loadEvents()`を呼び、event取得を開始する。その後、1249行目からCollectionView全体を再読み込みする。
4. CollectionViewの再読み込みは[`numberOfSections(in:)`](../bluerose/Swift/Controllers/Collection/MetaViewController.swift#L2198)を呼ぶ。`meta.name == nil`なら2201行目、LinearAssetの`event == nil`なら2204行目で0を返すため、CollectionViewはセクションを1つも持たない状態になる。
5. `meta`の設定処理が終わると、[`MetaViewController`のinitializer](../bluerose/Swift/Controllers/Collection/MetaViewController.swift#L753)は757行目から`loadECBannerIfNeeded(meta:)`を呼ぶ。
6. [`loadECBannerIfNeeded(meta:)`](../bluerose/Swift/Controllers/Base/BaseCollectionViewController.swift#L128)は、138行目で広告取得用の`Task`を作り、141行目で広告レスポンスを待つ。event取得とは別の非同期処理なので、どちらが先に完了するかは決まっていない。
7. event取得より広告取得が先に完了すると、150行目で`ecBannerAdvertising`が設定され、151行目から`reloadECBannerSection()`が呼ばれる。これにより[ECバナーのitem数](../bluerose/Swift/Controllers/Collection/MetaViewController.swift#L2306)は0から1になる。
8. [`MetaViewController.reloadECBannerSection()`](../bluerose/Swift/Controllers/Collection/MetaViewController.swift#L1253)は、1254行目で`sections`からECバナーの位置をindex 8と求め、1255行目でsection 8を再読み込みする。
9. CollectionViewが持つセクションは0個なので、存在しないsection 8の再読み込みによって`NSInternalInconsistencyException`が発生する。

event取得が先に完了した場合は、[eventを保存してCollectionView全体を再読み込み](../bluerose/Swift/Controllers/Collection/MetaViewController.swift#L1679)する。CollectionViewのセクション数が15になった後でsection 8を再読み込みするため、クラッシュしない。

シリーズ／シーズン画面では`sections.count`が18、EC indexが12になるが、「実際のセクション数が0なら対象位置が存在しない」という原因は同じである。

広告取得によって変わるのは、通常はECバナーsectionのitem数0→1である。広告がsectionそのものを追加するわけではない。クラッシュ時に問題となるsection数0は、メタ情報またはLinearAssetのeventがまだ利用できないために返される。

## 再現手順

1. ECバナーIDを持つLinearAssetの詳細画面を直接開く。
2. [`loadEvents()`が開始したevent取得](../bluerose/Swift/Controllers/Collection/MetaViewController.swift#L1617)を完了させず、`numberOfSections(in:)`が0を返す状態を維持する。
3. その間に、[`fetchAdvertising(_:)`](../bluerose/Swift/API/LGCECBannerAPI.swift#L15)へ端末向けcreativeを含む広告レスポンスを返す。
4. `reloadECBannerSection()`がsection 8を再読み込みし、`NSInternalInconsistencyException`が発生することを確認する。

画面を開いた後の追加操作はない。再現の成否は、event取得より広告レスポンスを先に完了させられるかで決まる。

## 根本対応

再読み込みの直前に、対象sectionがCollectionViewに存在することを確認する。

```swift
override func reloadECBannerSection() {
    guard let section = sections.firstIndex(of: .ECBanner) else { return }
    guard section < collectionView.numberOfSections else { return }
    collectionView.reloadSections(IndexSet(integer: section))
}
```

画面準備前は再読み込みを行わない。広告データは保存済みなので、その後の画面データ取得完了による全体再読み込みでバナーが表示される。画面を閉じた後も再読み込みは不要である。

適用範囲は次のとおりである。

- `MetaViewController`: `fix/crashlytics-0e51c61c` の修正で対応済み
- `WatchDetailViewController`: 同じ存在確認の追加が必要

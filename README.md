# SUUMO JJ 一括申告ツール

このリポジトリは SUUMO JJ の一般版と上位版を管理します。

## 配布と更新

| 種類 | 管理場所 | バージョン | 方針 |
| --- | --- | --- | --- |
| 一般版 | [main / SUUMO.user.js](SUUMO.user.js) | **8.0** | **凍結**。明示的な依頼がない限り変更しない |
| 上位版 | [dev / SUUMO-DEV.user.js](https://github.com/Alpha0727/suumo-jj-tool/blob/dev/SUUMO-DEV.user.js) | **7.54.5** | こちらで機能の追加・改善を行う |

一般版の自動更新情報は `main/latest.json`、上位版は `dev/latest-dev.json` を使います。
両者は Tampermonkey の識別情報も異なります。

## 配布済みバージョン

- 一般版の `releases/`：8.0 / 7.50 / 7.49（最新版と過去2版）
- 上位版の `dev/releases/`：7.54.5 / 7.54.4（最新版と現存する過去版）
- それ以前のファイルは Git の履歴から確認可能です

## バックアップ

- 一般版7.50の更新前バックアップ：`main/backups/2026-10-20/`
- 上位版7.54.4の更新前バックアップ：`dev/backups/2026-10-20/`

## いえらぶSPOT は別管理

**いえらぶSPOTは独立したリポジトリ** [Alpha0727/IERABU-SPOT](https://github.com/Alpha0727/IERABU-SPOT) で管理しています（Ver.2.4）。
このSUUMO-JJリポジトリには、いえらぶSPOTの配布スクリプトや更新設定を保管しません。

## 一般版の保護

一般版8.0は今後変更しない方針です。誤更新防止のため `main` ブランチを GitHub の **Lock branch** で保護する予定です。
この方針の記述だけでは書き込みを物理的に禁止できないため、GitHub側で保護設定が必要です。

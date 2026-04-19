HYPER-HAIKU

追加したもの:
- 起動キーワードゲート
- 写真選択
- カメラ起動 + 撮影
- 俳句 / 自由律 の切り替え
- 写真上プレビュー
- JPEG保存
- Cloudflare Pages Functions

デプロイ:
npx wrangler pages deploy . --project-name hyper-haiku


2026-04-19 update:
- Removed stray subtitle text under the main title.
- Added the approved statement to the keyword screen.


2026-04-19 update: 撮影操作をプレビュー画面内に移動。写真選択・カメラ・撮影・カメラを閉じるを同じ表示面の下部に統合。


Season prompt fix: season words are now used only when strongly supported by visible photo cues.

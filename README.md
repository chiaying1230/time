# 作業觀察筆記

行為改變課程用的 ABC 直接觀察工具：觀察同一位受試者在寫作業期間「非作業用途拿起並使用手機」，每次固定 20 分鐘。

- 純靜態 PWA（`index.html`、`style.css`、`app.js`、`sw.js`、`manifest.webmanifest`、`icons/`），沒有框架、沒有後端、不需 build。
- 資料只存在裝置本機 `localStorage`（`hwobs.records.v2`）。進行中的觀察存在 `hwobs.active.v2`，關閉或重新整理後會接續。
- 部署：GitHub → Netlify，`netlify.toml` 發佈 repo 根目錄。

## 部署新版本

修改程式後，把 `sw.js` 的 `VERSION` 加一（例如 `v2.0.1`），App 會提示「有新版本可用，重新整理即可更新」。
（就算忘了改，service worker 採網路優先，有網路時仍會拿到最新檔案。）

## 圖示

`python3 tools/make_icons.py` 重新產生 `icons/`。

## 本機測試

```
npx http-server -c-1 .
```
開啟 http://localhost:8080 （service worker 只在 https 或 localhost 運作）。

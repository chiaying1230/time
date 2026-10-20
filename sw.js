/* 作業觀察筆記 service worker
 * 策略：同網域 GET 請求一律「網路優先、失敗時用快取」。
 * - 有網路：永遠拿到最新版，並順手更新快取 → 不會卡在舊版。
 * - 沒網路／太慢：用最近一次成功載入的版本 → 可離線觀察。
 * 每次部署請把 VERSION 加一，瀏覽器會偵測到新 SW 並在 App 內提示更新。
 */
var VERSION = 'v2.0.1';
var CACHE = 'hwobs-' + VERSION;
var ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png'
];
// 路徑都相對於 sw.js 所在位置，網站放在根目錄（Netlify）或子目錄（GitHub Pages /time/）都可用
var INDEX_URL = new URL('index.html', self.location).href;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS.map(function (u) { return new Request(new URL(u, self.location).href, { cache: 'reload' }); }));
    })
  );
  // 不自動 skipWaiting：由使用者在 App 內按「重新整理」決定，避免打斷進行中的觀察
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf('hwobs-') === 0 && k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function timeout(ms) {
  return new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, ms); });
}

function networkFirst(request, cacheKey, ms) {
  return caches.open(CACHE).then(function (cache) {
    var net = fetch(request).then(function (res) {
      if (res && res.ok && res.type === 'basic') cache.put(cacheKey, res.clone());
      return res;
    });
    return Promise.race([net, timeout(ms)]).catch(function () {
      return cache.match(cacheKey, { ignoreSearch: true }).then(function (hit) {
        return hit || net; // 沒有快取就繼續等網路
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // 所有頁面都是同一個 index.html（hash 路由）
    event.respondWith(networkFirst(req, INDEX_URL, 4000));
    return;
  }
  event.respondWith(networkFirst(req, url.origin + url.pathname, 6000));
});

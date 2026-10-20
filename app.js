/* 作業觀察筆記 — ABC 直接觀察紀錄（寫作業期間的非作業用途手機使用）
 * 無框架、無後端。資料只存在本機 localStorage。
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- 設定
  var APP_VERSION = '2.0.0';
  var PLAN_MS = 20 * 60 * 1000;
  var B_LABEL = '非作業用途拿起並使用手機';
  var OTHER = '其他';
  var C_ONGOING = '觀察結束時仍在使用手機';

  var A_OPTIONS = [
    '手機螢幕亮起／出現通知',
    '手機發出提示音／震動',
    '停止書寫',
    '視線離開作業',
    '長時間停留在同一題／同一頁',
    '剛完成一題／一段作業',
    '手機放在桌面／視線範圍內',
    '他人正在使用手機',
    '他人主動與受試者說話',
    OTHER
  ];
  var C_OPTIONS = [
    '繼續查看手機內容',
    '回覆訊息／傳送訊息',
    '開啟社群媒體',
    '觀看短影音／影片',
    '切換到其他手機 App',
    '與他人交談',
    '停止作業一段時間',
    '放下手機後立即回到作業',
    '放下手機後仍未回到作業',
    '他人對其手機使用做出回應',
    OTHER
  ];

  var KEYS = {
    records: 'hwobs.records.v2',
    active: 'hwobs.active.v2',
    meta: 'hwobs.meta',
    lineTip: 'hwobs.lineTipDismissed'
  };

  // ---------------------------------------------------------------- 小工具
  var $app = document.getElementById('app');
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  // 秒數 → mm:ss（無條件捨去）；60 分鐘以上加上小時
  function mmss(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(s);
  }
  // 倒數顯示用（無條件進位，避免剩 0.4 秒時就顯示 00:00）
  function mmssCeil(ms) { return mmss(Math.ceil(Math.max(0, ms) / 1000)); }
  function humanSec(sec) {
    sec = Math.round(sec || 0);
    if (sec < 60) return sec + ' 秒';
    return Math.floor(sec / 60) + ' 分 ' + pad(sec % 60) + ' 秒';
  }
  function pct(x) { return isFinite(x) ? (x * 100).toFixed(1) + '%' : '—'; }
  function d(t) { return t instanceof Date ? t : new Date(t); }
  function fmtDate(t) { t = d(t); return t.getFullYear() + '/' + pad(t.getMonth() + 1) + '/' + pad(t.getDate()); }
  function fmtMD(t) { t = d(t); return pad(t.getMonth() + 1) + '/' + pad(t.getDate()); }
  function fmtClock(t) { t = d(t); return pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds()); }
  function iso(ms) { return new Date(ms).toISOString(); }
  function round3(x) { return Math.round(x * 1000) / 1000; }
  function joinTags(part) {
    if (!part || !part.tags || !part.tags.length) return '';
    return part.tags.map(function (t) {
      return t === OTHER && part.other ? OTHER + '（' + part.other + '）' : t;
    }).join('、');
  }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } }

  function lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { toast('無法寫入本機儲存空間，請先複製資料備份。'); return false; }
  }
  function lsDel(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }

  var UA = navigator.userAgent || '';
  function isInAppBrowser() { return /\bLine\/|FBAN|FBAV|Instagram|MicroMessenger|KAKAOTALK/i.test(UA); }
  function isStandalone() {
    return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }

  // ---------------------------------------------------------------- 資料
  // 觀察紀錄（schema 2）
  // { id, schema, startedAt, endedAt, plannedSec, observedSec, endReason: 'completed'|'early',
  //   pauses: [{from, to}], note, events: [Event] }
  // Event: { id, start, end, durationSec, A: {tags, other}, B, C: {tags, other}, note,
  //          status: 'complete'|'ongoing_at_end' }
  function loadRecords() {
    var list = lsGet(KEYS.records, []);
    return Array.isArray(list) ? list.filter(function (r) { return r && r.id && r.startedAt; }) : [];
  }
  function saveRecords(list) { return lsSet(KEYS.records, list); }
  function getRecord(id) { return loadRecords().filter(function (r) { return r.id === id; })[0] || null; }
  function putRecord(rec) {
    var list = loadRecords(), i;
    for (i = 0; i < list.length; i++) if (list[i].id === rec.id) { list[i] = rec; return saveRecords(list); }
    list.push(rec);
    return saveRecords(list);
  }
  function sortedRecords() {
    return loadRecords().sort(function (a, b) { return d(b.startedAt) - d(a.startedAt); });
  }

  function stats(rec) {
    var events = rec.events || [];
    var total = events.reduce(function (s, e) { return s + (e.durationSec || 0); }, 0);
    var obs = rec.observedSec || 0;
    return {
      count: events.length,
      totalSec: total,
      ratio: obs > 0 ? total / obs : NaN,
      avgSec: events.length ? total / events.length : 0,
      per10: obs > 0 ? events.length / (obs / 600) : NaN,
      observedSec: obs,
      pausedSec: (rec.pauses || []).reduce(function (s, p) {
        return s + (p.to ? Math.max(0, d(p.to) - d(p.from)) / 1000 : 0);
      }, 0)
    };
  }

  // 第一筆：由舊版畫面轉入的 2026/10/20 觀察（只保留手機使用事件）。
  // 舊版逐筆時間顯示到整數秒（無條件捨去）、總時間 04:58 為毫秒加總；
  // 每筆以「顯示秒數 + 0.6 秒」還原，使逐筆顯示與總時間都與舊版一致。
  var SEED_ID = 'seed-20261020-2323';
  function seedRecord() {
    var day = '2026-10-20T', tz = '+08:00';
    var raw = [
      ['23:23:17', '23:24:10', 52], ['23:24:17', '23:24:51', 33], ['23:27:13', '23:27:17', 4],
      ['23:27:33', '23:27:56', 22], ['23:28:14', '23:28:21', 6], ['23:28:28', '23:28:43', 15],
      ['23:28:53', '23:29:05', 11], ['23:29:09', '23:29:50', 40], ['23:30:12', '23:32:03', 110]
    ];
    return {
      id: SEED_ID, schema: 2,
      startedAt: day + '23:23:10' + tz, endedAt: day + '23:43:13' + tz,
      plannedSec: 1200, observedSec: 1202, endReason: 'completed', pauses: [],
      note: '由舊版紀錄轉入：只保留手機使用事件，已移除「其他分心」紀錄。舊版未記錄 A／C，可點各事件「修改」補填。',
      events: raw.map(function (r, i) {
        return {
          id: SEED_ID + '-e' + (i + 1),
          start: day + r[0] + tz, end: day + r[1] + tz, durationSec: r[2] + 0.6,
          A: { tags: [], other: '' }, B: B_LABEL, C: { tags: [], other: '' }, note: '', status: 'complete'
        };
      })
    };
  }

  function migrate() {
    var meta = lsGet(KEYS.meta, {}) || {};
    if (!meta.seeded1) {
      var list = loadRecords();
      if (!list.some(function (r) { return r.id === SEED_ID; })) { list.push(seedRecord()); saveRecords(list); }
      meta.seeded1 = true;
    }
    meta.schema = 2;
    lsSet(KEYS.meta, meta);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
  }

  // 此網址下其他（舊版）程式留下的資料：不讀入、不刪除，只提供原始備份。
  function legacyData() {
    var out = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf('hwobs.') === 0) continue;
        var v = localStorage.getItem(k);
        if (v && v.length > 2) out[k] = v;
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  // ---------------------------------------------------------------- 進行中的觀察
  // active: { id, startedAt(ms), activeMs, runStart(ms|null), pauses:[{from,to}], events:[...],
  //           open: { id, start(ms), startEff, A } | null }
  // 有效時間（effective）= 實際在倒數中的毫秒數，暫停時凍結。
  // 手機事件 duration = 結束時的有效時間 − 開始時的有效時間，因此暫停會自動暫停事件計時。
  var active = null;
  var timerId = null;
  var wakeLock = null;

  function loadActive() { active = lsGet(KEYS.active, null); }
  function persistActive() { if (active) lsSet(KEYS.active, active); }
  function effAt(now) { return active.activeMs + (active.runStart != null ? now - active.runStart : 0); }
  function finishedTotal() {
    return active.events.reduce(function (s, e) { return s + e.durationSec; }, 0);
  }

  function startObservation() {
    var now = Date.now();
    active = { id: uid(), startedAt: now, activeMs: 0, runStart: now, pauses: [], events: [], open: null };
    persistActive();
    location.replace('#/observe');
    vibrate(20);
  }

  function pickUp() {
    if (!active || active.open || active.runStart == null) return;
    var now = Date.now();
    // 先記錄開始時間，再顯示 A 選單
    active.open = { id: uid(), start: now, startEff: effAt(now), A: { tags: [], other: '' } };
    persistActive();
    vibrate(25);
    renderObserve();
    openABSheet('A');
  }

  function putDown(atWall, atEff) {
    if (!active || !active.open) return null;
    var now = Date.now();
    var endWall = atWall != null ? atWall : now;
    var endEff = atEff != null ? atEff : effAt(now);
    var o = active.open;
    var ev = {
      id: o.id, start: iso(o.start), end: iso(endWall),
      durationSec: round3(Math.max(0, endEff - o.startEff) / 1000),
      A: o.A, B: B_LABEL, C: { tags: [], other: '' }, note: '', status: 'complete'
    };
    active.events.push(ev);
    active.open = null;
    persistActive();
    return ev;
  }

  function onPutDownTap() {
    if (!active || !active.open || active.runStart == null) return;
    var ev = putDown();
    vibrate([15, 40, 15]);
    renderObserve();
    if (ev) openABSheet('C', ev.id);
  }

  function cancelOpenEvent() {
    if (!active || !active.open) return;
    active.open = null;
    persistActive();
    closeSheet();
    renderObserve();
    toast('已取消這次事件');
  }

  function pause() {
    if (!active || active.runStart == null) return;
    var now = Date.now();
    active.activeMs = effAt(now);
    active.runStart = null;
    active.pauses.push({ from: iso(now), to: null });
    persistActive();
    closeSheet();
    releaseWakeLock();
    renderObserve();
  }

  function resume() {
    if (!active || active.runStart != null) return;
    var now = Date.now();
    active.runStart = now;
    var last = active.pauses[active.pauses.length - 1];
    if (last && !last.to) last.to = iso(now);
    persistActive();
    requestWakeLock();
    renderObserve();
  }

  // 暫停中，受試者已放下手機：以暫停開始的時間點結束該事件（暫停期間不計入）
  function putDownDuringPause() {
    if (!active || !active.open || active.runStart != null) return;
    var last = active.pauses[active.pauses.length - 1];
    var ev = putDown(last ? d(last.from).getTime() : Date.now(), active.activeMs);
    renderObserve();
    if (ev) openABSheet('C', ev.id);
  }

  function finish(reason) {
    if (!active) return;
    var now = Date.now();
    var endWall, observedMs;
    if (active.runStart != null) {
      var eff = effAt(now);
      if (eff >= PLAN_MS) {
        endWall = active.runStart + (PLAN_MS - active.activeMs); // 精確的 20:00 時間點
        observedMs = PLAN_MS;
      } else {
        endWall = now;
        observedMs = eff;
      }
    } else {
      endWall = now;
      observedMs = active.activeMs;
      var last = active.pauses[active.pauses.length - 1];
      if (last && !last.to) last.to = iso(now);
    }
    if (active.open) {
      var pausedAt = active.runStart == null && active.pauses.length
        ? d(active.pauses[active.pauses.length - 1].from).getTime() : endWall;
      var ev = putDown(pausedAt, observedMs);
      ev.C = { tags: [C_ONGOING], other: '' };
      ev.status = 'ongoing_at_end';
    }
    var rec = {
      id: active.id, schema: 2,
      startedAt: iso(active.startedAt), endedAt: iso(endWall),
      plannedSec: PLAN_MS / 1000, observedSec: round3(observedMs / 1000),
      endReason: reason, pauses: active.pauses, note: '', events: active.events
    };
    if (!putRecord(rec)) return; // 寫入失敗時保留進行中的狀態，避免遺失
    lsDel(KEYS.active);
    active = null;
    stopTimer();
    releaseWakeLock();
    closeSheet();
    closeModal();
    vibrate([40, 60, 40]);
    location.replace('#/record/' + rec.id);
    toast(reason === 'completed' ? '20 分鐘觀察結束，已自動儲存' : '已提前結束並儲存');
  }

  function confirmEarlyEnd() {
    var eff = effAt(Date.now());
    confirmDialog({
      title: '提前結束觀察？',
      body: '目前有效觀察時間 ' + mmss(eff / 1000) + '，占比將以實際觀察時間計算。' +
        (active && active.open ? '進行中的手機事件會在此時結束，C 標記為「' + C_ONGOING + '」。' : ''),
      ok: '確定結束', danger: true
    }).then(function (yes) { if (yes) finish('early'); });
  }

  function tick() {
    if (!active) return stopTimer();
    var now = Date.now();
    if (active.runStart != null && effAt(now) >= PLAN_MS) return finish('completed');
    updateObserveNumbers(now);
  }
  function startTimer() { if (!timerId) timerId = setInterval(tick, 250); }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
        navigator.wakeLock.request('screen').then(function (l) {
          wakeLock = l;
          l.addEventListener('release', function () { wakeLock = null; });
        }).catch(function () { /* ignore */ });
      }
    } catch (e) { /* ignore */ }
  }
  function releaseWakeLock() { try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }

  // ---------------------------------------------------------------- 路由
  function route() {
    var h = location.hash || '#/';
    if (active) {
      if (h !== '#/observe') { location.replace('#/observe'); return; }
      return renderObserve();
    }
    stopTimer();
    var m = h.match(/^#\/record\/(.+)$/);
    if (m) return renderRecord(decodeURIComponent(m[1]));
    if (h === '#/history') return renderHistory();
    if (h === '#/observe') { location.replace('#/'); return; }
    renderHome();
  }

  // ---------------------------------------------------------------- 首頁
  function renderHome() {
    closeSheet();
    var n = loadRecords().length;
    var showTip = isInAppBrowser() && !lsGet(KEYS.lineTip, false);
    $app.innerHTML =
      '<section class="home">' +
        '<div class="home__hero">' +
          '<img class="home__icon" src="/icons/icon-192.png" alt="">' +
          '<h1>作業觀察筆記</h1>' +
          '<p class="home__lead">觀察寫作業期間「非作業用途拿起並使用手機」，以 ABC 直接紀錄。每次固定 20 分鐘。</p>' +
          (showTip ? '<div class="tip" id="line-tip"><p>建議使用 Chrome / Safari 開啟並加入主畫面，使用會更穩定。</p>' +
            '<button type="button" aria-label="關閉提示" data-act="tip-close">×</button></div>' : '') +
          '<div class="home__actions">' +
            '<button type="button" class="btn btn--primary btn--big" data-act="start">開始 20 分鐘觀察</button>' +
            '<a class="btn" href="#/history">歷史紀錄 <span class="home__count">' + n + ' 筆</span></a>' +
          '</div>' +
        '</div>' +
        '<p class="home__foot">資料只儲存在這支裝置上</p>' +
      '</section>';
    showUpdateBarIfReady();
  }

  // ---------------------------------------------------------------- 觀察中
  function renderObserve() {
    if (!active) return;
    hideUpdateBar();
    var paused = active.runStart == null;
    var o = active.open;
    $app.innerHTML =
      '<section class="obs">' +
        '<div class="obs__top">' +
          (paused ? '<span class="chip-label chip-label--warn">已暫停</span>' : '<span class="chip-label">觀察中</span>') +
          '<span class="muted small">' + fmtClock(active.startedAt) + ' 開始</span>' +
        '</div>' +
        '<div class="obs__timer">' +
          '<div class="obs__timer-label">剩餘時間</div>' +
          '<div class="obs__remain num' + (paused ? ' is-paused' : '') + '" id="remain">20:00</div>' +
          '<div class="progress"><i id="prog"></i></div>' +
        '</div>' +
        '<div class="obs__stats">' +
          '<div class="stat"><div class="stat__k">手機已使用</div><div class="stat__v num"><span id="cnt">0</span> 次</div></div>' +
          '<div class="stat"><div class="stat__k">累積手機時間</div><div class="stat__v num" id="tot">00:00</div></div>' +
        '</div>' +
        '<div class="obs__main">' +
          (o ? '<div class="obs__a-line"><span><b>A：</b>' + (esc(joinTags(o.A)) || '<span class="muted">未選</span>') + '</span>' +
            '<button type="button" class="btn btn--sm" data-act="edit-a">修改 A</button></div>' : '') +
          '<button type="button" id="phone-btn" class="phone-btn' + (o ? ' is-using' : '') + '" data-act="' + (o ? 'down' : 'up') + '"' + (paused ? ' disabled' : '') + '>' +
            (o ? '放下手機<span class="phone-btn__sub num">使用手機中 <span id="live">00:00</span></span>' : '拿起手機') +
          '</button>' +
          '<div class="obs__ctrl">' +
            (paused
              ? '<button type="button" class="btn btn--primary" data-act="resume">繼續觀察</button>'
              : '<button type="button" class="btn" data-act="pause">暫停</button>') +
            '<button type="button" class="btn btn--danger" data-act="end">提前結束</button>' +
          '</div>' +
          (paused ? '<p class="muted small" style="margin:0">暫停中：倒數停止，不計入有效觀察時間' +
            (o ? '；本次手機事件計時也同步暫停。' : '。') + '</p>' +
            (o ? '<button type="button" class="btn" data-act="down-paused">受試者已在暫停時放下手機</button>' : '') : '') +
        '</div>' +
      '</section>';
    updateObserveNumbers(Date.now());
    startTimer();
    if (!paused) requestWakeLock();
  }

  function updateObserveNumbers(now) {
    if (!active) return;
    var eff = Math.min(effAt(now), PLAN_MS);
    var el = document.getElementById('remain');
    if (!el) return;
    el.textContent = mmssCeil(PLAN_MS - eff);
    document.getElementById('prog').style.width = (eff / PLAN_MS * 100).toFixed(2) + '%';
    document.getElementById('cnt').textContent = active.events.length;
    var liveSec = active.open ? Math.max(0, eff - active.open.startEff) / 1000 : 0;
    document.getElementById('tot').textContent = mmss(finishedTotal() + liveSec);
    var live = document.getElementById('live');
    if (live) live.textContent = mmss(liveSec);
    var sheetLive = document.getElementById('sheet-live');
    if (sheetLive && active.open) sheetLive.textContent = '使用手機中 ' + mmss(liveSec);
  }

  // ---------------------------------------------------------------- A / C 快速選單
  var $sheet = document.getElementById('sheet');
  var $sheetBg = document.getElementById('sheet-backdrop');
  var sheetCtx = null;

  function findEventRef(id) {
    if (active) {
      if (active.open && active.open.id === id) return { ev: active.open, save: persistActive };
      for (var i = 0; i < active.events.length; i++) {
        if (active.events[i].id === id) return { ev: active.events[i], save: persistActive };
      }
    }
    return null;
  }

  function chipsHTML(options, part, prefix) {
    return options.map(function (opt, i) {
      var on = part.tags.indexOf(opt) >= 0;
      return '<button type="button" class="chip' + (opt === OTHER ? ' chip--wide' : '') + '" aria-pressed="' + on +
        '" data-chip="' + prefix + '" data-i="' + i + '">' + esc(opt) + '</button>';
    }).join('') +
      '<label class="field chip--wide" data-other="' + prefix + '"' + (part.tags.indexOf(OTHER) >= 0 ? '' : ' hidden') + '>' +
      '<span>其他（簡短補充）</span><input type="text" maxlength="60" data-otherinput="' + prefix + '" value="' + esc(part.other) + '"></label>';
  }

  // which: 'A' 或 'C'；A 一律對應進行中的事件
  function openABSheet(which, eventId) {
    var ref = which === 'A' ? (active && active.open ? { ev: active.open, save: persistActive } : null) : findEventRef(eventId);
    if (!ref) return;
    var ev = ref.ev;
    var part = which === 'A' ? ev.A : ev.C;
    sheetCtx = { kind: which, ref: ref, part: part, options: which === 'A' ? A_OPTIONS : C_OPTIONS };
    $sheet.innerHTML =
      '<div class="sheet__head">' +
        '<h2 class="sheet__title">' + (which === 'A' ? 'A 前事' : 'C 後果') + '<span class="muted small">（可複選）</span></h2>' +
        (which === 'A'
          ? '<span class="sheet__live num" id="sheet-live"></span>'
          : '<span class="sheet__live num" style="color:var(--accent)">本次 ' + mmss(ev.durationSec) + '</span>') +
      '</div>' +
      '<p class="sheet__hint">' + (which === 'A'
        ? '拿起手機「之前」看到／聽到的事件'
        : '使用手機「之後」實際發生的事件') + '</p>' +
      '<div class="chips">' + chipsHTML(sheetCtx.options, part, which) + '</div>' +
      '<div class="sheet__actions">' +
        '<button type="button" class="btn btn--primary btn--big" data-act="sheet-done">完成</button>' +
        (which === 'A' ? '<button type="button" class="link-btn" data-act="cancel-event">誤按？取消這次事件</button>' : '') +
      '</div>';
    $sheet.hidden = false;
    $sheetBg.hidden = false;
    if (active) updateObserveNumbers(Date.now());
  }

  function toggleChip(btn) {
    if (!sheetCtx) return;
    var opt = sheetCtx.options[+btn.getAttribute('data-i')];
    var tags = sheetCtx.part.tags;
    var i = tags.indexOf(opt);
    if (i >= 0) tags.splice(i, 1); else tags.push(opt);
    // 依選項原本順序排列，方便閱讀與統計
    tags.sort(function (a, b) { return sheetCtx.options.indexOf(a) - sheetCtx.options.indexOf(b); });
    btn.setAttribute('aria-pressed', String(i < 0));
    var other = $sheet.querySelector('[data-other]');
    if (opt === OTHER && other) {
      other.hidden = i >= 0;
      if (i < 0) setTimeout(function () { var inp = other.querySelector('input'); if (inp) inp.focus(); }, 30);
    }
    sheetCtx.ref.save();
    if (sheetCtx.kind === 'A') renderObserveKeepSheet();
  }

  function renderObserveKeepSheet() {
    // 更新觀察頁上的 A 摘要，不關閉選單
    var line = document.querySelector('.obs__a-line span');
    if (line && active && active.open) line.innerHTML = '<b>A：</b>' + (esc(joinTags(active.open.A)) || '<span class="muted">未選</span>');
  }

  function closeSheet() {
    sheetCtx = null;
    $sheet.hidden = true;
    $sheetBg.hidden = true;
    $sheet.innerHTML = '';
  }

  // ---------------------------------------------------------------- 結果頁
  function eventBlock(ev, i, editable) {
    return '<article class="event">' +
      '<div class="event__head"><div>' +
        '<div class="event__title">事件 ' + (i + 1) + '</div>' +
        '<div class="event__time num">' + fmtClock(ev.start) + ' – ' + fmtClock(ev.end) + '</div>' +
      '</div><div style="text-align:right">' +
        '<div class="event__dur num">' + mmss(ev.durationSec) + '</div>' +
        (editable ? '<button type="button" class="btn btn--sm" data-act="edit-event" data-id="' + esc(ev.id) + '">修改</button>' : '') +
      '</div></div>' +
      '<dl class="abc">' +
        '<div><dt>A 前事</dt><dd>' + (esc(joinTags(ev.A)) || '<span class="empty">未填</span>') + '</dd></div>' +
        '<div><dt>B 行為</dt><dd>' + esc(ev.B || B_LABEL) + '</dd></div>' +
        '<div><dt>C 後果</dt><dd>' + (esc(joinTags(ev.C)) || '<span class="empty">未填</span>') + '</dd></div>' +
        (ev.note ? '<div><dt>補充</dt><dd>' + esc(ev.note) + '</dd></div>' : '') +
      '</dl></article>';
  }

  function tallyHTML(events, key, options) {
    var counts = {};
    var others = [];
    events.forEach(function (e) {
      (e[key] && e[key].tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
      if (e[key] && e[key].other) others.push(e[key].other);
    });
    var keys = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || options.indexOf(a) - options.indexOf(b);
    });
    if (!keys.length) return '<p class="muted small">尚無資料</p>';
    var max = counts[keys[0]];
    return '<ul class="tally">' + keys.map(function (k) {
      return '<li><span>' + esc(k) + '</span><b class="num">' + counts[k] + ' 次</b>' +
        '<span class="bar"><i style="width:' + (counts[k] / max * 100) + '%"></i></span></li>';
    }).join('') + '</ul>' +
      (others.length ? '<p class="muted small">「其他」補充：' + esc(others.join('；')) + '</p>' : '');
  }

  function renderRecord(id) {
    closeSheet();
    var rec = getRecord(id);
    if (!rec) {
      $app.innerHTML = '<div class="topnav"><a href="#/history">← 歷史紀錄</a></div><p class="empty-state">找不到這筆紀錄。</p>';
      return;
    }
    var s = stats(rec);
    $app.innerHTML =
      '<div class="topnav"><a href="#/history">← 歷史紀錄</a><a href="#/">首頁</a></div>' +
      '<section class="card">' +
        '<span class="chip-label' + (rec.endReason === 'early' ? ' chip-label--warn' : '') + '">' +
          (rec.endReason === 'early' ? '提前結束' : '完成 20 分鐘') + '</span>' +
        '<h1 class="page-title">' + fmtDate(rec.startedAt) + '</h1>' +
        '<div class="muted num">' + fmtClock(rec.startedAt) + ' – ' + fmtClock(rec.endedAt) +
          ' · 有效觀察 ' + mmss(s.observedSec) + '</div>' +
        '<div class="metrics">' +
          '<div class="metric"><div class="metric__k">手機使用次數</div><div class="metric__v num">' + s.count + '<small>次</small></div></div>' +
          '<div class="metric"><div class="metric__k">手機使用總時間</div><div class="metric__v num">' + mmss(s.totalSec) + '</div></div>' +
          '<div class="metric"><div class="metric__k">手機使用時間占比</div><div class="metric__v num">' + pct(s.ratio) + '</div></div>' +
          '<div class="metric"><div class="metric__k">平均每次</div><div class="metric__v num">' + (s.count ? humanSec(s.avgSec) : '—') + '</div></div>' +
        '</div>' +
        (rec.note ? '<div class="note-box">' + esc(rec.note) + '</div>' : '') +
      '</section>' +
      '<section class="card"><div class="actions4">' +
        '<button type="button" class="btn" data-act="copy">複製本次資料</button>' +
        '<button type="button" class="btn" data-act="share">分享</button>' +
        '<button type="button" class="btn" data-act="csv">匯出 CSV</button>' +
        '<button type="button" class="btn" data-act="json">匯出 JSON 備份</button>' +
      '</div></section>' +
      '<section class="card"><h2 style="margin:0 0 6px;font-size:20px">事件明細</h2>' +
        (rec.events.length ? rec.events.map(function (e, i) { return eventBlock(e, i, true); }).join('')
          : '<p class="muted">本次觀察沒有手機使用事件。</p>') +
      '</section>' +
      '<section class="card"><details class="more"><summary>詳細資料</summary>' +
        '<dl class="kv">' +
          '<dt>有效觀察時間</dt><dd class="num">' + mmss(s.observedSec) + '</dd>' +
          '<dt>每 10 分鐘手機使用頻率</dt><dd class="num">' + (isFinite(s.per10) ? s.per10.toFixed(2) + ' 次' : '—') + '</dd>' +
          '<dt>暫停</dt><dd class="num">' + (rec.pauses || []).length + ' 次 · ' + mmss(s.pausedSec) + '</dd>' +
        '</dl>' +
        '<div class="sec-title">A 前事出現次數</div>' + tallyHTML(rec.events, 'A', A_OPTIONS) +
        '<div class="sec-title">C 後果出現次數</div>' + tallyHTML(rec.events, 'C', C_OPTIONS.concat([C_ONGOING])) +
        '<p class="muted small" style="margin-top:12px">以上僅整理觀察次數，不代表行為功能判定。功能假設請由研究者另行分析。</p>' +
      '</details></section>' +
      '<button type="button" class="btn btn--ghost btn--danger" data-act="delete-record">刪除這筆紀錄</button>';
    $app.setAttribute('data-record', rec.id);
    showUpdateBarIfReady();
  }

  // 編輯單一事件（A、C、補充文字、必要時修正時間）
  function openEditSheet(recId, evId) {
    var rec = getRecord(recId);
    if (!rec) return;
    var idx = -1;
    rec.events.forEach(function (e, i) { if (e.id === evId) idx = i; });
    if (idx < 0) return;
    var ev = JSON.parse(JSON.stringify(rec.events[idx]));
    var cOpts = C_OPTIONS.slice();
    if (ev.C.tags.indexOf(C_ONGOING) >= 0) cOpts.splice(cOpts.length - 1, 0, C_ONGOING);
    sheetCtx = { kind: 'edit', recId: recId, ev: ev, idx: idx, aOpts: A_OPTIONS, cOpts: cOpts };
    $sheet.innerHTML =
      '<div class="sheet__head"><h2 class="sheet__title">修改事件 ' + (idx + 1) + '</h2>' +
        '<span class="muted num">' + mmss(ev.durationSec) + '</span></div>' +
      '<div class="sec-title" style="margin-top:4px">A 前事</div><div class="chips">' + chipsHTML(A_OPTIONS, ev.A, 'eA') + '</div>' +
      '<div class="sec-title">B 行為</div><p style="margin:0">' + esc(B_LABEL) + '</p>' +
      '<div class="sec-title">C 後果</div><div class="chips">' + chipsHTML(cOpts, ev.C, 'eC') + '</div>' +
      '<label class="field"><span>補充文字</span><textarea maxlength="300" id="ed-note">' + esc(ev.note) + '</textarea></label>' +
      '<details class="more" style="margin-top:12px"><summary>修正開始／結束時間</summary>' +
        '<div class="row2">' +
          '<label class="field"><span>開始</span><input type="time" step="1" id="ed-start" value="' + fmtClock(ev.start) + '"></label>' +
          '<label class="field"><span>結束</span><input type="time" step="1" id="ed-end" value="' + fmtClock(ev.end) + '"></label>' +
        '</div><p class="muted small">須在觀察時段 ' + fmtClock(rec.startedAt) + '–' + fmtClock(rec.endedAt) + ' 內；持續時間會扣除暫停時間重新計算。</p>' +
      '</details>' +
      '<div class="sheet__actions">' +
        '<button type="button" class="btn btn--primary" data-act="edit-save">儲存</button>' +
        '<div class="row2"><button type="button" class="btn" data-act="sheet-close">取消</button>' +
        '<button type="button" class="btn btn--danger" data-act="edit-delete">刪除此事件</button></div>' +
      '</div>';
    $sheet.hidden = false;
    $sheetBg.hidden = false;
  }

  function toggleEditChip(btn) {
    var which = btn.getAttribute('data-chip');
    var opts = which === 'eA' ? sheetCtx.aOpts : sheetCtx.cOpts;
    var part = which === 'eA' ? sheetCtx.ev.A : sheetCtx.ev.C;
    var opt = opts[+btn.getAttribute('data-i')];
    var i = part.tags.indexOf(opt);
    if (i >= 0) part.tags.splice(i, 1); else part.tags.push(opt);
    part.tags.sort(function (a, b) { return opts.indexOf(a) - opts.indexOf(b); });
    btn.setAttribute('aria-pressed', String(i < 0));
    if (opt === OTHER) {
      var other = $sheet.querySelector('[data-other="' + which + '"]');
      if (other) other.hidden = i >= 0;
    }
  }

  // 由 HH:MM:SS 推回完整時間（以觀察開始日期為基準，可跨午夜）
  function timeOnDay(baseIso, hms) {
    var m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hms || '');
    if (!m) return NaN;
    var base = d(baseIso);
    var t = new Date(base.getFullYear(), base.getMonth(), base.getDate(), +m[1], +m[2], +(m[3] || 0)).getTime();
    if (t < base.getTime() - 1000) t += 24 * 3600 * 1000;
    return t;
  }
  function pausedOverlapMs(pauses, a, b) {
    return (pauses || []).reduce(function (s, p) {
      if (!p.to) return s;
      var lo = Math.max(a, d(p.from).getTime()), hi = Math.min(b, d(p.to).getTime());
      return s + Math.max(0, hi - lo);
    }, 0);
  }

  function saveEdit() {
    var ctx = sheetCtx;
    var rec = getRecord(ctx.recId);
    if (!rec) return closeSheet();
    var ev = ctx.ev;
    ev.note = ($sheet.querySelector('#ed-note').value || '').trim();
    ['eA', 'eC'].forEach(function (k) {
      var inp = $sheet.querySelector('[data-otherinput="' + k + '"]');
      var part = k === 'eA' ? ev.A : ev.C;
      part.other = part.tags.indexOf(OTHER) >= 0 && inp ? inp.value.trim() : '';
    });
    var sVal = $sheet.querySelector('#ed-start').value, eVal = $sheet.querySelector('#ed-end').value;
    if (sVal !== fmtClock(ev.start) || eVal !== fmtClock(ev.end)) {
      var recStart = d(rec.startedAt).getTime(), recEnd = d(rec.endedAt).getTime();
      var s = timeOnDay(rec.startedAt, sVal), e = timeOnDay(rec.startedAt, eVal);
      // 秒以下的誤差容許：觀察開始／結束可能不在整秒
      if (!isFinite(s) || !isFinite(e)) return toast('時間格式不正確');
      if (s < Math.floor(recStart / 1000) * 1000 || e > Math.ceil(recEnd / 1000) * 1000) return toast('時間須在觀察時段內');
      if (e <= s) return toast('結束時間須晚於開始時間');
      s = Math.max(s, recStart); e = Math.min(e, recEnd);
      ev.start = iso(s); ev.end = iso(e);
      ev.durationSec = round3((e - s - pausedOverlapMs(rec.pauses, s, e)) / 1000);
    }
    if (ev.status === 'ongoing_at_end' && ev.C.tags.indexOf(C_ONGOING) < 0) ev.status = 'complete';
    rec.events[ctx.idx] = ev;
    rec.events.sort(function (a, b) { return d(a.start) - d(b.start); });
    if (putRecord(rec)) { closeSheet(); renderRecord(rec.id); toast('已儲存'); }
  }

  function deleteEditEvent() {
    var ctx = sheetCtx;
    confirmDialog({ title: '刪除事件 ' + (ctx.idx + 1) + '？', body: '刪除後無法復原。', ok: '刪除', danger: true })
      .then(function (yes) {
        if (!yes) return;
        var rec = getRecord(ctx.recId);
        if (!rec) return;
        rec.events = rec.events.filter(function (e) { return e.id !== ctx.ev.id; });
        if (putRecord(rec)) { closeSheet(); renderRecord(rec.id); toast('已刪除事件'); }
      });
  }

  // ---------------------------------------------------------------- 歷史
  function renderHistory() {
    closeSheet();
    var list = sortedRecords();
    var legacy = legacyData();
    var legacyCount = Object.keys(legacy).length;
    $app.innerHTML =
      '<div class="topnav"><a href="#/">← 首頁</a><span class="muted small">' + list.length + ' 筆</span></div>' +
      '<h1 class="page-title" style="margin-bottom:12px">歷史紀錄</h1>' +
      (list.length ? '<ul class="hist">' + list.map(function (r) {
        var s = stats(r);
        return '<li><a href="#/record/' + encodeURIComponent(r.id) + '">' +
          '<span class="hist__date num">' + fmtMD(r.startedAt) + '</span>' +
          '<span class="hist__mid num">觀察 <b>' + mmss(s.observedSec) + '</b> · <b>' + s.count + '</b> 次 · <b>' + mmss(s.totalSec) + '</b></span>' +
          '<span class="hist__ratio num">' + pct(s.ratio) + '</span></a></li>';
      }).join('') + '</ul>'
        : '<p class="empty-state">還沒有紀錄。</p>') +
      (list.length ? '<div class="row2" style="margin-top:16px">' +
        '<button type="button" class="btn" data-act="all-json">全部 JSON 備份</button>' +
        '<button type="button" class="btn" data-act="all-csv">全部 CSV</button></div>' : '') +
      (legacyCount ? '<div class="note-box">此瀏覽器中有舊版程式留下的資料（' + legacyCount + ' 項），未列入上方紀錄，也沒有被刪除。' +
        '<br><button type="button" class="link-btn" data-act="legacy">匯出舊版原始資料</button></div>' : '') +
      '<div class="about">' +
        '<span>執行模式：' + (isStandalone() ? '已安裝 App（主畫面）' : '瀏覽器分頁') + '</span>' +
        '<span id="sw-status">離線使用：檢查中…</span>' +
        '<span>版本 ' + APP_VERSION + '</span>' +
      '</div>';
    updateSwStatus();
    showUpdateBarIfReady();
  }

  function updateSwStatus() {
    var el = document.getElementById('sw-status');
    if (!el) return;
    if (!('serviceWorker' in navigator)) { el.textContent = '離線使用：此瀏覽器不支援'; return; }
    navigator.serviceWorker.getRegistration().then(function (reg) {
      el.textContent = '離線使用：' + (reg && reg.active ? '已啟用' : '尚未啟用（重新開啟一次即可）');
    }).catch(function () { el.textContent = '離線使用：無法確認'; });
  }

  // ---------------------------------------------------------------- 匯出
  function recordText(rec) {
    var s = stats(rec);
    var lines = [
      '作業觀察筆記',
      '日期：' + fmtDate(rec.startedAt),
      '觀察時段：' + fmtClock(rec.startedAt) + '–' + fmtClock(rec.endedAt),
      '有效觀察時間：' + mmss(s.observedSec) + (rec.endReason === 'early' ? '（提前結束）' : ''),
      '手機使用：' + s.count + ' 次',
      '手機總時間：' + mmss(s.totalSec),
      '使用時間占比：' + pct(s.ratio),
      '平均每次：' + (s.count ? humanSec(s.avgSec) : '—')
    ];
    rec.events.forEach(function (e, i) {
      lines.push('', '事件 ' + (i + 1) + '（' + fmtClock(e.start) + '–' + fmtClock(e.end) + '）',
        'A：' + (joinTags(e.A) || '未填'),
        'B：' + (e.B || B_LABEL),
        'C：' + (joinTags(e.C) || '未填'),
        '持續：' + mmss(e.durationSec));
      if (e.note) lines.push('補充：' + e.note);
    });
    return lines.join('\n');
  }

  function csvCell(v) {
    v = String(v == null ? '' : v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function recordsCSV(recs) {
    var head = ['觀察ID', '日期', '觀察開始', '觀察結束', '有效觀察秒數', '結束方式', '手機使用次數', '手機總秒數', '使用時間占比',
      '事件編號', '事件開始', '事件結束', '持續秒數', 'A前事', 'A其他', 'B行為', 'C後果', 'C其他', '補充', '事件狀態'];
    var rows = [head];
    recs.forEach(function (r) {
      var s = stats(r);
      var base = [r.id, fmtDate(r.startedAt), fmtClock(r.startedAt), fmtClock(r.endedAt), Math.round(s.observedSec),
        r.endReason === 'early' ? '提前結束' : '完成20分鐘', s.count, Math.round(s.totalSec * 10) / 10,
        isFinite(s.ratio) ? (s.ratio * 100).toFixed(1) + '%' : ''];
      if (!r.events.length) rows.push(base.concat(['', '', '', '', '', '', '', '', '', '', '']));
      r.events.forEach(function (e, i) {
        rows.push(base.concat([i + 1, fmtClock(e.start), fmtClock(e.end), Math.round(e.durationSec * 10) / 10,
          e.A.tags.join('；'), e.A.other || '', e.B || B_LABEL, e.C.tags.join('；'), e.C.other || '', e.note || '',
          e.status === 'ongoing_at_end' ? '觀察結束時仍在使用' : '完整']));
      });
    });
    return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  function fileStamp(rec) {
    var t = d(rec.startedAt);
    return t.getFullYear() + pad(t.getMonth() + 1) + pad(t.getDate()) + '-' + pad(t.getHours()) + pad(t.getMinutes());
  }

  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { ta.setSelectionRange(0, text.length); } catch (e) { /* ignore */ }
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }

  function copyWithFeedback(text, okMsg) {
    copyText(text).then(function (ok) {
      if (ok) toast(okMsg || '已複製，可直接貼到 LINE、記事本或文件');
      else manualCopyDialog(text);
    });
  }

  function manualCopyDialog(text) {
    openModal('<h2>請手動複製</h2><p>此瀏覽器不允許自動複製。請長按下方文字 →「全選」→「複製」。</p>' +
      '<textarea readonly id="manual-copy">' + esc(text) + '</textarea>' +
      '<div class="modal__actions"><button type="button" class="btn btn--primary" data-act="modal-close">關閉</button></div>');
    var ta = document.getElementById('manual-copy');
    if (ta) { ta.focus(); ta.select(); }
  }

  function shareText(title, text) {
    if (navigator.share) {
      navigator.share({ title: title, text: text }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        copyWithFeedback(text, '無法開啟分享，已改為複製文字');
      });
      return;
    }
    copyWithFeedback(text, '此瀏覽器不支援分享，已改為複製文字，可貼到 LINE 或其他 App');
  }

  function downloadHelp(name, text, mime) {
    var canShareFile = false, file = null;
    try {
      file = new File([text], name, { type: mime });
      canShareFile = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    } catch (e) { canShareFile = false; }
    openModal('<h2>無法確定能否下載</h2>' +
      '<p>此瀏覽器可能不支援檔案下載。請使用「複製資料」、「分享」，或改用 Chrome / Safari 開啟。</p>' +
      '<div class="modal__actions">' +
        '<button type="button" class="btn btn--primary" data-act="dl-copy">複製檔案內容</button>' +
        (canShareFile ? '<button type="button" class="btn" data-act="dl-share">以分享傳送檔案</button>' : '') +
        '<button type="button" class="btn" data-act="dl-try">仍要嘗試下載</button>' +
        '<button type="button" class="btn btn--ghost" data-act="modal-close">關閉</button>' +
      '</div>');
    modalCtx = { name: name, text: text, mime: mime, file: file };
  }

  function triggerDownload(name, text, mime) {
    try {
      var blob = new Blob([text], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      toast('已開始下載 ' + name + '。若沒有出現檔案，請改用「複製本次資料」或「分享」。', 4500);
    } catch (e) {
      downloadHelp(name, text, mime);
    }
  }

  function exportFile(name, text, mime) {
    if (isInAppBrowser() || !('download' in document.createElement('a'))) return downloadHelp(name, text, mime);
    triggerDownload(name, text, mime);
  }

  // ---------------------------------------------------------------- 對話框 / 提示
  var $modal = document.getElementById('modal');
  var $modalBg = document.getElementById('modal-backdrop');
  var modalCtx = null;
  var modalResolve = null;

  function openModal(html) {
    $modal.innerHTML = html;
    $modal.hidden = false;
    $modalBg.hidden = false;
  }
  function closeModal(result) {
    $modal.hidden = true;
    $modalBg.hidden = true;
    $modal.innerHTML = '';
    modalCtx = null;
    if (modalResolve) { var r = modalResolve; modalResolve = null; r(!!result); }
  }
  function confirmDialog(o) {
    if (modalResolve) closeModal(false);
    openModal('<h2>' + esc(o.title) + '</h2><p>' + esc(o.body || '') + '</p>' +
      '<div class="modal__actions">' +
        '<button type="button" class="btn ' + (o.danger ? 'btn--primary" style="background:var(--danger);border-color:var(--danger)' : 'btn--primary') + '" data-act="modal-ok">' + esc(o.ok || '確定') + '</button>' +
        '<button type="button" class="btn" data-act="modal-close">取消</button>' +
      '</div>');
    return new Promise(function (resolve) { modalResolve = resolve; });
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 2600);
  }

  // ---------------------------------------------------------------- 事件委派
  var lastMainTap = 0;
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-chip]');
    if (chip) {
      var which = chip.getAttribute('data-chip');
      if (which === 'eA' || which === 'eC') toggleEditChip(chip); else toggleChip(chip);
      return;
    }
    var el = e.target.closest('[data-act]');
    if (!el) {
      if (e.target === $sheetBg && sheetCtx && sheetCtx.kind !== 'edit') closeSheet();
      return;
    }
    var act = el.getAttribute('data-act');
    var recId = $app.getAttribute('data-record');
    var now = Date.now();
    switch (act) {
      case 'start': startObservation(); break;
      case 'tip-close': lsSet(KEYS.lineTip, true); var t = document.getElementById('line-tip'); if (t) t.remove(); break;
      case 'up':
        if (now - lastMainTap < 350) return;
        lastMainTap = now; pickUp(); break;
      case 'down':
        if (now - lastMainTap < 350) return;
        lastMainTap = now; onPutDownTap(); break;
      case 'down-paused': putDownDuringPause(); break;
      case 'edit-a': openABSheet('A'); break;
      case 'pause': pause(); break;
      case 'resume': resume(); break;
      case 'end': confirmEarlyEnd(); break;
      case 'sheet-done': closeSheet(); break;
      case 'sheet-close': closeSheet(); break;
      case 'cancel-event': cancelOpenEvent(); break;
      case 'edit-event': openEditSheet(recId, el.getAttribute('data-id')); break;
      case 'edit-save': saveEdit(); break;
      case 'edit-delete': deleteEditEvent(); break;
      case 'copy': { var r1 = getRecord(recId); if (r1) copyWithFeedback(recordText(r1)); break; }
      case 'share': { var r2 = getRecord(recId); if (r2) shareText('作業觀察筆記 ' + fmtDate(r2.startedAt), recordText(r2)); break; }
      case 'csv': { var r3 = getRecord(recId); if (r3) exportFile('作業觀察-' + fileStamp(r3) + '.csv', recordsCSV([r3]), 'text/csv;charset=utf-8'); break; }
      case 'json': {
        var r4 = getRecord(recId);
        if (r4) exportFile('作業觀察-' + fileStamp(r4) + '.json', JSON.stringify({ app: 'hwobs', version: APP_VERSION, exportedAt: new Date().toISOString(), records: [r4] }, null, 2), 'application/json');
        break;
      }
      case 'all-json':
        exportFile('作業觀察-全部備份.json', JSON.stringify({ app: 'hwobs', version: APP_VERSION, exportedAt: new Date().toISOString(), records: sortedRecords() }, null, 2), 'application/json');
        break;
      case 'all-csv': exportFile('作業觀察-全部.csv', recordsCSV(sortedRecords().reverse()), 'text/csv;charset=utf-8'); break;
      case 'legacy': exportFile('舊版原始資料.json', JSON.stringify(legacyData(), null, 2), 'application/json'); break;
      case 'delete-record':
        confirmDialog({ title: '刪除這筆紀錄？', body: '整筆觀察與所有事件都會刪除，無法復原。建議先複製或匯出備份。', ok: '刪除', danger: true })
          .then(function (yes) {
            if (!yes) return;
            saveRecords(loadRecords().filter(function (r) { return r.id !== recId; }));
            location.replace('#/history');
            toast('已刪除');
          });
        break;
      case 'modal-ok': closeModal(true); break;
      case 'modal-close': closeModal(false); break;
      case 'dl-copy': { var c = modalCtx; closeModal(); if (c) copyWithFeedback(c.text, '已複製檔案內容'); break; }
      case 'dl-share': {
        var c2 = modalCtx; closeModal();
        if (c2 && c2.file) navigator.share({ files: [c2.file], title: c2.name }).catch(function (err) {
          if (!err || err.name !== 'AbortError') copyWithFeedback(c2.text, '無法分享檔案，已改為複製內容');
        });
        break;
      }
      case 'dl-try': { var c3 = modalCtx; closeModal(); if (c3) triggerDownload(c3.name, c3.text, c3.mime); break; }
      default: break;
    }
  });

  // 「其他」補充文字：觀察中即時儲存
  document.addEventListener('input', function (e) {
    var which = e.target.getAttribute && e.target.getAttribute('data-otherinput');
    if (!which || !sheetCtx || sheetCtx.kind === 'edit') return;
    sheetCtx.part.other = e.target.value.trim();
    sheetCtx.ref.save();
    if (sheetCtx.kind === 'A') renderObserveKeepSheet();
  });

  $sheetBg.addEventListener('click', function () { if (sheetCtx && sheetCtx.kind !== 'edit') closeSheet(); });
  $modalBg.addEventListener('click', function () { closeModal(false); });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (active) {
      tick();
      if (active && active.runStart != null) requestWakeLock();
    }
    if (swReg) swReg.update().catch(function () { /* offline */ });
  });
  window.addEventListener('hashchange', route);
  // 其他分頁修改了資料（同一裝置開兩個視窗）時同步
  window.addEventListener('storage', function (e) {
    if (e.key === KEYS.active) { loadActive(); route(); }
  });

  // ---------------------------------------------------------------- Service Worker / 更新
  var swReg = null;
  var updateReady = false;
  function showUpdateBarIfReady() { if (updateReady && !active) document.getElementById('update-bar').hidden = false; }
  function hideUpdateBar() { document.getElementById('update-bar').hidden = true; }

  document.getElementById('update-btn').addEventListener('click', function () {
    if (active) return toast('觀察進行中，結束後再更新');
    var waiting = swReg && swReg.waiting;
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
    else location.reload();
  });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      // 只有使用者按下「重新整理」才會觸發；觀察中不重新載入
      if (reloading || active) return;
      reloading = true;
      location.reload();
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(function (reg) {
        swReg = reg;
        function markReady() { updateReady = true; showUpdateBarIfReady(); }
        if (reg.waiting && navigator.serviceWorker.controller) markReady();
        reg.addEventListener('updatefound', function () {
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', function () {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) markReady();
          });
        });
        updateSwStatus();
        setInterval(function () { reg.update().catch(function () { /* offline */ }); }, 60 * 60 * 1000);
      }).catch(function () { /* 不支援或被阻擋：一般網頁模式仍可使用 */ });
    });
  }

  // ---------------------------------------------------------------- 啟動
  migrate();
  loadActive();
  if (active) {
    // 重新開啟時若已超過 20 分鐘，以 20:00 時間點結束
    if (active.runStart != null && effAt(Date.now()) >= PLAN_MS) finish('completed');
    else if (location.hash !== '#/observe') location.replace('#/observe');
  }
  route();
})();

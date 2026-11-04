(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('tvr_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('tvr_' + k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ---------- Capacitor bridge ---------- */
  const capx = window.capacitorExports || {};
  const Cap = capx.Capacitor || window.Capacitor;
  const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const reg = name => (capx.registerPlugin ? capx.registerPlugin(name) : (Cap && Cap.Plugins ? Cap.Plugins[name] : null));
  const TvNative = isNative ? reg('SamsungTv') : null;
  const Ble = isNative ? reg('BluetoothLe') : null;

  /* ---------- Helpers ---------- */
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }
  const lines = [];
  function log(m) { lines.unshift(new Date().toLocaleTimeString() + '  ' + m); lines.length = Math.min(lines.length, 60); $('#log').textContent = lines.join('\n'); }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- Settings ---------- */
  const opt = { vib: $('#optVib'), rep: $('#optRep'), auto: $('#optAuto'), name: $('#devName'), demo: $('#optDemo') };
  opt.vib.checked = store.get('vib', true);
  opt.rep.checked = store.get('rep', true);
  opt.auto.checked = store.get('auto', true);
  opt.demo.checked = store.get('demo', false);
  opt.name.value = store.get('name', 'Telefon Kumandasi');
  opt.vib.onchange = () => store.set('vib', opt.vib.checked);
  opt.rep.onchange = () => store.set('rep', opt.rep.checked);
  opt.auto.onchange = () => store.set('auto', opt.auto.checked);
  opt.name.onchange = () => store.set('name', opt.name.value.trim() || 'Telefon Kumandasi');
  opt.demo.onchange = () => { store.set('demo', opt.demo.checked); applyDemo(); };

  function vibrate(ms) { if (opt.vib.checked && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} }

  /* ---------- Tabs & remote mode ---------- */
  function showView(name) {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('sel', x.dataset.view === name));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'v-' + name));
  }
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { showView(t.dataset.view); vibrate(8); }));
  const setMode = m => {
    $('#v-remote').classList.toggle('mode-dpad', m === 'dpad');
    $('#m-dpad').classList.toggle('sel', m === 'dpad');
    $('#m-num').classList.toggle('sel', m !== 'dpad');
    store.set('mode', m);
  };
  $('#m-dpad').addEventListener('click', () => { setMode('dpad'); vibrate(8); });
  $('#m-num').addEventListener('click', () => { setMode('num'); vibrate(8); });
  setMode(store.get('mode', 'num'));

  /* ---------- Connection state ---------- */
  let state = 'off';           // off | wait | on
  let currentIp = '';
  function renderStatus() {
    const demo = opt.demo.checked && state !== 'on';
    const dot = $('#dot');
    dot.className = 'dot' + (state === 'on' ? ' on' : state === 'wait' ? ' wait' : demo ? ' demo' : '');
    $('#stxt').textContent = state === 'on' ? 'Bağlı' : state === 'wait' ? 'Bağlanıyor' : demo ? 'Demo' : 'Kapalı';
    document.body.classList.toggle('is-demo', demo);
    document.querySelectorAll('.dev[data-ip]').forEach(d => {
      const isCur = d.dataset.ip === currentIp && state === 'on';
      d.classList.toggle('connected', isCur);
      const go = d.querySelector('.go'); if (go) go.textContent = isCur ? 'Bağlı ✓' : 'Bağlan';
    });
  }
  function setState(s) { state = s; renderStatus(); }
  function applyDemo() { renderStatus(); }

  /* ---------- Transport: native plugin or browser WebSocket ---------- */
  let ws = null, manualClose = false, retry = 0, waitTimer = null;

  function onTvEvent(e) {
    switch (e.type) {
      case 'open': log('Soket açıldı – TV onayı bekleniyor…'); toast('TV ekranında "İzin Ver"i seç'); break;
      case 'connected':
        clearTimeout(waitTimer); retry = 0; setState('on'); toast('TV\'ye bağlandı'); log('Bağlandı: ' + currentIp);
        if (e.token) { store.set('token_' + currentIp, e.token); log('İzin anahtarı kaydedildi'); }
        store.set('lastIp', currentIp);
        setTimeout(() => showView('remote'), 600);
        break;
      case 'unauthorized': clearTimeout(waitTimer); log('TV izni reddetti'); toast('TV izni reddetti'); break;
      case 'timeout': log('TV onayı zaman aşımına uğradı'); break;
      case 'error': log('Hata: ' + (e.message || 'bağlantı kurulamadı')); break;
      case 'closed': {
        clearTimeout(waitTimer); const was = state; setState('off'); log('Bağlantı kapandı');
        if (!manualClose && was === 'on' && retry < 3) { retry++; setTimeout(() => connect(currentIp, store.get('port_' + currentIp, 8002)), 1500 * retry); }
        else if (was === 'wait' && !manualClose) {
          // Güvenli port başarısızsa eski modeller için 8001 dene
          const p = store.get('port_' + currentIp, 8002);
          if (p === 8002 && retry === 0) { retry = 1; log('8001 portu deneniyor…'); connect(currentIp, 8001, true); }
        }
        break;
      }
    }
  }
  if (TvNative && TvNative.addListener) TvNative.addListener('tvEvent', onTvEvent);

  function b64(s) { try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return btoa('Remote'); } }

  async function connect(ip, port, keepRetry) {
    ip = (ip || '').trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { toast('Geçerli bir IP gir'); return; }
    port = Number(port) || 8002;
    if (!keepRetry) retry = 0;
    await disconnect(true);
    manualClose = false; currentIp = ip;
    store.set('port_' + ip, port);
    setState('wait'); log('Bağlanılıyor: ' + ip + ':' + port);
    clearTimeout(waitTimer);
    waitTimer = setTimeout(() => {
      if (state === 'wait') { log('Zaman aşımı – TV açık mı, aynı ağda mı?'); toast('TV yanıt vermedi'); disconnect(true); }
    }, 35000);
    const token = store.get('token_' + ip, '');
    const name = opt.name.value.trim() || 'Telefon Kumandasi';

    if (TvNative) {
      try { await TvNative.connect({ ip, port, name, token }); }
      catch (e) { onTvEvent({ type: 'error', message: e.message }); setState('off'); }
      return;
    }
    // Browser fallback
    const secure = port === 8002;
    const url = (secure ? 'wss://' : 'ws://') + ip + ':' + port + '/api/v2/channels/samsung.remote.control?name=' + encodeURIComponent(b64(name)) + (token ? '&token=' + token : '');
    try { ws = new WebSocket(url); } catch (e) { onTvEvent({ type: 'error', message: e.message }); setState('off'); return; }
    ws.onopen = () => onTvEvent({ type: 'open' });
    ws.onmessage = ev => {
      let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (d.event === 'ms.channel.connect') onTvEvent({ type: 'connected', token: d.data && d.data.token });
      else if (d.event === 'ms.channel.unauthorized') onTvEvent({ type: 'unauthorized' });
      else if (d.event === 'ms.channel.timeOut') onTvEvent({ type: 'timeout' });
    };
    ws.onerror = () => onTvEvent({ type: 'error', message: 'soket hatası' });
    ws.onclose = () => onTvEvent({ type: 'closed' });
  }

  async function disconnect(silent) {
    manualClose = true; clearTimeout(waitTimer);
    if (TvNative) { try { await TvNative.disconnect(); } catch (e) {} }
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    setState('off'); if (!silent) log('Bağlantı kesildi');
  }

  function sendKey(key) {
    if (state !== 'on') return false;
    if (TvNative) { TvNative.sendKey({ key }).catch(e => log('Gönderilemedi: ' + e.message)); return true; }
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ method: 'ms.remote.control', params: { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' } }));
      return true;
    }
    return false;
  }

  /* ---------- Remote buttons ---------- */
  const label = el => el.getAttribute('aria-label') || el.textContent.trim() || el.dataset.key;
  let warnAt = 0;
  function fire(el) {
    const ok = sendKey(el.dataset.key);
    vibrate(el.dataset.key === 'KEY_POWER' ? 25 : 12);
    if (!ok) {
      const now = Date.now();
      if (now - warnAt > 2500) {
        warnAt = now;
        toast(opt.demo.checked ? 'Demo: ' + label(el) : label(el) + ' · TV bağlı değil – Connect\'ten bağlan');
      }
    }
  }
  document.querySelectorAll('[data-key]').forEach(el => {
    let hold, rep;
    const start = e => {
      e.preventDefault();
      el.classList.add('pressed');
      fire(el);
      if (el.hasAttribute('data-repeat') && opt.rep.checked) hold = setTimeout(() => { rep = setInterval(() => fire(el), 150); }, 450);
    };
    const end = () => { el.classList.remove('pressed'); clearTimeout(hold); clearInterval(rep); };
    el.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => el.addEventListener(t, end));
    el.addEventListener('contextmenu', e => e.preventDefault());
  });
  // Visual feedback for all other buttons
  document.querySelectorAll('.primary,.ghost,.ob-next,.ob-never').forEach(el => {
    el.addEventListener('pointerdown', () => el.classList.add('pressed'));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => el.addEventListener(t, () => el.classList.remove('pressed')));
  });

  /* ---------- Manual connect ---------- */
  const ipEl = $('#ip'), portEl = $('#port');
  ipEl.value = store.get('lastIp', '');
  $('#btnConnect').addEventListener('click', () => connect(ipEl.value, portEl.value));
  $('#btnDisconnect').addEventListener('click', () => disconnect(false));
  $('#btnReset').addEventListener('click', () => {
    try { Object.keys(localStorage).filter(k => k.startsWith('tvr_token_')).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    toast('Kayıtlı izinler silindi');
  });

  /* ---------- Scanning ---------- */
  const TV_ICON = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
  const BT_ICON = '<svg viewBox="0 0 24 24"><path d="M7 7l10 10-5 5V2l5 5L7 17"/></svg>';
  let scanning = false;
  let wifiDevices = [];
  let btDevices = [];

  function info(msg) { const i = $('#scanInfo'); if (msg) { i.innerHTML = msg; i.classList.add('show'); } else i.classList.remove('show'); }

  function renderWifi() {
    const el = $('#wifiList');
    if (!wifiDevices.length) return;
    el.innerHTML = wifiDevices.map(d => `
      <button class="dev" data-ip="${esc(d.ip)}">
        <span class="ic">${TV_ICON}</span>
        <span><div class="nm">${esc(d.name || 'Samsung TV')}</div><div class="meta">${esc(d.model ? d.model + ' · ' : '')}${esc(d.ip)}</div></span>
        <span class="go">Bağlan</span>
      </button>`).join('');
    el.querySelectorAll('.dev').forEach(b => b.addEventListener('click', () => { vibrate(10); connect(b.dataset.ip, 8002); }));
    renderStatus();
  }
  function renderBt() {
    const el = $('#btList');
    if (!btDevices.length) return;
    el.innerHTML = btDevices.map((d, i) => `
      <button class="dev bt" data-i="${i}">
        <span class="ic">${BT_ICON}</span>
        <span><div class="nm">${esc(d.name)}</div><div class="meta">Bluetooth · sinyal ${d.rssi != null ? esc(d.rssi) + ' dBm' : '—'}</div></span>
        <span class="go">Seç</span>
      </button>`).join('');
    el.querySelectorAll('.dev.bt').forEach(b => b.addEventListener('click', () => pickBt(btDevices[+b.dataset.i])));
  }
  function pickBt(d) {
    vibrate(10);
    // Bluetooth ile görülen TV'yi Wi‑Fi listesindeki aynı TV ile eşleştir
    const key = (d.name || '').toLowerCase().replace(/\[tv\]|samsung|\s+/g, '');
    const match = wifiDevices.find(w => key && (w.name || '').toLowerCase().replace(/\[tv\]|samsung|\s+/g, '').includes(key))
      || (wifiDevices.length === 1 ? wifiDevices[0] : null);
    if (match) { toast(d.name + ' → Wi‑Fi ile bağlanılıyor'); connect(match.ip, 8002); }
    else info('<b>' + esc(d.name) + '</b> Bluetooth ile yakında görüldü. Kumanda komutları Wi‑Fi üzerinden gider: TV\'yi telefonla aynı Wi‑Fi ağına bağlayıp tekrar <b>TV Ara</b>\'ya dokun ya da IP ile elle bağlan.');
  }

  async function scanWifi() {
    const st = $('#wifiSt');
    st.innerHTML = '<span class="spin"></span> Aranıyor';
    $('#wifiList').innerHTML = '<div class="empty">Ağdaki cihazlar taranıyor…</div>';
    wifiDevices = [];
    if (!TvNative) {
      st.textContent = 'Desteklenmiyor';
      $('#wifiList').innerHTML = '<div class="empty">Otomatik Wi‑Fi taraması uygulamada (APK) çalışır. Tarayıcıda IP ile elle bağlan.</div>';
      return;
    }
    try {
      const res = await TvNative.discover({ timeout: 3000 });
      wifiDevices = (res && res.devices) || [];
      log('Wi‑Fi taraması: ' + wifiDevices.length + ' TV' + (res && res.subnet ? ' (ağ ' + res.subnet + '.x)' : ''));
      if (wifiDevices.length) { st.textContent = wifiDevices.length + ' TV bulundu'; renderWifi(); }
      else {
        st.textContent = 'TV bulunamadı';
        $('#wifiList').innerHTML = '<div class="empty">Bu Wi‑Fi ağında Samsung TV bulunamadı. TV açık mı ve telefonla aynı ağda mı? Tekrar dene ya da IP ile elle bağlan.</div>';
      }
    } catch (e) {
      st.textContent = 'Hata';
      log('Wi‑Fi tarama hatası: ' + e.message);
      $('#wifiList').innerHTML = '<div class="empty">Tarama yapılamadı: ' + esc(e.message) + '. Wi‑Fi\'ın açık olduğundan emin ol.</div>';
    }
  }

  async function scanBt() {
    const st = $('#btSt');
    btDevices = [];
    if (!Ble) {
      st.textContent = 'Desteklenmiyor';
      $('#btList').innerHTML = '<div class="empty">Bluetooth taraması uygulamada (APK) çalışır.</div>';
      return;
    }
    st.innerHTML = '<span class="spin"></span> Aranıyor';
    $('#btList').innerHTML = '<div class="empty">Yakındaki Bluetooth cihazları taranıyor…</div>';
    let listener = null, seen = new Map(), total = 0;
    try {
      await Ble.initialize({ androidNeverForLocation: true });
      const en = await Ble.isEnabled();
      if (!en || !en.value) {
        try { await Ble.requestEnable(); } catch (e) {}
        const en2 = await Ble.isEnabled();
        if (!en2 || !en2.value) { st.textContent = 'Kapalı'; $('#btList').innerHTML = '<div class="empty">Bluetooth kapalı. Açıp tekrar dene.</div>'; return; }
      }
      listener = await Ble.addListener('onScanResult', r => {
        const id = r.device && r.device.deviceId;
        if (!id) return;
        if (!seen.has(id)) total++;
        const name = (r.localName || (r.device && r.device.name) || '').trim();
        seen.set(id, true);
        if (name && /tv|samsung|tizen/i.test(name) && !btDevices.some(d => d.id === id)) {
          btDevices.push({ id, name, rssi: r.rssi });
          st.textContent = btDevices.length + ' TV bulundu';
          renderBt();
        }
      });
      await Ble.requestLEScan({ allowDuplicates: false });
      await sleep(8000);
      try { await Ble.stopLEScan(); } catch (e) {}
      log('Bluetooth taraması: ' + total + ' cihaz, ' + btDevices.length + ' TV');
      if (!btDevices.length) {
        st.textContent = 'TV bulunamadı';
        $('#btList').innerHTML = '<div class="empty">' + total + ' Bluetooth cihazı tarandı, aralarında TV yok. Birçok TV Bluetooth\'ta görünmez; Wi‑Fi taraması yeterlidir.</div>';
      }
    } catch (e) {
      st.textContent = 'İzin yok';
      log('Bluetooth hatası: ' + e.message);
      $('#btList').innerHTML = '<div class="empty">Bluetooth taraması yapılamadı (' + esc(e.message) + '). Ayarlardan Bluetooth / Yakındaki cihazlar iznini ver.</div>';
    } finally {
      if (listener && listener.remove) try { await listener.remove(); } catch (e) {}
    }
  }

  async function startScan() {
    if (scanning) return;
    scanning = true; info('');
    $('#radar').classList.add('on');
    $('#btnScan').textContent = 'Aranıyor…';
    $('#scanTitle').textContent = 'TV aranıyor';
    $('#scanSub').textContent = 'Wi‑Fi ve Bluetooth taranıyor…';
    vibrate(10);
    await Promise.allSettled([scanWifi(), scanBt()]);
    scanning = false;
    $('#radar').classList.remove('on');
    $('#btnScan').textContent = 'Tekrar Ara';
    const n = wifiDevices.length;
    $('#scanTitle').textContent = n ? n + ' TV bulundu' : 'TV bulunamadı';
    $('#scanSub').textContent = n ? 'Bağlanmak için TV\'ne dokun' : 'TV açık ve aynı Wi‑Fi ağında olmalı';
    if (n === 1 && state !== 'on') { toast(wifiDevices[0].name + ' bulundu'); }
  }
  $('#btnScan').addEventListener('click', startScan);

  /* ---------- Onboarding ---------- */
  const ob = $('#ob'), slides = [...document.querySelectorAll('.ob-slide')], dots = [...document.querySelectorAll('#obDots i')];
  let obIdx = 0;
  function obGo(i) {
    obIdx = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach(s => s.style.transform = 'translateX(' + (-100 * obIdx) + '%)');
    dots.forEach((d, k) => d.classList.toggle('on', k === obIdx));
    $('#obNext').textContent = obIdx === slides.length - 1 ? 'Başla' : 'İleri';
  }
  function obOpen() { obGo(0); ob.classList.add('show'); }
  function obClose(goScan) {
    ob.classList.remove('show');
    if (goScan && state !== 'on') { showView('connect'); }
  }
  $('#obNext').addEventListener('click', () => { vibrate(8); if (obIdx < slides.length - 1) obGo(obIdx + 1); else obClose(true); });
  $('#obSkip').addEventListener('click', () => obClose(true));
  $('#obNever').addEventListener('click', () => { store.set('hideGuide', true); vibrate(10); obClose(true); toast('Kılavuz bir daha gösterilmeyecek'); });
  $('#btnGuide').addEventListener('click', () => { store.set('hideGuide', false); obOpen(); });
  // swipe
  let sx = null;
  $('#obTrack').addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  $('#obTrack').addEventListener('touchend', e => {
    if (sx === null) return; const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 50) obGo(obIdx + (dx < 0 ? 1 : -1));
  });

  // Prevent double-tap zoom
  let lastTouch = 0;
  document.addEventListener('touchend', e => { const n = Date.now(); if (n - lastTouch < 300 && e.target.closest('button')) e.preventDefault(); lastTouch = n; }, { passive: false });

  /* ---------- Startup ---------- */
  renderStatus();
  if (!store.get('hideGuide', false)) obOpen();
  const last = store.get('lastIp', '');
  if (opt.auto.checked && last) connect(last, store.get('port_' + last, 8002));
  log(isNative ? 'Uygulama hazır' : 'Tarayıcı modu (tarama yalnızca APK\'da)');
})();

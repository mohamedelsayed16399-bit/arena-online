/* ساحة الأبطال — منطق التطبيق: الدخول، الغرف، اللوبي، الأصدقاء، المتصدرين */
(function () {
  'use strict';

  const AVATARS = ['🦊', '🦁', '🐺', '🐯', '🦅', '🐉', '🤖', '👽', '💀', '🥷', '🧙', '🦖'];
  const MAX_PLAYERS = 6;
  const ROUND_SECONDS = 180;
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  const $ = (id) => document.getElementById(id);
  const screens = ['missions', 'shop', 'loading', 'profile', 'home', 'lobby', 'game', 'results', 'leaderboard', 'friends', 'how', 'rooms', 'stats'];

  let db = null, auth = null, uid = null;
  let profile = null;       // {name, avatar}
  let roomCode = null, roomListeners = [];
  let isHost = false, roomSeed = 1;
  let myColor = 0, myJoinedAt = 0;
  let chatLastKey = null;

  function show(name) {
    screens.forEach(s => $('screen-' + s).classList.toggle('active', s === name));
  }
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), ms || 2500);
  }

  // ============ البداية ============
  window.addEventListener('load', init);

  function init() {
    if (typeof firebase === 'undefined' || !window.FIREBASE_CONFIG) {
      $('screen-loading').querySelector('.loading-text').textContent = 'مشكلة في إعدادات الاتصال';
      return;
    }
    firebase.initializeApp(window.FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.database();

    auth.signInAnonymously().catch((e) => {
      $('screen-loading').querySelector('.loading-text').textContent = 'فشل الاتصال: ' + (e.code || e.message);
    });

    auth.onAuthStateChanged((user) => {
      if (!user) return;
      uid = user.uid;
      setupPresence();
      profile = loadProfile();
      if (profile) enterHome();
      else { buildAvatarPicker(); show('profile'); }
    });

    bindUi();
  }

  function loadProfile() {
    try {
      const p = JSON.parse(localStorage.getItem('arena_profile'));
      if (p && p.name) return p;
    } catch (e) { }
    return null;
  }
  function saveProfile() {
    localStorage.setItem('arena_profile', JSON.stringify(profile));
  }

  function setupPresence() {
    const pRef = db.ref('presence/' + uid);
    db.ref('.info/connected').on('value', (s) => {
      if (s.val() === true) {
        pRef.onDisconnect().set({ online: false, ts: firebase.database.ServerValue.TIMESTAMP });
        pRef.set({ online: true, ts: firebase.database.ServerValue.TIMESTAMP });
      }
    });
  }

  function friendCode() {
    return uid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
  }

  // ============ واجهة ============
  function bindUi() {
    // الملف الشخصي
    $('btn-save-profile').onclick = () => {
      const name = $('input-name').value.trim();
      if (!name) { toast('اكتب اسمك الأول'); return; }
      profile = { name, avatar: document.querySelector('.avatar-option.selected')?.dataset.a || AVATARS[0] };
      saveProfile();
      registerUser();
      enterHome();
    };
    $('input-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-save-profile').click(); });

    // الرئيسية
    $('btn-quick').onclick = () => quickPlay();
    $('btn-create').onclick = () => createRoom();
    $('btn-join').onclick = () => {
      const code = $('input-room-code').value.trim().toUpperCase();
      if (code.length !== 4) { toast('الكود ٤ حروف'); return; }
      joinRoom(code);
    };
    $('input-room-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
    $('btn-leaderboard').onclick = () => { showLeaderboard('wins'); };
    $('btn-rooms').onclick = showRooms;
    $('btn-stats').onclick = showStats;
    window.ARENA_SKINS = { gold: '#ffd32a', green: '#2ed573', purple: '#a55eea', fire: '#ff6b35', rainbow: 'rainbow' };
    const SKIN_LIST = [['gold', '🟡 ذهبي', 0], ['green', '🟢 أخضر', 30], ['purple', '🟣 بنفسجي', 60], ['fire', '🔥 ناري', 100], ['rainbow', '🌈 قوس قزح', 200]];
    const coinsNow = () => { try { return +localStorage.getItem('arena_coins') || 0; } catch (e) { return 0; } };
    const ownedSkins = () => { try { return JSON.parse(localStorage.getItem('arena_skins') || '["gold"]'); } catch (e) { return ['gold']; } };
    function updShopBtn() { $('btn-shop').textContent = '🛍️ المتجر (🪙 ' + coinsNow() + ')'; }
    function renderShop() {
      const own = ownedSkins(); const cur = localStorage.getItem('arena_skin') || 'gold';
      $('shop-coins').textContent = '🪙 ' + coinsNow();
      $('shop-list').innerHTML = '';
      SKIN_LIST.forEach(([k, label, price]) => {
        const row = document.createElement('div'); row.className = 'shop-row';
        const col = window.ARENA_SKINS[k] === 'rainbow' ? 'linear-gradient(90deg,red,orange,yellow,green,cyan,blue,violet)' : window.ARENA_SKINS[k];
        row.innerHTML = '<span class="shop-dot" style="background:' + col + '"></span><b>' + label + '</b>';
        const bt = document.createElement('button'); bt.className = 'btn btn-ghost shop-btn';
        if (own.indexOf(k) >= 0) { bt.textContent = cur === k ? '✅ مستخدم' : 'استخدم'; bt.onclick = () => { localStorage.setItem('arena_skin', k); renderShop(); }; }
        else { bt.textContent = '🪙 ' + price; bt.onclick = () => { if (coinsNow() < price) { toast('عملاتك مش كفاية'); return; } localStorage.setItem('arena_coins', String(coinsNow() - price)); own.push(k); localStorage.setItem('arena_skins', JSON.stringify(own)); localStorage.setItem('arena_skin', k); updShopBtn(); renderShop(); toast('اشتريت ' + label); }; }
        row.appendChild(bt); $('shop-list').appendChild(row);
      });
    }
    const MPOOL = [
      { id: 'kill', t: '☠️ اقتل {n} عدو', g: 20, r: 50 }, { id: 'wave', t: '🌊 وصّل للموجة {n}', g: 6, r: 70, max: true },
      { id: 'gem', t: '💎 اجمع {n} جوهرة (وضع الجواهر)', g: 12, r: 60 }, { id: 'ult', t: '⚡ استخدم القدرة الخاصة {n} مرات', g: 2, r: 40 },
      { id: 'dash', t: '💨 اعمل {n} داش', g: 10, r: 30 }, { id: 'gren', t: '💣 ارمي {n} قنابل', g: 5, r: 40 }, { id: 'pickup', t: '🎁 التقط {n} قدرات', g: 6, r: 30 }
    ];
    const todayKey = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
    function loadMissions() {
      let m = null; try { m = JSON.parse(localStorage.getItem('arena_missions')); } catch (e) { m = null; }
      if (!m || m.date !== todayKey()) {
        let hs = 0; const k = todayKey(); for (let i = 0; i < k.length; i++) hs = (hs * 31 + k.charCodeAt(i)) >>> 0;
        const pool = MPOOL.slice(); const list = [];
        for (let i = 0; i < 3; i++) { const j = hs % pool.length; hs = (hs * 1103515245 + 12345) >>> 0; list.push({ id: pool[j].id, prog: 0, claimed: false }); pool.splice(j, 1); }
        m = { date: k, list }; localStorage.setItem('arena_missions', JSON.stringify(m));
      }
      return m;
    }
    function trackMission(type, val) {
      try {
        const m = loadMissions(); let ch = false;
        m.list.forEach((x) => { if (x.id !== type) return; const def = MPOOL.find((q) => q.id === x.id); if (def.max) { if (val > x.prog) { x.prog = val; ch = true; } } else if (x.prog < def.g) { x.prog++; ch = true; } });
        if (ch) localStorage.setItem('arena_missions', JSON.stringify(m));
      } catch (e) { /* ignore */ }
    }
    const wrapAch = () => { if (!window.ArenaAch || window.ArenaAch._w) return !!(window.ArenaAch && window.ArenaAch._w); const _hit = window.ArenaAch.hit.bind(window.ArenaAch); window.ArenaAch.hit = (type, val) => { _hit(type, val); trackMission(type, val); }; window.ArenaAch._w = true; return true; };
    if (!wrapAch()) { const iv = setInterval(() => { if (wrapAch()) clearInterval(iv); }, 300); }
    function renderMissions() {
      const m = loadMissions(); const box = $('missions-list'); box.innerHTML = '';
      m.list.forEach((x, i) => {
        const def = MPOOL.find((q) => q.id === x.id); const done = x.prog >= def.g;
        const row = document.createElement('div'); row.className = 'shop-row mission-row';
        row.innerHTML = '<div style="flex:1"><b>' + def.t.replace('{n}', def.g) + '</b><div class="m-bar"><i style="width:' + Math.min(100, 100 * x.prog / def.g) + '%"></i></div><small dir="ltr">' + Math.min(x.prog, def.g) + ' / ' + def.g + '</small></div>';
        const bt = document.createElement('button'); bt.className = 'btn btn-ghost shop-btn';
        if (x.claimed) { bt.textContent = '✅ اتسلّمت'; bt.disabled = true; }
        else if (done) { bt.textContent = '🎁 استلم 🪙' + def.r; bt.onclick = () => { x.claimed = true; localStorage.setItem('arena_missions', JSON.stringify(m)); localStorage.setItem('arena_coins', String(coinsNow() + def.r)); toast('+' + def.r + ' عملة'); updShopBtn(); renderMissions(); }; }
        else { bt.textContent = '🪙 ' + def.r; bt.disabled = true; }
        row.appendChild(bt); box.appendChild(row);
      });
    }
    $('btn-bossrush').onclick = () => {
      window.ARENA_BR = true; createRoom();
      let tries = 0; const iv = setInterval(() => { tries++; const b = $('btn-start'); if (b && b.offsetParent) { clearInterval(iv); setTimeout(() => b.click(), 600); } else if (tries > 40) { clearInterval(iv); window.ARENA_BR = false; } }, 300);
    };
    $('btn-missions').onclick = () => { renderMissions(); show('missions'); };
    $('btn-back-from-missions').onclick = () => show('home');
    $('btn-shop').onclick = () => { renderShop(); show('shop'); };
    $('btn-back-from-shop').onclick = () => { updShopBtn(); show('home'); };
    updShopBtn(); setInterval(updShopBtn, 4000);
    $('btn-gren').onclick = () => { if (window.ArenaGame && ArenaGame.running) ArenaGame.throwGrenade(); };
    $('btn-ult').onclick = () => { if (window.ArenaGame && ArenaGame.running) ArenaGame.ultimate(); };
    $('btn-dash').onclick = () => { if (window.ArenaGame && ArenaGame.running) ArenaGame.dash(); };
    const diffNames = { easy: 'سهل', normal: 'عادي', hard: 'صعب' };
    const diffOrder = ['easy', 'normal', 'hard'];
    const curDiff = () => { try { return localStorage.getItem('arena_bot_diff') || 'normal'; } catch (e) { return 'normal'; } };
    const paintDiff = () => { $('btn-botdiff').textContent = '🤖 صعوبة البوتات: ' + diffNames[curDiff()]; };
    $('btn-botdiff').onclick = () => {
      const n = diffOrder[(diffOrder.indexOf(curDiff()) + 1) % 3];
      try { localStorage.setItem('arena_bot_diff', n); } catch (e) { /* ignore */ }
      paintDiff(); toast('صعوبة البوتات: ' + diffNames[n]);
    };
    paintDiff();
    $('btn-back-from-stats').onclick = () => show('home');
    $('btn-rooms-refresh').onclick = showRooms;
    $('btn-back-from-rooms').onclick = () => show('home');
    $('btn-friends').onclick = () => { showFriends(); };
    $('btn-how').onclick = () => show('how');
    $('btn-sound').onclick = toggleSound;
    $('btn-copy-code').onclick = () => copyText(friendCode(), 'اتنسخ كودك');
    $('btn-copy-room').onclick = () => copyText(roomCode, 'اتنسخ كود الغرفة');

    // اللوبي
    $('btn-leave-lobby').onclick = () => leaveRoom();
    $('btn-ready').onclick = toggleReady;
    $('btn-start').onclick = () => hostStartRound('classic');
    $('btn-start-blitz').onclick = () => hostStartRound('blitz');
    $('btn-start-zone').onclick = () => hostStartRound('zone');
    $('btn-start-team').onclick = () => hostStartRound('team');
    $('btn-start-coop').onclick = () => hostStartRound('coop');
    $('btn-start-flag').onclick = () => hostStartRound('flag');
    $('btn-start-gems').onclick = () => hostStartRound('gems');
    $('btn-start-storm').onclick = () => hostStartRound('storm');
    $('btn-send-chat').onclick = sendChat;
    $('input-chat').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

    // اللعبة
    $('btn-leave-game').onclick = () => { endGameToLobby(true); };
    document.querySelectorAll('.emote').forEach((b) => {
      b.onclick = () => { if (window.ArenaGame && ArenaGame.running) ArenaGame.sendEmote(b.textContent); };
    });

    // النتائج
    $('btn-back-lobby').onclick = () => backToLobby();
    $('btn-rematch').onclick = () => { backToLobby(); if (isHost) setTimeout(() => hostStartRound(window._lastMode || 'classic'), 2500); };
    $('btn-back-home').onclick = () => { leaveRoom(); };

    // رجوع
    $('btn-back-from-lb').onclick = () => show('home');
    $('btn-back-from-fr').onclick = () => show('home');
    $('btn-back-from-how').onclick = () => show('home');

    // تبويبات المتصدرين
    $('tab-wins').onclick = () => showLeaderboard('wins');
    $('tab-kills').onclick = () => showLeaderboard('kills');
    $('tab-points').onclick = () => showLeaderboard('points');
    $('tab-wave').onclick = () => showLeaderboard('bestWave');
    $('tab-rush').onclick = () => showLeaderboard('bestRush');

    // أصدقاء
    $('btn-add-friend').onclick = addFriend;

    updateSoundBtn();
  }

  function buildAvatarPicker() {
    const box = $('avatar-picker');
    box.innerHTML = '';
    AVATARS.forEach((a, i) => {
      const d = document.createElement('div');
      d.className = 'avatar-option' + (i === 0 ? ' selected' : '');
      d.dataset.a = a;
      d.textContent = a;
      d.onclick = () => {
        box.querySelectorAll('.avatar-option').forEach(x => x.classList.remove('selected'));
        d.classList.add('selected');
      };
      box.appendChild(d);
    });
  }

  function toggleSound() {
    const cur = localStorage.getItem('arena_sound') !== 'off';
    localStorage.setItem('arena_sound', cur ? 'off' : 'on');
    updateSoundBtn();
    toast(cur ? 'الصوت اتقفل 🔇' : 'الصوت اتفتح 🔊');
  }
  function updateSoundBtn() {
    $('btn-sound').textContent = localStorage.getItem('arena_sound') !== 'off' ? '🔊 الصوت' : '🔇 الصوت';
  }

  function copyText(txt, msg) {
    const done = () => toast(msg + ' ✅');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(() => fallbackCopy(txt, done));
    } else fallbackCopy(txt, done);
  }
  function fallbackCopy(txt, done) {
    const ta = document.createElement('textarea');
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('الكود: ' + txt); }
    document.body.removeChild(ta);
  }

  function registerUser() {
    db.ref('users/' + uid).set({
      name: profile.name, avatar: profile.avatar, code: friendCode(),
      lastOnline: firebase.database.ServerValue.TIMESTAMP,
    }).catch(() => {});
    db.ref('codes/' + friendCode()).set(uid).catch(() => {});
  }

  function enterHome() {
    registerUser();
    $('me-avatar').textContent = profile.avatar;
    $('me-name').textContent = profile.name;
    $('me-code').textContent = friendCode();
    $('me-code-2').textContent = friendCode();
    show('home');
    // عداد المتصلين (مباشر)
    if (!onlineWired) {
      onlineWired = true;
      db.ref('presence').orderByChild('online').equalTo(true).limitToLast(200).on('value', (s) => {
        $('online-count').textContent = '🟢 ' + s.numChildren() + ' لاعب متصل دلوقتي';
      }, () => { $('online-count').textContent = ''; });
    }
  }
  let onlineWired = false;

  // ============ الغرف ============
  function makeCode() {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return c;
  }

  function quickPlay() {
    toast('بدور على غرفة… ⚡', 1500);
    (async () => {
      for (let i = 1; i <= 6; i++) {
        const code = 'PUB' + i;
        const snap = await db.ref('rooms/' + code + '/meta').once('value');
        const meta = snap.val();
        if (!meta) { await createRoomWithCode(code); return; }
        const players = (await db.ref('rooms/' + code + '/players').once('value')).numChildren();
        if (players >= MAX_PLAYERS) continue;
        if (meta.state === 'lobby' || meta.state === 'ended') { joinRoom(code); return; }
        if (meta.state === 'playing') {
          const st = (await db.ref('rooms/' + code + '/state').once('value')).val() || {};
          if (st.endsAt && Date.now() < st.endsAt) { joinRoom(code); return; } // دخول متأخر
          if (!st.endsAt || Date.now() > st.endsAt + 90000) { // غرفة عالقة — نظّفها وادخل
            await db.ref('rooms/' + code + '/meta').update({ state: 'lobby' }).catch(() => {});
            joinRoom(code); return;
          }
        }
      }
      toast('كل الغرف مليانة — اعمل غرفة خاصة');
    })().catch(() => toast('حصل خطأ، جرب تاني'));
  }

  function createRoom() { createRoomWithCode(makeCode()); }

  async function createRoomWithCode(code) {
    try {
      roomCode = code;
      roomSeed = Math.floor(Math.random() * 1e9);
      await db.ref('rooms/' + code + '/meta').set({
        host: uid, state: 'lobby', seed: roomSeed,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
      });
      await enterRoom(code);
      toast('اتعملت الغرفة — ابعت الكود لصحابك 🎉');
    } catch (e) { toast('معرفتش أعمل الغرفة'); }
  }

  async function joinRoom(code) {
    try {
      const meta = (await db.ref('rooms/' + code + '/meta').once('value')).val();
      if (!meta) { toast('مفيش غرفة بالكود ده'); return; }
      if (meta.state === 'playing') {
        const st = (await db.ref('rooms/' + code + '/state').once('value')).val() || {};
        if (st.endsAt && Date.now() < st.endsAt) {
          toast('المعركة شغالة — داخل وسط الجولة! ⚔️');
        } else if (!st.endsAt || Date.now() > st.endsAt + 90000) {
          await db.ref('rooms/' + code + '/meta').update({ state: 'lobby' }).catch(() => {});
        } else { toast('الجولة بتخلص حالًا — ثانية واحدة'); return; }
      }
      const players = (await db.ref('rooms/' + code + '/players').once('value')).numChildren();
      if (players >= MAX_PLAYERS) { toast('الغرفة مليانة (' + MAX_PLAYERS + ' لاعيبة)'); return; }
      roomCode = code;
      await enterRoom(code);
    } catch (e) { toast('حصل خطأ في الدخول'); }
  }

  async function enterRoom(code) {
    // لون لكل لاعب حسب ترتيب الدخول
    const snap = await db.ref('rooms/' + code + '/players').once('value');
    myColor = snap.numChildren() % ARENA.PALETTE.length;
    const pRef = db.ref('rooms/' + code + '/players/' + uid);
    await pRef.set({
      name: profile.name, avatar: profile.avatar, color: myColor,
      ready: false, kills: 0, deaths: 0, hp: ARENA.MAX_HP, alive: true,
      x: ARENA.WORLD / 2, y: ARENA.WORLD / 2, angle: 0,
      joinedAt: firebase.database.ServerValue.TIMESTAMP,
    });
    pRef.onDisconnect().remove();
    db.ref('.info/connected').on('value', (cs) => {
      if (cs.val() === true && roomCode === code) {
        pRef.onDisconnect().remove();
        pRef.child('name').once('value').then((ns) => { if (ns.val() === null) pRef.update({ name: profile.name, avatar: profile.avatar, color: myColor }); }).catch(() => {});
      }
    });
    openLobby(code);
  }

  function leaveRoom() {
    detachRoom();
    if (roomCode) {
      const pRef = db.ref('rooms/' + roomCode + '/players/' + uid);
      pRef.onDisconnect().cancel();
      pRef.remove().catch(() => {});
    }
    roomCode = null;
    show('home');
  }

  function detachRoom() {
    roomListeners.forEach(({ ref, ev, fn }) => ref.off(ev, fn));
    roomListeners = [];
  }
  function listen(ref, ev, fn) {
    ref.on(ev, fn);
    roomListeners.push({ ref, ev, fn });
  }

  // ============ اللوبي ============
  function openLobby(code) {
    $('lobby-code').textContent = code;
    $('chat-messages').innerHTML = '';
    chatLastKey = null;
    show('lobby');

    const metaRef = db.ref('rooms/' + code + '/meta');
    listen(metaRef, 'value', (s) => {
      const meta = s.val();
      if (!meta) { toast('الغرفة اتقفلت'); leaveRoom(); return; }
      roomSeed = meta.seed || 1;
      if (meta.state === 'playing') {
        db.ref('rooms/' + code + '/state').once('value', (st) => {
          const state = st.val() || {};
          startGame(state.endsAt || (Date.now() + ROUND_SECONDS * 1000), state.mode || 'classic');
        });
      } else if (meta.state === 'ended') {
        showResults();
      } else if ($('screen-game').classList.contains('active') || $('screen-results').classList.contains('active')) {
        show('lobby');
      }
    });

    const playersRef = db.ref('rooms/' + code + '/players');
    listen(playersRef, 'value', (s) => renderLobbyPlayers(s.val() || {}));

    // الشات
    const chatRef = db.ref('rooms/' + code + '/chat');
    chatRef.limitToLast(1).once('value', (snap) => {
      snap.forEach((c) => { chatLastKey = c.key; });
      listen(chatRef, 'child_added', (s) => {
        if (chatLastKey && s.key <= chatLastKey) return;
        addChatMsg(s.val());
      });
    });
  }

  function renderLobbyPlayers(players) {
    const box = $('lobby-players');
    box.innerHTML = '';
    const arr = Object.entries(players).map(([u, p]) => ({ u, ...p }));
    arr.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    if (arr.length) isHost = arr[0].u === uid;
    let meReady = false;
    arr.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'lobby-player' + (p.u === uid ? ' me' : '');
      const hostTag = i === 0 ? ' <span class="p-host">👑 الهوست</span>' : '';
      row.innerHTML = `<span class="p-avatar">${p.avatar || '🦊'}</span>
        <span class="p-name">${esc(p.name)}${hostTag}</span>
        <span class="p-status ${p.ready ? 'ready' : 'notready'}">${p.ready ? '✅ جاهز' : 'مستني…'}</span>`;
      box.appendChild(row);
      if (p.u === uid) { meReady = !!p.ready; myJoinedAt = p.joinedAt || 0; }
    });
    $('btn-ready').textContent = meReady ? '⏳ مستني الباقي' : '✋ جاهز';
    $('btn-start').classList.toggle('hidden', !isHost);
    $('btn-start-blitz').classList.toggle('hidden', !isHost);
    $('btn-start-zone').classList.toggle('hidden', !isHost);
    $('btn-start-team').classList.toggle('hidden', !isHost);
    $('btn-start-coop').classList.toggle('hidden', !isHost);
    $('btn-start-flag').classList.toggle('hidden', !isHost);
    $('btn-start-gems').classList.toggle('hidden', !isHost);
    $('btn-start-storm').classList.toggle('hidden', !isHost);
    $('lobby-hint').textContent = isHost
      ? 'انت الهوست — لما الكل يجهز اضغط ابدأ (أو ابدأ لوحدك)'
      : 'شارك الكود مع صحابك عشان ينضموا';
  }

  function toggleReady() {
    if (!roomCode) return;
    const ref = db.ref('rooms/' + roomCode + '/players/' + uid + '/ready');
    ref.once('value', (s) => ref.set(!s.val()));
  }

  // نظام الخبرة والمستويات (محلي)
  const XP_NEED = (l) => 80 + 40 * l; // خبرة المستوى الجاي
  function xpInfo() {
    let xp = 0; try { xp = +localStorage.getItem('arena_xp') || 0; } catch (e) {}
    let lvl = 1, rem = xp;
    while (rem >= XP_NEED(lvl)) { rem -= XP_NEED(lvl); lvl++; }
    return { xp, lvl, rem, need: XP_NEED(lvl) };
  }
  const LVL_TITLES = ['مبتدئ', 'مقاتل', 'محارب', 'قناص', 'قائد', 'بطل', 'أسطورة'];
  const lvlTitle = (l) => LVL_TITLES[Math.min(LVL_TITLES.length - 1, Math.floor((l - 1) / 3))];
  function renderLevel() {
    const el = $('me-lvl'); if (!el) return;
    const i = xpInfo();
    el.innerHTML = '⭐ مستوى <b>' + i.lvl + '</b> — ' + lvlTitle(i.lvl) + ' <small>(' + i.rem + '/' + i.need + ')</small><div class="lvl-bar"><i style="width:' + Math.round(100 * i.rem / i.need) + '%"></i></div>';
  }
  function awardXp(gain) {
    const before = xpInfo();
    try { localStorage.setItem('arena_xp', String(before.xp + gain)); } catch (e) {}
    const after = xpInfo();
    let coins = 0;
    for (let l = before.lvl; l < after.lvl; l++) coins += 20 * l;
    if (coins) { try { localStorage.setItem('arena_coins', String((+localStorage.getItem('arena_coins') || 0) + coins)); } catch (e) {} }
    renderLevel();
    return { before, after, coins };
  }
  setTimeout(renderLevel, 300);

  function hostStartRound(mode) {
    window._lastMode = mode;
    if (!isHost || !roomCode) return;
    const secs = mode === 'blitz' ? 60 : mode === 'zone' ? 90 : mode === 'team' ? 90 : mode === 'flag' ? 90 : mode === 'gems' ? 90 : mode === 'storm' ? 90 : ROUND_SECONDS;
    const endsAt = Date.now() + secs * 1000 + 4000; // +٤ ثواني هامش سيرفر
    db.ref('rooms/' + roomCode + '/state').set({
      endsAt,
      mode: mode || 'classic',
      startedBy: uid,
      ts: firebase.database.ServerValue.TIMESTAMP,
    }).then(() => db.ref('rooms/' + roomCode + '/meta').update({ state: 'playing' }))
      .catch(() => toast('حصل خطأ في البدء'));
  }

  function sendChat() {
    const inp = $('input-chat');
    const text = inp.value.trim();
    if (!text || !roomCode) return;
    inp.value = '';
    db.ref('rooms/' + roomCode + '/chat').push({
      uid, name: profile.name, text,
      ts: firebase.database.ServerValue.TIMESTAMP,
    }).catch(() => {});
  }

  function addChatMsg(m) {
    if (!m) return;
    const box = $('chat-messages');
    const d = document.createElement('div');
    d.className = 'chat-msg';
    d.innerHTML = `<b>${esc(m.name || 'لاعب')}:</b> ${esc(m.text || '')}`;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    while (box.children.length > 60) box.removeChild(box.firstChild);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ============ اللعب ============
  function maybeTutorial() {
    let done = false; try { done = localStorage.getItem('arena_tut') === '1'; } catch (e) {}
    const box = $('tutorial'); if (done || !box) return;
    const touch = 'ontouchstart' in window;
    $('tut-list').innerHTML = (touch
      ? ['🕹️ العصا الشمال: حرّك لاعبك', '🎯 العصا اليمين: صوّب وبتضرب لوحدها', '💨 زر الداش للهروب، 💣 للقنبلة، ⚡ للقدرة الخاصة']
      : ['⌨️ WASD أو الأسهم: حركة', '🖱️ الماوس: صوّب، كليك: اضرب', 'Space: داش 💨 | G: قنبلة 💣 | Q: القدرة الخاصة ⚡']
    ).concat(['🎁 اجمع العلب: صحة، درع، أسلحة', '🌊 لو لوحدك: موجات بوتات وزعيم كل ٥ موجات وترقيات بينهم']).map((t) => '<li>' + t + '</li>').join('');
    box.classList.remove('hidden');
    const close = () => { box.classList.add('hidden'); try { localStorage.setItem('arena_tut', '1'); } catch (e) {} };
    $('btn-tut-ok').onclick = close;
    setTimeout(close, 25000);
  }

  function startGame(endsAt, mode) {
    if ($('screen-game').classList.contains('active') && window.ArenaGame.running) return;
    show('game');
    $('hud-mode').textContent = mode === 'flag' ? '🚩 العلم' : mode === 'coop' ? '🤝 تعاون' : mode === 'team' ? '🔴🔵 فريق ضد فريق' : mode === 'blitz' ? '⚡ بليتز' : mode === 'zone' ? '🎯 السيطرة' : mode === 'gems' ? '💎 صيد الجواهر' : mode === 'storm' ? '🌪️ العاصفة' : '';
    maybeTutorial();
    ArenaGame.start({
      db, roomCode,
      me: { uid, name: profile.name, avatar: profile.avatar, color: myColor, joinedAt: myJoinedAt },
      host: isHost,
      seed: roomSeed,
      endsAt, mode,
      onFeed: addKillFeed,
    });
  }

  function addKillFeed(text) {
    const feed = $('kill-feed');
    const d = document.createElement('div');
    d.className = 'kill-feed-item';
    d.textContent = text;
    feed.appendChild(d);
    while (feed.children.length > 4) feed.removeChild(feed.firstChild);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 6000);
  }

  function showResults() {
    const wasPlaying = $('screen-game').classList.contains('active') || ArenaGame.running;
    const rows = ArenaGame.running ? ArenaGame.collectResults() : lastResults || [];
    if (ArenaGame.running) { lastResults = rows; }
    if (ArenaGame.running) ArenaGame.stop();
    if (!rows.length) { show('lobby'); return; }

    // سجّل في المتصدرين (مرة واحدة لكل جولة، وبس لو كان فيه لاعبين فعلًا)
    if (wasPlaying && rows.length >= 2) {
      const winner = rows[0];
      if (winner.uid === uid) {
        db.ref('leaderboard/' + uid).transaction((cur) => {
          cur = cur || { name: profile.name, avatar: profile.avatar, kills: 0, wins: 0 };
          cur.name = profile.name; cur.avatar = profile.avatar;
          cur.wins = (cur.wins || 0) + 1;
          return cur;
        }).catch(() => {});
        ArenaSfx.win();
      }
      const myRow = rows.find(r => r.uid === uid);
      if (myRow && myRow.kills > 0) {
        db.ref('leaderboard/' + uid).transaction((cur) => {
          cur = cur || { name: profile.name, avatar: profile.avatar, kills: 0, wins: 0, deaths: 0 };
          cur.name = profile.name; cur.avatar = profile.avatar;
          cur.kills = (cur.kills || 0) + myRow.kills;
          return cur;
        }).catch(() => {});
      }
      if (myRow && myRow.deaths > 0) {
        db.ref('leaderboard/' + uid).transaction((cur) => {
          cur = cur || { name: profile.name, avatar: profile.avatar, kills: 0, wins: 0, deaths: 0 };
          cur.name = profile.name; cur.avatar = profile.avatar;
          cur.deaths = (cur.deaths || 0) + myRow.deaths;
          return cur;
        }).catch(() => {});
      }
    }

    if (wasPlaying && rows.length > 1 && rows[0].uid === uid && roomCode) {
      db.ref('rooms/' + roomCode + '/chat').push({ uid, name: '🏆', text: profile.name + ' كسب المعركة بـ ' + rows[0].kills + ' قتلة!', ts: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
    }
    if (wasPlaying && rows[0].uid === uid) window.ArenaAch.hit('win');
    let teamLine = '';
    if (ArenaGame.mode === 'team') { const tk = [0, 0]; rows.forEach((r) => { const t = ArenaGame.teamOf(r.uid); if (t >= 0) tk[t] += r.kills; }); teamLine = '🔴 ' + tk[0] + ' × ' + tk[1] + ' 🔵'; window._teamWin = tk[0] === tk[1] ? 'تعادل' : (tk[0] > tk[1] ? '🔴 الفريق الأحمر' : '🔵 الفريق الأزرق'); }
    $('results-title').textContent = rows[0].uid === uid ? '🏆 كسبت المعركة!' : `🏆 الفائز: ${rows[0].name}`;
    if (ArenaGame.mode === 'team') $('results-title').textContent = '🏆 ' + window._teamWin + ' | ' + teamLine;
    if (ArenaGame.mode === 'coop') { const tkk = rows.reduce((a, r) => a + (r.kills || 0), 0); $('results-title').textContent = '🤝 الفريق كله: ' + tkk + ' قتلة | موجتك ' + (ArenaGame.wave || 1); }
    const list = $('results-list');
    list.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    rows.forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'result-row' + (i === 0 ? ' winner' : '');
      d.innerHTML = `<span class="r-rank">${medals[i] || (i + 1)}</span>
        <span>${r.avatar || '🦊'}</span>
        <span class="r-name">${ArenaGame.mode === 'team' ? (ArenaGame.teamOf(r.uid) === 0 ? '🔴 ' : ArenaGame.teamOf(r.uid) === 1 ? '🔵 ' : '') : ''}${esc(r.name)}${r.uid === uid ? ' (انت)' : ''}</span>
        <span class="r-score">${ArenaGame.mode === 'flag' ? '🚩 ' + (r.zpts || 0) + ' | ' : ''}${ArenaGame.mode === 'gems' ? '💎 ' + (r.zpts || 0) + ' | ' : ''}${ArenaGame.mode === 'zone' ? '🎯 ' + (r.zpts || 0) + ' | ' : ''}☠️ ${r.kills} | 💀 ${r.deaths}</span>`;
      list.appendChild(d);
    });
    (function () {
      let xpHtml = '';
      if (wasPlaying) {
        const meR = rows.find((r) => r.uid === uid) || { kills: 0, deaths: 0 };
        const win = rows.length > 1 && rows[0].uid === uid;
        const gain = 25 + meR.kills * 15 + (win ? 60 : 0) + Math.max(0, (ArenaGame.wave || 1) - 1) * 12 + (meR.deaths === 0 && meR.kills > 0 ? 20 : 0);
        const r = awardXp(gain);
        const up = r.after.lvl > r.before.lvl;
        xpHtml = '<div class="xp-box' + (up ? ' up' : '') + '">⭐ +' + gain + ' خبرة — مستوى ' + r.after.lvl + ' (' + lvlTitle(r.after.lvl) + ')' +
          '<div class="lvl-bar"><i style="width:' + Math.round(100 * r.after.rem / r.after.need) + '%"></i></div>' +
          (up ? '<div>🎉 ترقيت لمستوى ' + r.after.lvl + '! +🪙 ' + r.coins + '</div>' : '') + '</div>';
      }
      window._xpHtml = xpHtml;
      const rs = ArenaGame.rs || {};
      const acc = rs.shots ? Math.round(100 * Math.min(rs.hits, rs.shots) / rs.shots) : 0;
      const me = rows.find((r) => r.uid === uid) || { kills: 0, deaths: 0 };
      const badges = [];
      if (rs.shots >= 8 && acc >= 50) badges.push('🎯 قنّاص');
      if (rs.gren >= 2) badges.push('💣 مفجّر');
      if (rs.dash >= 5) badges.push('💨 هارب');
      if (rs.pick >= 3) badges.push('🎁 جامع');
      if (rs.streak >= 3) badges.push('🔥 سلسلة ' + rs.streak);
      if (me.kills >= 5) badges.push('☠️ سفّاح');
      if (me.deaths === 0 && me.kills > 0) badges.push('🛡️ ما اتقتلش');
      if (ArenaGame.wave > 1) badges.push('🌊 موجة ' + ArenaGame.wave);
      $('results-awards').innerHTML = window._xpHtml + '<h3>📊 أداءك في الجولة</h3><div class="aw-grid">' +
        '<div><b>' + (rs.shots || 0) + '</b><small>طلقات</small></div>' +
        '<div><b>' + acc + '%</b><small>دقة</small></div>' +
        '<div><b>' + (rs.gren || 0) + '</b><small>قنابل</small></div>' +
        '<div><b>' + (rs.dash || 0) + '</b><small>داش</small></div>' +
        '<div><b>' + (rs.pick || 0) + '</b><small>قدرات</small></div>' +
        '<div><b>' + (me.kills || 0) + '</b><small>قتلات</small></div></div>' +
        (badges.length ? '<div class="aw-badges">' + badges.map((b) => '<span>' + b + '</span>').join('') + '</div>' : '<p class="subtitle">اشتغل أكتر عشان تاخد أوسمة</p>');
    })();
    show('results');
    spawnConfetti();

    // الهوست يرجع الغرفة للوبي بعد شوية
    if (isHost) {
      setTimeout(() => {
        if (!roomCode) return;
        db.ref('rooms/' + roomCode + '/gems').remove().catch(() => {}); db.ref('rooms/' + roomCode + '/flag').remove().catch(() => {});
        const updates = { state: 'lobby' };
        db.ref('rooms/' + roomCode + '/meta').update(updates).then(() => {
          return db.ref('rooms/' + roomCode + '/players').once('value');
        }).then((s) => {
          const ps = s.val() || {};
          const up = {};
          Object.keys(ps).forEach((u) => {
            up[u + '/zpts'] = 0; up[u + '/ready'] = false;
            up[u + '/kills'] = 0;
            up[u + '/deaths'] = 0;
            up[u + '/hp'] = ARENA.MAX_HP;
            up[u + '/alive'] = true;
          });
          return db.ref('rooms/' + roomCode + '/players').update(up);
        }).catch(() => {});
      }, 12000);
    }
  }

  let lastResults = null;

  function spawnConfetti() {
    const scr = $('screen-results');
    const colors = ['#ff4757', '#2ed573', '#1e90ff', '#ffa502', '#eccc68', '#ff6b81'];
    for (let i = 0; i < 36; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + '%';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = (1.6 + Math.random() * 1.8) + 's';
      c.style.animationDelay = (Math.random() * 0.8) + 's';
      scr.appendChild(c);
      setTimeout(() => { if (c.parentNode) c.parentNode.removeChild(c); }, 4500);
    }
  }

  function backToLobby() {
    if (ArenaGame.running) ArenaGame.stop();
    if (isHost) {
      // رجّع الحالة فورًا بدل الانتظار
      db.ref('rooms/' + roomCode + '/meta').update({ state: 'lobby' }).then(() => {
        return db.ref('rooms/' + roomCode + '/players').once('value');
      }).then((s) => {
        const ps = s.val() || {};
        const up = {};
        Object.keys(ps).forEach((u) => {
          up[u + '/ready'] = false; up[u + '/kills'] = 0; up[u + '/deaths'] = 0;
          up[u + '/hp'] = ARENA.MAX_HP; up[u + '/alive'] = true;
        });
        return db.ref('rooms/' + roomCode + '/players').update(up);
      }).catch(() => {});
    }
    show('lobby');
  }

  function endGameToLobby(leave) {
    if (ArenaGame.running) ArenaGame.stop();
    if (leave) {
      // خلي الهوست يشوف إني خرجت عادي — بس ارجع للوبي لو لسه
      show('lobby');
    }
  }

  // ============ الغرف العامة ============
  async function showRooms() {
    show('rooms');
    const list = $('rooms-list');
    list.innerHTML = '<p class="subtitle">بجيب الغرف…</p>';
    try {
      const rows = [];
      for (let i = 1; i <= 6; i++) {
        const code = 'PUB' + i;
        const meta = (await db.ref('rooms/' + code + '/meta').once('value')).val();
        const players = (await db.ref('rooms/' + code + '/players').once('value')).numChildren();
        rows.push({ code, meta, players });
      }
      list.innerHTML = '';
      rows.forEach((r) => {
        const d = document.createElement('div');
        d.className = 'room-row';
        let stateTxt, stateCls;
        if (!r.meta) { stateTxt = 'فاضية — كون أول واحد!'; stateCls = 'st-free'; }
        else if (r.meta.state === 'playing') { stateTxt = '⚔️ معركة شغالة (ممكن تدخل)'; stateCls = 'st-playing'; }
        else if (r.players > 0) { stateTxt = '⏳ في الانتظار'; stateCls = 'st-lobby'; }
        else { stateTxt = 'فاضية'; stateCls = 'st-free'; }
        const full = r.players >= MAX_PLAYERS;
        d.innerHTML = `<span class="room-code">${r.code}</span>
          <span class="room-players">👥 ${r.players}/${MAX_PLAYERS}</span>
          <span class="room-state ${stateCls}">${stateTxt}</span>
          <button class="btn-mini room-join" data-code="${r.code}" ${full ? 'disabled' : ''}>${full ? 'مليانة' : 'انضم ⚡'}</button>`;
        list.appendChild(d);
      });
      list.querySelectorAll('.room-join').forEach((b) => {
        b.onclick = () => {
          if (b.disabled) return;
          const r = rows.find((x) => x.code === b.dataset.code);
          if (r && !r.meta) createRoomWithCode(b.dataset.code);
          else joinRoom(b.dataset.code);
        };
      });
    } catch (e) {
      list.innerHTML = '<p class="subtitle">حصل خطأ في جلب الغرف — جرب تحديث</p>';
    }
  }

  // ============ المتصدرين ============
  const ACH_LIST = [
    ['kill1', '🎯 أول قتلة'], ['kill10', '🔟 ١٠ قتلات'], ['streak3', '🔥 سلسلة ٣ قتلات'],
    ['dash10', '💨 عدّاء (١٠ داشات)'], ['zone30', '🏁 سيد المنطقة (٣٠ نقطة)'], ['win1', '🏆 أول فوز'], ['pickup5', '🎁 جامع القدرات (٥)'], ['gren3', '💣 قنّاص (٣ قنابل)'], ['wave3', '🌊 صامد (الموجة ٣)'],
  ];
  window.ArenaAch = {
    load() { try { return JSON.parse(localStorage.getItem('arena_ach') || '{}'); } catch (e) { return {}; } },
    save(d) { try { localStorage.setItem('arena_ach', JSON.stringify(d)); } catch (e) { /* ignore */ } },
    unlock(d, id) {
      d.unlocked = d.unlocked || {};
      if (d.unlocked[id]) return;
      d.unlocked[id] = Date.now();
      const it = ACH_LIST.find((x) => x[0] === id);
      toast('🏅 إنجاز جديد: ' + (it ? it[1] : id), 3500);
    },
    hit(type, val) {
      const d = this.load(); d.c = d.c || {};
      if (type === 'kill') { d.c.kills = (d.c.kills || 0) + 1; this.unlock(d, 'kill1'); if (d.c.kills >= 10) this.unlock(d, 'kill10'); }
      else if (type === 'streak') { if (val >= 3) this.unlock(d, 'streak3'); }
      else if (type === 'dash') { d.c.dashes = (d.c.dashes || 0) + 1; if (d.c.dashes >= 10) this.unlock(d, 'dash10'); }
      else if (type === 'gren') { d.c.grens = (d.c.grens || 0) + 1; if (d.c.grens >= 3) this.unlock(d, 'gren3'); }
      else if (type === 'wave') { if (val >= 3) this.unlock(d, 'wave3'); }
      else if (type === 'zone') { if (val >= 30) this.unlock(d, 'zone30'); }
      else if (type === 'win') { this.unlock(d, 'win1'); }
      else if (type === 'pickup') { d.c.pickups = (d.c.pickups || 0) + 1; if (d.c.pickups >= 5) this.unlock(d, 'pickup5'); }
      this.save(d);
    },
  };

  function renderAch() {
    const d = window.ArenaAch.load(); const u = d.unlocked || {};
    const n = ACH_LIST.filter((x) => u[x[0]]).length;
    $('ach-list').innerHTML = '<h3>🏅 الإنجازات (' + n + '/' + ACH_LIST.length + ')</h3>' + ACH_LIST.map((x) => '<div class="ach-item' + (u[x[0]] ? ' on' : '') + '">' + (u[x[0]] ? '✅ ' : '🔒 ') + x[1] + '</div>').join('');
  }

  function showStats() {
    show('stats');
    renderAch();
    const c = $('stats-card');
    c.innerHTML = '<p class="subtitle">بجيب البيانات…</p>';
    db.ref('leaderboard').once('value', (s) => {
      const rows = [];
      s.forEach((x) => { const v = x.val(); v.uid = x.key; v.points = (v.wins || 0) * 5 + (v.kills || 0) * 2 - (v.deaths || 0); rows.push(v); });
      rows.sort((p, q) => q.points - p.points);
      const i = rows.findIndex((r) => r.uid === uid);
      const me = i >= 0 ? rows[i] : { wins: 0, kills: 0, deaths: 0, points: 0 };
      const kd = (me.kills || 0) / Math.max(1, me.deaths || 0);
      c.innerHTML = `<div class="stats-head"><span class="stats-av">${profile.avatar || '🦊'}</span><b>${esc(profile.name)}</b></div>
        <div class="stats-grid">
          <div><span>🏆</span><b>${me.wins || 0}</b><small>انتصارات</small></div>
          <div><span>☠️</span><b>${me.kills || 0}</b><small>قتلات</small></div>
          <div><span>💀</span><b>${me.deaths || 0}</b><small>مرات الموت</small></div>
          <div><span>🎯</span><b>${kd.toFixed(2)}</b><small>نسبة ق/م</small></div>
          <div><span>⭐</span><b>${me.points}</b><small>نقاط</small></div>
          <div><span>🏅</span><b>${i >= 0 ? '#' + (i + 1) : '-'}</b><small>ترتيبك من ${rows.length}</small></div>
          <div><span>🌊</span><b>${(function () { try { return localStorage.getItem('arena_bestwave') || 0; } catch (e) { return 0; } })()}</b><small>أفضل موجة</small></div>
        </div>` + (i < 0 ? '<p class="subtitle">العب جولة مع لاعب تاني عشان تظهر في الترتيب</p>' : '');
    }, () => { c.innerHTML = '<p class="subtitle">مقدرتش أجيب البيانات</p>'; });
  }

  function showLeaderboard(mode) {
    show('leaderboard');
    $('tab-wins').classList.toggle('active', mode === 'wins');
    $('tab-kills').classList.toggle('active', mode === 'kills');
    $('tab-points').classList.toggle('active', mode === 'points');
    $('tab-wave').classList.toggle('active', mode === 'bestWave');
    $('tab-rush').classList.toggle('active', mode === 'bestRush');
    const list = $('leaderboard-list');
    list.innerHTML = '<p class="subtitle">بجيب البيانات…</p>';
    db.ref('leaderboard').once('value', (s) => {
      const rows = [];
      s.forEach((c) => {
        const v = c.val(); v.uid = c.key;
        v.points = (v.wins || 0) * 5 + (v.kills || 0) * 2 - (v.deaths || 0);
        rows.push(v);
      });
      const key = mode === 'points' ? 'points' : mode;
      rows.sort((a, b) => (b[key] || 0) - (a[key] || 0));
      const top = rows.filter((q) => (mode === 'bestWave' || mode === 'bestRush') ? (q[mode] || 0) > 0 : true).slice(0, 20);
      list.innerHTML = '';
      if (!top.length) {
        list.innerHTML = '<p class="subtitle">لسه مفيش نتايج — كن أول بطل! ⚔️</p>';
        return;
      }
      top.forEach((r, i) => {
        const val = mode === 'bestWave' ? '🌊 ' + (r.bestWave || 0) : mode === 'bestRush' ? '👑 ' + (r.bestRush || 0) : mode === 'wins' ? '🏆 ' + (r.wins || 0) : mode === 'kills' ? '☠️ ' + (r.kills || 0) : '⭐ ' + r.points;
        const d = document.createElement('div');
        d.className = 'lb-row' + (i < 3 ? ' top' : '');
        d.innerHTML = `<span class="lb-rank">#${i + 1}</span>
          <span>${r.avatar || '🦊'}</span>
          <span class="lb-name">${esc(r.name || 'لاعب')}${r.uid === uid ? ' (انت)' : ''}<small class="lb-sub">🏆${r.wins || 0} ☠️${r.kills || 0} 💀${r.deaths || 0}</small></span>
          <span class="lb-val">${val}</span>`;
        list.appendChild(d);
      });
    });
  }

  // ============ الأصدقاء ============
  let friendsListener = null;
  function showFriends() {
    show('friends');
    const list = $('friends-list');
    list.innerHTML = '<p class="subtitle">بجيب الأصدقاء…</p>';
    if (friendsListener) friendsListener.off();
    friendsListener = db.ref('friends/' + uid);
    friendsListener.on('value', (s) => {
      const fr = s.val() || {};
      const ids = Object.keys(fr);
      list.innerHTML = '';
      if (!ids.length) {
        list.innerHTML = '<p class="subtitle">لسه مفيش أصدقاء — ابعت كودك لصاحبك وهو يضيفك، أو ضيفه بكوده 👆</p>';
        return;
      }
      ids.forEach((fid) => {
        const f = fr[fid];
        const d = document.createElement('div');
        d.className = 'friend-row';
        d.innerHTML = `<span class="f-status" data-fid="${fid}"></span>
          <span>${f.avatar || '🦊'}</span>
          <span class="f-name">${esc(f.name || 'صديق')}</span>
          <span class="lb-val f-online-text" data-fid="${fid}"></span>`;
        list.appendChild(d);
        db.ref('presence/' + fid).on('value', (ps) => {
          const on = ps.val() && ps.val().online;
          const dot = list.querySelector(`.f-status[data-fid="${fid}"]`);
          const txt = list.querySelector(`.f-online-text[data-fid="${fid}"]`);
          if (dot) dot.classList.toggle('online', !!on);
          if (txt) txt.textContent = on ? '🟢 متصل' : '';
        });
      });
    });
  }

  function addFriend() {
    const code = $('input-friend-code').value.trim().toUpperCase();
    if (code.length < 5) { toast('اكتب الكود كامل'); return; }
    if (code === friendCode()) { toast('ده كودك انت 😄'); return; }
    db.ref('codes/' + code).once('value', (s) => {
      const fid = s.val();
      if (!fid) { toast('الكود ده مش موجود'); return; }
      db.ref('users/' + fid).once('value', (us) => {
        const u = us.val();
        if (!u) { toast('الكود ده مش موجود'); return; }
        db.ref('friends/' + uid + '/' + fid).set({ name: u.name, avatar: u.avatar }).then(() => {
          toast('اتضاف ' + u.name + ' ✅');
          $('input-friend-code').value = '';
          // وأنا كمان أظهر عنده
          db.ref('friends/' + fid + '/' + uid).set({ name: profile.name, avatar: profile.avatar }).catch(() => {});
        }).catch(() => toast('حصل خطأ'));
      });
    });
  }
})();

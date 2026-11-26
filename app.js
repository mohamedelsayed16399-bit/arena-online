/* ساحة الأبطال — منطق التطبيق: الدخول، الغرف، اللوبي، الأصدقاء، المتصدرين */
(function () {
  'use strict';

  const AVATARS = ['🦊', '🦁', '🐺', '🐯', '🦅', '🐉', '🤖', '👽', '💀', '🥷', '🧙', '🦖'];
  const MAX_PLAYERS = 6;
  const ROUND_SECONDS = 180;
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  const $ = (id) => document.getElementById(id);
  const screens = ['loading', 'profile', 'home', 'lobby', 'game', 'results', 'leaderboard', 'friends', 'how', 'rooms'];

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
    $('btn-send-chat').onclick = sendChat;
    $('input-chat').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

    // اللعبة
    $('btn-leave-game').onclick = () => { endGameToLobby(true); };
    document.querySelectorAll('.emote').forEach((b) => {
      b.onclick = () => { if (window.ArenaGame && ArenaGame.running) ArenaGame.sendEmote(b.textContent); };
    });

    // النتائج
    $('btn-back-lobby').onclick = () => backToLobby();
    $('btn-back-home').onclick = () => { leaveRoom(); };

    // رجوع
    $('btn-back-from-lb').onclick = () => show('home');
    $('btn-back-from-fr').onclick = () => show('home');
    $('btn-back-from-how').onclick = () => show('home');

    // تبويبات المتصدرين
    $('tab-wins').onclick = () => showLeaderboard('wins');
    $('tab-kills').onclick = () => showLeaderboard('kills');
    $('tab-points').onclick = () => showLeaderboard('points');

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
    $('lobby-hint').textContent = isHost
      ? 'انت الهوست — لما الكل يجهز اضغط ابدأ (أو ابدأ لوحدك)'
      : 'شارك الكود مع صحابك عشان ينضموا';
  }

  function toggleReady() {
    if (!roomCode) return;
    const ref = db.ref('rooms/' + roomCode + '/players/' + uid + '/ready');
    ref.once('value', (s) => ref.set(!s.val()));
  }

  function hostStartRound(mode) {
    if (!isHost || !roomCode) return;
    const secs = mode === 'blitz' ? 60 : ROUND_SECONDS;
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
  function startGame(endsAt, mode) {
    if ($('screen-game').classList.contains('active') && window.ArenaGame.running) return;
    show('game');
    $('hud-mode').textContent = mode === 'blitz' ? '⚡ بليتز' : '';
    ArenaGame.start({
      db, roomCode,
      me: { uid, name: profile.name, avatar: profile.avatar, color: myColor, joinedAt: myJoinedAt },
      host: isHost,
      seed: roomSeed,
      endsAt,
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

    $('results-title').textContent = rows[0].uid === uid ? '🏆 كسبت المعركة!' : `🏆 الفائز: ${rows[0].name}`;
    const list = $('results-list');
    list.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    rows.forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'result-row' + (i === 0 ? ' winner' : '');
      d.innerHTML = `<span class="r-rank">${medals[i] || (i + 1)}</span>
        <span>${r.avatar || '🦊'}</span>
        <span class="r-name">${esc(r.name)}${r.uid === uid ? ' (انت)' : ''}</span>
        <span class="r-score">☠️ ${r.kills} | 💀 ${r.deaths}</span>`;
      list.appendChild(d);
    });
    show('results');
    spawnConfetti();

    // الهوست يرجع الغرفة للوبي بعد شوية
    if (isHost) {
      setTimeout(() => {
        if (!roomCode) return;
        const updates = { state: 'lobby' };
        db.ref('rooms/' + roomCode + '/meta').update(updates).then(() => {
          return db.ref('rooms/' + roomCode + '/players').once('value');
        }).then((s) => {
          const ps = s.val() || {};
          const up = {};
          Object.keys(ps).forEach((u) => {
            up[u + '/ready'] = false;
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
  function showLeaderboard(mode) {
    show('leaderboard');
    $('tab-wins').classList.toggle('active', mode === 'wins');
    $('tab-kills').classList.toggle('active', mode === 'kills');
    $('tab-points').classList.toggle('active', mode === 'points');
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
      const top = rows.slice(0, 20);
      list.innerHTML = '';
      if (!top.length) {
        list.innerHTML = '<p class="subtitle">لسه مفيش نتايج — كن أول بطل! ⚔️</p>';
        return;
      }
      top.forEach((r, i) => {
        const val = mode === 'wins' ? '🏆 ' + (r.wins || 0) : mode === 'kills' ? '☠️ ' + (r.kills || 0) : '⭐ ' + r.points;
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

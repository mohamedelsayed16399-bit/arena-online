/* ساحة الأبطال — محرك اللعبة والمزامنة اللحظية */
(function () {
  'use strict';

  const WORLD = 2200;             // حجم العالم
  const PLAYER_R = 20;            // نصف قطر اللاعب
  const SPEED = 240;              // سرعة الحركة
  const BULLET_SPEED = 640;
  const BULLET_LIFE = 1.1;        // ثانية
  const BULLET_DMG = 25;
  const FIRE_COOLDOWN = 330;      // مللي ثانية
  const MAX_HP = 100;
  const RESPAWN_SEC = 3;
  const NET_HZ = 90;              // كل كام مللي ثانية نبعت الموقع

  const THEMES = [
    { name: 'ليل', bg0: '#101426', bg1: '#0b0e1a', ob: '#222a52', obs: 'rgba(255,255,255,0.08)' },
    { name: 'صحرا', bg0: '#2a1f12', bg1: '#1a1209', ob: '#5a4326', obs: 'rgba(255,214,150,0.18)' },
    { name: 'تلج', bg0: '#0f2430', bg1: '#08141c', ob: '#2c5a73', obs: 'rgba(180,235,255,0.22)' },
    { name: 'حمم', bg0: '#2a0f0f', bg1: '#150606', ob: '#4a1d1d', obs: 'rgba(255,120,80,0.28)' },
  ];
  const BOT_LEVELS = { easy: { fire: 1600, err: 0.9, spd: 110 }, normal: { fire: 950, err: 0.45, spd: 150 }, hard: { fire: 600, err: 0.18, spd: 190 } };
  const PALETTE = ['#ff4757', '#2ed573', '#1e90ff', '#ffa502', '#eccc68', '#7bed9f', '#70a1ff', '#ff6b81'];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const Game = {
    running: false,
    canvas: null, ctx: null,
    db: null, roomCode: null, me: null, host: false,
    players: {},          // uid -> {name,avatar,color,x,y,angle,hp,alive,kills,deaths, tx,ty}
    bullets: [],          // {id,uid,x,y,dx,dy,age}
    obstacles: [],
    listeners: [],
    keys: {},
    mouse: { x: 0, y: 0, down: false },
    joyL: { active: false, dx: 0, dy: 0, id: null },
    joyR: { active: false, dx: 0, dy: 0, id: null },
    cam: { x: 0, y: 0 },
    lastFire: 0, lastNetSend: 0,
    serverOffset: 0,
    endsAt: 0,
    respawnAt: 0,
    pickups: {}, lastPickupSpawn: 0,
    muzzleUntil: 0, hitFlashUntil: 0, lastHpShown: null,
    speedUntil: 0, shieldUntil: 0, protectedUntil: 0, weaponUntil: 0, weapon: '', fx: [], dashUntil: 0, dashCd: 0, rs: { shots: 0, hits: 0, gren: 0, dash: 0, pick: 0, streak: 0 }, barrels: [], wave: 1, waveAt: 0, waveBanner: null, gren: [], grenCd: 0, rings: [], gcount: 0, dashX: 0, dashY: 0, mode: 'classic', zpts: 0, zoneAcc: 0, zoneCache: null, bots: [], botCheckAt: 0, botAnnounced: false, shakeUntil: 0, specIdx: 0, lastBurst: 0, up: { dmg: 0, spd: 0, rate: 0, steal: 0, arm: 0 }, upDone: false, pickWait: false,
    rafId: null, lastTs: 0,
    onRoundEnd: null, onFeed: null, onHud: null,
    seed: 1,
    ended: false,

    start(opts) {
      this.db = opts.db; this.roomCode = opts.roomCode;
      this.me = opts.me; this.host = opts.host;
      this.seed = opts.seed || 1;
      this.endsAt = opts.endsAt || 0;
      this.dashUntil = 0; this.dashCd = 0;
      this.theme = THEMES[Math.abs(Math.floor(this.seed)) % THEMES.length]; this.mode = opts.mode || 'classic'; this.zpts = 0; this.zoneAcc = 0; this.zoneCache = null; this.gemTaken = {};
      this.onRoundEnd = opts.onRoundEnd; this.onFeed = opts.onFeed || (() => {}); this.onHud = opts.onHud || (() => {});
      this.canvas = document.getElementById('game-canvas');
      this.ctx = this.canvas.getContext('2d');
      this.running = true; this.ended = false;
      this.bullets = []; this.players = {}; this.pickups = {}; this.lastPickupSpawn = 0; this.streaks = {};
      this.genObstacles();
      this.buildHazards();
      this.resize();
      window.addEventListener('resize', this._resize = () => this.resize());
      this.bindInput();
      this.listenDb();
      // مكاني الابتدائي
      const rnd = mulberry32(this.seed + hashCode(this.me.uid));
      const p = this.freeSpot(rnd);
      this.myX = p.x; this.myY = p.y; this.myAngle = 0;
      this.myHp = MAX_HP; this.myAlive = true;
      this.lastHpShown = MAX_HP; this.muzzleUntil = 0; this.hitFlashUntil = 0;
      this.speedUntil = 0; this.shieldUntil = 0; this.weaponUntil = 0; this.weapon = ''; this.fx = []; this.gren = []; this.rs = { shots: 0, hits: 0, gren: 0, dash: 0, pick: 0, streak: 0 }; this.barrels = []; this.wave = 1; this.waveAt = 0; this.waveBanner = null; this.rings = []; this.grenCd = 0; this.bots = []; this.botCheckAt = 0; this.botAnnounced = false; this.shakeUntil = 0; this.specIdx = 0; this.up = { dmg: 0, spd: 0, rate: 0, steal: 0, arm: 0 }; this.upDone = false; this.pickWait = false; this.hideUpgrades();
      this.protectedUntil = performance.now() + 2000; // حماية بداية الجولة
      this.writeSelf(true);
      this.onFeed('🗺️ ساحة ' + this.theme.name);
      this.lastTs = performance.now();
      const loop = (ts) => {
        if (!this.running) return;
        const dt = Math.min(0.05, (ts - this.lastTs) / 1000);
        this.lastTs = ts;
        this.tick(dt);
        this.draw();
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    },

    stop() {
      this.running = false;
      if (this.rafId) cancelAnimationFrame(this.rafId);
      window.removeEventListener('resize', this._resize);
      this.unbindInput();
      this.listeners.forEach(({ ref, ev, fn }) => ref.off(ev, fn));
      this.listeners = [];
    },

    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = innerWidth * dpr;
      this.canvas.height = innerHeight * dpr;
      this.dpr = dpr;
    },

    genObstacles() {
      const rnd = mulberry32(this.seed);
      this.obstacles = [];
      const count = 12 + Math.floor(rnd() * 9); // ١٢-٢٠ حاجز
      for (let i = 0; i < count; i++) {
        let w, h;
        const kind = rnd();
        if (kind < 0.35) { w = 200 + rnd() * 260; h = 40 + rnd() * 60; }       // حيطة عريضة
        else if (kind < 0.7) { w = 40 + rnd() * 60; h = 200 + rnd() * 260; }   // حيطة طولية
        else { w = 90 + rnd() * 160; h = 90 + rnd() * 160; }                   // مكعب
        this.obstacles.push({
          x: 120 + rnd() * (WORLD - 240 - w),
          y: 120 + rnd() * (WORLD - 240 - h),
          w, h,
        });
      }
      const r2 = mulberry32((this.seed * 13 + 777) >>> 0);
      for (let i = 0; i < 4; i++) {
        const horiz = i % 2 === 0;
        const w = horiz ? 40 : 220, h = horiz ? 220 : 40;
        const cx = 500 + r2() * (WORLD - 1000), cy = 500 + r2() * (WORLD - 1000);
        this.obstacles.push({ x: cx, y: cy, w, h, mv: { cx, cy, ax: horiz ? 1 : 0, ay: horiz ? 0 : 1, amp: 220 + r2() * 160, sp: 0.25 + r2() * 0.25, ph: r2() * 6.28 } });
      }
      this.updateMovers(true);
    },

    updateMovers(first) {
      const t = this.serverNow() / 1000;
      for (const o of this.obstacles) {
        if (!o.mv) continue;
        const m = o.mv, off = Math.sin(t * m.sp + m.ph) * m.amp;
        const px = o.x, py = o.y;
        o.x = m.cx + m.ax * off; o.y = m.cy + m.ay * off;
        if (first) continue;
        const ddx = o.x - px, ddy = o.y - py;
        const push = (ent, r) => {
          if (!circleRect(ent.x, ent.y, r, o)) return;
          const nx = clamp(ent.x, o.x, o.x + o.w), ny = clamp(ent.y, o.y, o.y + o.h);
          let vx = ent.x - nx, vy = ent.y - ny, d = Math.hypot(vx, vy);
          if (d < 0.001) { vx = ddx || 1; vy = ddy; d = Math.hypot(vx, vy) || 1; }
          ent.x = clamp(nx + (vx / d) * (r + 1), r, WORLD - r); ent.y = clamp(ny + (vy / d) * (r + 1), r, WORLD - r);
        };
        if (this.myAlive) { const me = { x: this.myX, y: this.myY }; push(me, PLAYER_R); this.myX = me.x; this.myY = me.y; }
        for (const bt of this.bots) if (bt.alive) push(bt, PLAYER_R);
      }
    },

    buildHazards() {
      this.hazards = [];
      const nm = this.theme && this.theme.name;
      if (nm !== 'حمم' && nm !== 'تلج') return;
      const rnd = mulberry32(((this.seed * 31 + 555) >>> 0));
      const n = nm === 'حمم' ? 5 : 4;
      for (let k = 0; k < n; k++) { const p = this.freeSpot(rnd); this.hazards.push({ x: p.x, y: p.y, r: nm === 'حمم' ? 110 : 150, type: nm === 'حمم' ? 'lava' : 'ice' }); }
    },

    freeSpot(rnd) {
      for (let tries = 0; tries < 40; tries++) {
        const x = 80 + rnd() * (WORLD - 160), y = 80 + rnd() * (WORLD - 160);
        if (!this.obstacles.some(o => circleRect(x, y, PLAYER_R + 8, o))) return { x, y };
      }
      return { x: WORLD / 2, y: WORLD / 2 };
    },

    // ============ المزامنة ============
    listenDb() {
      const roomRef = this.db.ref('rooms/' + this.roomCode);
      // اللاعبين
      const playersRef = roomRef.child('players');
      const onAdd = playersRef.on('child_added', (s) => {
        const u = s.key, v = s.val();
        if (u === this.me.uid) { if (v) this.applySelf(v, true); return; }
        this.players[u] = Object.assign({ tx: v.x || WORLD / 2, ty: v.y || WORLD / 2 }, v);
      });
      const onChange = playersRef.on('child_changed', (s) => {
        const u = s.key, v = s.val();
        if (u === this.me.uid) { this.applySelf(v, false); return; }
        if (this.players[u]) {
          if (v.hp !== undefined && v.hp < (this.players[u].hp || 0)) this.players[u].flashUntil = performance.now() + 200;
          this.players[u].tx = v.x; this.players[u].ty = v.y;
          Object.assign(this.players[u], v);
        }
      });
      const onRemove = playersRef.on('child_removed', (s) => { delete this.players[s.key]; });
      this.listeners.push({ ref: playersRef, ev: 'child_added', fn: onAdd });
      this.listeners.push({ ref: playersRef, ev: 'child_changed', fn: onChange });
      this.listeners.push({ ref: playersRef, ev: 'child_removed', fn: onRemove });

      // فرق التوقيت مع السيرفر
      const offRef = this.db.ref('.info/serverTimeOffset');
      const onOff = offRef.on('value', (s) => { this.serverOffset = s.val() || 0; });
      this.listeners.push({ ref: offRef, ev: 'value', fn: onOff });

      // علب الصحة
      const pickRef = roomRef.child('pickups');
      const onPickAdd = pickRef.on('child_added', (s) => { const v = s.val(); if (v) this.pickups[s.key] = v; });
      const onPickRem = pickRef.on('child_removed', (s) => { delete this.pickups[s.key]; });
      this.listeners.push({ ref: pickRef, ev: 'child_added', fn: onPickAdd });
      this.listeners.push({ ref: pickRef, ev: 'child_removed', fn: onPickRem });

      // الأحداث (طلقات، إصابات، قتل)
      const eventsRef = roomRef.child('events');
      eventsRef.limitToLast(1).once('value', (snap) => {
        let lastKey = '';
        snap.forEach((c) => { lastKey = c.key; });
        const onEvent = eventsRef.on('child_added', (s) => {
          if (s.key <= lastKey) return;
          this.handleEvent(s.val());
        });
        this.listeners.push({ ref: eventsRef, ev: 'child_added', fn: onEvent });
      });
    },

    applySelf(v, initial) {
      // بياناتي لما تتعدل من مصدر تاني (نادر) — ناخد القيم المهمة بس
      if (typeof v.kills === 'number') this.kills = v.kills;
      if (typeof v.deaths === 'number') this.deaths = v.deaths;
      if (initial) { this.kills = v.kills || 0; this.deaths = v.deaths || 0; }
    },

    handleEvent(e) {
      if (!e || !e.t) return;
      if (e.t === 'shoot') {
        if (!this.bullets.some((b) => b.id === e.id)) this.bullets.push({ id: e.id, uid: e.uid, x: e.x, y: e.y, dx: e.dx, dy: e.dy, age: 0, life: e.l || 0 });
        if (e.uid !== this.me.uid) Sfx.shoot(0.25);
      } else if (e.t === 'hit') {
        // شيل الطلقة اللي أصابت
        const i = this.bullets.findIndex(b => b.id === e.bulletId);
        if (i >= 0) this.bullets.splice(i, 1);
        if (e.by === this.me.uid) this.rs.hits++;
        if (e.target === this.me.uid) Sfx.hit();
        else if (this.players[e.target] && this.players[e.target].x !== undefined) this.burst(this.players[e.target].x, this.players[e.target].y, '#ff6b81', 8, 180);
      } else if (e.t === 'gren') {
        if (e.uid !== this.me.uid) this.addGrenade({ id: e.id, uid: e.uid, x: e.x, y: e.y, tx: e.tx, ty: e.ty });
      } else if (e.t === 'emote') {
        if (e.uid !== this.me.uid) {
          const n = (this.players[e.uid] && this.players[e.uid].name) || 'لاعب';
          this.onFeed(n + ': ' + e.e);
        }
      } else if (e.t === 'kill') {
        const killer = e.by === this.me.uid ? (this.me.name) : (this.players[e.by] && this.players[e.by].name) || 'لاعب';
        const victim = e.target === this.me.uid ? (this.me.name) : (this.players[e.target] && this.players[e.target].name) || 'لاعب';
        this.onFeed(`☠️ ${killer} قضى على ${victim}`);
        if (e.target !== this.me.uid && this.players[e.target] && this.players[e.target].x !== undefined) this.burst(this.players[e.target].x, this.players[e.target].y, '#ffd32a', 28, 300);
        this.streaks = this.streaks || {};
        this.streaks[e.target] = 0;
        this.streaks[e.by] = (this.streaks[e.by] || 0) + 1;
        const sk = this.streaks[e.by];
        if (e.by === this.me.uid) { this.ach('kill'); this.ach('streak', sk); }
        if (e.by === this.me.uid) this.rs.streak = Math.max(this.rs.streak, sk);
        if (sk >= 3) this.onFeed(`🔥 ${killer} في سلسلة ${sk} قتلات!`);
        Sfx.kill();
        if (e.target === this.me.uid && this.myAlive) {
          // تأكيد موتي
          this.die(e.by);
        }
      }
    },

    serverNow() { return Date.now() + this.serverOffset; },

    writeSelf(force) {
      const now = performance.now();
      if (!force && now - this.lastNetSend < NET_HZ) return;
      this.lastNetSend = now;
      this.db.ref('rooms/' + this.roomCode + '/players/' + this.me.uid).update({
        x: Math.round(this.myX), y: Math.round(this.myY),
        angle: Math.round(this.myAngle * 100) / 100,
        hp: this.myHp, alive: this.myAlive,
        sh: performance.now() < this.shieldUntil ? 1 : 0,
        zpts: this.zpts || 0,
      }).catch(() => {});
    },

    sendEmote(e) {
      if (!this.running) return;
      this.onFeed(this.me.name + ': ' + e);
      this.db.ref('rooms/' + this.roomCode + '/events').push({
        t: 'emote', uid: this.me.uid, e,
        ts: firebase.database.ServerValue.TIMESTAMP,
      }).catch(() => {});
    },

    ach(type, val) { try { if (window.ArenaAch) window.ArenaAch.hit(type, val); } catch (err) { /* ignore */ } },

    dash() {
      const now = performance.now();
      if (!this.myAlive || !this.running || now < this.dashCd) return;
      let mx = 0, my = 0;
      if (this.keys['w'] || this.keys['arrowup']) my -= 1;
      if (this.keys['s'] || this.keys['arrowdown']) my += 1;
      if (this.keys['a'] || this.keys['arrowleft']) mx -= 1;
      if (this.keys['d'] || this.keys['arrowright']) mx += 1;
      if (this.joyL.active) { mx = this.joyL.dx; my = this.joyL.dy; }
      let l = Math.hypot(mx, my);
      if (l < 0.1) { mx = Math.cos(this.myAngle); my = Math.sin(this.myAngle); l = 1; }
      this.dashX = mx / l; this.dashY = my / l;
      this.dashUntil = now + 170; this.dashCd = now + 2500;
      this.burst(this.myX, this.myY, '#7bdff2', 16, 220);
      this.ach('dash'); this.rs.dash++;
    },

    throwGrenade() {
      const now = performance.now();
      if (!this.myAlive || !this.running || now < this.grenCd) return;
      this.grenCd = now + 8000;
      const d = 260, tx = clamp(this.myX + Math.cos(this.myAngle) * d, 20, WORLD - 20), ty = clamp(this.myY + Math.sin(this.myAngle) * d, 20, WORLD - 20);
      const id = this.me.uid.slice(0, 4) + '_g' + Math.floor(now);
      this.addGrenade({ id, uid: this.me.uid, x: this.myX, y: this.myY, tx, ty });
      this.gcount = (this.gcount || 0) + 1;
      this.ach('gren'); this.rs.gren++;
      this.db.ref('rooms/' + this.roomCode + '/events').push({ t: 'gren', id, uid: this.me.uid, x: Math.round(this.myX), y: Math.round(this.myY), tx: Math.round(tx), ty: Math.round(ty), ts: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
    },

    addGrenade(o) {
      if (this.gren.some((q) => q.id === o.id)) return;
      this.gren.push({ id: o.id, uid: o.uid, sx: o.x, sy: o.y, tx: o.tx, ty: o.ty, x: o.x, y: o.y, age: 0 });
      Sfx.shoot(0.4);
    },

    explodeGrenade(q) {
      const R = 120;
      Sfx.boom();
      this.rings.push({ x: q.tx, y: q.ty, age: 0, life: 0.55, R });
      this.burst(q.tx, q.ty, '#ff9f43', 40, 420);
      this.burst(q.tx, q.ty, '#ffd32a', 24, 300);
      this.shakeUntil = Math.max(this.shakeUntil, performance.now() + 280);
      for (const o of this.barrels) { if (!o.dead && Math.hypot(o.x - q.tx, o.y - q.ty) < R) setTimeout(() => this.explodeBarrel(o), 120); }
      if (q.uid === this.me.uid) {
        for (const bt of this.bots) {
          if (bt.alive && Math.hypot(bt.x - q.tx, bt.y - q.ty) < R) {
            bt.hp -= 40;
            this.burst(bt.x, bt.y, '#ff6b81', 8, 180);
            if (bt.hp <= 0) {
              bt.alive = false; bt.respawnAt = performance.now() + 3000;
              this.burst(bt.x, bt.y, '#ffd32a', 28, 300);
              this.onFeed('💣 فجّرت ' + bt.name);
              Sfx.kill(); this.ach('kill');
              this.db.ref('rooms/' + this.roomCode + '/players/' + this.me.uid + '/kills').transaction((k) => (k || 0) + 1).catch(() => {});
            }
          }
        }
      } else if (this.myAlive && performance.now() > this.protectedUntil && Math.hypot(this.myX - q.tx, this.myY - q.ty) < R) {
        if (performance.now() < this.shieldUntil) { this.onFeed('🛡️ الدرع صدّ الانفجار!'); }
        else {
          this.myHp -= 40; this.onHud(this.myHp); this.writeSelf(true); Sfx.hit();
          this.shakeUntil = performance.now() + 300;
          if (this.myHp <= 0) { this.burst(this.myX, this.myY, '#ffd32a', 30, 320); this.die(q.uid); }
        }
      }
    },

    showUpgrades() {
      const ALL = [
        { k: 'dmg', i: '🔥', t: 'ضرر أعلى', d: '+٢٥٪ ضرر طلقاتك' },
        { k: 'spd', i: '👟', t: 'سرعة', d: '+١٠٪ سرعة حركة' },
        { k: 'rate', i: '⚡', t: 'تصويب أسرع', d: '-١٥٪ وقت بين الطلقات' },
        { k: 'steal', i: '🩸', t: 'سرقة صحة', d: 'كل إصابة بتشفيك' },
        { k: 'arm', i: '🛡️', t: 'دروع', d: '-١٨٪ ضرر من البوتات' }
      ];
      const pick = ALL.slice().sort(() => Math.random() - 0.5).slice(0, 3);
      let el = document.getElementById('upgrade-picker');
      if (!el) { el = document.createElement('div'); el.id = 'upgrade-picker'; document.body.appendChild(el); }
      el.innerHTML = '<div class="up-title">🎁 اختار ترقية للموجة الجاية</div><div class="up-row"></div>';
      const row = el.querySelector('.up-row');
      const choose = (u) => {
        if (!this.pickWait) return;
        this.up[u.k]++; this.pickWait = false; this.hideUpgrades();
        this.onFeed(u.i + ' ترقية: ' + u.t + ' (مستوى ' + this.up[u.k] + ')'); Sfx.kill();
      };
      this._upChoose = pick.map((u) => () => choose(u));
      pick.forEach((u, n) => {
        const b = document.createElement('button'); b.className = 'up-card';
        b.innerHTML = '<span class="up-i">' + u.i + '</span><b>' + u.t + '</b><small>' + u.d + ' (' + (this.up[u.k] + 1) + ')</small><em>' + (n + 1) + '</em>';
        b.onclick = this._upChoose[n]; row.appendChild(b);
      });
      el.style.display = 'flex';
      if (!this._upKey) { this._upKey = (e) => { if (this.pickWait && this._upChoose && e.key >= '1' && e.key <= '3') { const f = this._upChoose[+e.key - 1]; if (f) f(); } }; window.addEventListener('keydown', this._upKey); }
    },
    hideUpgrades() { const el = document.getElementById('upgrade-picker'); if (el) el.style.display = 'none'; },

    spawnWave(nowB) {
      const n = Math.min(9, 2 + this.wave);
      this.bots = [];
      this.barrels = [];
      for (let k = 0; k < 6; k++) { const p = this.freeSpot(mulberry32((Date.now() & 0xffff) + k * 131 + 7)); this.barrels.push({ x: p.x, y: p.y, hp: 2, dead: false }); }
      if (this.wave % 5 === 0) {
        const p = this.freeSpot(mulberry32((Date.now() & 0xffff) + 999));
        this.bots.push({ id: 'bot99', name: this.wave >= 15 ? '🌀 زعيم الشبح' : this.wave >= 10 ? '💀 زعيم الانفجار' : '👑 الزعيم', boss: true, boss2: this.wave >= 10 && this.wave < 15, boss3: this.wave >= 15, nextTp: nowB + 4500, max: this.wave >= 15 ? 600 : this.wave >= 10 ? 450 : 300, nextBurst: nowB + 3500, x: p.x, y: p.y, hp: this.wave >= 15 ? 600 : this.wave >= 10 ? 450 : 300, alive: true, angle: 0, lastFire: nowB + 1500, respawnAt: 0, phase: 0, color: 1 });
        this.onFeed(this.wave >= 15 ? '🌀 زعيم الشبح! بيتنقل وبيستدعي أتباع' : this.wave >= 10 ? '💀 زعيم الانفجار! دايرة طلقات' : '👑 زعيم ظهر! ٣٠٠ صحة وبيضرب ٣ طلقات'); Sfx.horn();
      }
      for (let k = 0; k < n; k++) {
        const p = this.freeSpot(mulberry32((Date.now() & 0xffff) + k * 77));
        this.bots.push({ id: 'bot' + k, name: '🤖 بوت ' + (k + 1), x: p.x, y: p.y, hp: MAX_HP, alive: true, angle: 0, lastFire: nowB + 1200 + k * 400, respawnAt: 0, phase: Math.random() * 6, color: 3 + (k % 5) });
      }
    },

    explodeBarrel(br) {
      if (br.dead) return;
      br.dead = true;
      const R = 140;
      Sfx.boom();
      this.rings.push({ x: br.x, y: br.y, age: 0, life: 0.6, R });
      this.burst(br.x, br.y, '#ff6b35', 44, 440);
      this.burst(br.x, br.y, '#ffd32a', 22, 300);
      this.shakeUntil = Math.max(this.shakeUntil, performance.now() + 320);
      Sfx.kill();
      for (const bt of this.bots) {
        if (bt.alive && Math.hypot(bt.x - br.x, bt.y - br.y) < R) {
          bt.hp -= 50;
          this.burst(bt.x, bt.y, '#ff6b81', 8, 180);
          if (bt.hp <= 0) {
            bt.alive = false; bt.respawnAt = performance.now() + 3000;
            this.burst(bt.x, bt.y, '#ffd32a', 28, 300);
            this.onFeed('🛢️ البرميل فجّر ' + bt.name);
            this.ach('kill');
            this.db.ref('rooms/' + this.roomCode + '/players/' + this.me.uid + '/kills').transaction((k) => (k || 0) + 1).catch(() => {});
          }
        }
      }
      if (this.myAlive && performance.now() > this.protectedUntil && Math.hypot(this.myX - br.x, this.myY - br.y) < R) {
        if (performance.now() < this.shieldUntil) this.onFeed('🛡️ الدرع صدّ الانفجار!');
        else {
          this.myHp -= 40; this.onHud(this.myHp); this.writeSelf(true); Sfx.hit();
          if (this.myHp <= 0) { this.burst(this.myX, this.myY, '#ffd32a', 30, 320); this.die('bot_barrel'); }
        }
      }
      for (const o of this.barrels) { if (!o.dead && Math.hypot(o.x - br.x, o.y - br.y) < R) setTimeout(() => this.explodeBarrel(o), 150); }
    },

    stormInfo() {
      if (this.mode !== 'storm') return null;
      const total = 94000;
      const el = clamp(total - Math.max(0, this.endsAt - this.serverNow()), 0, total) / 1000;
      const t = clamp((el - 8) / 72, 0, 1);
      const R0 = WORLD * 0.72, R1 = 170;
      const cx = WORLD / 2 + Math.cos(this.seed * 1.7) * 220, cy = WORLD / 2 + Math.sin(this.seed * 2.3) * 220;
      return { x: cx, y: cy, r: R0 + (R1 - R0) * t, t, el };
    },

    gemList() {
      if (this.mode !== 'gems') return [];
      const ep = Math.floor(Math.max(0, 90000 - (this.endsAt - this.serverNow())) / 18000);
      if (!this._gemC || this._gemC.ep !== ep) {
        const list = [];
        for (let i = 0; i < 16; i++) {
          const p = this.freeSpot(mulberry32(((this.seed * 31) + ep * 7001 + i * 977) >>> 0));
          list.push({ key: ep + '_' + i, x: p.x, y: p.y, gold: i % 5 === 0 });
        }
        if (this._gemC) this.onFeed('💎 جواهر جديدة ظهرت في الخريطة!');
        this._gemC = { ep, list };
      }
      return this._gemC.list;
    },
    zoneInfo() {
      if (this.mode !== 'zone') return null;
      const idx = Math.floor(Math.max(0, this.endsAt - this.serverNow()) / 15000);
      if (!this.zoneCache || this.zoneCache.idx !== idx) {
        const rnd = mulberry32(((this.seed * 7919) + idx * 104729) >>> 0);
        const p = this.freeSpot(rnd);
        if (this.zoneCache) this.onFeed('🎯 منطقة السيطرة اتنقلت!');
        this.zoneCache = { idx, x: p.x, y: p.y, r: 140 };
      }
      return this.zoneCache;
    },

    burst(x, y, color, n, spd) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = (spd || 160) * (0.35 + Math.random() * 0.9);
        this.fx.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.45 + Math.random() * 0.35, age: 0, c: color, r: 2 + Math.random() * 3 });
      }
      if (this.fx.length > 260) this.fx.splice(0, this.fx.length - 260);
    },

    shoot() {
      const now = performance.now();
      const rapid = this.weapon === 'rapid' && now < this.weaponUntil;
      const triple = this.weapon === 'triple' && now < this.weaponUntil;
      const shotgun = this.weapon === 'shotgun' && now < this.weaponUntil;
      if (now - this.lastFire < (rapid ? 130 : shotgun ? 520 : FIRE_COOLDOWN) * Math.pow(0.85, this.up.rate) || !this.myAlive) return;
      this.lastFire = now; this.rs.shots++;
      const angs = shotgun ? [-0.4, -0.2, 0, 0.2, 0.4] : triple ? [-0.22, 0, 0.22] : [0];
      if (shotgun) { this.shakeUntil = Math.max(this.shakeUntil, now + 120); this.burst(this.myX + Math.cos(this.myAngle) * 30, this.myY + Math.sin(this.myAngle) * 30, '#ffa502', 10, 260); }
      angs.forEach((off, k) => {
        const a = this.myAngle + off + (shotgun ? (Math.random() - 0.5) * 0.08 : 0);
        const id = this.me.uid.slice(0, 4) + '_' + now + '_' + k + Math.floor(Math.random() * 999);
        const dx = Math.cos(a), dy = Math.sin(a);
        const bx = this.myX + dx * (PLAYER_R + 6), by = this.myY + dy * (PLAYER_R + 6);
        this.bullets.push({ id, uid: this.me.uid, x: bx, y: by, dx, dy, age: 0, life: shotgun ? 0.5 : 0 });
        this.db.ref('rooms/' + this.roomCode + '/events').push({
          t: 'shoot', id, uid: this.me.uid,
          x: Math.round(bx), y: Math.round(by),
          dx: Math.round(dx * 1000) / 1000, dy: Math.round(dy * 1000) / 1000, l: shotgun ? 0.5 : 0,
          ts: firebase.database.ServerValue.TIMESTAMP,
        }).catch(() => {});
      });
      this.muzzleUntil = performance.now() + 70;
      Sfx.shoot(0.5);
    },

    die(killerUid) {
      if (!this.myAlive) return;
      this.myAlive = false;
      this.myHp = 0;
      this.deaths = (this.deaths || 0) + 1;
      this.respawnAt = performance.now() + RESPAWN_SEC * 1000;
      const ref = this.db.ref('rooms/' + this.roomCode + '/players/' + this.me.uid);
      ref.update({ alive: false, hp: 0, deaths: this.deaths }).catch(() => {});
      if (killerUid === 'storm') {
        this.onFeed('🌪️ العاصفة قتلتك');
      } else if (killerUid === 'lava') {
        this.onFeed('🌋 الحمم قتلتك');
      } else if (killerUid && String(killerUid).indexOf('bot') === 0) {
        this.onFeed('☠️ قتلك بوت');
      } else if (killerUid && killerUid !== this.me.uid) {
        this.db.ref('rooms/' + this.roomCode + '/players/' + killerUid + '/kills')
          .transaction((k) => (k || 0) + 1).catch(() => {});
        this.db.ref('rooms/' + this.roomCode + '/events').push({
          t: 'kill', by: killerUid, target: this.me.uid,
          ts: firebase.database.ServerValue.TIMESTAMP,
        }).catch(() => {});
      }
      this.showRespawn();
    },

    showRespawn() {
      const ov = document.getElementById('respawn-overlay');
      const cnt = document.getElementById('respawn-count');
      ov.classList.remove('hidden');
      const iv = setInterval(() => {
        const left = Math.ceil((this.respawnAt - performance.now()) / 1000);
        if (left <= 0 || this.myAlive) { clearInterval(iv); ov.classList.add('hidden'); return; }
        cnt.textContent = left;
      }, 200);
    },

    // ============ المدخلات ============
    bindInput() {
      this._kd = (e) => { this.keys[e.key.toLowerCase()] = true; if (e.key === ' ' || e.key === 'Shift') this.dash(); if (e.key === ' ') e.preventDefault(); if (e.key === 'g' || e.key === 'G') this.throwGrenade(); };
      this._ku = (e) => { this.keys[e.key.toLowerCase()] = false; };
      this._mm = (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; };
      this._md = (e) => { if (e.target.id === 'game-canvas' && !this.myAlive) this.specIdx++; if (e.target.id === 'game-canvas') { this.mouse.down = true; this.mouse.x = e.clientX; this.mouse.y = e.clientY; const wx = this.cam.x + e.clientX, wy = this.cam.y + e.clientY; this.myAngle = Math.atan2(wy - this.myY, wx - this.myX); this.shoot(); } };
      this._mu = () => { this.mouse.down = false; };
      window.addEventListener('keydown', this._kd);
      window.addEventListener('keyup', this._ku);
      window.addEventListener('mousemove', this._mm);
      window.addEventListener('mousedown', this._md);
      window.addEventListener('mouseup', this._mu);

      if ('ontouchstart' in window) {
        document.getElementById('joystick-left').style.display = 'block';
        document.getElementById('joystick-right').style.display = 'block';
        this.bindJoystick('joystick-left', this.joyL);
        this.bindJoystick('joystick-right', this.joyR);
      }
    },

    bindJoystick(elId, joy) {
      const el = document.getElementById(elId);
      const knob = el.querySelector('.joystick-knob');
      const move = (t) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let dx = t.clientX - cx, dy = t.clientY - cy;
        const len = Math.hypot(dx, dy), max = 44;
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        joy.dx = dx / max; joy.dy = dy / max;
        knob.style.transform = `translate(${dx}px,${dy}px)`;
      };
      el._ts = (e) => { e.preventDefault(); joy.active = true; joy.id = e.changedTouches[0].identifier; move(e.changedTouches[0]); };
      el._tm = (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) if (t.identifier === joy.id) move(t);
      };
      el._te = (e) => {
        for (const t of e.changedTouches) if (t.identifier === joy.id) {
          joy.active = false; joy.dx = 0; joy.dy = 0; joy.id = null;
          knob.style.transform = '';
        }
      };
      el.addEventListener('touchstart', el._ts, { passive: false });
      el.addEventListener('touchmove', el._tm, { passive: false });
      el.addEventListener('touchend', el._te);
      el.addEventListener('touchcancel', el._te);
    },

    unbindInput() {
      window.removeEventListener('keydown', this._kd);
      window.removeEventListener('keyup', this._ku);
      window.removeEventListener('mousemove', this._mm);
      window.removeEventListener('mousedown', this._md);
      window.removeEventListener('mouseup', this._mu);
      ['joystick-left', 'joystick-right'].forEach((id) => {
        const el = document.getElementById(id);
        el.style.display = 'none';
        el.removeEventListener('touchstart', el._ts);
        el.removeEventListener('touchmove', el._tm);
        el.removeEventListener('touchend', el._te);
        el.removeEventListener('touchcancel', el._te);
      });
      const ov = document.getElementById('respawn-overlay');
      if (ov) ov.classList.add('hidden');
    },

    // ============ حلقة اللعبة ============
    tick(dt) {
      if (this.ended) return;

      // نهاية الجولة
      if (this.endsAt && this.serverNow() >= this.endsAt) {
        if (this.host) this.finishRound();
        return;
      }

      // الهوست دايمًا أقدم لاعب موجود — لو الأساسي قفل، اللي بعده يمسك
      let bestJ = this.me.joinedAt || Infinity, hostUid = bestJ === Infinity ? null : this.me.uid;
      for (const uid in this.players) {
        const j = this.players[uid].joinedAt || Infinity;
        if (j < bestJ) { bestJ = j; hostUid = uid; }
      }
      if (hostUid) this.host = hostUid === this.me.uid;

      // الهوست يزرع قدرات كل ٢٠ ثانية (بحد أقصى ٣): صحة / تسريع / درع
      if (this.host) {
        const nowS = this.serverNow();
        if (nowS - this.lastPickupSpawn >= 20000 && Object.keys(this.pickups).length < 3) {
          this.lastPickupSpawn = nowS;
          const rnd = mulberry32(((nowS & 0x7fffffff) >>> 0) ^ this.seed);
          const p = this.freeSpot(rnd);
          const types = ['hp', 'speed', 'shield', 'rapid', 'triple', 'shotgun'];
          const type = types[Math.floor(rnd() * types.length)];
          this.db.ref('rooms/' + this.roomCode + '/pickups').push({ x: Math.round(p.x), y: Math.round(p.y), t: type }).catch(() => {});
        }
      }

      // الريسبون
      if (!this.myAlive && performance.now() >= this.respawnAt) {
        const rnd = mulberry32(Date.now() & 0xffff);
        let p = this.freeSpot(rnd);
        const stR = this.stormInfo();
        if (stR) { for (let tr = 0; tr < 30; tr++) { const an = rnd() * 6.283, rr = rnd() * stR.r * 0.8; const cx = clamp(stR.x + Math.cos(an) * rr, 80, WORLD - 80), cy = clamp(stR.y + Math.sin(an) * rr, 80, WORLD - 80); if (!this.obstacles.some((o) => circleRect(cx, cy, PLAYER_R + 8, o))) { p = { x: cx, y: cy }; break; } } }
        this.myX = p.x; this.myY = p.y; this.myHp = MAX_HP; this.myAlive = true;
        this.protectedUntil = performance.now() + 2000; // حماية ثانيتين بعد الريسبون
        this.db.ref('rooms/' + this.roomCode + '/players/' + this.me.uid)
          .update({ x: Math.round(p.x), y: Math.round(p.y), hp: MAX_HP, alive: true }).catch(() => {});
        document.getElementById('respawn-overlay').classList.add('hidden');
      }

      // الحركة
      if (this.myAlive) {
        let mx = 0, my = 0;
        if (this.keys['w'] || this.keys['arrowup']) my -= 1;
        if (this.keys['s'] || this.keys['arrowdown']) my += 1;
        if (this.keys['a'] || this.keys['arrowleft']) mx -= 1;
        if (this.keys['d'] || this.keys['arrowright']) mx += 1;
        if (this.joyL.active) { mx = this.joyL.dx; my = this.joyL.dy; }
        const dashing = performance.now() < this.dashUntil;
        if (dashing) { mx = this.dashX; my = this.dashY; }
        const onIce = (this.hazards || []).some((h) => h.type === 'ice' && Math.hypot(this.myX - h.x, this.myY - h.y) < h.r);
        if (onIce && !dashing) { const kk = Math.min(1, dt * 1.8); this.smx = (this.smx || 0) + (mx - (this.smx || 0)) * kk; this.smy = (this.smy || 0) + (my - (this.smy || 0)) * kk; mx = this.smx; my = this.smy; if (Math.random() < 0.15) this.burst(this.myX, this.myY, '#cfefff', 1, 40); } else { this.smx = mx; this.smy = my; }
        const len = Math.hypot(mx, my);
        if (len > 0.01) {
          if (len > 1) { mx /= len; my /= len; }
          const spd = dashing ? SPEED * 4.2 : performance.now() < this.speedUntil ? SPEED * 1.4 * (1 + 0.1 * this.up.spd) : SPEED * (1 + 0.1 * this.up.spd);
          let nx = this.myX + mx * spd * dt;
          let ny = this.myY + my * spd * dt;
          if (dashing && Math.random() < 0.7) this.burst(this.myX, this.myY, '#7bdff2', 2, 60);
          nx = Math.max(PLAYER_R, Math.min(WORLD - PLAYER_R, nx));
          ny = Math.max(PLAYER_R, Math.min(WORLD - PLAYER_R, ny));
          // اصطدام بالحواجز
          for (const o of this.obstacles) {
            if (circleRect(nx, ny, PLAYER_R, o)) {
              // جرب محور واحد
              if (!circleRect(nx, this.myY, PLAYER_R, o)) { ny = this.myY; }
              else if (!circleRect(this.myX, ny, PLAYER_R, o)) { nx = this.myX; }
              else { nx = this.myX; ny = this.myY; }
            }
          }
          this.myX = nx; this.myY = ny;
          if (Math.random() < 0.55) this.fx.push({ x: nx, y: ny, vx: 0, vy: 0, life: 0.7, age: 0, c: PALETTE[(this.me.color || 0) % PALETTE.length], r: 6 });
        }

        // التصويب
        if (this.joyR.active && Math.hypot(this.joyR.dx, this.joyR.dy) > 0.25) {
          this.myAngle = Math.atan2(this.joyR.dy, this.joyR.dx);
          this.shoot();
        } else if (!('ontouchstart' in window) || this.mouse.down) {
          // بالماوس: حوّل لإحداثيات العالم
          const wx = this.cam.x + this.mouse.x, wy = this.cam.y + this.mouse.y;
          this.myAngle = Math.atan2(wy - this.myY, wx - this.myX);
          if (this.mouse.down || this.keys[' ']) this.shoot();
        }
      }

      this.updateMovers();

      // الطلقات
      const db2 = document.getElementById('btn-dash');
      if (db2) {
        const cdl = Math.ceil((this.dashCd - performance.now()) / 1000);
        db2.textContent = cdl > 0 ? '💨 ' + cdl : '💨';
        db2.style.opacity = cdl > 0 ? '0.45' : '1';
      }

      if (this.myAlive) {
        const inLava = (this.hazards || []).some((h) => h.type === 'lava' && Math.hypot(this.myX - h.x, this.myY - h.y) < h.r);
        if (inLava && performance.now() > this.protectedUntil) {
          if (!this.wasLava) { this.wasLava = true; this.onFeed('🌋 حمم! اخرج بسرعة'); }
          this.lavaAcc = (this.lavaAcc || 0) + dt;
          if (this.lavaAcc >= 0.4) {
            this.lavaAcc -= 0.4; this.myHp -= 5; this.onHud(this.myHp); this.writeSelf(true);
            this.burst(this.myX, this.myY, '#ff6b35', 8, 200); this.hitFlashUntil = performance.now() + 150;
            if (this.myHp <= 0) { this.burst(this.myX, this.myY, '#ffd32a', 30, 320); this.die('lava'); }
          }
        } else if (!inLava) { this.wasLava = false; }
      }

      const st = this.stormInfo();
      this.inStorm = false;
      if (st && this.myAlive) {
        this.inStorm = Math.hypot(this.myX - st.x, this.myY - st.y) > st.r;
        if (this.inStorm && performance.now() > this.protectedUntil) {
          if (!this.wasStorm) { this.wasStorm = true; this.onFeed('🌪️ انت برّه الدايرة! ارجع جوّه'); }
          this.stormAcc = (this.stormAcc || 0) + dt;
          if (this.stormAcc >= 0.5) {
            this.stormAcc -= 0.5; Sfx.tick(); this.myHp -= 4; this.onHud(this.myHp); this.writeSelf(true);
            this.burst(this.myX, this.myY, '#c0392b', 6, 160); this.hitFlashUntil = performance.now() + 150;
            if (this.myHp <= 0) { this.burst(this.myX, this.myY, '#ffd32a', 30, 320); this.die('storm'); }
          }
        } else if (!this.inStorm) { this.wasStorm = false; }
      }

      // صيد الجواهر
      if (this.mode === 'gems' && this.myAlive) {
        for (const gm of this.gemList()) {
          if (this.gemTaken[gm.key]) continue;
          if (Math.hypot(this.myX - gm.x, this.myY - gm.y) < 36) {
            this.gemTaken[gm.key] = true; this.zpts = (this.zpts || 0) + (gm.gold ? 5 : 1);
            this.burst(gm.x, gm.y, gm.gold ? '#ffd32a' : '#18dcff', 12, 200); if (Sfx.pick) Sfx.pick();
            if (gm.gold) this.onFeed('💎 جوهرة دهبية! +٥');
            this.writeSelf(true);
          }
        }
      }
      // منطقة السيطرة: نقطة كل ثانية وانت جواها
      const zn = this.zoneInfo();
      if (zn && this.myAlive && Math.hypot(this.myX - zn.x, this.myY - zn.y) < zn.r) {
        this.zoneAcc += dt;
        if (this.zoneAcc >= 1) { this.zoneAcc -= 1; this.zpts = (this.zpts || 0) + 1; this.ach('zone', this.zpts); this.writeSelf(true); }
      }

      // بوتات التدريب: بتظهر بس لما تكون لوحدك في الغرفة
      const nowB = performance.now();
      if (nowB >= this.botCheckAt) {
        this.botCheckAt = nowB + 1000;
        const humans = Object.keys(this.players).length;
        if (humans === 0 && this.bots.length === 0) {
          this.spawnWave(nowB);
          if (!this.botAnnounced) { this.botAnnounced = true; this.onFeed('🌊 انت لوحدك: وضع الموجات! اصمد قد ما تقدر'); this.waveBanner = { text: '🌊 الموجة ١', until: nowB + 2200 }; }
        } else if (humans > 0 && this.bots.length) {
          this.bots = []; this.upDone = false; this.pickWait = false; this.hideUpgrades();
          this.onFeed('👥 لاعب حقيقي دخل: البوتات خرجت');
        }
      }
      if (this.bots.length && this.bots.every((q) => !q.alive)) {
        if (!this.waveAt) { this.waveAt = nowB + 2500; this.onFeed('🌊 الموجة ' + this.wave + ' خلصت! +٣٠ صحة'); Sfx.kill(); this.ach('wave', this.wave); try { const bw = +(localStorage.getItem('arena_bestwave') || 0); if (this.wave > bw) localStorage.setItem('arena_bestwave', String(this.wave)); } catch (err) { /* ignore */ } }
        else if (nowB >= this.waveAt && !this.upDone) { this.upDone = true; this.pickWait = true; this.showUpgrades(); }
        else if (nowB >= this.waveAt && !this.pickWait) {
          this.wave++; this.waveAt = 0; this.upDone = false;
          if (this.myAlive) { this.myHp = Math.min(MAX_HP, this.myHp + 30); this.onHud(this.myHp); this.writeSelf(true); }
          this.spawnWave(nowB);
          this.waveBanner = { text: '🌊 الموجة ' + this.wave + ' (' + this.bots.length + ' بوتات)', until: nowB + 2400 };
        }
      }
      let lvl = BOT_LEVELS.normal;
      try { lvl = BOT_LEVELS[localStorage.getItem('arena_bot_diff')] || BOT_LEVELS.normal; } catch (err) { /* ignore */ }
      for (const bt of this.bots) {
        if (!bt.alive) {
          continue;
        }
        const dxm = this.myX - bt.x, dym = this.myY - bt.y, dist = Math.hypot(dxm, dym) || 1;
        const tx = this.myAlive ? dxm / dist : Math.cos(bt.phase), ty = this.myAlive ? dym / dist : Math.sin(bt.phase);
        bt.angle = Math.atan2(ty, tx);
        let mvx = 0, mvy = 0;
        if (dist > 380) { mvx = tx; mvy = ty; }
        else if (dist < 220) { mvx = -tx; mvy = -ty; }
        else { const s = Math.sin(nowB / 900 + bt.phase) > 0 ? 1 : -1; mvx = -ty * s; mvy = tx * s; }
        const stB = this.stormInfo();
        if (stB && Math.hypot(bt.x - stB.x, bt.y - stB.y) > stB.r - 20) {
          const dd = Math.hypot(stB.x - bt.x, stB.y - bt.y) || 1; mvx = (stB.x - bt.x) / dd; mvy = (stB.y - bt.y) / dd;
          if (Math.hypot(bt.x - stB.x, bt.y - stB.y) > stB.r) { bt.hp -= 8 * dt; if (Math.random() < 0.1) this.burst(bt.x, bt.y, '#c0392b', 2, 80); if (bt.hp <= 0) { bt.alive = false; bt.respawnAt = performance.now() + 3000; this.burst(bt.x, bt.y, '#ffd32a', 28, 300); this.onFeed('🌪️ العاصفة قضت على ' + bt.name); continue; } }
        }
        for (const hz of (this.hazards || [])) {
          if (hz.type !== 'lava') continue;
          const hd = Math.hypot(bt.x - hz.x, bt.y - hz.y);
          if (hd < hz.r + 40) { const hh = hd || 1; mvx = (bt.x - hz.x) / hh; mvy = (bt.y - hz.y) / hh; }
          if (hd < hz.r) { bt.hp -= 12 * dt; if (Math.random() < 0.15) this.burst(bt.x, bt.y, '#ff6b35', 2, 100); if (bt.hp <= 0) { bt.alive = false; bt.respawnAt = performance.now() + 3000; this.burst(bt.x, bt.y, '#ffd32a', 28, 300); this.onFeed('🌋 الحمم قضت على ' + bt.name); break; } }
        }
        if (!bt.alive) continue;
        if (bt.boss3 && nowB >= bt.nextTp && this.myAlive) {
          bt.nextTp = nowB + 5000;
          this.rings.push({ x: bt.x, y: bt.y, age: 0, life: 0.5, R: 80 }); this.burst(bt.x, bt.y, '#18dcff', 18, 260);
          const ta = Math.random() * 6.283, tp = { x: clamp(this.myX + Math.cos(ta) * 320, 80, WORLD - 80), y: clamp(this.myY + Math.sin(ta) * 320, 80, WORLD - 80) };
          if (!this.obstacles.some((o) => circleRect(tp.x, tp.y, PLAYER_R + 6, o))) { bt.x = tp.x; bt.y = tp.y; }
          this.rings.push({ x: bt.x, y: bt.y, age: 0, life: 0.5, R: 80 }); this.burst(bt.x, bt.y, '#18dcff', 18, 260); Sfx.boom();
          if (this.bots.filter((q) => q.alive).length < 12) {
            for (let m = 0; m < 2; m++) { const sp = this.freeSpot(mulberry32((Date.now() & 0xffff) + m * 51)); this.bots.push({ id: 'botm' + Math.floor(nowB) + m, name: '👻 تابع', x: sp.x, y: sp.y, hp: 50, alive: true, angle: 0, lastFire: nowB + 1500, respawnAt: 0, phase: Math.random() * 6, color: 6 }); }
            this.onFeed('🌀 الشبح استدعى تابعين!');
          }
        }
        if (bt.boss2 && nowB >= bt.nextBurst && this.myAlive) {
          bt.nextBurst = nowB + 4000;
          for (let q = 0; q < 14; q++) { const a3 = (q / 14) * Math.PI * 2 + nowB / 1000; this.bullets.push({ id: bt.id + '_r' + Math.floor(nowB) + '_' + q, uid: bt.id, x: bt.x + Math.cos(a3) * 30, y: bt.y + Math.sin(a3) * 30, dx: Math.cos(a3), dy: Math.sin(a3), age: 0, life: 1.4 }); }
          this.rings.push({ x: bt.x, y: bt.y, age: 0, life: 0.5, R: 90 });
          this.burst(bt.x, bt.y, '#a55eea', 20, 320); Sfx.boom();
        }
        let nx = clamp(bt.x + mvx * lvl.spd * dt, PLAYER_R, WORLD - PLAYER_R), ny = clamp(bt.y + mvy * lvl.spd * dt, PLAYER_R, WORLD - PLAYER_R);
        for (const o of this.obstacles) {
          if (circleRect(nx, ny, PLAYER_R, o)) {
            if (!circleRect(nx, bt.y, PLAYER_R, o)) ny = bt.y;
            else if (!circleRect(bt.x, ny, PLAYER_R, o)) nx = bt.x;
            else { nx = bt.x; ny = bt.y; bt.phase += 2; }
          }
        }
        bt.x = nx; bt.y = ny;
        if (this.myAlive && dist < 650 && nowB - bt.lastFire > lvl.fire) {
          bt.lastFire = nowB + Math.random() * 500;
          const a = bt.angle + (Math.random() - 0.5) * lvl.err;
          (bt.boss ? [-0.25, 0, 0.25] : [0]).forEach((off, q) => { const a2 = a + off; this.bullets.push({ id: bt.id + '_' + Math.floor(nowB) + '_' + q, uid: bt.id, x: bt.x + Math.cos(a2) * (PLAYER_R + 6), y: bt.y + Math.sin(a2) * (PLAYER_R + 6), dx: Math.cos(a2), dy: Math.sin(a2), age: 0 }); });
        }
      }

      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        b.x += b.dx * BULLET_SPEED * dt;
        b.y += b.dy * BULLET_SPEED * dt;
        b.age += dt;
        let dead = b.age > (b.life || BULLET_LIFE) || b.x < 0 || b.x > WORLD || b.y < 0 || b.y > WORLD;
        if (!dead) {
          for (const br of this.barrels) {
            if (!br.dead && Math.hypot(b.x - br.x, b.y - br.y) < 26) {
              dead = true; br.hp--; this.burst(br.x, br.y, '#ff9f43', 6, 160);
              if (br.hp <= 0) this.explodeBarrel(br);
              break;
            }
          }
        }
        if (!dead) {
          for (const o of this.obstacles) {
            if (b.x > o.x && b.x < o.x + o.w && b.y > o.y && b.y < o.y + o.h) { dead = true; break; }
          }
        }
        if (!dead && b.uid === this.me.uid) {
          for (const bt of this.bots) {
            if (bt.alive && Math.hypot(b.x - bt.x, b.y - bt.y) < PLAYER_R + 4) {
              dead = true; this.rs.hits++;
              bt.hp -= BULLET_DMG * (1 + 0.25 * this.up.dmg);
              if (this.up.steal && this.myAlive) { this.myHp = Math.min(MAX_HP, this.myHp + 2 * this.up.steal); this.onHud(this.myHp); }
              this.burst(bt.x, bt.y, '#ff6b81', 8, 180);
              if (bt.hp <= 0) {
                bt.alive = false; bt.respawnAt = performance.now() + 3000;
                this.burst(bt.x, bt.y, '#ffd32a', 28, 300);
                this.onFeed('🤖 قضيت على ' + bt.name);
                Sfx.kill();
                this.ach('kill');
                this.db.ref('rooms/' + this.roomCode + '/players/' + this.me.uid + '/kills').transaction((k) => (k || 0) + 1).catch(() => {});
              }
              break;
            }
          }
        }
        // إصابتي أنا (كل جهاز مسؤول عن لاعبه) — الدرع والحماية بيصدّوا
        if (!dead && b.uid !== this.me.uid && this.myAlive && performance.now() > this.protectedUntil) {
          if (performance.now() < this.shieldUntil) {
            if (Math.hypot(b.x - this.myX, b.y - this.myY) < PLAYER_R + 4) {
              dead = true;
              this.onFeed('🛡️ الدرع صدّ طلقة!');
            }
          } else if (Math.hypot(b.x - this.myX, b.y - this.myY) < PLAYER_R + 4) {
            dead = true;
            this.myHp -= BULLET_DMG * (String(b.uid).indexOf('bot') === 0 ? Math.pow(0.82, this.up.arm) : 1);
            this.onHud(this.myHp);
            this.writeSelf(true);
            this.db.ref('rooms/' + this.roomCode + '/events').push({
              t: 'hit', bulletId: b.id, target: this.me.uid, by: b.uid,
              ts: firebase.database.ServerValue.TIMESTAMP,
            }).catch(() => {});
            Sfx.hit();
            this.shakeUntil = performance.now() + 220;
            this.burst(this.myX, this.myY, '#ff4757', 10, 200);
            if (this.myHp <= 0) { this.burst(this.myX, this.myY, '#ffd32a', 30, 320); this.die(b.uid); }
          }
        }
        if (dead) { if (b.age <= (b.life || BULLET_LIFE)) this.burst(b.x, b.y, '#ffd32a', 4, 90); this.bullets.splice(i, 1); }
      }

      // تنعيم حركة اللاعبين التانيين
      for (const uid in this.players) {
        const p = this.players[uid];
        if (typeof p.tx === 'number') {
          p.x = (p.x === undefined ? p.tx : p.x + (p.tx - p.x) * Math.min(1, dt * 12));
          p.y = (p.y === undefined ? p.ty : p.y + (p.ty - p.y) * Math.min(1, dt * 12));
        }
      }

      // الكاميرا
      for (let i = this.gren.length - 1; i >= 0; i--) {
        const q = this.gren[i];
        q.age += dt;
        const p = Math.min(1, q.age / 0.8);
        q.x = q.sx + (q.tx - q.sx) * p; q.y = q.sy + (q.ty - q.sy) * p; q.h = Math.sin(p * Math.PI) * 60;
        if (q.age >= 0.8) { this.gren.splice(i, 1); this.explodeGrenade(q); }
      }
      for (let i = this.rings.length - 1; i >= 0; i--) { this.rings[i].age += dt; if (this.rings[i].age >= this.rings[i].life) this.rings.splice(i, 1); }
      const gb = document.getElementById('btn-gren');
      if (gb) { const gc = Math.ceil((this.grenCd - performance.now()) / 1000); gb.textContent = gc > 0 ? '💣 ' + gc : '💣'; gb.style.opacity = gc > 0 ? '0.45' : '1'; }
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        f.age += dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy *= 0.92;
        if (f.age >= f.life) this.fx.splice(i, 1);
      }
      // المشاهدة بعد الموت: الكاميرا تتبع لاعب حي
      let camX = this.myX, camY = this.myY;
      this.specName = '';
      if (!this.myAlive) {
        const alive = Object.keys(this.players).filter((u) => this.players[u].alive && this.players[u].x !== undefined);
        const liveBots = this.bots.filter((x) => x.alive);
        if (!alive.length && liveBots.length) {
          const bb = liveBots[this.specIdx % liveBots.length];
          camX = bb.x; camY = bb.y; this.specName = bb.name;
        } else if (alive.length) {
          const u = alive[this.specIdx % alive.length];
          camX = this.players[u].x; camY = this.players[u].y; this.specName = this.players[u].name || 'لاعب';
        }
      }
      this.cam.x = clamp(camX - innerWidth / 2, 0, WORLD - innerWidth);
      this.cam.y = clamp(camY - innerHeight / 2, 0, WORLD - innerHeight);
      if (WORLD < innerWidth) this.cam.x = (WORLD - innerWidth) / 2;
      if (WORLD < innerHeight) this.cam.y = (WORLD - innerHeight) / 2;

      // ابعت موقعي
      if (this.myAlive) this.writeSelf(false);

      // التقاط القدرات
      if (this.myAlive) {
        for (const pid in this.pickups) {
          const pk = this.pickups[pid];
          const pdx = pk.x - this.myX, pdy = pk.y - this.myY;
          if (pdx * pdx + pdy * pdy >= (PLAYER_R + 16) * (PLAYER_R + 16)) continue;
          const type = pk.t || 'hp';
          if (type === 'hp') {
            if (this.myHp >= MAX_HP) continue; // بلاش نهدّر العلبة واحنا مليانين
            this.myHp = Math.min(MAX_HP, this.myHp + 50);
            this.onFeed('💊 التقطت علبة صحة (+٥٠)');
          } else if (type === 'speed') {
            this.speedUntil = performance.now() + 8000;
            this.onFeed('👟 تسريع ٨ ثواني!');
          } else if (type === 'rapid') {
            this.weapon = 'rapid'; this.weaponUntil = performance.now() + 10000;
            this.onFeed('🔫 رشاش ١٠ ثواني!');
          } else if (type === 'triple') {
            this.weapon = 'triple'; this.weaponUntil = performance.now() + 10000;
            this.onFeed('🔱 طلقة ثلاثية ١٠ ثواني!');
          } else if (type === 'shotgun') {
            this.weapon = 'shotgun'; this.weaponUntil = performance.now() + 10000;
            this.onFeed('💥 شوتجن ١٠ ثواني! ٥ طلقات في الضربة');
          } else if (type === 'shield') {
            this.shieldUntil = performance.now() + 5000;
            this.onFeed('🛡️ درع ٥ ثواني!');
          }
          this.ach('pickup'); this.rs.pick++;
          this.db.ref('rooms/' + this.roomCode + '/pickups/' + pid).remove().catch(() => {});
          this.writeSelf(true);
          break;
        }
      }

      // حدّث الواجهة
      const left = Math.max(0, this.endsAt - this.serverNow());
      const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
      document.getElementById('hud-timer').textContent = `${mm}:${String(ss).padStart(2, '0')}`;
      document.getElementById('hud-kills').textContent = this.kills || 0;
      document.getElementById('hud-deaths').textContent = this.deaths || 0;
      document.getElementById('hud-hp-fill').style.width = Math.max(0, this.myHp) + '%';
      document.getElementById('hud-hp').classList.toggle('low', this.myAlive && this.myHp < 30);
      // وميض الإصابة لما دمّي يقل
      if (this.lastHpShown !== null && this.myHp < this.lastHpShown) this.hitFlashUntil = performance.now() + 220;
      this.lastHpShown = this.myHp;

      let aliveCount = this.myAlive ? 1 : 0;
      for (const uid in this.players) if (this.players[uid].alive) aliveCount++;
      const aliveEl = document.getElementById('hud-alive-n');
      if (aliveEl) aliveEl.textContent = aliveCount;
    },

    finishRound() {
      if (this.ended) return;
      this.ended = true;
      // الهوست بيغيّر الحالة — الكل هيسمع ويطلع للنتائج
      this.db.ref('rooms/' + this.roomCode + '/meta').update({ state: 'ended' }).catch(() => {});
      this.db.ref('rooms/' + this.roomCode + '/pickups').remove().catch(() => {});
    },

    collectResults() {
      const rows = [];
      for (const uid in this.players) {
        const p = this.players[uid];
        rows.push({ uid, name: p.name, avatar: p.avatar, kills: p.kills || 0, deaths: p.deaths || 0, zpts: p.zpts || 0 });
      }
      // أضفني أنا
      rows.push({ uid: this.me.uid, name: this.me.name, avatar: this.me.avatar, kills: this.kills || 0, deaths: this.deaths || 0, zpts: this.zpts || 0 });
      if (this.mode === 'zone' || this.mode === 'gems') rows.sort((a, b) => b.zpts - a.zpts || b.kills - a.kills);
      else rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      return rows;
    },

    // ============ الرسم ============
    draw() {
      const ctx = this.ctx, dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // الخلفية
      const g = ctx.createLinearGradient(0, 0, 0, innerHeight);
      g.addColorStop(0, this.theme.bg0); g.addColorStop(1, this.theme.bg1);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      ctx.save();
      let shx = 0, shy = 0;
      if (performance.now() < this.shakeUntil) { shx = (Math.random() - 0.5) * 9; shy = (Math.random() - 0.5) * 9; }
      ctx.translate(-this.cam.x + shx, -this.cam.y + shy);

      // أرضية الساحة: دايرة مركزية وتوهّج الأركان
      const cg = ctx.createRadialGradient(WORLD / 2, WORLD / 2, 40, WORLD / 2, WORLD / 2, 520);
      cg.addColorStop(0, 'rgba(165,94,234,0.16)'); cg.addColorStop(1, 'rgba(165,94,234,0)');
      ctx.fillStyle = cg; ctx.fillRect(WORLD / 2 - 540, WORLD / 2 - 540, 1080, 1080);
      ctx.strokeStyle = 'rgba(165,94,234,0.35)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(WORLD / 2, WORLD / 2, 260, 0, Math.PI * 2); ctx.stroke();
      const corners = [[0, 0, '#ff4757'], [WORLD, 0, '#1e90ff'], [0, WORLD, '#2ed573'], [WORLD, WORLD, '#ffa502']];
      corners.forEach((c) => {
        const gg = ctx.createRadialGradient(c[0], c[1], 10, c[0], c[1], 360);
        gg.addColorStop(0, c[2] + '55'); gg.addColorStop(1, c[2] + '00');
        ctx.fillStyle = gg; ctx.fillRect(c[0] - 360, c[1] - 360, 720, 720);
      });

      // شبكة
      ctx.strokeStyle = 'rgba(255,255,255,0.045)';
      ctx.lineWidth = 1;
      const gs = 110;
      for (let x = 0; x <= WORLD; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD); ctx.stroke(); }
      for (let y = 0; y <= WORLD; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD, y); ctx.stroke(); }
      // حدود العالم
      ctx.strokeStyle = 'rgba(255,71,87,0.5)';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, WORLD, WORLD);
      const stm = this.stormInfo();
      if (stm) {
        ctx.fillStyle = 'rgba(170,20,30,0.30)';
        ctx.beginPath(); ctx.rect(-2000, -2000, WORLD + 4000, WORLD + 4000); ctx.arc(stm.x, stm.y, stm.r, 0, Math.PI * 2, true); ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(255,90,90,' + (0.7 + 0.3 * Math.sin(performance.now() / 200)) + ')'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(stm.x, stm.y, stm.r, 0, Math.PI * 2); ctx.stroke();
      }

      for (const h of (this.hazards || [])) {
        const tt = performance.now() / 1000;
        const gr = ctx.createRadialGradient(h.x, h.y, 10, h.x, h.y, h.r);
        if (h.type === 'lava') {
          const pl = 0.75 + 0.25 * Math.sin(tt * 3 + h.x);
          gr.addColorStop(0, 'rgba(255,210,60,' + pl + ')'); gr.addColorStop(0.55, 'rgba(255,90,30,' + (0.8 * pl) + ')'); gr.addColorStop(1, 'rgba(120,10,0,0.25)');
        } else {
          gr.addColorStop(0, 'rgba(235,250,255,0.55)'); gr.addColorStop(0.7, 'rgba(150,220,255,0.35)'); gr.addColorStop(1, 'rgba(150,220,255,0.12)');
        }
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = h.type === 'lava' ? 'rgba(255,120,40,0.8)' : 'rgba(220,245,255,0.7)'; ctx.lineWidth = 3; ctx.stroke();
      }

      // الحواجز
      for (const o of this.obstacles) {
        ctx.fillStyle = o.mv ? '#7d3c98' : this.theme.ob;
        roundRect(ctx, o.x, o.y, o.w, o.h, 10);
        ctx.fill();
        if (o.mv) { ctx.fillStyle = 'rgba(255,211,42,0.55)'; const stripes = Math.floor((o.w > o.h ? o.w : o.h) / 30); for (let s = 0; s < stripes; s++) { if (o.w > o.h) ctx.fillRect(o.x + 8 + s * 30, o.y + 6, 12, o.h - 12); else ctx.fillRect(o.x + 6, o.y + 8 + s * 30, o.w - 12, 12); } }
        ctx.strokeStyle = o.mv ? '#ffd32a' : this.theme.obs;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (this.mode === 'gems') {
        const tt = performance.now() / 400;
        for (const gm of this.gemList()) {
          if (this.gemTaken[gm.key]) continue;
          const bob = Math.sin(tt + gm.x) * 3, col = gm.gold ? '#ffd32a' : '#18dcff', r0 = gm.gold ? 15 : 11;
          ctx.save(); ctx.translate(gm.x, gm.y + bob); ctx.shadowColor = col; ctx.shadowBlur = 18; ctx.fillStyle = col;
          ctx.beginPath(); ctx.moveTo(0, -r0 - 3); ctx.lineTo(r0, 0); ctx.lineTo(0, r0 + 3); ctx.lineTo(-r0, 0); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.moveTo(0, -r0 - 3); ctx.lineTo(r0 * 0.5, -2); ctx.lineTo(-r0 * 0.3, -2); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      }
      // منطقة السيطرة
      const zd = this.zoneInfo();
      if (zd) {
        const inside = this.myAlive && Math.hypot(this.myX - zd.x, this.myY - zd.y) < zd.r;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
        const zg = ctx.createRadialGradient(zd.x, zd.y, 10, zd.x, zd.y, zd.r);
        zg.addColorStop(0, inside ? 'rgba(46,213,115,0.45)' : 'rgba(255,211,42,0.30)');
        zg.addColorStop(1, inside ? 'rgba(46,213,115,0.18)' : 'rgba(255,211,42,0.10)');
        ctx.fillStyle = zg;
        ctx.beginPath(); ctx.arc(zd.x, zd.y, zd.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = inside ? '#2ed573' : '#ffd32a'; ctx.lineWidth = 3 + pulse * 3;
        ctx.beginPath(); ctx.arc(zd.x, zd.y, zd.r, 0, Math.PI * 2); ctx.stroke();
        ctx.font = '30px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🎯', zd.x, zd.y);
      }

      // القدرات
      for (const pid in this.pickups) {
        const pk = this.pickups[pid];
        const type = pk.t || 'hp';
        const col = type === 'speed' ? '#ffa502' : type === 'shield' ? '#1e90ff' : type === 'rapid' ? '#a55eea' : type === 'triple' ? '#fd79a8' : type === 'shotgun' ? '#ff6348' : '#2ed573';
        ctx.fillStyle = col;
        ctx.shadowColor = col; ctx.shadowBlur = 12;
        roundRect(ctx, pk.x - 13, pk.y - 13, 26, 26, 7);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        if (type === 'hp') {
          ctx.fillRect(pk.x - 3, pk.y - 9, 6, 18);
          ctx.fillRect(pk.x - 9, pk.y - 3, 18, 6);
        } else {
          ctx.font = '16px serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(type === 'speed' ? '👟' : type === 'rapid' ? '🔫' : type === 'triple' ? '🔱' : type === 'shotgun' ? '💥' : '🛡️', pk.x, pk.y + 1);
        }
      }

      // الطلقات
      for (const b of this.bullets) {
        ctx.strokeStyle = 'rgba(255,211,42,0.45)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.dx * 26, b.y - b.dy * 26); ctx.stroke();
        ctx.fillStyle = '#ffd32a';
        ctx.shadowColor = '#ffd32a'; ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // مؤثرات
      for (const f of this.fx) {
        ctx.globalAlpha = Math.max(0, 1 - f.age / f.life);
        ctx.fillStyle = f.c;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      for (const br of this.barrels) {
        if (br.dead) continue;
        ctx.fillStyle = br.hp < 2 ? '#c0392b' : '#e67e22'; ctx.strokeStyle = '#2d1b00'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(br.x, br.y, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.font = '24px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
        ctx.fillText('\u{1F6E2}', br.x, br.y + 1);
      }
      for (const r of this.rings) {
        const k = r.age / r.life;
        ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ff9f43'; ctx.lineWidth = 6 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.R * k, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,159,67,0.25)'; ctx.beginPath(); ctx.arc(r.x, r.y, r.R * k, 0, Math.PI * 2); ctx.fill();
      }
      for (const q of this.gren) {
        ctx.globalAlpha = 0.25; ctx.strokeStyle = '#ff6b81'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.arc(q.tx, q.ty, 120, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = 1; ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('\u{1F4A3}', q.x, q.y - (q.h || 0));
      }
      ctx.globalAlpha = 1;
      // اللاعبين
      const drawPlayer = (uid, p, isMe) => {
        const x = isMe ? this.myX : p.x, y = isMe ? this.myY : p.y;
        if (x === undefined) return;
        const alive = isMe ? this.myAlive : p.alive;
        const hp = isMe ? this.myHp : p.hp;
        const color = PALETTE[(p.color || 0) % PALETTE.length];
        ctx.globalAlpha = alive ? 1 : 0.3;
        // خط التصويب لي أنا
        if (isMe && alive) {
          ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(this.myAngle) * 46, y + Math.sin(this.myAngle) * 46);
          ctx.stroke();
          // وميض الفوهة لحظة الضرب
          if (performance.now() < this.muzzleUntil) {
            const fx = x + Math.cos(this.myAngle) * (PLAYER_R + 12), fy = y + Math.sin(this.myAngle) * (PLAYER_R + 12);
            ctx.fillStyle = '#ffd32a';
            ctx.shadowColor = '#ffd32a'; ctx.shadowBlur = 14;
            ctx.beginPath(); ctx.arc(fx, fy, 8, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
        // وميض إصابة اللاعبين التانيين
        if (!isMe && performance.now() < (p.flashUntil || 0)) {
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(x, y, PLAYER_R + 6, 0, Math.PI * 2); ctx.stroke();
        }
        // الدرع
        if ((isMe ? performance.now() < this.shieldUntil : p.sh) && alive) {
          ctx.strokeStyle = 'rgba(30,144,255,0.85)';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(x, y, PLAYER_R + 7, 0, Math.PI * 2); ctx.stroke();
        }
        // حماية الريسبون (رمشة)
        if (isMe && alive && performance.now() < this.protectedUntil) {
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.4 + 0.4 * Math.sin(performance.now() / 90)) + ')';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath(); ctx.arc(x, y, PLAYER_R + 11, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        }
        // الجسم
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, PLAYER_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = isMe ? '#fff' : 'rgba(255,255,255,0.4)';
        ctx.lineWidth = isMe ? 3 : 2;
        ctx.stroke();
        // الأفاتار
        ctx.font = '22px serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.avatar || '🦊', x, y + 1);
        // الاتجاه
        const ang = isMe ? this.myAngle : (p.angle || 0);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.arc(x + Math.cos(ang) * 12, y + Math.sin(ang) * 12, 5, 0, Math.PI * 2);
        ctx.fill();
        // الاسم والدم
        ctx.font = 'bold 12px Cairo, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(p.name || 'لاعب', x, y - PLAYER_R - 16);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        roundRect(ctx, x - 22, y - PLAYER_R - 10, 44, 6, 3);
        ctx.fill();
        ctx.fillStyle = hp > 40 ? '#2ed573' : '#ff4757';
        if (hp > 0) { roundRect(ctx, x - 22, y - PLAYER_R - 10, 44 * Math.max(0, hp) / MAX_HP, 6, 3); ctx.fill(); }
        ctx.globalAlpha = 1;
      };
      for (const bt of this.bots) drawPlayer(bt.id, { name: bt.name, avatar: bt.boss ? '👹' : '🤖', color: bt.color, x: bt.x, y: bt.y, alive: bt.alive, hp: Math.min(bt.hp, MAX_HP), angle: bt.angle }, false);
      for (const bt of this.bots) {
        if (!bt.boss || !bt.alive) continue;
        const bc = bt.boss3 ? '#18dcff' : bt.boss2 ? '#a55eea' : '#ff4757'; ctx.strokeStyle = bc; ctx.lineWidth = 5; ctx.shadowColor = bc; ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.arc(bt.x, bt.y, PLAYER_R + 12, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(bt.x - 40, bt.y - PLAYER_R - 28, 80, 8);
        ctx.fillStyle = bt.boss3 ? '#18dcff' : bt.boss2 ? '#a55eea' : '#ff4757'; ctx.fillRect(bt.x - 40, bt.y - PLAYER_R - 28, 80 * Math.max(0, bt.hp) / (bt.max || 300), 8);
        ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd32a'; ctx.fillText('\u{1F451}', bt.x, bt.y - PLAYER_R - 38);
      }
      for (const uid in this.players) drawPlayer(uid, this.players[uid], false);
      drawPlayer(this.me.uid, { name: this.me.name, avatar: this.me.avatar, color: this.me.color }, true);

      ctx.restore();

      if (this.bots.length) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 15px Cairo, sans-serif'; ctx.fillStyle = '#7bdff2';
        ctx.fillText('🌊 موجة ' + this.wave + ' | بوتات: ' + this.bots.filter((q) => q.alive).length, innerWidth / 2, innerWidth < 641 ? innerHeight - 215 : 78);
        const wb = this.waveBanner;
        if (wb && performance.now() < wb.until) {
          const k = (wb.until - performance.now()) / 2400;
          ctx.globalAlpha = Math.min(1, k * 2.5);
          let fs = 44; ctx.font = 'bold 44px Cairo, sans-serif'; const tw = ctx.measureText(wb.text).width; if (tw > innerWidth - 30) { fs = Math.floor(44 * (innerWidth - 30) / tw); ctx.font = 'bold ' + fs + 'px Cairo, sans-serif'; } ctx.fillStyle = '#ffd32a'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 6;
          ctx.strokeText(wb.text, innerWidth / 2, innerHeight * 0.3); ctx.fillText(wb.text, innerWidth / 2, innerHeight * 0.3);
          ctx.globalAlpha = 1;
        }
      }
      const sti = this.stormInfo();
      if (sti && this.myAlive) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 15px Cairo, sans-serif';
        ctx.fillStyle = this.inStorm ? '#ff4757' : '#ffa502';
        const msg = this.inStorm ? '🌪️ انت برّه الدايرة! ارجع جوّه' : (sti.el < 8 ? '🌪️ العاصفة هتبدأ تضيّق بعد ' + Math.ceil(8 - sti.el) + 'ث' : '🌪️ الدايرة بتضيّق: ' + Math.round(sti.r) + ' م');
        ctx.fillText(msg, innerWidth / 2, innerWidth < 641 ? innerHeight - 250 : 105);
      }

      // وميض أحمر لما اتضرب
      if (performance.now() < this.hitFlashUntil) {
        ctx.fillStyle = 'rgba(255,71,87,0.18)';
        ctx.fillRect(0, 0, innerWidth, innerHeight);
      }

      if (this.mode === 'gems') {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 18px Cairo, sans-serif'; ctx.fillStyle = '#18dcff';
        ctx.fillText('💎 جواهرك: ' + (this.zpts || 0), innerWidth / 2, innerHeight - 140);
      }
      if (this.mode === 'zone') {
        const z2 = this.zoneInfo();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 18px Cairo, sans-serif'; ctx.fillStyle = '#ffd32a';
        ctx.fillText('🎯 نقاطك: ' + (this.zpts || 0), innerWidth / 2, innerHeight - 140);
        const sx = z2.x - this.cam.x, sy = z2.y - this.cam.y;
        if (sx < 0 || sy < 0 || sx > innerWidth || sy > innerHeight) {
          const cx = innerWidth / 2, cy = innerHeight / 2, ang = Math.atan2(sy - cy, sx - cx);
          const ax = cx + Math.cos(ang) * (Math.min(cx, cy) - 40), ay = cy + Math.sin(ang) * (Math.min(cx, cy) - 40);
          ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
          ctx.fillStyle = '#ffd32a'; ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -11); ctx.lineTo(-10, 11); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      }

      // شريط السلاح + المشاهدة
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const wl = this.weaponUntil - performance.now();
      if (this.myAlive && wl > 0) {
        ctx.font = 'bold 14px Cairo, sans-serif'; ctx.fillStyle = this.weapon === 'rapid' ? '#a55eea' : this.weapon === 'shotgun' ? '#ff6348' : '#fd79a8';
        ctx.fillText((this.weapon === 'rapid' ? '🔫 رشاش ' : this.weapon === 'shotgun' ? '💥 شوتجن ' : '🔱 ثلاثي ') + Math.ceil(wl / 1000) + 'ث', innerWidth / 2, innerHeight - 170);
      }
      if (!this.myAlive && this.specName) {
        ctx.font = 'bold 16px Cairo, sans-serif'; ctx.fillStyle = '#fff';
        ctx.fillText('👁️ بتتفرج على ' + this.specName + ' (اضغط للتبديل)', innerWidth / 2, 70);
      }

      this.drawMinimap();
    },

    drawMinimap() {
      const mc = document.getElementById('minimap');
      if (!mc) return;
      const c = mc.getContext('2d');
      const S = mc.width, sc = S / WORLD;
      c.clearRect(0, 0, S, S);
      c.fillStyle = 'rgba(255,255,255,0.18)';
      for (const o of this.obstacles) c.fillRect(o.x * sc, o.y * sc, Math.max(2, o.w * sc), Math.max(2, o.h * sc));
      for (const h of (this.hazards || [])) { c.fillStyle = h.type === 'lava' ? 'rgba(255,90,30,0.65)' : 'rgba(160,225,255,0.4)'; c.beginPath(); c.arc(h.x * sc, h.y * sc, h.r * sc, 0, Math.PI * 2); c.fill(); }
      const sm = this.stormInfo();
      if (sm) { c.strokeStyle = '#ff4757'; c.lineWidth = 2; c.beginPath(); c.arc(sm.x * sc, sm.y * sc, sm.r * sc, 0, Math.PI * 2); c.stroke(); }
      if (this.mode === 'gems') { c.fillStyle = '#18dcff'; for (const gm of this.gemList()) { if (!this.gemTaken[gm.key]) { c.fillRect(gm.x * sc - 1.5, gm.y * sc - 1.5, 3, 3); } } }
      const zm = this.zoneInfo();
      if (zm) { c.strokeStyle = '#ffd32a'; c.lineWidth = 2; c.beginPath(); c.arc(zm.x * sc, zm.y * sc, zm.r * sc, 0, Math.PI * 2); c.stroke(); }
      c.fillStyle = '#2ed573';
      for (const pid in this.pickups) { const pk = this.pickups[pid]; c.beginPath(); c.arc(pk.x * sc, pk.y * sc, 3, 0, Math.PI * 2); c.fill(); }
      for (const uid in this.players) {
        const p = this.players[uid];
        if (!p.alive || p.x === undefined) continue;
        c.fillStyle = PALETTE[(p.color || 0) % PALETTE.length];
        c.beginPath(); c.arc(p.x * sc, p.y * sc, 4, 0, Math.PI * 2); c.fill();
      }
      if (this.myAlive) {
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(this.myX * sc, this.myY * sc, 5, 0, Math.PI * 2); c.fill();
        c.strokeStyle = PALETTE[(this.me.color || 0) % PALETTE.length]; c.lineWidth = 2;
        c.beginPath(); c.arc(this.myX * sc, this.myY * sc, 7, 0, Math.PI * 2); c.stroke();
      }
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1.5;
      c.strokeRect(this.cam.x * sc, this.cam.y * sc, Math.max(8, innerWidth * sc), Math.max(8, innerHeight * sc));
    },
  };

  function circleRect(cx, cy, r, rect) {
    const nx = clamp(cx, rect.x, rect.x + rect.w);
    const ny = clamp(cy, rect.y, rect.y + rect.h);
    return (cx - nx) * (cx - nx) + (cy - ny) * (cy - ny) < r * r;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function hashCode(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }

  // ============ الأصوات ============
  const Sfx = {
    ctx: null,
    enabled() { return localStorage.getItem('arena_sound') !== 'off'; },
    ac() {
      if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
      return this.ctx;
    },
    beep(freq, dur, type, vol) {
      if (!this.enabled()) return;
      const ac = this.ac(); if (!ac) return;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.06, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + dur);
    },
    shoot(v) { this.beep(240, 0.08, 'square', 0.05 * (v || 1)); },
    hit() { this.beep(120, 0.15, 'sawtooth', 0.08); },
    kill() { this.beep(440, 0.1, 'square', 0.07); setTimeout(() => this.beep(220, 0.2, 'square', 0.07), 110); },
    boom() { this.beep(70, 0.35, 'sawtooth', 0.12); setTimeout(() => this.beep(45, 0.4, 'square', 0.1), 60); },
    horn() { this.beep(180, 0.5, 'sawtooth', 0.09); setTimeout(() => this.beep(135, 0.7, 'sawtooth', 0.09), 250); },
    tick() { this.beep(900, 0.05, 'square', 0.04); },
    win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.beep(f, 0.18, 'triangle', 0.08), i * 130)); },
  };

  window.ArenaGame = Game;
  window.ArenaSfx = Sfx;
  window.ARENA = { WORLD, MAX_HP, PALETTE, game: Game };
})();

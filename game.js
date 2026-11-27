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
    { name: 'فضاء', bg0: '#160b2e', bg1: '#070312', ob: '#3b2a73', obs: 'rgba(190,150,255,0.28)' },
    { name: 'غابة', bg0: '#0f2a16', bg1: '#07160b', ob: '#2f5a2a', obs: 'rgba(160,255,140,0.22)' },
    { name: 'نيون', bg0: '#1a0630', bg1: '#06010f', ob: '#0e3b5a', obs: 'rgba(0,245,255,0.45)' },
    { name: 'مصنع', bg0: '#231c10', bg1: '#0f0c06', ob: '#6b5426', obs: 'rgba(255,200,80,0.35)' },
    { name: 'عميق', bg0: '#06263a', bg1: '#021018', ob: '#1b6b7a', obs: 'rgba(120,255,230,0.25)' },
  ];
  const BOT_LEVELS = { easy: { fire: 1600, err: 0.9, spd: 110 }, normal: { fire: 950, err: 0.45, spd: 150 }, hard: { fire: 600, err: 0.18, spd: 190 } };
  const MODS = { dark: { t: '🌑 ظلام: الرؤية محدودة' }, fast: { t: '⚡ بوتات سريعة +٤٠٪' }, rage: { t: '😡 بوتات غضبانة: ضرر ×١٫٥' }, loot: { t: '💰 غنيمة: عملات ×٢' }, swarm: { t: '🐝 سرب: بوتات أكتر وصحتها أقل' } };
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
    speedUntil: 0, shieldUntil: 0, protectedUntil: 0, weaponUntil: 0, weapon: '', fx: [], dashUntil: 0, dashCd: 0, rs: { shots: 0, hits: 0, gren: 0, dash: 0, pick: 0, streak: 0 }, barrels: [], wave: 1, waveAt: 0, waveBanner: null, gren: [], grenCd: 0, rings: [], gcount: 0, dashX: 0, dashY: 0, mode: 'classic', zpts: 0, zoneAcc: 0, zoneCache: null, bots: [], botCheckAt: 0, botAnnounced: false, shakeUntil: 0, specIdx: 0, lastBurst: 0, ult: 0, meteors: [], up: { dmg: 0, spd: 0, rate: 0, steal: 0, arm: 0, drone: 0 }, upDone: false, pickWait: false,
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
      this.theme = THEMES[Math.abs(Math.floor(this.seed)) % THEMES.length]; this.mode = opts.mode || 'classic'; this.bossRush = !!window.ARENA_BR; window.ARENA_BR = false; this.zpts = 0; this.zoneAcc = 0; this.zoneCache = null; this.gemTaken = {};
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
      this.speedUntil = 0; this.shieldUntil = 0; this.weaponUntil = 0; this.weapon = ''; this.fx = []; this.gren = []; this.rs = { shots: 0, hits: 0, gren: 0, dash: 0, pick: 0, streak: 0 }; this.barrels = []; this.wave = 1; this.waveAt = 0; this.waveBanner = null; this.rings = []; this.grenCd = 0; this.bots = []; this.botCheckAt = 0; this.botAnnounced = false; this.shakeUntil = 0; this.wasHole = false; this.specIdx = 0; this.mod = ''; this.ult = 0; this.meteors = []; this.icePools = []; this.up = { dmg: 0, spd: 0, rate: 0, steal: 0, arm: 0, drone: 0 }; this.upDone = false; this.pickWait = false; this.hideUpgrades();
      this.protectedUntil = performance.now() + 2000; // حماية بداية الجولة
      this.writeSelf(true);
      this.onFeed('🗺️ ساحة ' + this.theme.name);
      this.lastTs = performance.now();
      const loop = (ts) => {
        if (!this.running) return;
        const dt = Math.min(0.05, (ts - this.lastTs) / 1000) * (performance.now() < (this.slowUntil || 0) ? 0.3 : 1);
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
      this.portals = [];
      try {
        const rp = mulberry32(((this.seed * 31 + 999) >>> 0));
        for (let pr = 0; pr < 2; pr++) {
          const p1 = this.freeSpot(rp); let p2 = this.freeSpot(rp);
          for (let q = 0; q < 12 && Math.hypot(p1.x - p2.x, p1.y - p2.y) < 700; q++) p2 = this.freeSpot(rp);
          this.portals.push({ x: p1.x, y: p1.y, to: pr * 2 + 1, c: pr ? '#ff5ce1' : '#00f5ff' }, { x: p2.x, y: p2.y, to: pr * 2, c: pr ? '#ff5ce1' : '#00f5ff' });
        }
      } catch (e) { this.portals = []; }
      const nm = this.theme && this.theme.name;
      if (nm === 'فضاء') {
        const rs = mulberry32(((this.seed * 31 + 777) >>> 0));
        for (let k = 0; k < 4; k++) { const p = this.freeSpot(rs); this.hazards.push({ x: p.x, y: p.y, r: 190, type: 'hole' }); }
        return;
      }
      if (nm === 'مصنع') {
        const rf = mulberry32(((this.seed * 31 + 321) >>> 0));
        for (let k = 0; k < 7; k++) { const p = this.freeSpot(rf); this.hazards.push({ x: p.x, y: p.y, r: 140, type: 'belt', a: Math.floor(rf() * 4) * Math.PI / 2 }); }
        return;
      }
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

      // جواهر (مزامنة: أول واحد ياخد الجوهرة بس)
      const gemRef = roomRef.child('gems');
      const onGem = gemRef.on('child_added', (s) => { this.gemTaken[s.key] = true; });
      this.listeners.push({ ref: gemRef, ev: 'child_added', fn: onGem });

      // العلم (وضع الاستحواذ على العلم)
      this.flag = null; this.flagBlock = 0; this.flagAcc = 0; this.flagTry = false;
      this.mines = []; this.mineUntil = 0; this.mineNext = 0; this.inf = false; this.infAcc = 0; this.infBlock = 0; this.infT0 = 0; this.infChosen = false; this.infPrev = {}; this.bomb = null; this.bombBlock = 0; this.bombTry = false; this.bombAcc = 0; this._lastBombHolder = '';
      if (this.mode === 'flag') {
        const flagRef = roomRef.child('flag');
        const onFlag = flagRef.on('value', (s) => { this.flag = s.val(); });
        this.listeners.push({ ref: flagRef, ev: 'value', fn: onFlag });
        if (this.host) { const fp = this.freeSpot(mulberry32(((this.seed * 7 + 99) >>> 0))); flagRef.set({ holder: '', x: Math.round(fp.x), y: Math.round(fp.y) }).catch(() => {}); }
      }

      if (this.mode === 'bomb') {
        const bombRef = roomRef.child('bomb');
        const onBomb = bombRef.on('value', (s) => { this.bomb = s.val(); });
        this.listeners.push({ ref: bombRef, ev: 'value', fn: onBomb });
        if (this.host) {
          setTimeout(() => {
            if (!this.running) return;
            const ids = Object.keys(this.players).concat([this.me.uid]).filter((v, i, a) => a.indexOf(v) === i);
            const h0 = ids[Math.floor(Math.random() * ids.length)];
            bombRef.set({ holder: h0, at: firebase.database.ServerValue.TIMESTAMP, fuse: 11000 + Math.floor(Math.random() * 6000), n: 0 }).catch(() => {});
          }, 3000);
        }
      }

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
        if (!this.bullets.some((b) => b.id === e.id)) this.bullets.push({ id: e.id, uid: e.uid, x: e.x, y: e.y, dx: e.dx, dy: e.dy, age: 0, life: e.l || 0, rail: !!e.rl, sp: e.rl ? 2.4 : 1 });
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
        zpts: this.zpts || 0, inf: this.inf ? 1 : 0, hb: firebase.database.ServerValue.TIMESTAMP,
        name: this.me.name, avatar: this.me.avatar, color: this.me.color,
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

    coin(n) { if (this.mod === 'loot' && this.bots.length) n *= 2; try { localStorage.setItem('arena_coins', String((+localStorage.getItem('arena_coins') || 0) + n)); } catch (err) { /* ignore */ } },
    bulletColor() { try { return (window.ARENA_SKINS || {})[localStorage.getItem('arena_skin') || 'gold'] || '#ffd32a'; } catch (err) { return '#ffd32a'; } },
    nDrone() { return (this.up.drone || 0) + (performance.now() < (this.droneTmpUntil || 0) ? 2 : 0); },
    ach(type, val) { if (type === 'kill') { const cn = performance.now(); this.combo = (this._comboAt && cn - this._comboAt < 4000) ? (this.combo || 0) + 1 : 1; this._comboAt = cn; if (this.combo >= 2) { const cx = this.combo; this.modBanner = { text: (cx === 2 ? '✌️ ثنائية!' : cx === 3 ? '🔥 ثلاثية! +٢ عملة' : cx === 4 ? '💥 رباعية! +٣ عملة' : '☠️ مجزرة ×' + cx + '! +٥ عملة'), until: cn + 1800 }; if (cx >= 3) this.coin(cx === 3 ? 2 : cx === 4 ? 3 : 5); this.ult = Math.min(100, (this.ult || 0) + 5 * cx); try { Sfx.horn(); } catch (e2) { /* ignore */ } } this.coin(1); this.ult = Math.min(100, (this.ult || 0) + 20); } else if (type === 'wave') this.ult = Math.min(100, (this.ult || 0) + 30); if (type === 'kill') { /* coin above */ } else if (type === 'wave') this.coin(5); try { if (window.ArenaAch) window.ArenaAch.hit(type, val); } catch (err) { /* ignore */ } },

    ultimate() {
      if (!this.myAlive || !this.running || (this.ult || 0) < 100) return;
      this.ult = 0; this.ach('ult');
      const R = 460, nowU = performance.now();
      this.rings.push({ x: this.myX, y: this.myY, age: 0, life: 0.8, R }); this.rings.push({ x: this.myX, y: this.myY, age: -0.12, life: 0.8, R: R * 0.7 });
      this.burst(this.myX, this.myY, '#18dcff', 60, 700); this.burst(this.myX, this.myY, '#ffffff', 30, 500);
      this.shakeUntil = nowU + 500; Sfx.boom(); Sfx.horn && Sfx.horn();
      this.shieldUntil = Math.max(this.shieldUntil, nowU + 2500);
      this.onFeed('⚡ موجة الصدمة! دمرت كل اللي حواليك');
      let cleared = 0;
      for (let i = this.bullets.length - 1; i >= 0; i--) { const b = this.bullets[i]; if (b.uid !== this.me.uid && Math.hypot(b.x - this.myX, b.y - this.myY) < R) { this.bullets.splice(i, 1); cleared++; } }
      for (const bt of this.bots) {
        if (bt.alive && Math.hypot(bt.x - this.myX, bt.y - this.myY) < R) {
          bt.hp -= bt.boss ? 150 : 120; this.burst(bt.x, bt.y, '#18dcff', 14, 260);
          if (bt.hp <= 0) {
            bt.alive = false; bt.respawnAt = performance.now() + 3000; this.burst(bt.x, bt.y, '#ffd32a', 28, 300);
            this.onFeed('⚡ الصدمة قضت على ' + bt.name); this.ach('kill');
            this.db.ref('rooms/' + this.roomCode + '/players/' + this.me.uid + '/kills').transaction((k) => (k || 0) + 1).catch(() => {});
          }
        }
      }
      for (const br of this.barrels) { if (!br.dead && Math.hypot(br.x - this.myX, br.y - this.myY) < R) this.explodeBarrel(br); }
      this.ult = 0;
    },
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
        { k: 'drone', i: '🚁', t: 'درون مساعد', d: 'درون بيضرب أقرب بوت' },
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
    teamOf(uid) {
      if (this.mode === 'coop') return (uid && String(uid).indexOf('bot') !== 0) ? 0 : -1;
      if (this.mode !== 'team' || !uid || String(uid).indexOf('bot') === 0) return -1;
      const ids = Object.keys(this.players).concat([this.me.uid]).filter((v, i, a) => a.indexOf(v) === i).sort();
      const i = ids.indexOf(uid); return i < 0 ? -1 : i % 2;
    },
    hideUpgrades() { const el = document.getElementById('upgrade-picker'); if (el) el.style.display = 'none'; },

    spawnWave(nowB) {
      const wv = this.bossRush ? [1, 10, 15, 20, 25, 30, 35, 40, 45, 50][(this.wave - 1) % 10] : this.wave, sc = this.bossRush ? 1 + 0.3 * Math.floor((this.wave - 1) / 10) : 1;
      const MK = Object.keys(MODS);
      this.mod = this.wave >= 2 && !this.bossRush && this.wave % 5 !== 0 && Math.random() < 0.65 ? MK[Math.floor(Math.random() * MK.length)] : '';
      if (this.mod) { this.onFeed('🎲 تعديل الموجة: ' + MODS[this.mod].t); this.modBanner = { text: MODS[this.mod].t, until: performance.now() + 2600 }; }
      const n = (this.bossRush ? Math.min(4, Math.floor(this.wave / 3)) : Math.min(9, 2 + this.wave)) + (this.mod === 'swarm' ? 3 : 0);
      this.bots = [];
      this.barrels = [];
      for (let k = 0; k < 6; k++) { const p = this.freeSpot(mulberry32((Date.now() & 0xffff) + k * 131 + 7)); this.barrels.push({ x: p.x, y: p.y, hp: 2, dead: false }); }
      if (this.bossRush || this.wave % 5 === 0) {
        const p = this.freeSpot(mulberry32((Date.now() & 0xffff) + 999));
        this.bots.push({ id: 'bot99', name: wv >= 50 ? '🌌 ملك الفراغ' : wv >= 45 ? '🕷️ ملكة الأسراب' : wv >= 40 ? '👹 سيد الساحة' : wv >= 35 ? '⚡ زعيم البرق' : wv >= 30 ? '🐉 زعيم الهيدرا' : wv >= 25 ? '❄️ زعيم الجليد' : wv >= 20 ? '☄️ زعيم النيازك' : wv >= 15 ? '🌀 زعيم الشبح' : wv >= 10 ? '💀 زعيم الانفجار' : '👑 الزعيم', boss: true, boss2: wv >= 10 && wv < 15, boss3: wv >= 15 && wv < 20, boss4: wv >= 20 && wv < 25, boss5: wv >= 25 && wv < 30, boss6: wv >= 30 && wv < 35, boss7: wv >= 35 && wv < 40, boss8: wv >= 40 && wv < 45, boss9: wv >= 45 && wv < 50, boss10: wv >= 50, nextPulse: nowB + 3500, pulseAt: 0, nextStrike: nowB + 3000, nextSpiral: nowB + 2500, nextIce: nowB + 3000, nextCharge: nowB + 5000, chargeAt: 0, chargeUntil: 0, nextMet: nowB + 3000, nextTp: nowB + 4500, max: wv >= 50 ? 3500 : wv >= 45 ? 2600 : wv >= 40 ? 2000 : wv >= 35 ? 1200 : wv >= 30 ? 700 : wv >= 25 ? 1000 : wv >= 20 ? 800 : wv >= 15 ? 600 : wv >= 10 ? 450 : 300, nextBurst: nowB + 3500, x: p.x, y: p.y, hp: wv >= 50 ? 3500 : wv >= 45 ? 2600 : wv >= 40 ? 2000 : wv >= 35 ? 1200 : wv >= 30 ? 700 : wv >= 25 ? 1000 : wv >= 20 ? 800 : wv >= 15 ? 600 : wv >= 10 ? 450 : 300, alive: true, angle: 0, lastFire: nowB + 1500, respawnAt: 0, phase: 0, color: 1 });
        if (!this.bossRush && this.wave > 45) { const bb0 = this.bots[this.bots.length - 1]; bb0.hp = Math.round(bb0.hp * (1 + 0.15 * Math.floor((this.wave - 45) / 5))); bb0.max = bb0.hp; this.onFeed('♾️ مرحلة اللانهاية: الزعماء بقوا أقوى ' + Math.round(15 * Math.floor((this.wave - 45) / 5)) + '٪'); }
        if (sc > 1) { const bb = this.bots[this.bots.length - 1]; bb.hp = Math.round(bb.hp * sc); bb.max = bb.hp; }
        this.onFeed(wv >= 50 ? '🌌 ملك الفراغ! بيسحبك ناحيته وبيطلق نبضة فراغ حمرا — اخرج من الدايرة قبل ما تنفجر!' : wv >= 45 ? '🕷️ ملكة الأسراب! بتتنقل وبتستدعي أتباع ودوامات — اقتل الأتباع الأول' : wv >= 40 ? '👹 سيد الساحة! بيجمع دوامات الهيدرا وصواعق البرق — ٢٠٠٠ صحة' : wv >= 35 ? '⚡ زعيم البرق! بيعلّم أماكن وبعدين الصاعقة بتضرب — اتحرك أول ما تشوف الدايرة!' : wv >= 30 ? '🐉 زعيم الهيدرا! لما يموت بيتحول لراسين — خلّص عليهم' : wv >= 25 ? '❄️ زعيم الجليد! برك تجمّد وهجوم اندفاعي — ابعد عن الخط الأحمر!' : wv >= 20 ? '☄️ زعيم النيازك! بيمطر نيازك — اتحرك!' : wv >= 15 ? '🌀 زعيم الشبح! بيتنقل وبيستدعي أتباع' : wv >= 10 ? '💀 زعيم الانفجار! دايرة طلقات' : '👑 زعيم ظهر! ٣٠٠ صحة وبيضرب ٣ طلقات'); Sfx.horn();
      }
      for (let k = 0; k < n; k++) {
        const p = this.freeSpot(mulberry32((Date.now() & 0xffff) + k * 77));
        let cls = '';
        if (this.wave >= 3 && k % 4 === 1) cls = 'sniper'; else if (this.wave >= 4 && k % 4 === 2) cls = 'tank'; else if (this.wave >= 5 && k % 4 === 3) cls = 'healer';
        const CI = { sniper: ['🎯', '🎯 قناص', 70], tank: ['🛡️', '🛡️ دبابة', 220], healer: ['💚', '💚 مداوي', 70] }[cls];
        const swarmHp = this.mod === 'swarm' && !cls ? 50 : 0;
        this.bots.push({ cls, av: CI ? CI[0] : '🤖', max: CI ? CI[2] : (swarmHp || MAX_HP), id: 'bot' + k, name: CI ? CI[1] + ' ' + (k + 1) : '🤖 بوت ' + (k + 1), x: p.x, y: p.y, hp: CI ? CI[2] : (swarmHp || MAX_HP), alive: true, angle: 0, lastFire: nowB + 1200 + k * 400, respawnAt: 0, phase: Math.random() * 6, color: 3 + (k % 5) });
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
      if (this.mode === 'infect' && this.inf) return;
      const now = performance.now();
      const rapid = this.weapon === 'rapid' && now < this.weaponUntil;
      const triple = this.weapon === 'triple' && now < this.weaponUntil;
      const shotgun = this.weapon === 'shotgun' && now < this.weaponUntil;
      const homing = this.weapon === 'homing' && now < this.weaponUntil;
      const laser = this.weapon === 'laser' && now < this.weaponUntil;
      const flame = this.weapon === 'flame' && now < this.weaponUntil;
      const rail = this.weapon === 'rail' && now < this.weaponUntil;
      const boom = this.weapon === 'boom' && now < this.weaponUntil;
      if (now - this.lastFire < (boom ? 700 : rail ? 850 : flame ? 75 : laser ? 200 : rapid ? 130 : shotgun ? 520 : homing ? 600 : FIRE_COOLDOWN) * Math.pow(0.85, this.up.rate) || !this.myAlive) return;
      this.lastFire = now; this.rs.shots++;
      const angs = shotgun ? [-0.4, -0.2, 0, 0.2, 0.4] : triple ? [-0.22, 0, 0.22] : [0];
      if (shotgun) { this.shakeUntil = Math.max(this.shakeUntil, now + 120); this.burst(this.myX + Math.cos(this.myAngle) * 30, this.myY + Math.sin(this.myAngle) * 30, '#ffa502', 10, 260); }
      angs.forEach((off, k) => {
        const a = this.myAngle + off + (shotgun ? (Math.random() - 0.5) * 0.08 : flame ? (Math.random() - 0.5) * 0.34 : 0);
        const id = this.me.uid.slice(0, 4) + '_' + now + '_' + k + Math.floor(Math.random() * 999);
        const dx = Math.cos(a), dy = Math.sin(a);
        const bx = this.myX + dx * (PLAYER_R + 6), by = this.myY + dy * (PLAYER_R + 6);
        this.bullets.push({ id, uid: this.me.uid, x: bx, y: by, dx, dy, age: 0, life: boom ? 3.2 : shotgun ? 0.5 : homing ? 1.8 : rail ? 0.9 : laser ? 1.1 : flame ? 0.3 : 0, h: homing, pierce: laser || flame || rail || boom, boom, flame, rail, sp: rail ? 2.4 : 1, dm: flame ? 0.45 : rail ? 4.4 : boom ? 1.6 : 0 });
        if (!flame) this.db.ref('rooms/' + this.roomCode + '/events').push({
          t: 'shoot', id, uid: this.me.uid,
          x: Math.round(bx), y: Math.round(by),
          dx: Math.round(dx * 1000) / 1000, dy: Math.round(dy * 1000) / 1000, l: boom ? 0.8 : shotgun ? 0.5 : rail ? 0.9 : 0, rl: rail ? 1 : 0,
          ts: firebase.database.ServerValue.TIMESTAMP,
        }).catch(() => {});
      });
      if (rail) { this.shakeUntil = Math.max(this.shakeUntil, now + 200); this.burst(this.myX + Math.cos(this.myAngle) * 34, this.myY + Math.sin(this.myAngle) * 34, '#ff3df5', 14, 380); }
      if (laser) { this.shakeUntil = Math.max(this.shakeUntil, now + 90); this.burst(this.myX + Math.cos(this.myAngle) * 30, this.myY + Math.sin(this.myAngle) * 30, '#00f5ff', 6, 220); }
      this.muzzleUntil = performance.now() + 70;
      if (!flame || Math.random() < 0.3) Sfx.shoot(0.5);
    },

    die(killerUid) {
      if (!this.myAlive) return;
      this.myAlive = false;
      this.myHp = 0;
      this.deaths = (this.deaths || 0) + 1;
      this.respawnAt = performance.now() + RESPAWN_SEC * 1000;
      this.killCam = (killerUid && killerUid !== this.me.uid) ? { uid: killerUid, until: performance.now() + 2800, t0: performance.now() } : null;
      if (this.mode === 'flag' && this.flag && this.flag.holder === this.me.uid) {
        const dr = { holder: '', x: Math.round(this.myX), y: Math.round(this.myY) }; this.flag = dr; this.flagBlock = performance.now() + 2500;
        this.db.ref('rooms/' + this.roomCode + '/flag').set(dr).catch(() => {}); this.onFeed('🚩 وقع منك العلم!');
      }
      try {
        let kn = '';
        if (killerUid === 'storm') kn = '🌪️ العاصفة'; else if (killerUid === 'hole') kn = '🕳️ الثقب الأسود'; else if (killerUid === 'lava') kn = '🌋 الحمم';
        else if (killerUid && String(killerUid).indexOf('bot') === 0) { const kb = this.bots.find((q) => q.id === killerUid); kn = kb ? kb.name : '🤖 بوت'; }
        else if (killerUid && this.players[killerUid]) kn = (this.players[killerUid].avatar || '') + ' ' + (this.players[killerUid].name || 'لاعب');
        const tips = ['💡 استخدم الداش (Space) تهرب من الطلقات', '💡 الدرع بيصدّ النيازك والاندفاعات', '💡 القنبلة (G) بتكسر تجمع البوتات', '💡 خلّي الحيطان بينك وبين القناص', '💡 الموجة الجاية فيها ترقيات، اختار دروع لو بتموت كتير'];
        const bye = document.getElementById('respawn-by');
        if (bye) bye.textContent = (kn ? '☠️ قتلك: ' + kn + ' — ' : '') + tips[Math.floor(Math.random() * tips.length)];
      } catch (e) {}
      const ref = this.db.ref('rooms/' + this.roomCode + '/players/' + this.me.uid);
      ref.update({ alive: false, hp: 0, deaths: this.deaths }).catch(() => {});
      if (killerUid === 'storm') {
        this.onFeed('🌪️ العاصفة قتلتك');
      } else if (killerUid === 'hole') {
        this.onFeed('🕳️ الثقب الأسود بلعك');
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
      this._kd = (e) => { this.keys[e.key.toLowerCase()] = true; if (e.key === ' ' || e.key === 'Shift') this.dash(); if (e.key === ' ') e.preventDefault(); if (e.key === 'g' || e.key === 'G') this.throwGrenade(); if (e.key === 'q' || e.key === 'Q') this.ultimate(); };
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
          const types = ['hp', 'speed', 'shield', 'rapid', 'triple', 'shotgun', 'homing', 'flame', 'magnet', 'drone', 'freeze', 'nuke', 'rail', 'mine', 'boom'];
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
        if (this.myAlive && !dashing) {
          for (const hz of (this.hazards || [])) {
            if (hz.type !== 'hole') continue;
            const hd = Math.hypot(hz.x - this.myX, hz.y - this.myY);
            if (hd < hz.r) {
              if (!this.wasHole) { this.wasHole = true; this.onFeed('🕳️ ثقب أسود بيسحبك! ابعد أو اعمل داش'); }
              const f = (1 - hd / hz.r) * 230 * dt / (hd || 1), px = this.myX + (hz.x - this.myX) * f, py = this.myY + (hz.y - this.myY) * f;
              if (!this.obstacles.some((o) => circleRect(px, py, PLAYER_R, o))) { this.myX = px; this.myY = py; }
              this.shakeUntil = Math.max(this.shakeUntil, performance.now() + 60);
              if (hd < 36 && performance.now() > this.protectedUntil) { this.burst(this.myX, this.myY, '#a55eea', 30, 320); this.myHp = 0; this.onHud(0); this.die('hole'); break; }
            }
          }
        }
        const onIce = (this.hazards || []).some((h) => h.type === 'ice' && Math.hypot(this.myX - h.x, this.myY - h.y) < h.r);
        if (onIce && !dashing) { const kk = Math.min(1, dt * 1.8); this.smx = (this.smx || 0) + (mx - (this.smx || 0)) * kk; this.smy = (this.smy || 0) + (my - (this.smy || 0)) * kk; mx = this.smx; my = this.smy; if (Math.random() < 0.15) this.burst(this.myX, this.myY, '#cfefff', 1, 40); } else { this.smx = mx; this.smy = my; }
        const len = Math.hypot(mx, my);
        if (len > 0.01) {
          if (len > 1) { mx /= len; my /= len; }
          const inIce = (this.icePools || []).some((ip) => performance.now() < ip.until && Math.hypot(this.myX - ip.x, this.myY - ip.y) < ip.r);
          const spd0 = dashing ? SPEED * 4.2 : performance.now() < this.speedUntil ? SPEED * 1.4 * (1 + 0.1 * this.up.spd) : SPEED * (1 + 0.1 * this.up.spd);
          const spd = (inIce && !dashing ? spd0 * 0.45 : spd0) * (this.mode === 'flag' && this.flag && this.flag.holder === this.me.uid ? 0.88 : 1) * (this.mode === 'bomb' && this.bomb && this.bomb.holder === this.me.uid ? 1.12 : 1) * (this.mode === 'infect' && this.inf ? 1.18 : 1);
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

      if (this.theme && this.theme.name === 'مصنع') {
        for (const h of (this.hazards || [])) {
          if (h.type !== 'belt') continue;
          const bx = Math.cos(h.a) * 140 * dt, by = Math.sin(h.a) * 140 * dt;
          if (this.myAlive && Math.hypot(this.myX - h.x, this.myY - h.y) < h.r) {
            const nx3 = clamp(this.myX + bx, PLAYER_R, WORLD - PLAYER_R), ny3 = clamp(this.myY + by, PLAYER_R, WORLD - PLAYER_R);
            if (!this.obstacles.some((o) => circleRect(nx3, ny3, PLAYER_R, o))) { this.myX = nx3; this.myY = ny3; }
          }
          for (const bt of this.bots) if (bt.alive && Math.hypot(bt.x - h.x, bt.y - h.y) < h.r) { bt.x = clamp(bt.x + bx, 30, WORLD - 30); bt.y = clamp(bt.y + by, 30, WORLD - 30); }
        }
      }
      if (this.myAlive && this.portals && this.portals.length && performance.now() > (this.portalCd || 0)) {
        for (const po of this.portals) {
          if (Math.hypot(this.myX - po.x, this.myY - po.y) < 44) {
            const dst = this.portals[po.to];
            this.burst(this.myX, this.myY, po.c, 20, 260);
            this.myX = dst.x + 60; this.myY = dst.y; this.portalCd = performance.now() + 1500;
            this.burst(this.myX, this.myY, po.c, 20, 260); this.writeSelf(true);
            this.shakeUntil = Math.max(this.shakeUntil || 0, performance.now() + 120);
            try { Sfx.dash && Sfx.dash(); } catch (e) {}
            this.onFeed('🌀 بوابة! اتنقلت');
            break;
          }
        }
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

      // العلم: امسكه وانت عايش، كل ثانية = نقطة. لو اتقتلت بيقع مكانك
      if (this.mode === 'flag' && this.flag) {
        const f = this.flag, fnow = performance.now();
        const hp0 = f.holder && f.holder !== this.me.uid ? this.players[f.holder] : null; const stale = f.holder && f.holder !== this.me.uid && (!hp0 || (typeof hp0.hb === 'number' && this.serverNow() - hp0.hb > 6000));
        if (this.myAlive && fnow >= this.flagBlock && (!f.holder || stale) && !this.flagTry && Math.hypot(this.myX - f.x, this.myY - f.y) < 42) {
          this.flagTry = true; const staleId = f.holder || '';
          this.db.ref('rooms/' + this.roomCode + '/flag').transaction((cur) => (cur && (!cur.holder || cur.holder === staleId)) ? { holder: this.me.uid, x: cur.x, y: cur.y } : undefined).then((r) => {
            this.flagTry = false;
            if (r && r.committed) { this.onFeed('🚩 معاك العلم! كل ثانية نقطة — حد يقتلك ياخده'); this.burst(this.myX, this.myY, '#ff4757', 18, 260); if (Sfx.pick) Sfx.pick(); }
          }).catch(() => { this.flagTry = false; });
        }
        if (f.holder === this.me.uid && this.myAlive) {
          this.flagAcc += dt;
          if (this.flagAcc >= 1) { this.flagAcc -= 1; this.zpts = (this.zpts || 0) + 1; this.writeSelf(true); }
        }
      }

      // لعبة القنبلة
      if (this.mode === 'bomb' && this.bomb && this.bomb.holder) {
        const bb = this.bomb, bnow = performance.now(), mine = bb.holder === this.me.uid;
        if (bb.holder !== this._lastBombHolder) { this._lastBombHolder = bb.holder; if (mine) { this.bombBlock = bnow + 1500; this.onFeed('💣 القنبلة معاك! المس لاعب تاني عشان تديهاله'); this.shakeUntil = Math.max(this.shakeUntil, bnow + 250); if (Sfx.horn) Sfx.horn(); } else { const hn = this.players[bb.holder]; this.onFeed('💣 القنبلة مع ' + ((hn && hn.name) || 'لاعب')); } }
        if (this.myAlive && !mine) { this.bombAcc += dt; if (this.bombAcc >= 1) { this.bombAcc -= 1; this.zpts = (this.zpts || 0) + 1; this.writeSelf(true); } }
        if (mine && this.myAlive && !this.bombTry) {
          if (bnow >= this.bombBlock) {
            for (const pu in this.players) {
              const pp = this.players[pu];
              if (!pp || pp.alive === false || typeof pp.x !== 'number') continue;
              if (Math.hypot(pp.x - this.myX, pp.y - this.myY) < 54) {
                this.bombTry = true;
                this.db.ref('rooms/' + this.roomCode + '/bomb').transaction((cur) => (cur && cur.holder === this.me.uid) ? Object.assign({}, cur, { holder: pu }) : undefined).then(() => { this.bombTry = false; this.bombBlock = performance.now() + 1500; this.onFeed('💣 مررت القنبلة!'); }).catch(() => { this.bombTry = false; });
                break;
              }
            }
          }
          if (!this.bombTry && this.serverNow() >= bb.at + bb.fuse) {
            this.bombTry = true;
            this.rings.push({ x: this.myX, y: this.myY, age: 0, life: 0.7, R: 190 }); this.rings.push({ x: this.myX, y: this.myY, age: -0.1, life: 0.7, R: 120 }); this.burst(this.myX, this.myY, '#ff6b35', 50, 460); this.burst(this.myX, this.myY, '#ffd32a', 26, 320);
            this.shakeUntil = Math.max(this.shakeUntil, bnow + 600); Sfx.boom(); this.onFeed('💥 القنبلة انفجرت فيك! -٧٠');
            this.myHp -= 70; this.onHud(this.myHp); this.writeSelf(true);
            const others = Object.keys(this.players).filter((u) => this.players[u] && this.players[u].alive !== false);
            const nh = others.length ? others[Math.floor(Math.random() * others.length)] : this.me.uid;
            this.db.ref('rooms/' + this.roomCode + '/bomb').transaction((cur) => (cur && cur.holder === this.me.uid) ? { holder: nh, at: firebase.database.ServerValue.TIMESTAMP, fuse: 11000 + Math.floor(Math.random() * 6000), n: (cur.n || 0) + 1 } : undefined).then(() => { this.bombTry = false; this.bombBlock = performance.now() + 1500; }).catch(() => { this.bombTry = false; });
            if (this.myHp <= 0) { this.die('bomb'); }
          }
        }
      }

      // الألغام
      if (this.myAlive) {
        const mn = performance.now(); this.mines = this.mines || [];
        if (mn < (this.mineUntil || 0) && mn > (this.mineNext || 0) && this.mines.length < 8) { this.mineNext = mn + 1100; this.mines.push({ x: this.myX, y: this.myY, at: mn, id: this.me.uid.slice(0, 4) + '_m' + Math.floor(mn) }); }
        for (let mi = this.mines.length - 1; mi >= 0; mi--) {
          const mm = this.mines[mi]; if (mn - mm.at < 700) continue;
          let hit = this.bots.some((bt) => bt.alive && Math.hypot(bt.x - mm.x, bt.y - mm.y) < 55);
          if (!hit) for (const pu in this.players) { const pp = this.players[pu]; if (pp && pp.alive !== false && typeof pp.x === 'number' && Math.hypot(pp.x - mm.x, pp.y - mm.y) < 55) { hit = true; break; } }
          if (hit) {
            this.mines.splice(mi, 1);
            this.addGrenade({ id: mm.id, uid: this.me.uid, x: mm.x, y: mm.y, tx: mm.x, ty: mm.y });
            this.db.ref('rooms/' + this.roomCode + '/events').push({ t: 'gren', id: mm.id, uid: this.me.uid, x: Math.round(mm.x), y: Math.round(mm.y), tx: Math.round(mm.x), ty: Math.round(mm.y), ts: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
            this.onFeed('🪤 لغمك انفجر!');
          }
        }
      }
      // وضع العدوى
      if (this.mode === 'infect' && this.myAlive) {
        const inow = performance.now();
        if (!this.infT0) this.infT0 = inow;
        if (!this.infChosen && inow - this.infT0 > 3500) {
          this.infChosen = true;
          const uids = Object.keys(this.players).filter((u) => this.players[u] && this.players[u].alive !== false).concat(this.me.uid).sort();
          if (uids[Math.abs(Math.floor(this.seed)) % uids.length] === this.me.uid) { this.inf = true; this.onFeed('🧟 انت أول مصاب! المس الناس عشان تعديهم'); this.shakeUntil = Math.max(this.shakeUntil, inow + 400); this.writeSelf(true); }
        }
        for (const pu in this.players) {
          const pp = this.players[pu]; if (!pp) continue;
          const was = this.infPrev[pu] || 0, nowI = pp.inf ? 1 : 0; this.infPrev[pu] = nowI;
          if (!was && nowI && this.inf && typeof pp.x === 'number' && Math.hypot(pp.x - this.myX, pp.y - this.myY) < 140) { this.zpts = (this.zpts || 0) + 4; this.onFeed('🧟 عديت ' + (pp.name || 'لاعب') + ' (+٤)'); this.writeSelf(true); }
        }
        if (this.infChosen && !this.inf) {
          this.infAcc += dt; if (this.infAcc >= 1) { this.infAcc -= 1; this.zpts = (this.zpts || 0) + 1; this.writeSelf(true); }
          if (inow > this.infBlock) for (const pu in this.players) {
            const pp = this.players[pu];
            if (!pp || !pp.inf || pp.alive === false || typeof pp.x !== 'number') continue;
            if (Math.hypot(pp.x - this.myX, pp.y - this.myY) < 52) {
              this.inf = true; this.onFeed('🧟 اتصبت! بقيت مصاب — عدّي الباقيين'); this.burst(this.myX, this.myY, '#7bed9f', 30, 340); this.shakeUntil = Math.max(this.shakeUntil, inow + 500); Sfx.boom && Sfx.boom(); this.writeSelf(true); break;
            }
          }
        }
      }

      // صيد الجواهر
      if (this.mode === 'gems' && this.myAlive) {
        for (const gm of this.gemList()) {
          if (this.gemTaken[gm.key]) continue;
          if (Math.hypot(this.myX - gm.x, this.myY - gm.y) < 36) {
            this.gemTaken[gm.key] = true;
            this.burst(gm.x, gm.y, gm.gold ? '#ffd32a' : '#18dcff', 12, 200); if (Sfx.pick) Sfx.pick();
            const pts = gm.gold ? 5 : 1;
            const award = () => { this.ach('gem'); this.zpts = (this.zpts || 0) + pts; this.coin(gm.gold ? 3 : 1); if (gm.gold) this.onFeed('💎 جوهرة دهبية! +٥'); this.writeSelf(true); };
            this.db.ref('rooms/' + this.roomCode + '/gems/' + gm.key).transaction((cur) => (cur ? undefined : this.me.uid)).then((r) => {
              if (r && r.committed) award();
            }).catch(() => { award(); });
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
        const humans = this.mode === 'coop' ? 0 : Object.keys(this.players).length;
        if (humans === 0 && this.bots.length === 0) {
          this.spawnWave(nowB);
          if (!this.botAnnounced) { this.botAnnounced = true; this.onFeed(this.mode === 'coop' ? '🤝 تعاون! كل واحد بموجاته — صحابك معاك وماتضربوش بعض' : '🌊 انت لوحدك: وضع الموجات! اصمد قد ما تقدر'); this.waveBanner = { text: '🌊 الموجة ١', until: nowB + 2200 }; }
        } else if (humans > 0 && this.bots.length) {
          this.bots = []; this.upDone = false; this.pickWait = false; this.hideUpgrades();
          this.onFeed('👥 لاعب حقيقي دخل: البوتات خرجت');
        }
      }
      for (const hb of this.bots) {
        if (hb.boss6 && !hb.alive && !hb.split) {
          hb.split = true;
          for (let m = 0; m < 2; m++) { this.bots.push({ id: 'botH' + Math.floor(nowB) + m, name: '🐉 رأس الهيدرا', x: hb.x + (m ? 50 : -50), y: hb.y, hp: 220, max: 220, alive: true, angle: 0, lastFire: nowB + 800, respawnAt: 0, phase: Math.random() * 6, color: 3, cls: 'sniper' }); }
          this.burst(hb.x, hb.y, '#2ed573', 36, 380); this.onFeed('🐉 الهيدرا اتقسمت لراسين!'); Sfx.boom();
          break;
        }
      }
      if (this.bots.length && this.bots.every((q) => !q.alive)) {
        if (!this.waveAt) { this.waveAt = nowB + 2500; this.onFeed('🌊 الموجة ' + this.wave + ' خلصت! +٣٠ صحة'); Sfx.kill(); this.ach('wave', this.wave); try { const wk = this.bossRush ? 'bestRush' : 'bestWave', wn = this.wave; this.db.ref('leaderboard/' + this.me.uid + '/' + wk).transaction((c) => ((c || 0) < wn ? wn : undefined)).catch(() => {}); } catch (err) { /* ignore */ } try { const bw = +(localStorage.getItem('arena_bestwave') || 0); if (this.wave > bw) localStorage.setItem('arena_bestwave', String(this.wave)); } catch (err) { /* ignore */ } }
        else if (nowB >= this.waveAt && !this.upDone) { this.upDone = true; this.pickWait = true; this.showUpgrades(); }
        else if (nowB >= this.waveAt && !this.pickWait) {
          this.wave++; this.waveAt = 0; this.upDone = false;
          if (this.myAlive) { this.myHp = Math.min(MAX_HP, this.myHp + 30); this.onHud(this.myHp); this.writeSelf(true); }
          this.spawnWave(nowB);
          this.waveBanner = { text: (this.bossRush ? '👑 زعيم رقم ' : '🌊 الموجة ') + this.wave + ' (' + this.bots.length + ' بوتات)', until: nowB + 2400 };
        }
      }
      let lvl = BOT_LEVELS.normal;
      try { lvl = BOT_LEVELS[localStorage.getItem('arena_bot_diff')] || BOT_LEVELS.normal; } catch (err) { /* ignore */ }
      for (const bt of this.bots) {
        if (!bt.alive) {
          continue;
        }
        if (performance.now() < (this.freezeUntil || 0)) continue;
        const dxm = this.myX - bt.x, dym = this.myY - bt.y, dist = Math.hypot(dxm, dym) || 1;
        const tx = this.myAlive ? dxm / dist : Math.cos(bt.phase), ty = this.myAlive ? dym / dist : Math.sin(bt.phase);
        bt.angle = Math.atan2(ty, tx);
        let mvx = 0, mvy = 0;
        if (dist > 380) { mvx = tx; mvy = ty; }
        else if (dist < 220) { mvx = -tx; mvy = -ty; }
        else { const s = Math.sin(nowB / 900 + bt.phase) > 0 ? 1 : -1; mvx = -ty * s; mvy = tx * s; }
        if (bt.cls === 'sniper') { if (dist > 800) { mvx = tx; mvy = ty; } else if (dist < 520) { mvx = -tx; mvy = -ty; } else { const s2 = Math.sin(nowB / 1500 + bt.phase) > 0 ? 1 : -1; mvx = -ty * s2; mvy = tx * s2; } }
        if (bt.cls === 'healer') {
          if (dist < 450) { mvx = -tx; mvy = -ty; } else if (dist > 700) { mvx = tx; mvy = ty; }
          for (const o2 of this.bots) { if (o2 !== bt && o2.alive && o2.hp < (o2.max || MAX_HP) && Math.hypot(o2.x - bt.x, o2.y - bt.y) < 280) { o2.hp = Math.min(o2.max || MAX_HP, o2.hp + 14 * dt); if (Math.random() < 0.08) this.burst(o2.x, o2.y, '#2ed573', 2, 60); } }
        }
        const stB = this.stormInfo();
        if (stB && Math.hypot(bt.x - stB.x, bt.y - stB.y) > stB.r - 20) {
          const dd = Math.hypot(stB.x - bt.x, stB.y - bt.y) || 1; mvx = (stB.x - bt.x) / dd; mvy = (stB.y - bt.y) / dd;
          if (Math.hypot(bt.x - stB.x, bt.y - stB.y) > stB.r) { bt.hp -= 8 * dt; if (Math.random() < 0.1) this.burst(bt.x, bt.y, '#c0392b', 2, 80); if (bt.hp <= 0) { bt.alive = false; bt.respawnAt = performance.now() + 3000; this.burst(bt.x, bt.y, '#ffd32a', 28, 300); this.onFeed('🌪️ العاصفة قضت على ' + bt.name); continue; } }
        }
        for (const hz of (this.hazards || [])) {
          if (hz.type !== 'hole') continue;
          const hd2 = Math.hypot(hz.x - bt.x, hz.y - bt.y);
          if (hd2 < hz.r) {
            const f2 = (1 - hd2 / hz.r) * 150 * dt / (hd2 || 1); bt.x += (hz.x - bt.x) * f2; bt.y += (hz.y - bt.y) * f2;
            if (hd2 < 36) { bt.alive = false; bt.respawnAt = performance.now() + 3000; this.burst(bt.x, bt.y, '#a55eea', 24, 300); this.onFeed('🕳️ الثقب الأسود بلع ' + bt.name); break; }
          }
        }
        if (!bt.alive) continue;
        for (const hz of (this.hazards || [])) {
          if (hz.type !== 'lava') continue;
          const hd = Math.hypot(bt.x - hz.x, bt.y - hz.y);
          if (hd < hz.r + 40) { const hh = hd || 1; mvx = (bt.x - hz.x) / hh; mvy = (bt.y - hz.y) / hh; }
          if (hd < hz.r) { bt.hp -= 12 * dt; if (Math.random() < 0.15) this.burst(bt.x, bt.y, '#ff6b35', 2, 100); if (bt.hp <= 0) { bt.alive = false; bt.respawnAt = performance.now() + 3000; this.burst(bt.x, bt.y, '#ffd32a', 28, 300); this.onFeed('🌋 الحمم قضت على ' + bt.name); break; } }
        }
        if (!bt.alive) continue;
        if (bt.boss8 && !bt.enraged && bt.hp < bt.max / 2) { bt.enraged = true; this.onFeed('🔥 سيد الساحة اتجنن! هجماته بقت أسرع'); this.modBanner = { text: '🔥 الغضب!', until: nowB + 2600 }; this.shakeUntil = Math.max(this.shakeUntil, nowB + 500); Sfx.horn(); }
        if ((bt.boss7 || bt.boss8) && this.myAlive) {
          this.strikes = this.strikes || [];
          if (nowB >= bt.nextStrike) {
            bt.nextStrike = nowB + (bt.boss8 && bt.hp < bt.max / 2 ? 1500 : 2400);
            for (let m = 0; m < 4; m++) { const sa = Math.random() * 6.283, sd = m === 0 ? 0 : 80 + Math.random() * 260; this.strikes.push({ x: clamp(this.myX + Math.cos(sa) * sd, 80, WORLD - 80), y: clamp(this.myY + Math.sin(sa) * sd, 80, WORLD - 80), r: 85, at: nowB + 1200 }); }
            Sfx.horn();
          }
          for (const k of this.strikes) {
            if (!k.done && nowB >= k.at) {
              k.done = true; k.flash = nowB; Sfx.boom(); this.burst(k.x, k.y, '#fff176', 18, 360); this.shakeUntil = Math.max(this.shakeUntil, nowB + 200);
              if (this.myAlive && nowB > this.protectedUntil && Math.hypot(this.myX - k.x, this.myY - k.y) < k.r) {
                if (nowB < this.shieldUntil) this.onFeed('🛡️ الدرع صدّ الصاعقة!');
                else { this.myHp -= 45; this.onHud(this.myHp); this.writeSelf(true); Sfx.hit(); if (this.myHp <= 0) { this.burst(this.myX, this.myY, '#fff176', 30, 320); this.die('bot99'); } }
              }
            }
          }
          this.strikes = this.strikes.filter((k) => nowB < k.at + 400);
        }
        if ((bt.boss6 || bt.boss8 || bt.boss9 || bt.boss10) && this.myAlive && nowB >= bt.nextSpiral) {
          bt.nextSpiral = nowB + (bt.boss8 && bt.hp < bt.max / 2 ? 1500 : 2600);
          for (let arm = 0; arm < 3; arm++) for (let q = 0; q < 6; q++) { const a4 = (arm / 3) * Math.PI * 2 + q * 0.16 + nowB / 900; this.bullets.push({ id: bt.id + '_s' + Math.floor(nowB) + '_' + arm + q, uid: bt.id, x: bt.x + Math.cos(a4) * 30, y: bt.y + Math.sin(a4) * 30, dx: Math.cos(a4), dy: Math.sin(a4), age: -q * 0.09, life: 1.6 }); }
          this.rings.push({ x: bt.x, y: bt.y, age: 0, life: 0.5, R: 90 }); this.burst(bt.x, bt.y, '#2ed573', 16, 300); Sfx.boom();
        }
        if (bt.boss5 && this.myAlive) {
          this.icePools = this.icePools || [];
          if (nowB >= bt.nextIce) {
            bt.nextIce = nowB + 6000;
            for (let m = 0; m < 3; m++) { const ia = Math.random() * 6.283, idd = m === 0 ? 0 : 100 + Math.random() * 200; this.icePools.push({ x: clamp(this.myX + Math.cos(ia) * idd, 90, WORLD - 90), y: clamp(this.myY + Math.sin(ia) * idd, 90, WORLD - 90), r: 95, until: nowB + 7000 }); }
            this.onFeed('❄️ برك جليد! بتبطّأك');
          }
          if (!bt.chargeAt && !bt.chargeUntil && nowB >= bt.nextCharge) { bt.chargeAt = nowB + 1000; bt.cdx = Math.cos(bt.angle); bt.cdy = Math.sin(bt.angle); this.onFeed('⚠️ الجليد هيندفع! اطلع من الخط'); }
          if (bt.chargeAt && nowB >= bt.chargeAt) { bt.chargeAt = 0; bt.chargeUntil = nowB + 650; bt.hitC = false; Sfx.boom(); }
          if (bt.chargeUntil) {
            if (nowB >= bt.chargeUntil) { bt.chargeUntil = 0; bt.nextCharge = nowB + 5000; }
            else {
              const cx2 = clamp(bt.x + bt.cdx * 760 * dt, PLAYER_R, WORLD - PLAYER_R), cy2 = clamp(bt.y + bt.cdy * 760 * dt, PLAYER_R, WORLD - PLAYER_R);
              if (!this.obstacles.some((o) => circleRect(cx2, cy2, PLAYER_R, o))) { bt.x = cx2; bt.y = cy2; } else { bt.chargeUntil = nowB; }
              if (Math.random() < 0.5) this.burst(bt.x, bt.y, '#7efff5', 2, 120);
              if (!bt.hitC && Math.hypot(this.myX - bt.x, this.myY - bt.y) < PLAYER_R * 2 + 6) {
                bt.hitC = true;
                if (nowB < this.shieldUntil) this.onFeed('🛡️ الدرع صدّ الاندفاع!');
                else { this.myHp -= 40; this.onHud(this.myHp); this.writeSelf(true); Sfx.hit(); this.shakeUntil = Math.max(this.shakeUntil, nowB + 300); if (this.myHp <= 0) { this.burst(this.myX, this.myY, '#7efff5', 30, 320); this.die('bot99'); } }
              }
            }
          }
        }
        if (bt.boss4 && nowB >= bt.nextMet && this.myAlive) {
          bt.nextMet = nowB + 3500;
          for (let m = 0; m < 3; m++) {
            const ma = Math.random() * 6.283, md = m === 0 ? 0 : 60 + Math.random() * 160;
            this.meteors.push({ x: clamp(this.myX + Math.cos(ma) * md, 60, WORLD - 60), y: clamp(this.myY + Math.sin(ma) * md, 60, WORLD - 60), at: nowB + 1400, t0: nowB, R: 85 });
          }
          this.onFeed('☄️ نيازك جاية! اتحرك'); 
        }
        if ((bt.boss3 || bt.boss9) && nowB >= bt.nextTp && this.myAlive) {
          bt.nextTp = nowB + 5000;
          this.rings.push({ x: bt.x, y: bt.y, age: 0, life: 0.5, R: 80 }); this.burst(bt.x, bt.y, '#18dcff', 18, 260);
          const ta = Math.random() * 6.283, tp = { x: clamp(this.myX + Math.cos(ta) * 320, 80, WORLD - 80), y: clamp(this.myY + Math.sin(ta) * 320, 80, WORLD - 80) };
          if (!this.obstacles.some((o) => circleRect(tp.x, tp.y, PLAYER_R + 6, o))) { bt.x = tp.x; bt.y = tp.y; }
          this.rings.push({ x: bt.x, y: bt.y, age: 0, life: 0.5, R: 80 }); this.burst(bt.x, bt.y, '#18dcff', 18, 260); Sfx.boom();
          if (this.bots.filter((q) => q.alive).length < 12) {
            for (let m = 0; m < 2; m++) { const sp = this.freeSpot(mulberry32((Date.now() & 0xffff) + m * 51)); this.bots.push({ id: 'botm' + Math.floor(nowB) + m, name: '👻 تابع', x: sp.x, y: sp.y, hp: 50, alive: true, angle: 0, lastFire: nowB + 1500, respawnAt: 0, phase: Math.random() * 6, color: 6 }); }
            this.onFeed(bt.boss9 ? '🕷️ الملكة استدعت تابعين!' : '🌀 الشبح استدعى تابعين!');
          }
        }
        if (bt.boss10 && this.myAlive) {
          const vdx = bt.x - this.myX, vdy = bt.y - this.myY, vd = Math.hypot(vdx, vdy) || 1;
          if (vd < 800 && vd > 50 && nowB > this.dashUntil) {
            const nx2 = this.myX + (vdx / vd) * 85 * dt, ny2 = this.myY + (vdy / vd) * 85 * dt;
            if (!this.obstacles.some((o) => circleRect(nx2, ny2, PLAYER_R, o))) { this.myX = nx2; this.myY = ny2; }
          }
          if (!bt.pulseAt && nowB >= bt.nextPulse) { bt.pulseAt = nowB + 1500; bt.nextPulse = nowB + 5200; this.onFeed('🌌 نبضة فراغ! اخرج من الدايرة'); }
          if (bt.pulseAt && nowB >= bt.pulseAt) {
            bt.pulseAt = 0; const PR = 380;
            this.rings.push({ x: bt.x, y: bt.y, age: 0, life: 0.7, R: PR }); this.burst(bt.x, bt.y, '#7d5fff', 40, 480); Sfx.boom(); this.shakeUntil = Math.max(this.shakeUntil, nowB + 400);
            if (Math.hypot(this.myX - bt.x, this.myY - bt.y) < PR && nowB > this.protectedUntil) {
              if (nowB < this.shieldUntil) this.onFeed('🛡️ الدرع صدّ نبضة الفراغ!');
              else { this.myHp -= 55; this.onHud(this.myHp); this.writeSelf(true); Sfx.hit(); if (this.myHp <= 0) { this.burst(this.myX, this.myY, '#7d5fff', 30, 320); this.die('bot99'); } }
            }
          }
        }
        if (bt.boss2 && nowB >= bt.nextBurst && this.myAlive) {
          bt.nextBurst = nowB + 4000;
          for (let q = 0; q < 14; q++) { const a3 = (q / 14) * Math.PI * 2 + nowB / 1000; this.bullets.push({ id: bt.id + '_r' + Math.floor(nowB) + '_' + q, uid: bt.id, x: bt.x + Math.cos(a3) * 30, y: bt.y + Math.sin(a3) * 30, dx: Math.cos(a3), dy: Math.sin(a3), age: 0, life: 1.4 }); }
          this.rings.push({ x: bt.x, y: bt.y, age: 0, life: 0.5, R: 90 });
          this.burst(bt.x, bt.y, '#a55eea', 20, 320); Sfx.boom();
        }
        if (bt.chargeUntil || bt.chargeAt) { mvx = 0; mvy = 0; }
        let nx = clamp(bt.x + mvx * lvl.spd * (bt.cls === 'tank' ? 0.6 : 1) * (this.mod === 'fast' ? 1.4 : 1) * dt, PLAYER_R, WORLD - PLAYER_R), ny = clamp(bt.y + mvy * lvl.spd * (bt.cls === 'tank' ? 0.6 : 1) * (this.mod === 'fast' ? 1.4 : 1) * dt, PLAYER_R, WORLD - PLAYER_R);
        for (const o of this.obstacles) {
          if (circleRect(nx, ny, PLAYER_R, o)) {
            if (!circleRect(nx, bt.y, PLAYER_R, o)) ny = bt.y;
            else if (!circleRect(bt.x, ny, PLAYER_R, o)) nx = bt.x;
            else { nx = bt.x; ny = bt.y; bt.phase += 2; }
          }
        }
        bt.x = nx; bt.y = ny;
        if (this.myAlive && bt.cls !== 'healer' && dist < (bt.cls === 'sniper' ? 950 : 650) && nowB - bt.lastFire > lvl.fire * (bt.cls === 'sniper' ? 1.7 : 1)) {
          bt.lastFire = nowB + Math.random() * 500;
          const a = bt.angle + (Math.random() - 0.5) * lvl.err * (bt.cls === 'sniper' ? 0.15 : 1);
          (bt.boss ? [-0.25, 0, 0.25] : bt.cls === 'tank' ? [-0.1, 0.1] : [0]).forEach((off, q) => { const a2 = a + off; this.bullets.push({ life: bt.cls === 'sniper' ? 1.5 : 0, id: bt.id + '_' + Math.floor(nowB) + '_' + q, uid: bt.id, x: bt.x + Math.cos(a2) * (PLAYER_R + 6), y: bt.y + Math.sin(a2) * (PLAYER_R + 6), dx: Math.cos(a2), dy: Math.sin(a2), age: 0 }); });
        }
      }

      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        if (b.h) {
          let tb = null, td = 750;
          for (const bt of this.bots) { if (bt.alive) { const dd = Math.hypot(bt.x - b.x, bt.y - b.y); if (dd < td) { td = dd; tb = bt; } } }
          if (tb) {
            const cur = Math.atan2(b.dy, b.dx); let df = Math.atan2(tb.y - b.y, tb.x - b.x) - cur; while (df > Math.PI) df -= 6.283; while (df < -Math.PI) df += 6.283;
            const na = cur + Math.max(-4.5 * dt, Math.min(4.5 * dt, df)); b.dx = Math.cos(na); b.dy = Math.sin(na);
          }
          if (Math.random() < 0.6) this.burst(b.x, b.y, '#ff9f43', 1, 40);
        }
        if (b.boom && b.uid === this.me.uid) {
          if (b.age > 0.8) {
            const ta = Math.atan2(this.myY - b.y, this.myX - b.x);
            const cur = Math.atan2(b.dy, b.dx); let df = ta - cur; while (df > Math.PI) df -= 6.283185; while (df < -Math.PI) df += 6.283185;
            if (Math.abs(df) > 3.0) df = 3.0;
            const na = cur + Math.max(-8 * dt, Math.min(8 * dt, df)); b.dx = Math.cos(na); b.dy = Math.sin(na);
            if (Math.hypot(this.myX - b.x, this.myY - b.y) < PLAYER_R + 40) { this.bullets.splice(i, 1); this.burst(b.x, b.y, '#2ed573', 6, 120); continue; }
          }
          if (Math.random() < 0.5) this.burst(b.x, b.y, '#2ed573', 1, 50);
          b.ang = (b.ang || 0) + 18 * dt;
        }
        b.x += b.dx * BULLET_SPEED * (b.sp || 1) * dt;
        b.y += b.dy * BULLET_SPEED * (b.sp || 1) * dt;
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
            if (bt.alive && !(b.hit && b.hit[bt.id]) && Math.hypot(b.x - bt.x, b.y - bt.y) < PLAYER_R + 4) {
              if (b.pierce) { (b.hit = b.hit || {})[bt.id] = 1; } else dead = true;
              this.rs.hits++;
              let dmgN = BULLET_DMG * (b.h ? 2 : 1) * (b.dm || (b.pierce ? 1.6 : 1)) * (1 + 0.25 * this.up.dmg);
              const crit = Math.random() < (b.flame ? 0.04 : 0.12); if (crit) { dmgN *= 2.2; this.shakeUntil = Math.max(this.shakeUntil, performance.now() + 90); this.burst(bt.x, bt.y, '#ffd32a', 14, 300); Sfx.hit && Sfx.hit(); this.critCount = (this.critCount || 0) + 1; }
              bt.hp -= dmgN;
              this.dmgNums = this.dmgNums || []; this.dmgNums.push({ x: bt.x + (Math.random() - 0.5) * 24, y: bt.y - 30, t: crit ? '💥 ' + Math.round(dmgN) + '!' : Math.round(dmgN), crit, at: performance.now(), big: crit || !!b.h || dmgN >= 40 }); if (this.dmgNums.length > 40) this.dmgNums.shift();
              if (this.up.steal && this.myAlive) { this.myHp = Math.min(MAX_HP, this.myHp + 2 * this.up.steal); this.onHud(this.myHp); }
              this.burst(bt.x, bt.y, '#ff6b81', 8, 180);
              if (bt.hp <= 0) {
                bt.alive = false; bt.respawnAt = performance.now() + 3000;
                this.burst(bt.x, bt.y, '#ffd32a', 28, 300);
                this.onFeed('🤖 قضيت على ' + bt.name);
                if (bt.boss && this.myAlive) {
                  this.weapon = 'laser'; this.weaponUntil = performance.now() + 15000; this.myHp = Math.min(MAX_HP, this.myHp + 60); this.onHud(this.myHp);
                  this.rewardBanner = { text: '🎁 غنيمة الزعيم: ليزر ١٥ث + صحة', until: performance.now() + 3200 };
                  this.slowUntil = performance.now() + 1300; this.shakeUntil = Math.max(this.shakeUntil, performance.now() + 700); for (let q = 0; q < 4; q++) this.rings.push({ x: bt.x, y: bt.y, age: -q * 0.12, life: 0.9, R: 120 + q * 90 }); this.burst(bt.x, bt.y, '#ffffff', 60, 520); this.burst(bt.x, bt.y, '#ffd32a', 50, 420); try { Sfx.boom(); } catch (e3) { /* ignore */ }
                  this.burst(bt.x, bt.y, '#00f5ff', 40, 420); this.onFeed('🎁 غنيمة الزعيم: سلاح الليزر المخترق ١٥ ثانية!');
                }
                Sfx.kill();
                this.ach('kill');
                this.db.ref('rooms/' + this.roomCode + '/players/' + this.me.uid + '/kills').transaction((k) => (k || 0) + 1).catch(() => {});
              }
              if (!b.pierce) break;
            }
          }
        }
        // إصابتي أنا (كل جهاز مسؤول عن لاعبه) — الدرع والحماية بيصدّوا
        if (!dead && b.uid !== this.me.uid && this.myAlive && performance.now() > this.protectedUntil && !((this.mode === 'team' || this.mode === 'coop') && this.teamOf(b.uid) >= 0 && this.teamOf(b.uid) === this.teamOf(this.me.uid))) {
          if (performance.now() < this.shieldUntil) {
            if (Math.hypot(b.x - this.myX, b.y - this.myY) < PLAYER_R + 4) {
              dead = true;
              this.onFeed('🛡️ الدرع صدّ طلقة!');
            }
          } else if (Math.hypot(b.x - this.myX, b.y - this.myY) < PLAYER_R + 4) {
            dead = true;
            this.myHp -= BULLET_DMG * (b.rail ? 3 : 1) * (this.mode === 'oneshot' && String(b.uid).indexOf('bot') !== 0 ? 4 : 1) * (String(b.uid).indexOf('bot') === 0 ? Math.pow(0.82, this.up.arm) * (this.mod === 'rage' ? 1.5 : 1) : 1);
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

      // الدرون
      if (this.nDrone() && this.myAlive && this.bots.length) {
        const nd = performance.now();
        if (nd >= (this.droneAt || 0)) {
          this.droneAt = nd + 1100;
          for (let j = 0; j < this.nDrone(); j++) {
            const da = nd / 700 + j * (6.283 / this.nDrone()), dx0 = this.myX + Math.cos(da) * 52, dy0 = this.myY + Math.sin(da) * 52;
            let best = null, bd = 650;
            for (const bt of this.bots) { if (bt.alive) { const dd = Math.hypot(bt.x - dx0, bt.y - dy0); if (dd < bd) { bd = dd; best = bt; } } }
            if (best) { const aa = Math.atan2(best.y - dy0, best.x - dx0); this.bullets.push({ id: 'drn' + Math.floor(nd) + j, uid: this.me.uid, x: dx0, y: dy0, dx: Math.cos(aa), dy: Math.sin(aa), age: 0, life: 0.9 }); }
          }
        }
      }
      // النيازك
      for (let i = this.meteors.length - 1; i >= 0; i--) {
        const mt = this.meteors[i];
        if (performance.now() >= mt.at) {
          this.meteors.splice(i, 1);
          this.rings.push({ x: mt.x, y: mt.y, age: 0, life: 0.6, R: mt.R + 20 }); this.burst(mt.x, mt.y, '#ff6b35', 36, 400); this.burst(mt.x, mt.y, '#ffd32a', 16, 260); Sfx.boom();
          this.shakeUntil = Math.max(this.shakeUntil, performance.now() + 250);
          if (this.myAlive && Math.hypot(this.myX - mt.x, this.myY - mt.y) < mt.R) {
            if (performance.now() < this.shieldUntil) { this.onFeed('🛡️ الدرع صدّ النيزك!'); }
            else { this.myHp -= 45; this.onHud(this.myHp); this.writeSelf(true); Sfx.hit(); if (this.myHp <= 0) { this.burst(this.myX, this.myY, '#ffd32a', 30, 320); this.die('bot99'); } }
          }
        }
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
      const ub = document.getElementById('btn-ult');
      if (ub) { const u = Math.floor(this.ult || 0); ub.textContent = u >= 100 ? '⚡ جاهز!' : '⚡ ' + u + '٪'; ub.style.opacity = u >= 100 ? '1' : '0.5'; ub.classList.toggle('ult-ready', u >= 100); }
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
        const kcm = this.killCam; let kcDone = false;
        if (kcm && performance.now() < kcm.until) {
          let kt = null, kn2 = '';
          if (this.players[kcm.uid] && this.players[kcm.uid].x !== undefined) { kt = this.players[kcm.uid]; kn2 = kt.name || 'لاعب'; }
          else { const kb2 = this.bots.find((q) => q.id === kcm.uid); if (kb2) { kt = kb2; kn2 = kb2.name; } }
          if (kt) { camX = kt.x; camY = kt.y; this.specName = ''; this.killCamName = kn2; kcDone = true; }
        }
        if (!kcDone) this.killCamName = '';
        if (!kcDone) {
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
      }
      this.cam.x = clamp(camX - innerWidth / 2, 0, WORLD - innerWidth);
      this.cam.y = clamp(camY - innerHeight / 2, 0, WORLD - innerHeight);
      if (WORLD < innerWidth) this.cam.x = (WORLD - innerWidth) / 2;
      if (WORLD < innerHeight) this.cam.y = (WORLD - innerHeight) / 2;

      // ابعت موقعي
      if (this.myAlive) this.writeSelf(false);

      // التقاط القدرات
      if (this.myAlive) {
        const mgOn = performance.now() < (this.magnetUntil || 0);
        if (mgOn && performance.now() > (this._mgRing || 0)) { this._mgRing = performance.now() + 450; this.rings.push({ x: this.myX, y: this.myY, age: 0, life: 0.5, R: 280 }); }
        const pRad = mgOn ? 280 : PLAYER_R + 16;
        for (const pid in this.pickups) {
          const pk = this.pickups[pid];
          const pdx = pk.x - this.myX, pdy = pk.y - this.myY;
          if (pdx * pdx + pdy * pdy >= pRad * pRad) continue;
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
          } else if (type === 'drone') {
            this.droneTmpUntil = performance.now() + 15000; this.onFeed('🚁 درونين مساعدين ١٥ ثانية! بيضربوا أقرب بوت');
          } else if (type === 'mine') {
            this.mineUntil = performance.now() + 15000; this.onFeed('🪤 ألغام ١٥ ثانية! بتسيب ألغام مخفية وراك بتنفجر لما حد يقرب');
          } else if (type === 'boom') {
            this.weapon = 'boom'; this.weaponUntil = performance.now() + 14000; this.onFeed('🪃 بوميرانج ١٤ ثانية! بترميه ويرجعلك وبيضرب في الرايح والجاي');
          } else if (type === 'rail') {
            this.weapon = 'rail'; this.weaponUntil = performance.now() + 12000; this.onFeed('💠 مدفع الريل ١٢ ثانية! طلقة سريعة جداً بتخترق وضررها ضخم');
          } else if (type === 'freeze') {
            this.freezeUntil = performance.now() + 6000; this.onFeed('❄️ تجميد! كل البوتات متجمدة ٦ ثواني'); this.burst(this.myX, this.myY, '#9be7ff', 24, 300);
          } else if (type === 'nuke') {
            const R = 650, nn = performance.now(); this.rings.push({ x: this.myX, y: this.myY, age: 0, life: 0.9, R }); this.nukeFlash = nn + 450; this.shakeUntil = Math.max(this.shakeUntil, nn + 600); Sfx.boom();
            this.burst(this.myX, this.myY, '#ffd32a', 50, 520); this.onFeed('☢️ نووي! ضرر ٧٠ لكل البوتات القريبة');
            for (const bt of this.bots) {
              if (!bt.alive || Math.hypot(bt.x - this.myX, bt.y - this.myY) > R) continue;
              bt.hp -= 70; this.burst(bt.x, bt.y, '#ff6b81', 10, 200);
              if (bt.hp <= 0) { bt.alive = false; bt.respawnAt = nn + 3000; this.burst(bt.x, bt.y, '#ffd32a', 28, 300); this.onFeed('☢️ أبدت ' + bt.name); Sfx.kill(); this.ach('kill'); this.db.ref('rooms/' + this.roomCode + '/players/' + this.me.uid + '/kills').transaction((k) => (k || 0) + 1).catch(() => {}); }
            }
          } else if (type === 'magnet') {
            this.magnetUntil = performance.now() + 10000; this.onFeed('🧲 مغناطيس ١٠ ثواني! بيجذب كل العلب في دايرة كبيرة');
          } else if (type === 'flame') {
            this.weapon = 'flame'; this.weaponUntil = performance.now() + 9000;
            this.onFeed('🔥 قاذف لهب ٩ ثواني! بيحرق البوتات القريبة (ضد البوتات بس)');
          } else if (type === 'homing') {
            this.weapon = 'homing'; this.weaponUntil = performance.now() + 12000;
            this.onFeed('🚀 صواريخ موجهة ١٢ ثانية! بتطارد أقرب بوت');
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
      if (this.mode === 'zone' || this.mode === 'gems' || this.mode === 'flag' || this.mode === 'bomb' || this.mode === 'infect') rows.sort((a, b) => b.zpts - a.zpts || b.kills - a.kills);
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

      for (const mm of (this.mines || [])) {
        const mk = performance.now() - mm.at > 700; ctx.save(); ctx.globalAlpha = mk ? 0.55 + 0.4 * Math.sin(performance.now() / 180) : 0.25;
        ctx.fillStyle = '#2d3436'; ctx.strokeStyle = '#ff4757'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(mm.x, mm.y, 11, 0, 6.283); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ff4757'; ctx.beginPath(); ctx.arc(mm.x, mm.y, 3.5, 0, 6.283); ctx.fill(); ctx.restore();
      }
      for (const po of (this.portals || [])) {
        const pt = performance.now() / 1000, dst = this.portals[po.to];
        ctx.save(); ctx.translate(po.x, po.y);
        const pg = ctx.createRadialGradient(0, 0, 4, 0, 0, 48); pg.addColorStop(0, '#000'); pg.addColorStop(0.6, po.c + '88'); pg.addColorStop(1, po.c + '00');
        ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(0, 0, 48, 0, 6.283); ctx.fill();
        for (let q = 0; q < 3; q++) { ctx.save(); ctx.rotate(pt * (2 + q) * (q % 2 ? -1 : 1)); ctx.strokeStyle = po.c; ctx.globalAlpha = 0.9 - q * 0.2; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, 40 - q * 9, 18 - q * 3, q, 0, 5); ctx.stroke(); ctx.restore(); }
        ctx.restore();
      }
      for (const h of (this.hazards || [])) {
        const tt = performance.now() / 1000;
        if (h.type === 'belt') {
          ctx.save(); ctx.translate(h.x, h.y); ctx.beginPath(); ctx.arc(0, 0, h.r, 0, 6.283); ctx.fillStyle = 'rgba(40,34,20,0.85)'; ctx.fill(); ctx.strokeStyle = '#ffc048'; ctx.lineWidth = 4; ctx.stroke(); ctx.clip();
          ctx.rotate(h.a); const off = (tt * 90) % 50; ctx.strokeStyle = 'rgba(255,192,72,0.8)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
          for (let cx2 = -h.r - 50; cx2 < h.r + 50; cx2 += 50) { const xx = cx2 + off; ctx.beginPath(); ctx.moveTo(xx - 10, -26); ctx.lineTo(xx + 10, 0); ctx.lineTo(xx - 10, 26); ctx.stroke(); }
          ctx.restore(); continue;
        }
        if (h.type === 'hole') {
          const sp = tt * 1.6;
          ctx.save(); ctx.translate(h.x, h.y);
          const hg = ctx.createRadialGradient(0, 0, 8, 0, 0, h.r); hg.addColorStop(0, 'rgba(0,0,0,1)'); hg.addColorStop(0.25, 'rgba(10,0,30,0.95)'); hg.addColorStop(0.6, 'rgba(110,50,200,0.35)'); hg.addColorStop(1, 'rgba(110,50,200,0.04)');
          ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, 0, h.r, 0, 6.283); ctx.fill();
          for (let q = 0; q < 3; q++) { ctx.rotate(sp + q * 2.1); ctx.strokeStyle = 'rgba(190,140,255,' + (0.5 - q * 0.12) + ')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, h.r * (0.9 - q * 0.22), h.r * (0.32 - q * 0.05), 0, 0, 4.2); ctx.stroke(); }
          ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, 0, 36, 0, 6.283); ctx.fill(); ctx.strokeStyle = '#c79bff'; ctx.lineWidth = 3; ctx.stroke();
          ctx.restore(); continue;
        }
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

      if (this.mode === 'bomb' && this.bomb && this.bomb.holder) {
        const bh = this.bomb.holder, hq = bh === this.me.uid ? { x: this.myX, y: this.myY } : (this.players[bh] && typeof this.players[bh].x === 'number' ? this.players[bh] : null);
        if (hq) {
          const left = Math.max(0, this.bomb.at + this.bomb.fuse - this.serverNow()), pul = left < 4000 ? 1 + Math.sin(performance.now() / (60 + left / 40)) * 0.25 : 1;
          ctx.save(); ctx.shadowColor = '#ff4757'; ctx.shadowBlur = 28; ctx.strokeStyle = 'rgba(255,71,87,' + (left < 4000 ? 0.9 : 0.55) + ')'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(hq.x, hq.y, (PLAYER_R + 12) * pul, 0, 6.283); ctx.stroke();
          ctx.font = (34 * pul) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('💣', hq.x, hq.y - PLAYER_R - 34);
          ctx.font = 'bold 16px Cairo, sans-serif'; ctx.fillStyle = left < 4000 ? '#ff4757' : '#fff'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; const tt = (left / 1000).toFixed(1); ctx.strokeText(tt, hq.x, hq.y - PLAYER_R - 60); ctx.fillText(tt, hq.x, hq.y - PLAYER_R - 60); ctx.restore();
        }
      }
      if (this.mode === 'flag' && this.flag) {
        const f = this.flag, hp2 = f.holder === this.me.uid ? { x: this.myX, y: this.myY } : (f.holder && this.players[f.holder] && typeof this.players[f.holder].x === 'number' ? this.players[f.holder] : null);
        const fx = hp2 ? hp2.x : f.x, fy = (hp2 ? hp2.y - 34 : f.y) + Math.sin(performance.now() / 300) * 3;
        ctx.save(); ctx.shadowColor = '#ff4757'; ctx.shadowBlur = 26; ctx.strokeStyle = 'rgba(255,71,87,0.7)'; ctx.lineWidth = 3;
        if (!hp2) { ctx.beginPath(); ctx.arc(f.x, f.y, 42 + Math.sin(performance.now() / 200) * 4, 0, 6.283); ctx.stroke(); }
        ctx.font = '38px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🚩', fx, fy); ctx.restore();
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
        const col = type === 'speed' ? '#ffa502' : type === 'shield' ? '#1e90ff' : type === 'rapid' ? '#a55eea' : type === 'triple' ? '#fd79a8' : type === 'shotgun' ? '#ff6348' : type === 'homing' ? '#ff9f43' : type === 'flame' ? '#ff4500' : type === 'mine' ? '#ff6348' : type === 'boom' ? '#2ed573' : type === 'rail' ? '#ff3df5' : type === 'freeze' ? '#74d7ff' : type === 'nuke' ? '#badc58' : type === 'magnet' ? '#e84393' : type === 'drone' ? '#00cec9' : '#2ed573';
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
          ctx.fillText(type === 'speed' ? '👟' : type === 'rapid' ? '🔫' : type === 'triple' ? '🔱' : type === 'shotgun' ? '💥' : type === 'homing' ? '🚀' : type === 'flame' ? '🔥' : type === 'mine' ? '🪤' : type === 'boom' ? '🪃' : type === 'rail' ? '💠' : type === 'freeze' ? '❄️' : type === 'nuke' ? '☢️' : type === 'magnet' ? '🧲' : type === 'drone' ? '🚁' : '🛡️', pk.x, pk.y + 1);
        }
      }

      // الطلقات
      for (const b of this.bullets) {
        let bcol = b.h ? '#ff9f43' : '#ffd32a';
        if (b.flame) { const fk = Math.min(1, b.age / 0.3); ctx.save(); ctx.globalAlpha = 0.85 - 0.6 * fk; ctx.fillStyle = fk < 0.4 ? '#ffe066' : fk < 0.7 ? '#ff9f1a' : '#ff4500'; ctx.shadowColor = '#ff6b00'; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(b.x, b.y, 6 + 16 * fk, 0, 6.283); ctx.fill(); ctx.restore(); continue; }
        if (b.boom) { ctx.save(); ctx.translate(b.x, b.y); ctx.rotate((b.ang || 0)); ctx.shadowColor = '#2ed573'; ctx.shadowBlur = 16; ctx.font = '30px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🪃', 0, 0); ctx.restore(); continue; }
        if (b.rail) { ctx.save(); ctx.strokeStyle = '#ff3df5'; ctx.shadowColor = '#ff3df5'; ctx.shadowBlur = 22; ctx.globalAlpha = 0.9; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.dx * 380, b.y - b.dy * 380); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.5; ctx.stroke(); ctx.restore(); continue; }
        if (b.pierce) { ctx.save(); ctx.strokeStyle = '#00f5ff'; ctx.shadowColor = '#00f5ff'; ctx.shadowBlur = 18; ctx.globalAlpha = 0.85; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.dx * 120, b.y - b.dy * 120); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke(); ctx.restore(); continue; }
        if (b.uid === this.me.uid && !b.h) { bcol = this.bulletColor(); if (bcol === 'rainbow') bcol = 'hsl(' + ((performance.now() / 4 + b.x) % 360) + ',95%,60%)'; }
        ctx.strokeStyle = bcol; ctx.globalAlpha = 0.5; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.dx * 26, b.y - b.dy * 26); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = bcol;
        ctx.shadowColor = bcol; ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.h ? 8 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // مؤثرات
      if (this._lastHp !== undefined && this.myHp < this._lastHp && this.myAlive) { this.dmgNums = this.dmgNums || []; this.dmgNums.push({ x: this.myX + (Math.random() - 0.5) * 20, y: this.myY - 40, t: '-' + Math.round(this._lastHp - this.myHp), at: performance.now(), big: false, red: true }); }
      this._lastHp = this.myHp;
      if (this.dmgNums && this.dmgNums.length) {
        const dn = performance.now(); this.dmgNums = this.dmgNums.filter((q) => dn - q.at < 800);
        ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 4; ctx.strokeStyle = '#000';
        for (const q of this.dmgNums) { const pr = (dn - q.at) / 800; ctx.globalAlpha = 1 - pr * pr; ctx.font = 'bold ' + (q.crit ? 30 : q.big ? 22 : 16) + 'px Cairo, sans-serif'; ctx.fillStyle = q.red ? '#ff4757' : q.crit ? '#ff9f1a' : q.big ? '#ffd32a' : '#ffffff'; const yy = q.y - pr * (q.crit ? 52 : 36); ctx.strokeText(q.t, q.x, yy); ctx.fillText(q.t, q.x, yy); }
        ctx.restore();
      }
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
      for (const k of (this.strikes || [])) {
        const nw = performance.now(); ctx.save();
        if (!k.done) { const pr = 1 - (k.at - nw) / 1200; ctx.globalAlpha = 0.25 + 0.3 * Math.sin(nw / 60) ** 2; ctx.fillStyle = '#fff176'; ctx.beginPath(); ctx.arc(k.x, k.y, k.r * (0.4 + 0.6 * pr), 0, 6.283); ctx.fill(); ctx.globalAlpha = 0.95; ctx.strokeStyle = '#ffd32a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(k.x, k.y, k.r, 0, 6.283); ctx.stroke(); ctx.font = '26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⚡', k.x, k.y); }
        else { ctx.globalAlpha = Math.max(0, 1 - (nw - k.flash) / 350); ctx.fillStyle = '#ffffff'; ctx.fillRect(k.x - 14, k.y - 700, 28, 700); ctx.beginPath(); ctx.arc(k.x, k.y, k.r, 0, 6.283); ctx.fill(); }
        ctx.restore();
      }
      for (const ip of (this.icePools || [])) {
        const nw = performance.now(); if (nw >= ip.until) continue;
        ctx.save(); ctx.globalAlpha = Math.min(0.45, (ip.until - nw) / 1000 * 0.45); ctx.fillStyle = '#7efff5'; ctx.beginPath(); ctx.arc(ip.x, ip.y, ip.r, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 0.9; ctx.strokeStyle = '#d7fffb'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]); ctx.stroke(); ctx.setLineDash([]); ctx.font = '30px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('❄️', ip.x, ip.y); ctx.restore();
      }
      for (const bt of this.bots) {
        if (bt.boss5 && bt.alive && bt.chargeAt) { ctx.save(); ctx.globalAlpha = 0.35 + 0.3 * Math.sin(performance.now() / 50); ctx.strokeStyle = '#ff4757'; ctx.lineWidth = 46; ctx.beginPath(); ctx.moveTo(bt.x, bt.y); ctx.lineTo(bt.x + bt.cdx * 500, bt.y + bt.cdy * 500); ctx.stroke(); ctx.restore(); }
      }
      for (const mt of this.meteors) {
        const k = Math.min(1, (performance.now() - mt.t0) / (mt.at - mt.t0)), pl = 0.6 + 0.4 * Math.sin(performance.now() / 70);
        ctx.save(); ctx.globalAlpha = 0.25 + 0.3 * pl; ctx.fillStyle = '#ff4757'; ctx.beginPath(); ctx.arc(mt.x, mt.y, mt.R, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 0.9; ctx.strokeStyle = '#ff9f43'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(mt.x, mt.y, mt.R * k, 0, 6.283); ctx.stroke();
        ctx.globalAlpha = 1; ctx.font = '34px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('☄️', mt.x + (1 - k) * 120, mt.y - (1 - k) * 380); ctx.restore();
      }
      for (const r of this.rings) {
        if (r.age < 0) continue;
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
        if (this.mode === 'infect' && (isMe ? this.inf : p.inf)) { ctx.save(); const ip = 0.6 + 0.4 * Math.sin(performance.now() / 150); ctx.strokeStyle = '#7bed9f'; ctx.shadowColor = '#2ed573'; ctx.shadowBlur = 18; ctx.lineWidth = 4; ctx.globalAlpha = alive ? ip : 0.2; ctx.beginPath(); ctx.arc(x, y, PLAYER_R + 8, 0, 6.283); ctx.stroke(); ctx.fillStyle = 'rgba(46,213,115,0.25)'; ctx.fill(); ctx.font = '18px sans-serif'; ctx.textAlign = 'center'; ctx.globalAlpha = 1; ctx.fillText('🧟', x, y - PLAYER_R - 22); ctx.restore(); }
        if (this.mode === 'team' || this.mode === 'coop') { const tm = this.teamOf(uid); if (tm >= 0) { ctx.save(); ctx.strokeStyle = this.mode === 'coop' ? '#2ed573' : tm ? '#3b82f6' : '#ef4444'; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 12; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, y, PLAYER_R + 6, 0, 6.283); ctx.stroke(); ctx.restore(); } }
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
      if (this.nDrone() && this.myAlive) {
        for (let j = 0; j < this.nDrone(); j++) {
          const da = performance.now() / 700 + j * (6.283 / this.nDrone()), px = this.myX + Math.cos(da) * 52, py = this.myY + Math.sin(da) * 52;
          ctx.save(); ctx.shadowColor = '#18dcff'; ctx.shadowBlur = 12; ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🚁', px, py); ctx.restore();
        }
      }
      for (const bt of this.bots) {
        if (bt.cls === 'sniper' && bt.alive && this.myAlive && Math.hypot(this.myX - bt.x, this.myY - bt.y) < 950) {
          ctx.save(); ctx.globalAlpha = 0.25 + 0.2 * Math.sin(performance.now() / 120); ctx.strokeStyle = '#ff4757'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bt.x, bt.y); ctx.lineTo(this.myX, this.myY); ctx.stroke(); ctx.restore();
        }
        if (bt.cls === 'healer' && bt.alive) { ctx.save(); ctx.globalAlpha = 0.18 + 0.1 * Math.sin(performance.now() / 300); ctx.strokeStyle = '#2ed573'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(bt.x, bt.y, 280, 0, 6.283); ctx.stroke(); ctx.restore(); }
      }
      for (const bt of this.bots) drawPlayer(bt.id, { name: bt.name, avatar: bt.boss ? '👹' : (bt.av || '🤖'), color: bt.color, x: bt.x, y: bt.y, alive: bt.alive, hp: Math.min(MAX_HP, bt.hp * MAX_HP / (bt.max || MAX_HP)), angle: bt.angle }, false);
      for (const bt of this.bots) {
        if (!bt.boss || !bt.alive) continue;
        if (bt.boss10) {
          const vt = performance.now() / 1000; ctx.save(); ctx.translate(bt.x, bt.y);
          for (let q = 0; q < 3; q++) { ctx.rotate(vt * (1 + q * 0.4)); ctx.strokeStyle = 'rgba(125,95,255,' + (0.5 - q * 0.12) + ')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, 120 - q * 25, 45 - q * 8, q, 0, 6.283); ctx.stroke(); }
          if (bt.pulseAt) { const pk = 1 - (bt.pulseAt - performance.now()) / 1500; ctx.fillStyle = 'rgba(255,40,80,' + (0.12 + 0.2 * Math.sin(performance.now() / 60) ** 2) + ')'; ctx.strokeStyle = 'rgba(255,80,110,0.9)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 380, 0, 6.283); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 380 * Math.max(0.05, pk), 0, 6.283); ctx.stroke(); }
          ctx.restore();
        }
        const bc = bt.boss10 ? '#7d5fff' : bt.boss9 ? '#e056fd' : bt.boss8 ? '#ff2e63' : bt.boss7 ? '#fff176' : bt.boss6 ? '#2ed573' : bt.boss5 ? '#7efff5' : bt.boss4 ? '#ff6b35' : bt.boss3 ? '#18dcff' : bt.boss2 ? '#a55eea' : '#ff4757'; ctx.strokeStyle = bc; ctx.lineWidth = 5; ctx.shadowColor = bc; ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.arc(bt.x, bt.y, PLAYER_R + 12, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(bt.x - 40, bt.y - PLAYER_R - 28, 80, 8);
        ctx.fillStyle = bt.boss10 ? '#7d5fff' : bt.boss9 ? '#e056fd' : bt.boss8 ? '#ff2e63' : bt.boss7 ? '#fff176' : bt.boss6 ? '#2ed573' : bt.boss5 ? '#7efff5' : bt.boss4 ? '#ff6b35' : bt.boss3 ? '#18dcff' : bt.boss2 ? '#a55eea' : '#ff4757'; ctx.fillRect(bt.x - 40, bt.y - PLAYER_R - 28, 80 * Math.max(0, bt.hp) / (bt.max || 300), 8);
        ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd32a'; ctx.fillText('\u{1F451}', bt.x, bt.y - PLAYER_R - 38);
      }
      for (const uid in this.players) drawPlayer(uid, this.players[uid], false);
      drawPlayer(this.me.uid, { name: this.me.name, avatar: this.me.avatar, color: this.me.color }, true);

      ctx.restore();

      if (this.bots.length && this.mod === 'dark' && this.myAlive) {
        const mx0 = this.myX - this.cam.x, my0 = this.myY - this.cam.y;
        const dg = ctx.createRadialGradient(mx0, my0, 90, mx0, my0, 330); dg.addColorStop(0, 'rgba(0,0,10,0)'); dg.addColorStop(1, 'rgba(0,0,10,0.93)');
        ctx.fillStyle = dg; ctx.fillRect(0, 0, innerWidth, innerHeight);
      }
      if (this.bots.length) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (this.mod) { ctx.font = 'bold 13px Cairo, sans-serif'; ctx.fillStyle = '#ffd32a'; ctx.fillText((MODS[this.mod] || {}).t || '', innerWidth / 2, innerWidth < 641 ? innerHeight - 238 : 100); }
        ctx.font = 'bold 15px Cairo, sans-serif'; ctx.fillStyle = '#7bdff2';
        ctx.fillText('🌊 موجة ' + this.wave + ' | بوتات: ' + this.bots.filter((q) => q.alive).length, innerWidth / 2, innerWidth < 641 ? innerHeight - 215 : 78);
        const mb = this.modBanner;
        if (mb && performance.now() < mb.until) {
          ctx.globalAlpha = Math.min(1, (mb.until - performance.now()) / 600); ctx.font = 'bold 24px Cairo, sans-serif'; ctx.lineWidth = 5; ctx.strokeStyle = '#000'; ctx.fillStyle = '#ffd32a';
          ctx.strokeText(mb.text, innerWidth / 2, innerHeight * 0.3 + 46); ctx.fillText(mb.text, innerWidth / 2, innerHeight * 0.3 + 46); ctx.globalAlpha = 1;
        }
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
        ctx.textAlign = 'right'; ctx.fillText('💎 ' + (this.zpts || 0), innerWidth - 14, 198);
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
        ctx.font = 'bold 14px Cairo, sans-serif'; ctx.fillStyle = this.weapon === 'boom' ? '#2ed573' : this.weapon === 'rail' ? '#ff3df5' : this.weapon === 'flame' ? '#ff4500' : this.weapon === 'laser' ? '#00f5ff' : this.weapon === 'rapid' ? '#a55eea' : this.weapon === 'shotgun' ? '#ff6348' : this.weapon === 'homing' ? '#ff9f43' : '#fd79a8';
        ctx.fillText((this.weapon === 'boom' ? '🪃 بوميرانج ' : this.weapon === 'rail' ? '💠 ريل ' : this.weapon === 'flame' ? '🔥 لهب ' : this.weapon === 'laser' ? '⚡ ليزر ' : this.weapon === 'rapid' ? '🔫 رشاش ' : this.weapon === 'shotgun' ? '💥 شوتجن ' : this.weapon === 'homing' ? '🚀 موجّه ' : '🔱 ثلاثي ') + Math.ceil(wl / 1000) + 'ث', innerWidth / 2, innerHeight - 170);
      }
      if (performance.now() < (this.freezeUntil || 0) || performance.now() < (this.nukeFlash || 0)) {
        const fn = performance.now(), nf = fn < (this.nukeFlash || 0);
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (nf) { ctx.fillStyle = 'rgba(255,255,220,' + (0.7 * ((this.nukeFlash - fn) / 450)) + ')'; ctx.fillRect(0, 0, innerWidth, innerHeight); }
        else { const fl = (this.freezeUntil - fn) / 1000; ctx.fillStyle = 'rgba(120,200,255,' + (fl < 1 ? 0.12 * fl : 0.12) + ')'; ctx.fillRect(0, 0, innerWidth, innerHeight); ctx.textAlign = 'center'; ctx.fillStyle = '#9be7ff'; ctx.font = 'bold 16px Cairo, sans-serif'; ctx.fillText('❄️ تجميد ' + fl.toFixed(1) + 'ث', innerWidth / 2, 100); }
        ctx.restore();
      }
      if (!this.myAlive && this.killCamName) {
        const kk = this.killCam ? Math.min(1, (performance.now() - this.killCam.t0) / 300) : 1, bh = 46 * kk;
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, innerWidth, bh); ctx.fillRect(0, innerHeight - bh, innerWidth, bh);
        const vg = ctx.createRadialGradient(innerWidth / 2, innerHeight / 2, Math.min(innerWidth, innerHeight) * 0.3, innerWidth / 2, innerHeight / 2, Math.max(innerWidth, innerHeight) * 0.75); vg.addColorStop(0, 'rgba(255,0,0,0)'); vg.addColorStop(1, 'rgba(160,0,20,0.55)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, innerWidth, innerHeight);
        ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 18px Cairo, sans-serif'; ctx.fillText('🎥 كاميرا القتل: ' + this.killCamName + ' هو اللي قتلك', innerWidth / 2, 30);
        ctx.fillStyle = '#ff4757'; ctx.font = 'bold 14px Cairo, sans-serif'; ctx.fillText('● REC', 40, innerHeight - 16); ctx.restore();
      }
      if (!this.myAlive && this.specName) {
        ctx.font = 'bold 16px Cairo, sans-serif'; ctx.fillStyle = '#fff';
        ctx.fillText('👁️ بتتفرج على ' + this.specName + ' (اضغط للتبديل)', innerWidth / 2, 70);
      }

      if (this.rewardBanner && performance.now() < this.rewardBanner.until) { ctx.save(); ctx.font = 'bold 26px Cairo, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#00f5ff'; ctx.shadowColor = '#00f5ff'; ctx.shadowBlur = 14; ctx.fillText(this.rewardBanner.text, innerWidth / 2, 150); ctx.restore(); }
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
      for (const po of (this.portals || [])) { c.fillStyle = po.c; c.beginPath(); c.arc(po.x * sc, po.y * sc, 2.5, 0, 6.283); c.fill(); }
      for (const h of (this.hazards || [])) { c.fillStyle = h.type === 'hole' ? 'rgba(160,90,255,0.7)' : h.type === 'lava' ? 'rgba(255,90,30,0.65)' : h.type === 'belt' ? 'rgba(255,192,72,0.6)' : 'rgba(160,225,255,0.4)'; c.beginPath(); c.arc(h.x * sc, h.y * sc, h.r * sc, 0, Math.PI * 2); c.fill(); }
      const sm = this.stormInfo();
      if (sm) { c.strokeStyle = '#ff4757'; c.lineWidth = 2; c.beginPath(); c.arc(sm.x * sc, sm.y * sc, sm.r * sc, 0, Math.PI * 2); c.stroke(); }
      if (this.mode === 'flag' && this.flag) { const f = this.flag, hq = f.holder === this.me.uid ? { x: this.myX, y: this.myY } : (f.holder && this.players[f.holder] && typeof this.players[f.holder].x === 'number' ? this.players[f.holder] : f); c.fillStyle = '#ff4757'; c.fillRect(hq.x * sc - 4, hq.y * sc - 4, 8, 8); }
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

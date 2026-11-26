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
    rafId: null, lastTs: 0,
    onRoundEnd: null, onFeed: null, onHud: null,
    seed: 1,
    ended: false,

    start(opts) {
      this.db = opts.db; this.roomCode = opts.roomCode;
      this.me = opts.me; this.host = opts.host;
      this.seed = opts.seed || 1;
      this.endsAt = opts.endsAt || 0;
      this.onRoundEnd = opts.onRoundEnd; this.onFeed = opts.onFeed || (() => {}); this.onHud = opts.onHud || (() => {});
      this.canvas = document.getElementById('game-canvas');
      this.ctx = this.canvas.getContext('2d');
      this.running = true; this.ended = false;
      this.bullets = []; this.players = {};
      this.genObstacles();
      this.resize();
      window.addEventListener('resize', this._resize = () => this.resize());
      this.bindInput();
      this.listenDb();
      // مكاني الابتدائي
      const rnd = mulberry32(this.seed + hashCode(this.me.uid));
      const p = this.freeSpot(rnd);
      this.myX = p.x; this.myY = p.y; this.myAngle = 0;
      this.myHp = MAX_HP; this.myAlive = true;
      this.writeSelf(true);
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
      for (let i = 0; i < 16; i++) {
        const w = 90 + rnd() * 220, h = 90 + rnd() * 220;
        this.obstacles.push({
          x: 120 + rnd() * (WORLD - 240 - w),
          y: 120 + rnd() * (WORLD - 240 - h),
          w, h,
        });
      }
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
        this.bullets.push({ id: e.id, uid: e.uid, x: e.x, y: e.y, dx: e.dx, dy: e.dy, age: 0 });
        if (e.uid !== this.me.uid) Sfx.shoot(0.25);
      } else if (e.t === 'hit') {
        // شيل الطلقة اللي أصابت
        const i = this.bullets.findIndex(b => b.id === e.bulletId);
        if (i >= 0) this.bullets.splice(i, 1);
        if (e.target === this.me.uid) Sfx.hit();
      } else if (e.t === 'kill') {
        const killer = e.by === this.me.uid ? (this.me.name) : (this.players[e.by] && this.players[e.by].name) || 'لاعب';
        const victim = e.target === this.me.uid ? (this.me.name) : (this.players[e.target] && this.players[e.target].name) || 'لاعب';
        this.onFeed(`☠️ ${killer} قضى على ${victim}`);
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
      }).catch(() => {});
    },

    shoot() {
      const now = performance.now();
      if (now - this.lastFire < FIRE_COOLDOWN || !this.myAlive) return;
      this.lastFire = now;
      const id = this.me.uid.slice(0, 4) + '_' + now + '_' + Math.floor(Math.random() * 999);
      const dx = Math.cos(this.myAngle), dy = Math.sin(this.myAngle);
      const bx = this.myX + dx * (PLAYER_R + 6), by = this.myY + dy * (PLAYER_R + 6);
      this.bullets.push({ id, uid: this.me.uid, x: bx, y: by, dx, dy, age: 0 });
      this.db.ref('rooms/' + this.roomCode + '/events').push({
        t: 'shoot', id, uid: this.me.uid,
        x: Math.round(bx), y: Math.round(by),
        dx: Math.round(dx * 1000) / 1000, dy: Math.round(dy * 1000) / 1000,
        ts: firebase.database.ServerValue.TIMESTAMP,
      }).catch(() => {});
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
      if (killerUid && killerUid !== this.me.uid) {
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
      this._kd = (e) => { this.keys[e.key.toLowerCase()] = true; if (e.key === ' ') e.preventDefault(); };
      this._ku = (e) => { this.keys[e.key.toLowerCase()] = false; };
      this._mm = (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; };
      this._md = (e) => { if (e.target.id === 'game-canvas') this.mouse.down = true; };
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

      // الريسبون
      if (!this.myAlive && performance.now() >= this.respawnAt) {
        const rnd = mulberry32(Date.now() & 0xffff);
        const p = this.freeSpot(rnd);
        this.myX = p.x; this.myY = p.y; this.myHp = MAX_HP; this.myAlive = true;
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
        const len = Math.hypot(mx, my);
        if (len > 0.01) {
          if (len > 1) { mx /= len; my /= len; }
          let nx = this.myX + mx * SPEED * dt;
          let ny = this.myY + my * SPEED * dt;
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
        }

        // التصويب
        if (this.joyR.active && Math.hypot(this.joyR.dx, this.joyR.dy) > 0.25) {
          this.myAngle = Math.atan2(this.joyR.dy, -this.joyR.dx); // الاتجاه: لاحظ RTL لا يأثر على الإحداثيات
          this.myAngle = Math.atan2(this.joyR.dy, this.joyR.dx);
          this.shoot();
        } else if (!('ontouchstart' in window) || this.mouse.down) {
          // بالماوس: حوّل لإحداثيات العالم
          const wx = this.cam.x + this.mouse.x, wy = this.cam.y + this.mouse.y;
          this.myAngle = Math.atan2(wy - this.myY, wx - this.myX);
          if (this.mouse.down || this.keys[' ']) this.shoot();
        }
      }

      // الطلقات
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        b.x += b.dx * BULLET_SPEED * dt;
        b.y += b.dy * BULLET_SPEED * dt;
        b.age += dt;
        let dead = b.age > BULLET_LIFE || b.x < 0 || b.x > WORLD || b.y < 0 || b.y > WORLD;
        if (!dead) {
          for (const o of this.obstacles) {
            if (b.x > o.x && b.x < o.x + o.w && b.y > o.y && b.y < o.y + o.h) { dead = true; break; }
          }
        }
        // إصابتي أنا (كل جهاز مسؤول عن لاعبه)
        if (!dead && b.uid !== this.me.uid && this.myAlive) {
          if (Math.hypot(b.x - this.myX, b.y - this.myY) < PLAYER_R + 4) {
            dead = true;
            this.myHp -= BULLET_DMG;
            this.onHud(this.myHp);
            this.writeSelf(true);
            this.db.ref('rooms/' + this.roomCode + '/events').push({
              t: 'hit', bulletId: b.id, target: this.me.uid, by: b.uid,
              ts: firebase.database.ServerValue.TIMESTAMP,
            }).catch(() => {});
            Sfx.hit();
            if (this.myHp <= 0) this.die(b.uid);
          }
        }
        if (dead) this.bullets.splice(i, 1);
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
      this.cam.x = clamp(this.myX - innerWidth / 2, 0, WORLD - innerWidth);
      this.cam.y = clamp(this.myY - innerHeight / 2, 0, WORLD - innerHeight);
      if (WORLD < innerWidth) this.cam.x = (WORLD - innerWidth) / 2;
      if (WORLD < innerHeight) this.cam.y = (WORLD - innerHeight) / 2;

      // ابعت موقعي
      if (this.myAlive) this.writeSelf(false);

      // حدّث الواجهة
      const left = Math.max(0, this.endsAt - this.serverNow());
      const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
      document.getElementById('hud-timer').textContent = `${mm}:${String(ss).padStart(2, '0')}`;
      document.getElementById('hud-kills').textContent = this.kills || 0;
      document.getElementById('hud-deaths').textContent = this.deaths || 0;
      document.getElementById('hud-hp-fill').style.width = Math.max(0, this.myHp) + '%';
    },

    finishRound() {
      if (this.ended) return;
      this.ended = true;
      // الهوست بيغيّر الحالة — الكل هيسمع ويطلع للنتائج
      this.db.ref('rooms/' + this.roomCode + '/meta').update({ state: 'ended' }).catch(() => {});
    },

    collectResults() {
      const rows = [];
      for (const uid in this.players) {
        const p = this.players[uid];
        rows.push({ uid, name: p.name, avatar: p.avatar, kills: p.kills || 0, deaths: p.deaths || 0 });
      }
      // أضفني أنا
      rows.push({ uid: this.me.uid, name: this.me.name, avatar: this.me.avatar, kills: this.kills || 0, deaths: this.deaths || 0 });
      rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      return rows;
    },

    // ============ الرسم ============
    draw() {
      const ctx = this.ctx, dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // الخلفية
      const g = ctx.createLinearGradient(0, 0, 0, innerHeight);
      g.addColorStop(0, '#101426'); g.addColorStop(1, '#0b0e1a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      ctx.save();
      ctx.translate(-this.cam.x, -this.cam.y);

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

      // الحواجز
      for (const o of this.obstacles) {
        ctx.fillStyle = '#222a52';
        roundRect(ctx, o.x, o.y, o.w, o.h, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // الطلقات
      for (const b of this.bullets) {
        ctx.fillStyle = '#ffd32a';
        ctx.shadowColor = '#ffd32a'; ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

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
      for (const uid in this.players) drawPlayer(uid, this.players[uid], false);
      drawPlayer(this.me.uid, { name: this.me.name, avatar: this.me.avatar, color: this.me.color }, true);

      ctx.restore();
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
    win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.beep(f, 0.18, 'triangle', 0.08), i * 130)); },
  };

  window.ArenaGame = Game;
  window.ArenaSfx = Sfx;
  window.ARENA = { WORLD, MAX_HP, PALETTE };
})();

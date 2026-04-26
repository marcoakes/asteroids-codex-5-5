(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var touchButtons = Array.prototype.slice.call(document.querySelectorAll('[data-key]'));
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  var TAU = Math.PI * 2;
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randi(a, b) { return Math.floor(rand(a, b)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrap(v, m) { return ((v % m) + m) % m; }
  function wrapDist2(ax, ay, bx, by) {
    var dx = Math.abs(ax - bx); if (dx > W / 2) dx = W - dx;
    var dy = Math.abs(ay - by); if (dy > H / 2) dy = H - dy;
    return dx * dx + dy * dy;
  }

  // ---------- Audio ----------
  var AC = null, master = null;
  function initAudio() {
    if (AC) return;
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain(); master.gain.value = 0.35; master.connect(AC.destination);
    } catch (e) {}
  }
  function tone(f, d, t, v, sl) {
    if (!AC) return;
    var o = AC.createOscillator(), g = AC.createGain();
    o.type = t || 'square'; o.frequency.value = f;
    if (sl) o.frequency.exponentialRampToValueAtTime(Math.max(40, f * sl), AC.currentTime + d);
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(v || 0.12, AC.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + d);
    o.connect(g); g.connect(master); o.start(); o.stop(AC.currentTime + d + 0.02);
  }
  function nz(d, v, f) {
    if (!AC) return;
    var buf = AC.createBuffer(1, AC.sampleRate * d, AC.sampleRate);
    var dd = buf.getChannelData(0);
    for (var i = 0; i < dd.length; i++) dd[i] = (Math.random() * 2 - 1) * (1 - i / dd.length);
    var s = AC.createBufferSource(); s.buffer = buf;
    var fi = AC.createBiquadFilter(); fi.type = 'lowpass'; fi.frequency.value = f || 1200;
    var g = AC.createGain(); g.gain.value = v || 0.2;
    s.connect(fi); fi.connect(g); g.connect(master); s.start();
  }
  function sfxFire() { tone(920, 0.08, 'square', 0.07, 0.4); }
  function sfxBoom() { nz(0.45, 0.38, 400); tone(80, 0.35, 'sawtooth', 0.18, 0.3); }
  function sfxPower() { tone(1200, 0.08, 'sine', 0.14, 1.5); setTimeout(function () { tone(1600, 0.1, 'sine', 0.12, 1.5); }, 70); }
  function sfxDead() { tone(220, 0.6, 'sawtooth', 0.22, 0.2); setTimeout(function () { tone(110, 0.8, 'sawtooth', 0.18, 0.2); }, 180); }
  function sfxWarp() { tone(1600, 0.25, 'sine', 0.1, 0.2); }
  function sfxUfo() { tone(320, 0.12, 'sawtooth', 0.08, 1.3); }

  // ---------- Input ----------
  var keys = {}, pressed = {};
  function setKeyState(key, down) {
    if (down) {
      if (!keys[key]) pressed[key] = true;
      keys[key] = true;
    } else {
      keys[key] = false;
    }
  }
  function norm(e) {
    var k = e.key;
    if (k === 'ArrowLeft') return 'left';
    if (k === 'ArrowRight') return 'right';
    if (k === 'ArrowUp') return 'up';
    if (k === 'ArrowDown') return 'down';
    if (k === ' ') return 'fire';
    if (k === 'Shift') return 'warp';
    if (k === 'Enter') return 'boost';
    if (k === 'Escape') return 'pause';
    return k.toLowerCase();
  }
  window.addEventListener('keydown', function (e) {
    var k = norm(e);
    if (['left', 'right', 'up', 'down', 'fire', 'boost'].indexOf(k) !== -1) e.preventDefault();
    setKeyState(k, true);
  });
  window.addEventListener('keyup', function (e) { setKeyState(norm(e), false); });
  window.addEventListener('blur', function () { keys = {}; pressed = {}; });

  // Click / tap anywhere to start / dismiss
  window.addEventListener('mousedown', function () { pressed['any'] = true; });
  window.addEventListener('touchstart', function (e) { e.preventDefault(); pressed['any'] = true; }, { passive: false });
  touchButtons.forEach(function (button) {
    var key = button.getAttribute('data-key');
    function down(e) {
      e.preventDefault();
      pressed['any'] = true;
      setKeyState(key, true);
      button.classList.add('is-active');
    }
    function up(e) {
      if (e) e.preventDefault();
      setKeyState(key, false);
      button.classList.remove('is-active');
    }
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('pointerleave', up);
  });

  // ---------- State ----------
  var state = 'menu';
  var ship, bullets = [], ufoBullets = [], rocks = [], ufos = [], particles = [], pickups = [], floats = [];
  var score = 0, best = 0, wave = 0, lives = 3, kills = 0, combo = 0, comboT = 0;
  var shake = 0, flash = 0, waveT = 0, nextUfo = 0, respawnT = 0, deathT = 0;
  var pulseText = '', pulseT = 0;
  var focus = { charge: 0, max: 100, active: 0, cooldown: 0 };
  var director = { heat: 0.18, label: 'Calculating' };
  try { best = parseInt(localStorage.getItem('ac55_best') || localStorage.getItem('ao47b') || '0', 10) || 0; } catch (e) {}

  var POW = {
    shield: { t: 0, max: 12, label: 'SHIELD', color: '#6ff' },
    triple: { t: 0, max: 14, label: 'TRIPLE', color: '#ff7acd' },
    rapid:  { t: 0, max: 12, label: 'RAPID',  color: '#ffb14a' },
    pierce: { t: 0, max: 10, label: 'PIERCE', color: '#9fffa3' }
  };

  var SHIP = { r: 14, rotSpeed: 4.8, thrust: 260, maxSpeed: 380, friction: 0.35, fireCd: 0.22, bulletSpeed: 620, bulletLife: 0.95 };
  var MODE_LABELS = ['Steady', 'Escalating', 'Ferocious', 'Cataclysmic'];

  function makeShip(x, y) {
    return { x: x, y: y, vx: 0, vy: 0, angle: -Math.PI / 2, r: SHIP.r, alive: true, invuln: 2.5, thrusting: false, fireCd: 0, warpCd: 0 };
  }

  function saveBest() {
    try { localStorage.setItem('ac55_best', String(best)); } catch (e) {}
  }

  function updateDirector() {
    director.heat = clamp(0.18 + wave * 0.045 + combo * 0.03 + kills * 0.0025 - lives * 0.02, 0, 1);
    var idx = Math.min(MODE_LABELS.length - 1, Math.floor(director.heat * MODE_LABELS.length));
    director.label = MODE_LABELS[idx];
  }

  function chargeFocus(amount, x, y) {
    if (focus.active > 0) return;
    focus.charge = clamp(focus.charge + amount, 0, focus.max);
    if (x !== undefined && y !== undefined && amount >= 6) {
      floats.push({ x: x, y: y, t: 0, text: '+FOCUS', color: '#80ffe8' });
    }
  }

  function activateOverdrive() {
    if (focus.active > 0 || focus.cooldown > 0 || focus.charge < focus.max) return false;
    focus.active = 4.8;
    focus.cooldown = 9;
    focus.charge = 0;
    flash = Math.max(flash, 0.22);
    shake = Math.max(shake, 10);
    pulseText = 'OVERDRIVE ENGAGED';
    pulseT = 1.4;
    return true;
  }

  function makeRock(size, x, y, vx, vy) {
    var r = size === 3 ? rand(44, 54) : size === 2 ? rand(24, 30) : rand(12, 16);
    var verts = []; var n = randi(10, 14);
    for (var i = 0; i < n; i++) verts.push({ a: (i / n) * TAU, r: r * rand(0.72, 1.15) });
    return {
      x: x, y: y,
      vx: vx !== undefined ? vx : rand(-50, 50),
      vy: vy !== undefined ? vy : rand(-50, 50),
      r: r, size: size, verts: verts, angle: rand(0, TAU), spin: rand(-1.2, 1.2)
    };
  }

  function spawnRock(size) {
    var x, y;
    for (var tries = 0; tries < 20; tries++) {
      x = rand(0, W); y = rand(0, H);
      if (!ship || wrapDist2(x, y, ship.x, ship.y) > 220 * 220) break;
    }
    var speed = rand(25 + wave * 4, 55 + wave * 7);
    var a = rand(0, TAU);
    rocks.push(makeRock(size, x, y, Math.cos(a) * speed, Math.sin(a) * speed));
  }

  function breakRock(r) {
    if (r.size > 1) {
      for (var i = 0; i < 2; i++) {
        var a = rand(0, TAU), sp = 40 + wave * 5 + rand(0, 60);
        rocks.push(makeRock(r.size - 1, r.x + Math.cos(a) * 4, r.y + Math.sin(a) * 4,
          r.vx * 0.5 + Math.cos(a) * sp, r.vy * 0.5 + Math.sin(a) * sp));
      }
    }
    for (var p = 0; p < (r.size === 3 ? 18 : r.size === 2 ? 12 : 8); p++) {
      var aa = rand(0, TAU), ss = rand(40, 200);
      particles.push({ x: r.x, y: r.y, vx: Math.cos(aa) * ss, vy: Math.sin(aa) * ss, life: rand(0.4, 0.9), max: 0.9, color: '#9abbd6', r: rand(1, 2.2) });
    }
    if (Math.random() < 0.05) spawnPickup(r.x, r.y);
  }

  function spawnUfo() {
    var small = wave > 4 && Math.random() < Math.min(0.55, 0.15 + wave * 0.03);
    var sx = Math.random() < 0.5 ? -30 : W + 30;
    var ufo = { x: sx, y: rand(H * 0.15, H * 0.85),
      vx: sx < 0 ? rand(70, 110) : -rand(70, 110), vy: 0,
      r: small ? 10 : 16, small: small, fireCd: rand(1.2, 2.0), dirT: rand(1.2, 2.5),
      color: small ? '#ff7acd' : '#ffb14a' };
    ufos.push(ufo);
    sfxUfo();
  }

  var PTYPES = [
    { key: 'shield', color: '#6ff',    letter: 'S' },
    { key: 'triple', color: '#ff7acd', letter: '3' },
    { key: 'rapid',  color: '#ffb14a', letter: 'R' },
    { key: 'pierce', color: '#9fffa3', letter: 'P' },
    { key: 'life',   color: '#ff4776', letter: '♥' }
  ];
  function spawnPickup(x, y) {
    var t = PTYPES[randi(0, PTYPES.length)];
    pickups.push({ x: x, y: y, vx: rand(-30, 30), vy: rand(-30, 30), r: 13, life: 14, type: t.key, color: t.color, letter: t.letter, pulse: 0 });
  }
  function applyPickup(p) {
    sfxPower();
    if (p.type === 'life') { lives++; }
    else { POW[p.type].t = POW[p.type].max; }
    chargeFocus(8, p.x, p.y);
  }

  function newGame() {
    ship = makeShip(W / 2, H / 2);
    bullets = []; ufoBullets = []; rocks = []; ufos = []; particles = []; pickups = []; floats = [];
    score = 0; wave = 0; lives = 3; kills = 0; combo = 0; comboT = 0; shake = 0; flash = 0;
    respawnT = 0; deathT = 0;
    pulseText = 'SIMULATION LIVE'; pulseT = 1.1;
    focus.charge = 0; focus.active = 0; focus.cooldown = 0;
    for (var k in POW) POW[k].t = 0;
    nextUfo = 18; waveT = 0;
    updateDirector();
    startWave();
  }
  function startWave() {
    wave++;
    updateDirector();
    var extra = director.heat > 0.7 ? 2 : director.heat > 0.45 ? 1 : 0;
    var count = Math.min(4 + Math.floor(wave * 0.7) + extra, 14);
    for (var i = 0; i < count; i++) spawnRock(3);
    if (wave > 5) for (var j = 0; j < Math.floor(wave / 3) + extra; j++) spawnRock(2);
    waveT = 0; nextUfo = Math.max(8, 20 - wave - Math.floor(director.heat * 4));
    pulseText = 'WAVE ' + wave + ' · ' + director.label.toUpperCase();
    pulseT = 1.3;
    chargeFocus(12);
  }

  function addScore(v, x, y, color) {
    var mult = 1 + Math.min(combo, 9) * 0.1 + (focus.active > 0 ? 0.4 : 0);
    var gain = Math.floor(v * mult);
    score += gain;
    if (score > best) { best = score; saveBest(); }
    floats.push({ x: x, y: y, t: 0, text: '+' + gain, color: color || '#fff' });
    combo++; comboT = 2.5;
    updateDirector();
  }

  function killShip() {
    if (!ship.alive) return;
    if (POW.shield.t > 0) { POW.shield.t = 0; shake = 14; flash = 0.15; sfxBoom(); return; }
    ship.alive = false;
    for (var i = 0; i < 45; i++) {
      var a = rand(0, TAU), s = rand(60, 280);
      particles.push({ x: ship.x, y: ship.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.6, 1.2), max: 1.2, color: i % 3 === 0 ? '#ff4776' : i % 3 === 1 ? '#ffd86a' : '#6ff', r: rand(1.5, 3) });
    }
    shake = 28; flash = 0.35; sfxDead();
    lives--; combo = 0;
    focus.active = 0; focus.cooldown = Math.max(focus.cooldown, 2.5);
    updateDirector();
    if (lives <= 0) { deathT = 2.0; }
    else { respawnT = 1.6; }
  }
  function respawnShip() {
    ship = makeShip(W / 2, H / 2);
    for (var tries = 0; tries < 15; tries++) {
      var safe = true;
      for (var i = 0; i < rocks.length; i++) {
        if (wrapDist2(ship.x, ship.y, rocks[i].x, rocks[i].y) < 120 * 120) { safe = false; break; }
      }
      if (safe) break;
      ship.x = rand(W * 0.2, W * 0.8); ship.y = rand(H * 0.2, H * 0.8);
    }
  }

  function fire(s) {
    var shots = POW.triple.t > 0 ? 3 : (focus.active > 0 ? 2 : 1);
    var spread = focus.active > 0 ? 0.11 : 0.16;
    for (var i = 0; i < shots; i++) {
      var off = shots === 1 ? 0 : (i - (shots - 1) / 2) * spread;
      var a = s.angle + off;
      bullets.push({
        x: s.x + Math.cos(a) * (SHIP.r + 2), y: s.y + Math.sin(a) * (SHIP.r + 2),
        vx: Math.cos(a) * SHIP.bulletSpeed * (focus.active > 0 ? 1.2 : 1) + s.vx * 0.5, vy: Math.sin(a) * SHIP.bulletSpeed * (focus.active > 0 ? 1.2 : 1) + s.vy * 0.5,
        life: SHIP.bulletLife + (focus.active > 0 ? 0.18 : 0),
        color: focus.active > 0 ? '#80ffe8' : (POW.pierce.t > 0 ? '#9fffa3' : '#6ff'),
        pierce: focus.active > 0 ? 3 : (POW.pierce.t > 0 ? 2 : 0)
      });
    }
    sfxFire();
  }
  function hyperspace() {
    if (!ship.alive) return;
    for (var i = 0; i < 18; i++) {
      var a = rand(0, TAU), s = rand(80, 240);
      particles.push({ x: ship.x, y: ship.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.6), max: 0.6, color: '#ba88ff', r: rand(1, 2.2) });
    }
    ship.x = rand(W * 0.1, W * 0.9); ship.y = rand(H * 0.1, H * 0.9);
    ship.vx *= 0.3; ship.vy *= 0.3; ship.invuln = Math.max(ship.invuln, 0.7);
    sfxWarp();
    if (Math.random() < 0.04) killShip();
  }

  // ---------- Update ----------
  function update(dt) {
    // Menu state: wait for any key/click
    if (state === 'menu') {
      if (pressed['any'] || pressed['fire'] || pressed['up'] || pressed['w'] || pressed['left'] || pressed['right'] || pressed['boost']) {
        initAudio(); if (AC && AC.state === 'suspended') AC.resume();
        newGame(); state = 'playing';
      }
      clearPressed();
      return;
    }
    if (state === 'paused') {
      if (pressed['p'] || pressed['pause'] || pressed['any']) { state = 'playing'; }
      clearPressed();
      return;
    }
    if (state === 'gameover') {
      if (deathT > 0) deathT -= dt;
      else if (pressed['any'] || pressed['fire']) {
        newGame(); state = 'playing';
      }
      // Still update particles for effect
      updateParticles(dt);
      clearPressed();
      return;
    }

    // Playing
    if (pressed['p'] || pressed['pause']) { state = 'paused'; clearPressed(); return; }
    if (focus.cooldown > 0) focus.cooldown -= dt;
    if (pressed['boost'] && activateOverdrive()) sfxPower();
    if (focus.active > 0) focus.active -= dt;

    if (ship.alive) {
      var rot = 0;
      if (keys['left'] || keys['a']) rot -= 1;
      if (keys['right'] || keys['d']) rot += 1;
      ship.angle += rot * SHIP.rotSpeed * (focus.active > 0 ? 1.4 : 1) * dt;

      ship.thrusting = !!(keys['up'] || keys['w']);
      if (ship.thrusting) {
        ship.vx += Math.cos(ship.angle) * SHIP.thrust * (focus.active > 0 ? 1.28 : 1) * dt;
        ship.vy += Math.sin(ship.angle) * SHIP.thrust * (focus.active > 0 ? 1.28 : 1) * dt;
        if (Math.random() < 0.6) {
          var bx = ship.x - Math.cos(ship.angle) * SHIP.r;
          var by = ship.y - Math.sin(ship.angle) * SHIP.r;
          var sp = rand(60, 160), spread = rand(-0.3, 0.3);
          particles.push({ x: bx, y: by, vx: -Math.cos(ship.angle + spread) * sp + ship.vx * 0.5, vy: -Math.sin(ship.angle + spread) * sp + ship.vy * 0.5, life: rand(0.25, 0.5), max: 0.5, color: Math.random() < 0.5 ? '#6ff' : '#ffd86a', r: rand(1.2, 2) });
        }
      }
      var sp2 = ship.vx * ship.vx + ship.vy * ship.vy;
      var maxSpeed = SHIP.maxSpeed * (focus.active > 0 ? 1.22 : 1);
      if (sp2 > maxSpeed * maxSpeed) {
        var k = maxSpeed / Math.sqrt(sp2); ship.vx *= k; ship.vy *= k;
      }
      var damp = Math.pow(1 - SHIP.friction, dt);
      ship.vx *= damp; ship.vy *= damp;
      ship.x = wrap(ship.x + ship.vx * dt, W); ship.y = wrap(ship.y + ship.vy * dt, H);
      if (ship.invuln > 0) ship.invuln -= dt;

      if (ship.fireCd > 0) ship.fireCd -= dt;
      var wantFire = pressed['fire'] || (keys['fire'] && ship.fireCd <= 0);
      if (wantFire && ship.fireCd <= 0) {
        ship.fireCd = SHIP.fireCd * (POW.rapid.t > 0 ? 0.38 : 1) * (focus.active > 0 ? 0.65 : 1);
        fire(ship);
      }

      if (ship.warpCd > 0) ship.warpCd -= dt;
      if ((pressed['warp'] || pressed['h']) && ship.warpCd <= 0) {
        ship.warpCd = 1.5; hyperspace();
      }

      // ship vs rocks
      for (var ri = 0; ri < rocks.length; ri++) {
        var r = rocks[ri], rad = (ship.r + r.r) * 0.85;
        if (wrapDist2(ship.x, ship.y, r.x, r.y) < rad * rad && ship.invuln <= 0) { killShip(); break; }
        if (ship.alive && ship.invuln <= 0) {
          var near = (ship.r + r.r + 26);
          if (wrapDist2(ship.x, ship.y, r.x, r.y) < near * near) chargeFocus(7 * dt);
        }
      }
      // ship vs ufos
      if (ship.alive && ship.invuln <= 0) {
        for (var u = 0; u < ufos.length; u++) {
          var uf = ufos[u], rd = (ship.r + uf.r) * 0.85;
          if (wrapDist2(ship.x, ship.y, uf.x, uf.y) < rd * rd) { killShip(); break; }
        }
      }
      // ufo bullets vs ship
      if (ship.alive && ship.invuln <= 0) {
        for (var b2 = ufoBullets.length - 1; b2 >= 0; b2--) {
          var ub = ufoBullets[b2];
          if (wrapDist2(ship.x, ship.y, ub.x, ub.y) < (ship.r + 3) * (ship.r + 3)) {
            ufoBullets.splice(b2, 1); killShip(); break;
          }
        }
      }
    } else if (lives > 0 && respawnT > 0) {
      respawnT -= dt;
      if (respawnT <= 0) respawnShip();
    } else if (lives <= 0 && deathT > 0) {
      deathT -= dt;
      if (deathT <= 0) state = 'gameover';
    }

    // Powers
    for (var pk in POW) if (POW[pk].t > 0) POW[pk].t -= dt;

    // Bullets
    for (var bi = bullets.length - 1; bi >= 0; bi--) {
      var b = bullets[bi];
      b.x = wrap(b.x + b.vx * dt, W); b.y = wrap(b.y + b.vy * dt, H);
      b.life -= dt;
      if (b.life <= 0) { bullets.splice(bi, 1); continue; }
      var hit = false;
      for (var rr = rocks.length - 1; rr >= 0; rr--) {
        var rk = rocks[rr];
        if (wrapDist2(b.x, b.y, rk.x, rk.y) < rk.r * rk.r) {
          var pts = rk.size === 3 ? 20 : rk.size === 2 ? 50 : 100;
          addScore(pts, rk.x, rk.y, '#fff');
          breakRock(rk); rocks.splice(rr, 1);
          kills++; sfxBoom(); shake = Math.max(shake, rk.size * 3);
          chargeFocus(rk.size === 3 ? 6 : rk.size === 2 ? 8 : 10, rk.x, rk.y);
          if (!b.pierce) hit = true; else b.pierce--;
          updateDirector();
          break;
        }
      }
      if (hit) { bullets.splice(bi, 1); continue; }
      for (var uu = ufos.length - 1; uu >= 0; uu--) {
        var uf2 = ufos[uu];
        if (wrapDist2(b.x, b.y, uf2.x, uf2.y) < uf2.r * uf2.r) {
          addScore(uf2.small ? 1000 : 200, uf2.x, uf2.y, uf2.color);
          for (var pp = 0; pp < 22; pp++) {
            var aa = rand(0, TAU), ss = rand(60, 220);
            particles.push({ x: uf2.x, y: uf2.y, vx: Math.cos(aa) * ss, vy: Math.sin(aa) * ss, life: rand(0.4, 0.9), max: 0.9, color: uf2.color, r: rand(1.2, 2.5) });
          }
          ufos.splice(uu, 1); kills++; shake = Math.max(shake, 10); sfxBoom();
          chargeFocus(18, uf2.x, uf2.y);
          if (Math.random() < 0.35) spawnPickup(uf2.x, uf2.y);
          bullets.splice(bi, 1); hit = true; break;
        }
      }
    }

    // Rocks
    for (var i2 = 0; i2 < rocks.length; i2++) {
      var r2 = rocks[i2];
      r2.x = wrap(r2.x + r2.vx * dt, W); r2.y = wrap(r2.y + r2.vy * dt, H);
      r2.angle += r2.spin * dt;
    }

    // UFOs
    for (var ii = ufos.length - 1; ii >= 0; ii--) {
      var u3 = ufos[ii];
      u3.dirT -= dt;
      if (u3.dirT <= 0) { u3.dirT = rand(1.0, 2.2); u3.vy = rand(-80, 80); }
      u3.x += u3.vx * dt; u3.y = clamp(u3.y + u3.vy * dt, 30, H - 30);
      if (u3.x < -60 || u3.x > W + 60) { ufos.splice(ii, 1); continue; }
      u3.fireCd -= dt;
      if (u3.fireCd <= 0 && ship.alive) {
        u3.fireCd = u3.small ? rand(0.9, 1.4) : rand(1.6, 2.4);
        var ang;
        if (u3.small) {
          var lead = 0.35;
          ang = Math.atan2((ship.y + ship.vy * lead) - u3.y, (ship.x + ship.vx * lead) - u3.x) + rand(-0.04, 0.04);
        } else ang = rand(0, TAU);
        ufoBullets.push({ x: u3.x, y: u3.y, vx: Math.cos(ang) * 360, vy: Math.sin(ang) * 360, life: 2.0, color: u3.color });
        sfxFire();
      }
    }
    for (var ub2 = ufoBullets.length - 1; ub2 >= 0; ub2--) {
      var ubb = ufoBullets[ub2];
      ubb.x = wrap(ubb.x + ubb.vx * dt, W); ubb.y = wrap(ubb.y + ubb.vy * dt, H);
      ubb.life -= dt;
      if (ubb.life <= 0) ufoBullets.splice(ub2, 1);
    }

    // Pickups
    for (var pi = pickups.length - 1; pi >= 0; pi--) {
      var pp2 = pickups[pi];
      pp2.life -= dt; pp2.pulse += dt * 6;
      pp2.x = wrap(pp2.x + pp2.vx * dt, W); pp2.y = wrap(pp2.y + pp2.vy * dt, H);
      pp2.vx *= 0.99; pp2.vy *= 0.99;
      if (pp2.life <= 0) { pickups.splice(pi, 1); continue; }
      if (ship.alive && wrapDist2(pp2.x, pp2.y, ship.x, ship.y) < (ship.r + pp2.r) * (ship.r + pp2.r)) {
        applyPickup(pp2); pickups.splice(pi, 1);
      }
    }

    updateParticles(dt);

    // Floats
    for (var ft = floats.length - 1; ft >= 0; ft--) {
      var f = floats[ft]; f.t += dt; f.y -= 30 * dt;
      if (f.t > 0.8) floats.splice(ft, 1);
    }

    if (comboT > 0) comboT -= dt; else combo = 0;

    nextUfo -= dt;
    if (nextUfo <= 0 && ufos.length < (wave > 8 ? 2 : 1)) {
      spawnUfo(); nextUfo = rand(11, 20) - wave * 0.25 - director.heat * 3;
    }
    if (rocks.length === 0) {
      waveT += dt;
      if (waveT > 1.2) startWave();
    }

    if (shake > 0) shake = Math.max(0, shake - dt * 45);
    if (flash > 0) flash = Math.max(0, flash - dt * 1.5);
    if (pulseT > 0) pulseT -= dt;

    clearPressed();
  }

  function updateParticles(dt) {
    for (var pa = particles.length - 1; pa >= 0; pa--) {
      var pt = particles[pa];
      pt.life -= dt;
      if (pt.life <= 0) { particles.splice(pa, 1); continue; }
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vx *= 0.96; pt.vy *= 0.96;
    }
  }

  function clearPressed() { pressed = {}; }

  // ---------- Stars ----------
  var stars = [];
  function initStars() {
    stars = [];
    for (var i = 0; i < 160; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, z: Math.random(), s: 0.5 + Math.random() * 1.6 });
  }
  initStars(); window.addEventListener('resize', initStars);

  // ---------- Render ----------
  function render() {
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, focus.active > 0 ? '#071d28' : '#03040a');
    sky.addColorStop(1, focus.active > 0 ? '#041019' : '#06111b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    var dx = ship ? ship.vx * 0.015 : 0, dy = ship ? ship.vy * 0.015 : 0;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.x = wrap(s.x - dx * (0.3 + s.z), W);
      s.y = wrap(s.y - dy * (0.3 + s.z), H);
      ctx.fillStyle = 'rgba(160,200,240,' + (0.15 + s.z * 0.65) + ')';
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }

    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    for (var pi = 0; pi < pickups.length; pi++) drawPickup(pickups[pi]);
    for (var ri = 0; ri < rocks.length; ri++) drawRock(rocks[ri]);
    for (var bi = 0; bi < bullets.length; bi++) drawBullet(bullets[bi]);
    for (var ubi = 0; ubi < ufoBullets.length; ubi++) drawUfoBullet(ufoBullets[ubi]);
    for (var ui = 0; ui < ufos.length; ui++) drawUfo(ufos[ui]);

    if (ship && ship.alive) drawShip(ship);

    for (var pa = 0; pa < particles.length; pa++) {
      var p = particles[pa], a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a; ctx.fillStyle = p.color;
      ctx.shadowBlur = 6; ctx.shadowColor = p.color;
      ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;

    ctx.font = 'bold 13px "SF Mono", monospace';
    ctx.textAlign = 'center';
    for (var ft = 0; ft < floats.length; ft++) {
      var f = floats[ft], al = 1 - f.t / 0.8;
      ctx.globalAlpha = al; ctx.fillStyle = f.color;
      ctx.shadowBlur = 6; ctx.shadowColor = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;

    ctx.restore();

    if (flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (flash * 0.5) + ')'; ctx.fillRect(0, 0, W, H); }

    drawHud();

    if (state === 'menu') drawMenu();
    if (state === 'paused') drawPause();
    if (state === 'gameover') drawGameOver();
  }

  function drawShip(s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);

    if (POW.shield.t > 0) {
      var pulse = 0.65 + Math.sin(performance.now() * 0.012) * 0.3;
      ctx.strokeStyle = 'rgba(120,240,255,' + pulse + ')';
      ctx.lineWidth = 2.2; ctx.shadowBlur = 15; ctx.shadowColor = '#6ff';
      ctx.beginPath(); ctx.arc(0, 0, s.r + 7, 0, TAU); ctx.stroke(); ctx.shadowBlur = 0;
    }

    // Always visible — no half-alpha blink
    ctx.strokeStyle = focus.active > 0 ? '#80ffe8' : '#6ff';
    ctx.fillStyle = focus.active > 0 ? 'rgba(32,136,124,0.95)' : 'rgba(30,90,160,0.95)';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.shadowBlur = 14; ctx.shadowColor = focus.active > 0 ? '#80ffe8' : '#6ff';
    ctx.beginPath();
    ctx.moveTo(s.r + 3, 0);
    ctx.lineTo(-s.r, -s.r * 0.8);
    ctx.lineTo(-s.r * 0.5, 0);
    ctx.lineTo(-s.r, s.r * 0.8);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    if (s.thrusting) {
      ctx.strokeStyle = '#ffd86a'; ctx.shadowColor = '#ff9a3c';
      ctx.beginPath();
      var flame = rand(0.7, 1.2);
      ctx.moveTo(-s.r * 0.5, -3); ctx.lineTo(-s.r - 8 * flame, 0); ctx.lineTo(-s.r * 0.5, 3); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawRock(r) {
    ctx.save();
    ctx.translate(r.x, r.y); ctx.rotate(r.angle);
    ctx.strokeStyle = '#a8c4dc'; ctx.fillStyle = 'rgba(18,26,42,0.9)';
    ctx.lineWidth = 1.8; ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(120,180,240,0.4)';
    ctx.beginPath();
    for (var i = 0; i < r.verts.length; i++) {
      var v = r.verts[i];
      var x = Math.cos(v.a) * v.r, y = Math.sin(v.a) * v.r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.restore();
  }

  function drawBullet(b) {
    ctx.fillStyle = b.color; ctx.shadowBlur = 12; ctx.shadowColor = b.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, 2.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = b.color; ctx.globalAlpha = 0.45; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02); ctx.stroke();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }
  function drawUfoBullet(b) {
    ctx.fillStyle = b.color; ctx.shadowBlur = 10; ctx.shadowColor = b.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
  }
  function drawUfo(u) {
    ctx.save(); ctx.translate(u.x, u.y);
    ctx.strokeStyle = u.color; ctx.fillStyle = 'rgba(20,10,30,0.85)';
    ctx.lineWidth = 2; ctx.shadowBlur = 14; ctx.shadowColor = u.color;
    ctx.beginPath();
    ctx.moveTo(-u.r, 0); ctx.lineTo(-u.r * 0.5, -u.r * 0.5); ctx.lineTo(u.r * 0.5, -u.r * 0.5);
    ctx.lineTo(u.r, 0); ctx.lineTo(u.r * 0.5, u.r * 0.35); ctx.lineTo(-u.r * 0.5, u.r * 0.35);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -u.r * 0.5, u.r * 0.45, Math.PI, 0); ctx.stroke();
    ctx.shadowBlur = 0; ctx.restore();
  }
  function drawPickup(p) {
    ctx.save(); ctx.translate(p.x, p.y);
    var sc = 1 + Math.sin(p.pulse) * 0.08; ctx.scale(sc, sc);
    ctx.strokeStyle = p.color; ctx.fillStyle = 'rgba(5,10,20,0.9)';
    ctx.lineWidth = 2; ctx.shadowBlur = 16; ctx.shadowColor = p.color;
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * TAU + Math.PI / 6;
      var x = Math.cos(a) * p.r, y = Math.sin(a) * p.r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = p.color;
    ctx.font = 'bold 13px "SF Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.letter, 0, 1);
    ctx.shadowBlur = 0; ctx.restore();
  }

  function drawHud() {
    if (state === 'menu') return;
    ctx.save();
    ctx.font = 'bold 14px "SF Mono", monospace';
    ctx.textBaseline = 'top';
    ctx.shadowBlur = 8;

    // Top-left: score + wave
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7ef'; ctx.shadowColor = '#6ff';
    ctx.fillText('SCORE ' + score, 24, 22);
    ctx.fillText('WAVE  ' + wave, 24, 42);

    // Top-center: big score
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px "SF Mono", monospace';
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#6ff';
    ctx.fillText(String(score).padStart(6, '0'), W / 2, 20);

    // Top-right: best + lives
    ctx.textAlign = 'right';
    ctx.font = 'bold 14px "SF Mono", monospace';
    ctx.fillStyle = '#ffd86a'; ctx.shadowColor = '#ffd86a';
    ctx.fillText('BEST ' + best, W - 24, 22);
    // Lives
    for (var i = 0; i < lives; i++) {
      ctx.save();
      ctx.translate(W - 24 - i * 20, 50);
      ctx.rotate(-Math.PI / 2);
      ctx.strokeStyle = '#ffd86a';
      ctx.lineWidth = 1.8; ctx.shadowBlur = 6; ctx.shadowColor = '#ffd86a';
      ctx.beginPath();
      ctx.moveTo(7, 0); ctx.lineTo(-7, -5); ctx.lineTo(-4, 0); ctx.lineTo(-7, 5); ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // Combo
    if (combo > 1) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff7acd'; ctx.shadowColor = '#ff7acd';
      ctx.font = 'bold 15px "SF Mono", monospace';
      ctx.fillText('COMBO ×' + combo, W / 2, 60);
    }

    // Active powers
    var activeY = 72;
    ctx.textAlign = 'left'; ctx.font = 'bold 12px "SF Mono", monospace';
    for (var k in POW) {
      if (POW[k].t > 0) {
        ctx.fillStyle = POW[k].color; ctx.shadowColor = POW[k].color;
        ctx.fillText(POW[k].label + '  ' + POW[k].t.toFixed(1) + 's', 24, activeY);
        activeY += 18;
      }
    }

    ctx.textAlign = 'left';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#80ffe8'; ctx.shadowColor = '#80ffe8';
    ctx.fillText('FOCUS ' + Math.floor(focus.charge) + '%', 24, activeY + 8);
    ctx.fillStyle = 'rgba(130, 240, 225, 0.16)';
    ctx.fillRect(24, activeY + 28, 170, 10);
    ctx.fillStyle = focus.active > 0 ? '#80ffe8' : '#29c7c9';
    ctx.fillRect(24, activeY + 28, 170 * (focus.charge / focus.max), 10);
    ctx.strokeStyle = 'rgba(128,255,232,0.4)';
    ctx.strokeRect(24, activeY + 28, 170, 10);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd86a'; ctx.shadowColor = '#ffd86a';
    ctx.fillText('DIRECTOR ' + director.label.toUpperCase(), W - 24, 76);
    if (focus.active > 0) {
      ctx.fillStyle = '#80ffe8'; ctx.shadowColor = '#80ffe8';
      ctx.fillText('OVERDRIVE ' + focus.active.toFixed(1) + 's', W - 24, 96);
    } else if (focus.cooldown > 0) {
      ctx.fillStyle = 'rgba(190,230,245,0.8)'; ctx.shadowColor = '#6ff';
      ctx.fillText('RECHARGE ' + focus.cooldown.toFixed(1) + 's', W - 24, 96);
    }

    // Controls hint
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(150,180,210,0.5)'; ctx.shadowBlur = 0;
    ctx.font = '11px "SF Mono", monospace';
    ctx.fillText('ROTATE ←→   THRUST ↑   FIRE SPACE   OVERDRIVE ENTER   WARP SHIFT   PAUSE P', 24, H - 26);

    if (pulseT > 0) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px "SF Mono", monospace';
      ctx.globalAlpha = Math.min(1, pulseT);
      ctx.fillStyle = '#80ffe8'; ctx.shadowBlur = 12; ctx.shadowColor = '#80ffe8';
      ctx.fillText(pulseText, W / 2, H - 54);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function panel(x, y, w, h) {
    var grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(6,18,28,0.9)');
    grad.addColorStop(1, 'rgba(4,11,21,0.82)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(120,200,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 20; ctx.shadowColor = 'rgba(100,200,255,0.5)';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.shadowBlur = 0;
  }

  function drawMenu() {
    ctx.save();
    // Dim bg slightly so ship+stars still peek through
    ctx.fillStyle = 'rgba(0,5,15,0.55)';
    ctx.fillRect(0, 0, W, H);

    var cx = W / 2, cy = H / 2;
    panel(cx - 280, cy - 180, 560, 360);

    ctx.textAlign = 'center';
    ctx.font = 'bold 48px "SF Mono", monospace';
    ctx.shadowBlur = 22; ctx.shadowColor = '#6ff';
    ctx.fillStyle = '#cff';
    ctx.fillText('ASTEROIDS', cx, cy - 102);

    ctx.font = 'bold 12px "SF Mono", monospace';
    ctx.shadowBlur = 10; ctx.shadowColor = '#9af';
    ctx.fillStyle = '#9cf';
    ctx.fillText('CODEX  ·  5.5', cx, cy - 72);

    ctx.font = '15px "SF Mono", monospace';
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#bcd';
    var lines = [
      'ADAPTIVE DIRECTOR  ·  OVERDRIVE SYSTEM  ·  TOUCH FLIGHT CONTROLS',
      'ROTATE      ← →   /  A D',
      'THRUST      ↑     /  W',
      'FIRE        SPACE',
      'OVERDRIVE   ENTER',
      'HYPERSPACE  SHIFT /  H',
      'PAUSE       P     /  ESC'
    ];
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, cy - 28 + i * 24);

    // Pulse prompt
    var p = 0.55 + Math.sin(performance.now() * 0.005) * 0.45;
    ctx.globalAlpha = p;
    ctx.shadowBlur = 14; ctx.shadowColor = '#ffd86a';
    ctx.fillStyle = '#ffd86a';
    ctx.font = 'bold 18px "SF Mono", monospace';
    ctx.fillText('PRESS ANY KEY OR TAP TO ENGAGE', cx, cy + 132);
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;

    if (best > 0) {
      ctx.font = '12px "SF Mono", monospace';
      ctx.fillStyle = '#fd8';
      ctx.fillText('BEST  ' + best, cx, cy + 160);
    }
    ctx.restore();
  }

  function drawPause() {
    ctx.save();
    ctx.fillStyle = 'rgba(0,5,15,0.65)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px "SF Mono", monospace';
    ctx.shadowBlur = 18; ctx.shadowColor = '#6ff';
    ctx.fillStyle = '#cff';
    ctx.fillText('PAUSED', W / 2, H / 2 - 20);
    ctx.font = '13px "SF Mono", monospace'; ctx.shadowBlur = 6;
    ctx.fillStyle = '#bcd';
    ctx.fillText('PRESS P OR ESC TO RESUME', W / 2, H / 2 + 20);
    ctx.restore();
  }

  function drawGameOver() {
    ctx.save();
    ctx.fillStyle = 'rgba(10,0,8,0.65)';
    ctx.fillRect(0, 0, W, H);
    var cx = W / 2, cy = H / 2;
    panel(cx - 240, cy - 140, 480, 280);
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px "SF Mono", monospace';
    ctx.shadowBlur = 20; ctx.shadowColor = '#ff4776';
    ctx.fillStyle = '#ff8aa6';
    ctx.fillText('SIMULATION LOST', cx, cy - 70);

    ctx.font = 'bold 22px "SF Mono", monospace'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#6ff';
    ctx.fillText('SCORE  ' + score, cx, cy - 20);

    ctx.font = '14px "SF Mono", monospace';
    ctx.fillStyle = '#bcd';
    ctx.fillText('WAVE ' + wave + '   ·   KILLS ' + kills, cx, cy + 10);
    ctx.fillStyle = '#ffd86a';
    ctx.fillText('BEST  ' + best, cx, cy + 36);

    var p = 0.55 + Math.sin(performance.now() * 0.005) * 0.45;
    ctx.globalAlpha = p;
    ctx.shadowBlur = 14; ctx.shadowColor = '#6ff';
    ctx.fillStyle = '#cff';
    ctx.font = 'bold 16px "SF Mono", monospace';
    ctx.fillText('PRESS ANY KEY TO RELAUNCH', cx, cy + 90);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------- Loop ----------
  var lastT = 0, errText = null;
  function frame(ts) {
    var now = ts / 1000;
    var dt = Math.min(0.05, lastT ? now - lastT : 0.016);
    lastT = now;

    try { update(dt); }
    catch (e) { errText = 'update: ' + (e && e.message); console.error(e); }
    try { render(); }
    catch (e) { errText = 'render: ' + (e && e.message); console.error(e); }

    if (errText) {
      ctx.fillStyle = '#200'; ctx.fillRect(0, 0, W, 40);
      ctx.fillStyle = '#f77'; ctx.font = '13px monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(errText, 12, 20);
    }

    requestAnimationFrame(frame);
  }

  // Pre-create ship so something draws immediately under the menu
  ship = makeShip(W / 2, H / 2);
  ship.invuln = 0;

  requestAnimationFrame(frame);
})();

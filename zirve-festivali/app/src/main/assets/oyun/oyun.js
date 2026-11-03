/* Zirve Festivali — küçük açık dünya dağ yolu sürüş oyunu (Three.js r149) */
(function () {
"use strict";
const $ = id => document.getElementById(id);

// ================== KAYIT ==================
const kayit = {
  oku(k, d) { try { const v = localStorage.getItem("zirve_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  yaz(k, v) { try { localStorage.setItem("zirve_" + k, JSON.stringify(v)); } catch (e) {} }
};

// ================== YARDIMCI ==================
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
function hash(x, z) {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) {
  let s = 0, a = 1, f = 1, n = 0;
  for (let i = 0; i < 5; i++) { s += vnoise(x * f, z * f) * a; n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
let tohum = 12345;
const rastgele = () => { tohum = (Math.imul(tohum, 1664525) + 1013904223) >>> 0; return tohum / 4294967296; };
const sureYaz = s => { const m = Math.floor(s / 60), r = s - m * 60; return m + ":" + (r < 10 ? "0" : "") + r.toFixed(2); };

// ================== DÜNYA SABİTLERİ ==================
const YARI = 450;           // harita yarı genişliği (m)
const GRID = 220;           // arazi ızgarası
const ADIM = (2 * YARI) / GRID;
const HARITA = kayit.oku("harita", "dag") === "sehir" ? "sehir" : "dag";
const SEHIR = HARITA === "sehir";
let YOL_YARI = SEHIR ? 8 : 6.5;  // yol yarı genişliği
const GOL = { x: -175, z: 235, r: 78 };
const SU_Y = SEHIR ? -0.6 : -2;

// --- Çöl şehri ölçüleri ---
const SOKAKLAR = [-300, -180, -60, 60, 180, 300];      // hem x hem z için sokak çizgileri
const SOKAK_YARI = 8, BULVAR_Z = 60, BULVAR_YARI = 15;  // z=60 geniş bulvar
const sokakYari = (eksen, v) => (eksen === "z" && v === BULVAR_Z) ? BULVAR_YARI : SOKAK_YARI;
const SEHIR_SINIR = 300 + SOKAK_YARI;
function sokakMu(x, z) {
  if (Math.abs(x) > SEHIR_SINIR + 0.5 || Math.abs(z) > SEHIR_SINIR + 0.5) return false;
  for (const v of SOKAKLAR) {
    if (Math.abs(x - v) < sokakYari("x", v)) return true;
    if (Math.abs(z - v) < sokakYari("z", v)) return true;
  }
  return false;
}

function tabanYukseklik(x, z) {
  if (SEHIR) return sehirYukseklik(x, z);
  const d = Math.max(Math.abs(x), Math.abs(z)) / YARI;
  let h = (fbm(x * 0.0042 + 10, z * 0.0042 + 3) - 0.45) * 120;
  h += (fbm(x * 0.018 + 4, z * 0.018 + 9) - 0.5) * 10;
  h += smooth(0.8, 1.0, d) * 170;
  const ld = Math.hypot(x - GOL.x, z - GOL.z);
  h = lerp(h, -9, smooth(GOL.r * 1.55, GOL.r * 0.55, ld));
  return h;
}
function sehirYukseklik(x, z) {
  // şehir düz; dışında kum tepeleri, güneyde sahil ve deniz
  const d = Math.max(Math.abs(x), Math.abs(z)) / YARI;
  const disari = Math.max(Math.abs(x), z < 0 ? -z : 0);
  let h = smooth(330, 400, disari) * (fbm(x * 0.012 + 7, z * 0.012 + 2) * 26 + 2);
  h += smooth(0.86, 1.0, d) * 90;
  if (z > 320) h = lerp(h, -6, smooth(345, 400, z));
  return h;
}

// ================== YOL ==================
const YOL_NOKTALARI = [
  [-300, -250], [-80, -325], [120, -285], [300, -305], [345, -120], [250, 20], [335, 170],
  [265, 325], [60, 305], [-40, 185], [35, 60], [-120, -40], [-300, 35], [-340, -120]
];
const yol = { n: 0, x: [], z: [], y: [], tx: [], tz: [], mesafe: [], uzunluk: 0, kova: new Map(), KOVA: 40 };

const SEHIR_PARKUR = [[-300, -300], [60, -300], [60, -180], [180, -180], [180, -300], [300, -300], [300, 60],
  [180, 60], [180, 300], [-60, 300], [-60, 60], [-300, 60]];
function sehirParkurNoktalari() {
  // köşeleri yuvarlatılmış çokgen, 2 m aralıklı noktalar
  const P = SEHIR_PARKUR, R = 14, ham = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[(i - 1 + P.length) % P.length], b = P[i], c = P[(i + 1) % P.length];
    const d1 = Math.hypot(b[0] - a[0], b[1] - a[1]), d2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const g = [b[0] - (b[0] - a[0]) / d1 * R, b[1] - (b[1] - a[1]) / d1 * R];
    const c2 = [b[0] + (c[0] - b[0]) / d2 * R, b[1] + (c[1] - b[1]) / d2 * R];
    for (let k = 0; k <= 8; k++) { const t = k / 8, u = 1 - t; ham.push([u * u * g[0] + 2 * u * t * b[0] + t * t * c2[0], u * u * g[1] + 2 * u * t * b[1] + t * t * c2[1]]); }
  }
  // eşit aralıkla yeniden örnekle
  const sonuc = []; let kalan = 0;
  for (let i = 0; i < ham.length; i++) {
    const a = ham[i], b = ham[(i + 1) % ham.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = kalan;
    while (t < L) { sonuc.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t / L, 0, a[1] + (b[1] - a[1]) * t / L)); t += 2; }
    kalan = t - L;
  }
  return sonuc;
}
function yolKur() {
  let pts;
  if (SEHIR) pts = sehirParkurNoktalari();
  else {
    const egri = new THREE.CatmullRomCurve3(YOL_NOKTALARI.map(p => new THREE.Vector3(p[0], 0, p[1])), true, "centripetal");
    pts = egri.getSpacedPoints(1200); pts.pop();
  }
  yol.n = pts.length;
  let ham = pts.map(p => SEHIR ? 0 : Math.max(tabanYukseklik(p.x, p.z), 2));
  // yüksekliği yumuşat (dik rampa olmasın)
  for (let gecis = 0; gecis < (SEHIR ? 0 : 6); gecis++) {
    const yeni = new Array(yol.n);
    for (let i = 0; i < yol.n; i++) {
      let s = 0; for (let k = -18; k <= 18; k++) s += ham[(i + k + yol.n) % yol.n];
      yeni[i] = s / 37;
    }
    ham = yeni;
  }
  let toplam = 0;
  for (let i = 0; i < yol.n; i++) {
    const p = pts[i], q = pts[(i + 1) % yol.n];
    yol.x.push(p.x); yol.z.push(p.z); yol.y.push(SEHIR ? 0 : Math.max(ham[i], 1.5));
    const dx = q.x - p.x, dz = q.z - p.z, L = Math.hypot(dx, dz) || 1;
    yol.tx.push(dx / L); yol.tz.push(dz / L);
    yol.mesafe.push(toplam); toplam += L;
    const anahtar = Math.floor(p.x / yol.KOVA) + "," + Math.floor(p.z / yol.KOVA);
    if (!yol.kova.has(anahtar)) yol.kova.set(anahtar, []);
    yol.kova.get(anahtar).push(i);
  }
  yol.uzunluk = toplam;
}

// En yakın yol noktası (parça üzerinde): { d, h, i, t }
const _yakin = { d: Infinity, h: 0, i: 0, t: 0 };
function enYakinYol(x, z) {
  _yakin.d = Infinity;
  const cx = Math.floor(x / yol.KOVA), cz = Math.floor(z / yol.KOVA);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const liste = yol.kova.get((cx + a) + "," + (cz + b));
    if (!liste) continue;
    for (const i of liste) {
      const j = (i + 1) % yol.n;
      const ax = yol.x[i], az = yol.z[i], bx = yol.x[j] - ax, bz = yol.z[j] - az;
      const L2 = bx * bx + bz * bz || 1;
      const t = clamp(((x - ax) * bx + (z - az) * bz) / L2, 0, 1);
      const px = ax + bx * t - x, pz = az + bz * t - z;
      const d = Math.sqrt(px * px + pz * pz);
      if (d < _yakin.d) { _yakin.d = d; _yakin.i = i; _yakin.t = t; _yakin.h = lerp(yol.y[i], yol.y[j], t); }
    }
  }
  return _yakin;
}

// ================== ARAZİ ==================
let yukseklik; // Float32Array (GRID+1)^2
function araziYuksekligiHesapla() {
  yukseklik = new Float32Array((GRID + 1) * (GRID + 1));
  for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) {
    const x = -YARI + i * ADIM, z = -YARI + j * ADIM;
    let h = tabanYukseklik(x, z);
    const y = SEHIR ? { d: Infinity } : enYakinYol(x, z);
    if (y.d < 40) {
      const w = smooth(YOL_YARI + 1.5, YOL_YARI + 24, y.d);
      h = lerp(y.h - 0.45, h, w);
    }
    yukseklik[j * (GRID + 1) + i] = h;
  }
}
function araziH(x, z) {
  const fx = clamp((x + YARI) / ADIM, 0, GRID - 0.001), fz = clamp((z + YARI) / ADIM, 0, GRID - 0.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, W = GRID + 1;
  const a = yukseklik[j * W + i], b = yukseklik[j * W + i + 1], c = yukseklik[(j + 1) * W + i], d = yukseklik[(j + 1) * W + i + 1];
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function zeminH(x, z) {
  let h = araziH(x, z);
  if (SEHIR) {
    if (Math.abs(x) < SEHIR_SINIR && Math.abs(z) < SEHIR_SINIR && !sokakMu(x, z)) h = Math.max(h, 0.2);
    return Math.max(h, SU_Y - 0.6);
  }
  const y = enYakinYol(x, z);
  if (y.d < YOL_YARI + 0.6) h = Math.max(h, y.h + 0.06);
  return Math.max(h, SU_Y - 0.6);
}

// ================== SAHNE ==================
const tuval = $("sahne");
let kalite = kayit.oku("kalite", "yuksek");
const renderer = new THREE.WebGLRenderer({ canvas: tuval, antialias: true, powerPreference: "high-performance" });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const GOLGE = kalite === "yuksek";
renderer.shadowMap.enabled = GOLGE;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const sahne = new THREE.Scene();
const RENK = SEHIR
  ? { ust: 0x5d93cf, ufuk: 0xe6dccb, sis: 0xe0d6c4, gok: 0xfff1d8, yer: 0xb59a6c, gunes: 0xffe9c7 }
  : { ust: 0x4f86c6, ufuk: 0xc9dceb, sis: 0xb9cfe0, gok: 0xdcefff, yer: 0x3d4a2c, gunes: 0xfff1dc };
sahne.background = new THREE.Color(RENK.ufuk);
sahne.fog = new THREE.Fog(RENK.sis, SEHIR ? 260 : 220, SEHIR ? 900 : 780);
const kamera = new THREE.PerspectiveCamera(62, 1, 0.3, 1600);
sahne.add(new THREE.HemisphereLight(RENK.gok, RENK.yer, SEHIR ? 0.55 : 0.6));
const gunes = new THREE.DirectionalLight(RENK.gunes, SEHIR ? 1.25 : 1.1);
const GUNES_YON = new THREE.Vector3(0.45, 0.75, 0.3).normalize();
gunes.position.copy(GUNES_YON).multiplyScalar(300);
gunes.castShadow = GOLGE;
gunes.shadow.mapSize.set(2048, 2048);
Object.assign(gunes.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 600 });
gunes.shadow.bias = -0.0005; gunes.shadow.normalBias = 0.04;
sahne.add(gunes, gunes.target);

// Gökyüzü kubbesi (ufuktan tepeye renk geçişi + güneş parlaması)
const gok = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), new THREE.ShaderMaterial({
  uniforms: { ust: { value: new THREE.Color(RENK.ust) }, ufuk: { value: new THREE.Color(RENK.ufuk) }, gyon: { value: GUNES_YON } },
  vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }",
  fragmentShader: "uniform vec3 ust; uniform vec3 ufuk; uniform vec3 gyon; varying vec3 vP; void main(){ float h = max(vP.y, 0.0); vec3 c = mix(ufuk, ust, pow(smoothstep(0.0, 0.6, h), 0.8)); float g = max(dot(normalize(vP), gyon), 0.0); c += vec3(1.0,0.9,0.7) * (pow(g, 600.0) * 2.0 + pow(g, 12.0) * 0.18); gl_FragColor = vec4(c, 1.0); }",
  side: THREE.BackSide, depthWrite: false, fog: false
}));
gok.frustumCulled = false; gok.renderOrder = -1;
sahne.add(gok);
function gunesTakip(x, y, z) {
  gunes.target.position.set(x, y, z);
  gunes.position.set(x + GUNES_YON.x * 300, y + GUNES_YON.y * 300, z + GUNES_YON.z * 300);
  gok.position.copy(kamera.position);
}
// Arabalar için yansıma ortamı
const pmrem = new THREE.PMREMGenerator(renderer);
sahne.environment = pmrem.fromScene(new THREE_EK.RoomEnvironment(), 0.04).texture;

function boyutla() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, kalite === "yuksek" ? 1.5 : 1));
  renderer.setSize(w, h, false);
  kamera.aspect = w / h; kamera.updateProjectionMatrix();
}
window.addEventListener("resize", boyutla);

function araziMeshKur() {
  const g = new THREE.PlaneGeometry(2 * YARI, 2 * YARI, GRID, GRID);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    const i = Math.round((pos.getX(k) + YARI) / ADIM), j = Math.round((pos.getZ(k) + YARI) / ADIM);
    pos.setY(k, yukseklik[j * (GRID + 1) + i]);
  }
  g.computeVertexNormals();
  const nor = g.attributes.normal, renk = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), cim = new THREE.Color(0x4f7a35), orman = new THREE.Color(0x2f5a2b),
    kaya = new THREE.Color(0x7d7a72), kar = new THREE.Color(0xf2f4f6), kum = new THREE.Color(0xc9b98a), toprak = new THREE.Color(0x6b5a3e);
  const kum1 = new THREE.Color(0xdcc293), kum2 = new THREE.Color(0xc9a46a), islak = new THREE.Color(0xb39a72);
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k), egim = 1 - nor.getY(k);
    const n = vnoise(x * 0.05, z * 0.05);
    if (SEHIR) {
      c.copy(kum1).lerp(kum2, smooth(0.35, 0.8, vnoise(x * 0.02 + 3, z * 0.02)) * 0.7 + smooth(0.05, 0.3, egim) * 0.3);
      if (z > 335) c.lerp(islak, smooth(350, 375, z));
      renk[k * 3] = c.r; renk[k * 3 + 1] = c.g; renk[k * 3 + 2] = c.b;
      continue;
    }
    c.copy(cim).lerp(orman, smooth(0.3, 0.75, n));
    if (y < 0.5) c.lerp(kum, smooth(0.5, -1.5, y));
    c.lerp(toprak, smooth(0.12, 0.25, egim) * 0.6);
    c.lerp(kaya, smooth(0.22, 0.42, egim));
    c.lerp(kaya, smooth(70, 100, y));
    c.lerp(kar, smooth(120, 150, y + n * 10));
    renk[k * 3] = c.r; renk[k * 3 + 1] = c.g; renk[k * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(renk, 3));
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.receiveShadow = GOLGE;
  sahne.add(m);
  if (SEHIR) {
    const deniz = new THREE.Mesh(new THREE.PlaneGeometry(2 * YARI + 600, 400),
      new THREE.MeshPhongMaterial({ color: 0x1b8cae, transparent: true, opacity: 0.88, shininess: 120, specular: 0xbfe6ff }));
    deniz.rotation.x = -Math.PI / 2; deniz.position.set(0, SU_Y + 0.2, 545);
    sahne.add(deniz);
    return;
  }
  // Göl
  const su = new THREE.Mesh(new THREE.CircleGeometry(GOL.r * 1.7, 48),
    new THREE.MeshPhongMaterial({ color: 0x2f6f9e, transparent: true, opacity: 0.85, shininess: 90, specular: 0x99bbdd }));
  su.rotation.x = -Math.PI / 2; su.position.set(GOL.x, SU_Y, GOL.z);
  sahne.add(su);
}

function yolDokusu() {
  const c = document.createElement("canvas"); c.width = 128; c.height = 256;
  const x = c.getContext("2d");
  x.fillStyle = "#3a3d42"; x.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 1400; i++) { const v = 50 + Math.random() * 30; x.fillStyle = `rgb(${v},${v},${v + 4})`; x.fillRect(Math.random() * 128, Math.random() * 256, 1.5, 1.5); }
  x.fillStyle = "#e8e8e2"; x.fillRect(5, 0, 4, 256); x.fillRect(119, 0, 4, 256);
  x.fillStyle = "#f2c230"; x.fillRect(62, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  t.encoding = THREE.sRGBEncoding;
  return t;
}

function yolMeshKur() {
  const n = yol.n, poz = [], uv = [], idx = [];
  for (let k = 0; k <= n; k++) {
    const i = k % n, rx = yol.tz[i], rz = -yol.tx[i], y = yol.y[i] + 0.06;
    const v = (k === n ? yol.uzunluk : yol.mesafe[i]) / 9;
    poz.push(yol.x[i] + rx * YOL_YARI, y, yol.z[i] + rz * YOL_YARI, yol.x[i] - rx * YOL_YARI, y, yol.z[i] - rz * YOL_YARI);
    uv.push(0, v, 1, v);
    if (k < n) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(poz, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: yolDokusu(), side: THREE.DoubleSide }));
  sahne.add(m);

  // Yol kenarı direkleri
  const direkG = new THREE.BoxGeometry(0.22, 1.0, 0.22);
  const sayi = Math.floor(yol.n / 10) * 2;
  const direk = new THREE.InstancedMesh(direkG, new THREE.MeshLambertMaterial({ color: 0xf2f2ee }), sayi);
  const bant = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.18, 0.24), new THREE.MeshBasicMaterial({ color: 0xff3a2a }), sayi);
  const mat = new THREE.Matrix4(); let s = 0;
  for (let i = 0; i < yol.n; i += 10) for (const yon of [1, -1]) {
    const rx = yol.tz[i] * yon, rz = -yol.tx[i] * yon;
    const x = yol.x[i] + rx * (YOL_YARI + 1.2), z = yol.z[i] + rz * (YOL_YARI + 1.2);
    const y = araziH(x, z);
    mat.makeTranslation(x, y + 0.5, z); direk.setMatrixAt(s, mat);
    mat.makeTranslation(x, y + 0.82, z); bant.setMatrixAt(s, mat); s++;
  }
  sahne.add(direk, bant);
}

// ================== AĞAÇ / KAYA ==================
const engeller = []; const engelKova = new Map(); const ENGEL_KOVA = 20;
function engelEkle(x, z, r) {
  engeller.push({ x, z, r });
  const k = Math.floor(x / ENGEL_KOVA) + "," + Math.floor(z / ENGEL_KOVA);
  if (!engelKova.has(k)) engelKova.set(k, []);
  engelKova.get(k).push(engeller.length - 1);
}
function doga() {
  const agacSayi = kalite === "yuksek" ? 1100 : 650;
  const govdeG = new THREE.CylinderGeometry(0.22, 0.34, 2.2, 6); govdeG.translate(0, 1.1, 0);
  const yaprakG = new THREE.ConeGeometry(2.1, 6.5, 7); yaprakG.translate(0, 5.2, 0);
  const yaprak2G = new THREE.ConeGeometry(1.5, 4.2, 7); yaprak2G.translate(0, 7.6, 0);
  const govdeler = new THREE.InstancedMesh(govdeG, new THREE.MeshLambertMaterial({ color: 0x5a3f2a }), agacSayi);
  const yapraklar = new THREE.InstancedMesh(yaprakG, new THREE.MeshLambertMaterial({ color: 0xffffff }), agacSayi);
  const yapraklar2 = new THREE.InstancedMesh(yaprak2G, new THREE.MeshLambertMaterial({ color: 0xffffff }), agacSayi);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  let adet = 0, deneme = 0;
  while (adet < agacSayi && deneme < agacSayi * 12) {
    deneme++;
    const x = (rastgele() * 2 - 1) * (YARI - 20), z = (rastgele() * 2 - 1) * (YARI - 20);
    const h = araziH(x, z);
    if (h < 1.5 || h > 95) continue;
    if (enYakinYol(x, z).d < YOL_YARI + 5) continue;
    if (Math.hypot(x - GOL.x, z - GOL.z) < GOL.r * 1.25) continue;
    // ormanlık bölgelerde daha sık
    if (vnoise(x * 0.012 + 50, z * 0.012) < 0.38 && rastgele() < 0.75) continue;
    const olc = 0.75 + rastgele() * 0.8;
    p.set(x, h - 0.2, z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rastgele() * 6.28); s.set(olc, olc * (0.9 + rastgele() * 0.3), olc);
    m.compose(p, q, s);
    govdeler.setMatrixAt(adet, m); yapraklar.setMatrixAt(adet, m); yapraklar2.setMatrixAt(adet, m);
    c.setHSL(0.31 + rastgele() * 0.05, 0.45 + rastgele() * 0.15, 0.17 + rastgele() * 0.08);
    yapraklar.setColorAt(adet, c); c.offsetHSL(0, 0, 0.03); yapraklar2.setColorAt(adet, c);
    engelEkle(x, z, 0.55 * olc);
    adet++;
  }
  govdeler.count = yapraklar.count = yapraklar2.count = adet;
  sahne.add(govdeler, yapraklar, yapraklar2);

  // Kayalar
  const kayaSayi = 160;
  const kayalar = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x8a877f }), kayaSayi);
  let k = 0; deneme = 0;
  while (k < kayaSayi && deneme < 3000) {
    deneme++;
    const x = (rastgele() * 2 - 1) * (YARI - 25), z = (rastgele() * 2 - 1) * (YARI - 25);
    const h = araziH(x, z);
    if (h < 0 || enYakinYol(x, z).d < YOL_YARI + 6) continue;
    const olc = 0.8 + rastgele() * 2.2;
    p.set(x, h + olc * 0.25, z); q.setFromEuler(new THREE.Euler(rastgele() * 3, rastgele() * 3, rastgele() * 3));
    s.set(olc * (1 + rastgele() * 0.6), olc * 0.75, olc);
    m.compose(p, q, s); kayalar.setMatrixAt(k, m);
    engelEkle(x, z, olc * 0.95);
    k++;
  }
  kayalar.count = k;
  sahne.add(kayalar);
}

// ================== ÇÖL ŞEHRİ ==================
const kutular = []; const kutuKova = new Map(); const KUTU_KOVA = 40;
function kutuEkle(x0, z0, x1, z1) {
  const k = { x0, z0, x1, z1 }; kutular.push(k);
  for (let a = Math.floor(x0 / KUTU_KOVA); a <= Math.floor(x1 / KUTU_KOVA); a++)
    for (let b = Math.floor(z0 / KUTU_KOVA); b <= Math.floor(z1 / KUTU_KOVA); b++) {
      const key = a + "," + b; if (!kutuKova.has(key)) kutuKova.set(key, []); kutuKova.get(key).push(k);
    }
}
function canvasDoku(w, h, ciz) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  ciz(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.encoding = THREE.sRGBEncoding;
  return t;
}
function asfalt(x, w, h) {
  x.fillStyle = "#34363b"; x.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 40; i++) { const v = 44 + Math.random() * 26; x.fillStyle = `rgb(${v},${v},${v + 3})`; x.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
}
// Geometri toplayıcı: çok sayıda dörtgeni tek mesh'te birleştirir
function toplayici() {
  const p = [], n = [], u = [], i = [];
  return {
    dortgen(a, b, c, d, nx, ny, nz, uv) { // a,b,c,d saat yönünün tersine; uv = [u0,v0,u1,v1]
      const s = p.length / 3;
      p.push(...a, ...b, ...c, ...d);
      for (let k = 0; k < 4; k++) n.push(nx, ny, nz);
      u.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
      i.push(s, s + 1, s + 2, s, s + 2, s + 3);
    },
    yer(x0, z0, x1, z1, y, uv) { this.dortgen([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], 0, 1, 0, uv); },
    mesh(mat) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(u, 2));
      g.setIndex(i);
      const m = new THREE.Mesh(g, mat); sahne.add(m); return m;
    }
  };
}
// Kutu bina: yanlar cephe dokulu (kat ve pencere ölçüsünde), çatı ayrı
function binaKutusu(cephe, cati, x, z, w, d, y0, h) {
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y0 + h;
  const kat = 3.6, pen = 3.2, v0 = y0 / kat, v1 = y1 / kat;
  cephe.dortgen([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, [0, v0, w / pen, v1]);
  cephe.dortgen([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1, [0, v0, w / pen, v1]);
  cephe.dortgen([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0, [0, v0, d / pen, v1]);
  cephe.dortgen([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, [0, v0, d / pen, v1]);
  cati.yer(x0, z0, x1, z1, y1, [0, 0, w / 8, d / 8]);
}

function sehirKur() {
  const yolMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, map: canvasDoku(256, 256, (x, w, h) => {
    asfalt(x, w, h);
    x.fillStyle = "#e9e9e4"; x.fillRect(w * 0.03, 0, 4, h); x.fillRect(w * 0.97 - 4, 0, 4, h);
    x.fillRect(w * 0.26, 0, 3, h * 0.5); x.fillRect(w * 0.74 - 3, 0, 3, h * 0.5);
    x.fillStyle = "#f0c419"; x.fillRect(w * 0.5 - 5, 0, 3, h); x.fillRect(w * 0.5 + 2, 0, 3, h);
  }) });
  const kavsakMat = new THREE.MeshStandardMaterial({ roughness: 0.92, map: canvasDoku(128, 128, asfalt) });
  const zebraMat = yonV => new THREE.MeshStandardMaterial({ roughness: 0.6, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    map: canvasDoku(64, 64, (x, w, h) => { x.clearRect(0, 0, w, h); x.fillStyle = "#f2f2ee"; if (yonV) x.fillRect(0, 0, w, h * 0.55); else x.fillRect(0, 0, w * 0.55, h); }) });
  const kaldirimMat = new THREE.MeshStandardMaterial({ roughness: 0.85, map: canvasDoku(128, 128, (x, w, h) => {
    x.fillStyle = "#b3ab9c"; x.fillRect(0, 0, w, h);
    x.strokeStyle = "rgba(90,85,75,.35)"; x.lineWidth = 2;
    for (let k = 0; k <= 4; k++) { x.beginPath(); x.moveTo(0, k * h / 4); x.lineTo(w, k * h / 4); x.stroke(); x.beginPath(); x.moveTo(k * w / 4, 0); x.lineTo(k * w / 4, h); x.stroke(); }
  }) });
  const cimMat = new THREE.MeshLambertMaterial({ color: 0x5f8f3a });
  const bordurMat = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.7 });

  // --- Sokaklar
  const yollar = toplayici(), kavsak = toplayici(), zebra = toplayici(), zebra2 = toplayici();
  const L = SEHIR_SINIR;
  for (const v of SOKAKLAR) {
    const hz = sokakYari("z", v), hx = SOKAK_YARI;
    // x yönünde uzanan sokak (z = v): doku u = enine
    yollar.dortgen([-L, 0.02, v + hz], [L, 0.02, v + hz], [L, 0.02, v - hz], [-L, 0.02, v - hz], 0, 1, 0, [1, 0, 0, 2 * L / 14]);
    // z yönünde uzanan sokak (x = v)
    yollar.dortgen([v - hx, 0.025, L], [v + hx, 0.025, L], [v + hx, 0.025, -L], [v - hx, 0.025, -L], 0, 1, 0, [0, 0, 1, 2 * L / 14]);
  }
  // u/v sırası: dortgen uv düzeni a=(u0,v0) b=(u1,v0) c=(u1,v1) d=(u0,v1)
  for (const vx of SOKAKLAR) for (const vz of SOKAKLAR) {
    const hx = SOKAK_YARI, hz = sokakYari("z", vz);
    kavsak.yer(vx - hx, vz - hz, vx + hx, vz + hz, 0.035, [0, 0, 2 * hx / 10, 2 * hz / 10]);
    const ZG = 3.5, Y = 0.045;
    for (const s of [-1, 1]) {
      const xz = vx + s * (hx + 2.4);   // x-sokağı üzerinde, kavşağın iki yanında
      if (Math.abs(xz) < L - 2) zebra.yer(xz - ZG / 2, vz - hz + 0.6, xz + ZG / 2, vz + hz - 0.6, Y, [0, 0, 1, (2 * hz - 1.2) / 1.1]);
      const zz = vz + s * (hz + 2.4);
      if (Math.abs(zz) < L - 2) zebra2.yer(vx - hx + 0.6, zz - ZG / 2, vx + hx - 0.6, zz + ZG / 2, Y, [0, 0, (2 * hx - 1.2) / 1.1, 1]);
    }
  }
  const ym = yollar.mesh(yolMat), km = kavsak.mesh(kavsakMat), zm = zebra.mesh(zebraMat(true)), zm2 = zebra2.mesh(zebraMat(false));
  ym.receiveShadow = km.receiveShadow = zm.receiveShadow = zm2.receiveShadow = GOLGE;

  // --- Malzemeler (cephe dokuları)
  const camDoku = (ust, alt, cerceve) => canvasDoku(128, 128, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, ust); g.addColorStop(1, alt);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = "rgba(255,255,255,.10)"; x.fillRect(w * 0.08, h * 0.12, w * 0.3, h * 0.7);
    x.fillStyle = cerceve; x.fillRect(0, h * 0.86, w, h * 0.14); x.fillRect(0, 0, 5, h);
  });
  const camMavi = new THREE.MeshStandardMaterial({ map: camDoku("#4f86b3", "#1f3f5c", "#9fb3c4"), metalness: 0.55, roughness: 0.12, envMapIntensity: 1.3 });
  const camGumus = new THREE.MeshStandardMaterial({ map: camDoku("#9fb4c2", "#56707f", "#d8dde0"), metalness: 0.6, roughness: 0.15, envMapIntensity: 1.3 });
  const camYesil = new THREE.MeshStandardMaterial({ map: camDoku("#5fa3a0", "#21504f", "#c9d6d2"), metalness: 0.5, roughness: 0.14, envMapIntensity: 1.2 });
  const tas = new THREE.MeshStandardMaterial({ roughness: 0.85, map: canvasDoku(128, 128, (x, w, h) => {
    x.fillStyle = "#dccaa5"; x.fillRect(0, 0, w, h);
    x.fillStyle = "#3a4b5a"; x.fillRect(w * 0.18, h * 0.2, w * 0.64, h * 0.55);
    x.fillStyle = "rgba(255,255,255,.18)"; x.fillRect(w * 0.18, h * 0.2, w * 0.2, h * 0.55);
    x.fillStyle = "#c7b28b"; x.fillRect(0, h * 0.8, w, h * 0.06);
  }) });
  const catiMat = new THREE.MeshStandardMaterial({ color: 0x8e8b85, roughness: 0.9 });
  const cepheler = [camMavi, camGumus, camYesil, tas].map(m => ({ mat: m, t: toplayici() }));
  const cati = toplayici();
  const kaldirim = toplayici(), cim = toplayici(), bordur = toplayici();

  const merkezHmax = (x, z) => lerp(210, 35, clamp(Math.hypot(x, z - 40) / 360, 0, 1));
  const kule = (x, z, w, d, h, stil) => {
    const c = cepheler[stil].t;
    // basamaklı kule: yükseldikçe daralır
    const kademe = h > 90 && rastgele() < 0.6 ? 3 : h > 50 && rastgele() < 0.5 ? 2 : 1;
    let y = 0.2, ww = w, dd = d;
    for (let k = 0; k < kademe; k++) {
      const hh = k === kademe - 1 ? h - (y - 0.2) : h * (k === 0 ? 0.55 : 0.28);
      binaKutusu(c, cati, x, z, ww, dd, y, hh);
      y += hh; ww *= 0.78; dd *= 0.78;
    }
    // çatı detayı
    if (rastgele() < 0.5) binaKutusu(cepheler[3].t, cati, x, z, ww * 0.6, dd * 0.6, y, 3);
    kutuEkle(x - w / 2, z - d / 2, x + w / 2, z + d / 2);
  };

  for (let i = 0; i < SOKAKLAR.length - 1; i++) for (let j = 0; j < SOKAKLAR.length - 1; j++) {
    const x0 = SOKAKLAR[i] + SOKAK_YARI, x1 = SOKAKLAR[i + 1] - SOKAK_YARI;
    const z0 = SOKAKLAR[j] + sokakYari("z", SOKAKLAR[j]), z1 = SOKAKLAR[j + 1] - sokakYari("z", SOKAKLAR[j + 1]);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const park = (i === 1 && j === 3) || (i === 3 && j === 1) || (i === 4 && j === 4);
    // kaldırım / çim zemin (0.2 m yüksek) + bordür
    (park ? cim : kaldirim).yer(x0, z0, x1, z1, 0.2, [0, 0, (x1 - x0) / 4, (z1 - z0) / 4]);
    bordur.dortgen([x0, 0, z1], [x1, 0, z1], [x1, 0.2, z1], [x0, 0.2, z1], 0, 0, 1, [0, 0, 1, 1]);
    bordur.dortgen([x1, 0, z0], [x0, 0, z0], [x0, 0.2, z0], [x1, 0.2, z0], 0, 0, -1, [0, 0, 1, 1]);
    bordur.dortgen([x1, 0, z1], [x1, 0, z0], [x1, 0.2, z0], [x1, 0.2, z1], 1, 0, 0, [0, 0, 1, 1]);
    bordur.dortgen([x0, 0, z0], [x0, 0, z1], [x0, 0.2, z1], [x0, 0.2, z0], -1, 0, 0, [0, 0, 1, 1]);
    if (park) {
      for (let k = 0; k < 14; k++) palmiyeEkle(lerp(x0 + 8, x1 - 8, rastgele()), lerp(z0 + 8, z1 - 8, rastgele()));
      continue;
    }
    if (i === 2 && j === 2) { zirveKulesi(cx, cz); continue; }
    const pay = 9, gx0 = x0 + pay, gx1 = x1 - pay, gz0 = z0 + pay, gz1 = z1 - pay;
    const hmax = merkezHmax(cx, cz);
    if (rastgele() < 0.18) { // alçak AVM
      const w = gx1 - gx0, d = gz1 - gz0;
      binaKutusu(cepheler[3].t, cati, cx, cz, w, d, 0.2, 12 + rastgele() * 10);
      kutuEkle(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2);
      continue;
    }
    // 2x2 parsel
    const pw = (gx1 - gx0) / 2, pd = (gz1 - gz0) / 2;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      if (rastgele() < 0.12) continue;
      const px = gx0 + pw * (a + 0.5), pz = gz0 + pd * (b + 0.5);
      const w = pw * (0.55 + rastgele() * 0.35), d = pd * (0.55 + rastgele() * 0.35);
      const h = Math.max(18, hmax * (0.35 + rastgele() * 0.65));
      kule(px, pz, w, d, h, Math.floor(rastgele() * 4));
    }
  }
  cepheler.forEach(c => { const m = c.t.mesh(c.mat); m.castShadow = m.receiveShadow = GOLGE; });
  const cm = cati.mesh(catiMat); cm.receiveShadow = GOLGE;
  const ka = kaldirim.mesh(kaldirimMat); ka.receiveShadow = GOLGE;
  const ci = cim.mesh(cimMat); ci.receiveShadow = GOLGE;
  bordur.mesh(bordurMat);

  // Bulvar boyunca palmiyeler
  for (let x = -290; x <= 290; x += 18) {
    if (SOKAKLAR.some(v => Math.abs(x - v) < SOKAK_YARI + 5)) continue;
    palmiyeEkle(x, BULVAR_Z - BULVAR_YARI - 3); palmiyeEkle(x, BULVAR_Z + BULVAR_YARI + 3);
  }
  // Sahil: palmiyeler ve şemsiyeler
  for (let k = 0; k < 40; k++) palmiyeEkle(-280 + rastgele() * 560, 322 + rastgele() * 18);
  sokakLambalari();
  palmiyeleriKur();
  plajSemsiyeleri();
}

function zirveKulesi(x, z) {
  // Şehrin ortasındaki dev kule: köşeleri basamaklı, ince sivri uçlu
  const mat = new THREE.MeshStandardMaterial({ color: 0xc9d4dc, metalness: 0.75, roughness: 0.18, envMapIntensity: 1.4,
    map: canvasDoku(64, 128, (c, w, h) => { const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, "#8ea3b3"); g.addColorStop(0.5, "#dfe7ec"); g.addColorStop(1, "#7f95a6"); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = "rgba(40,60,80,.35)"; c.fillRect(0, h * 0.88, w, h * 0.12); }) });
  const g = new THREE.Group();
  let y = 0.2, r = 26;
  const katlar = [70, 60, 55, 45, 40, 30, 25];
  for (let k = 0; k < katlar.length; k++) {
    const h = katlar[k];
    const geo = new THREE.CylinderGeometry(r * 0.92, r, h, 6, 1);
    const uv = geo.attributes.uv; for (let q = 0; q < uv.count; q++) uv.setXY(q, uv.getX(q) * (r * 6 / 4), uv.getY(q) * h / 3.6);
    const m = new THREE.Mesh(geo, mat); m.position.set(x + (k % 2 ? 2 : -2), y + h / 2, z); m.rotation.y = k * 0.35;
    m.castShadow = m.receiveShadow = GOLGE; g.add(m);
    y += h; r *= 0.74;
  }
  const sivri = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 2.2, 60, 8), mat); sivri.position.set(x, y + 30, z); sivri.castShadow = GOLGE; g.add(sivri);
  // havuzlu meydan
  const havuz = new THREE.Mesh(new THREE.CylinderGeometry(42, 42, 0.3, 48), new THREE.MeshPhongMaterial({ color: 0x2a9cc0, shininess: 120, specular: 0xffffff }));
  havuz.position.set(x, 0.12, z); havuz.scale.z = 0.8; g.add(havuz);
  sahne.add(g);
  kutuEkle(x - 26, z - 26, x + 26, z + 26);
}

const palmiyeler = [];
function palmiyeEkle(x, z) { palmiyeler.push({ x, z, h: 7 + rastgele() * 5, egim: (rastgele() - 0.5) * 0.25, don: rastgele() * 6.28 }); engelEkle(x, z, 0.4); }
function palmiyeleriKur() {
  const n = palmiyeler.length;
  const govdeG = new THREE.CylinderGeometry(0.2, 0.34, 1, 7, 3); govdeG.translate(0, 0.5, 0);
  // yaprak: yatay şerit, uca doğru incelir ve aşağı kıvrılır
  const yaprakG = new THREE.PlaneGeometry(4.6, 1.0, 8, 2);
  yaprakG.rotateX(-Math.PI / 2); yaprakG.translate(2.3, 0, 0);
  const pp = yaprakG.attributes.position;
  for (let k = 0; k < pp.count; k++) {
    const t = pp.getX(k) / 4.6;
    pp.setZ(k, pp.getZ(k) * (1 - t * 0.75));
    pp.setY(k, -t * t * 1.9 + Math.abs(pp.getZ(k)) * 0.25);
  }
  yaprakG.computeVertexNormals();
  const govde = new THREE.InstancedMesh(govdeG, new THREE.MeshLambertMaterial({ color: 0x8a6a48 }), n);
  const yaprak = new THREE.InstancedMesh(yaprakG, new THREE.MeshLambertMaterial({ color: 0x3f7d2e, side: THREE.DoubleSide }), n * 8);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
  palmiyeler.forEach((a, k) => {
    const y = zeminH(a.x, a.z);
    e.set(a.egim, a.don, 0); q.setFromEuler(e); p.set(a.x, y, a.z); s.set(1, a.h, 1);
    m.compose(p, q, s); govde.setMatrixAt(k, m);
    const tepe = new THREE.Vector3(0, a.h, 0).applyQuaternion(q).add(p);
    for (let f = 0; f < 8; f++) {
      e.set(0, a.don + f * Math.PI / 4 + rastgele() * 0.3, -0.15 + rastgele() * 0.25, "YXZ"); q.setFromEuler(e);
      const o = 0.9 + rastgele() * 0.3; s.set(o, o, o);
      m.compose(tepe, q, s); yaprak.setMatrixAt(k * 8 + f, m);
      c.setHSL(0.27 + rastgele() * 0.05, 0.5, 0.25 + rastgele() * 0.08); yaprak.setColorAt(k * 8 + f, c);
    }
  });
  govde.castShadow = yaprak.castShadow = GOLGE;
  sahne.add(govde, yaprak);
}

function sokakLambalari() {
  const yerler = [];
  for (const v of SOKAKLAR) {
    const hz = sokakYari("z", v) + 1.3, hx = SOKAK_YARI + 1.3;
    for (let t = -SEHIR_SINIR + 10; t <= SEHIR_SINIR - 10; t += 32) {
      if (!SOKAKLAR.some(w => Math.abs(t - w) < SOKAK_YARI + 7)) {
        yerler.push([t, v + hz, Math.PI], [t, v - hz, 0]);         // x-sokağı: lambalar yola bakar
        yerler.push([v + hx, t, -Math.PI / 2], [v - hx, t, Math.PI / 2]);
      }
    }
  }
  const direkG = new THREE.CylinderGeometry(0.1, 0.15, 8.5, 6); direkG.translate(0, 4.25, 0);
  const kolG = new THREE.BoxGeometry(0.1, 0.1, 2.4); kolG.translate(0, 8.4, 1.1);
  const lambaG = new THREE.BoxGeometry(0.45, 0.14, 0.9); lambaG.translate(0, 8.33, 2.2);
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.7, roughness: 0.35 });
  const direk = new THREE.InstancedMesh(direkG, metal, yerler.length), kol = new THREE.InstancedMesh(kolG, metal, yerler.length);
  const lamba = new THREE.InstancedMesh(lambaG, new THREE.MeshBasicMaterial({ color: 0xfff3d6 }), yerler.length);
  const m = new THREE.Matrix4();
  yerler.forEach(([x, z, r], k) => {
    m.makeRotationY(r); m.setPosition(x, 0.2, z);
    direk.setMatrixAt(k, m); kol.setMatrixAt(k, m); lamba.setMatrixAt(k, m);
    engelEkle(x, z, 0.2);
  });
  direk.castShadow = GOLGE;
  sahne.add(direk, kol, lamba);
}

function plajSemsiyeleri() {
  const n = 26, renkler = [0xe94b3c, 0xf2b134, 0x2f9bd6, 0xffffff];
  const sapG = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5); sapG.translate(0, 1.2, 0);
  const tepeG = new THREE.ConeGeometry(1.5, 0.6, 8); tepeG.translate(0, 2.5, 0);
  const sap = new THREE.InstancedMesh(sapG, new THREE.MeshLambertMaterial({ color: 0xdddddd }), n);
  const tepe = new THREE.InstancedMesh(tepeG, new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const x = -260 + rastgele() * 520, z = 343 + rastgele() * 10;
    m.makeTranslation(x, zeminH(x, z), z); sap.setMatrixAt(k, m); tepe.setMatrixAt(k, m);
    tepe.setColorAt(k, c.set(renkler[k % renkler.length]));
  }
  sahne.add(sap, tepe);
}

// ================== ARABALAR ==================
// 3D modeller: "Ferrari 458 Italia" – vicent091036 (CC BY 4.0, three.js örneklerinden)
//              "Car Concept" – Khronos Group, Unity Fan'ın CC0 modelinden (CC BY 4.0)
const ARABALAR = [
  { id: "kizil", ad: "Kızıl Ok", tip: "İtalyan süper spor havası · orta motor, V8", model: "kizil",
    on: ["wheel_fl", "wheel_fr"], arka: ["wheel_rl", "wheel_rr"], cevir: Math.PI,
    renk: 0xc8161d, aksan: 0x1a1a1a,
    maxHiz: 88, ivme: 17, tutus: 8.0, driftTutus: 1.9, donus: 2.0, motor: 52,
    puan: { hiz: 1.0, ivme: 0.95, yol: 0.82, drift: 0.75 } },
  { id: "nova", ad: "Nova Konsept", tip: "Geleceğin süper sporu · çevik, drift dostu", model: "nova",
    on: ["WheelFrontL", "WheelFrontR"], arka: ["WheelRearL", "WheelRearR"], cevir: 0,
    renk: 0xb3121b, aksan: 0x2b2b2b,
    maxHiz: 82, ivme: 16.5, tutus: 8.6, driftTutus: 1.35, donus: 2.3, motor: 44,
    puan: { hiz: 0.93, ivme: 0.92, yol: 0.9, drift: 0.97 } }
];
const MODEL_SABLON = {};
function modelleriYukle() {
  const yukleyici = new THREE_EK.GLTFLoader();
  const isler = ARABALAR.map(s => new Promise((tamam, hata) => {
    const b64 = window.MODELLER[s.model], ikili = atob(b64), dizi = new Uint8Array(ikili.length);
    for (let i = 0; i < ikili.length; i++) dizi[i] = ikili.charCodeAt(i);
    yukleyici.parse(dizi.buffer, "", g => { MODEL_SABLON[s.id] = modelHazirla(s, g.scene); tamam(); }, hata);
  }));
  return Promise.all(isler);
}
function modelHazirla(s, sahneM) {
  const kok = new THREE.Group(), govde = new THREE.Group();
  kok.add(govde); govde.add(sahneM);
  sahneM.rotation.y = s.cevir;
  sahneM.traverse(o => {
    if (!o.isMesh) return;
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    o.castShadow = GOLGE; o.receiveShadow = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) { if (m.envMapIntensity !== undefined) m.envMapIntensity = 1.2; }
  });
  // tekerleri yere oturt, ortala
  kok.updateMatrixWorld(true);
  const kutu = new THREE.Box3().setFromObject(sahneM), merkez = kutu.getCenter(new THREE.Vector3()), boyut = kutu.getSize(new THREE.Vector3());
  sahneM.position.x -= merkez.x; sahneM.position.z -= merkez.z; sahneM.position.y -= kutu.min.y;
  s.en = boyut.x; s.boy = boyut.z;
  kok.updateMatrixWorld(true);
  // tekerleri dönebilen gruplara taşı
  const tekerler = [], onPivot = [];
  const bul = ad => { let n = null; sahneM.traverse(o => { if (!n && o.name === ad) n = o; }); return n; };
  for (const ad of [...s.on, ...s.arka]) {
    const t = bul(ad); if (!t) continue;
    const kutuT = new THREE.Box3().setFromObject(t), mT = kutuT.getCenter(new THREE.Vector3());
    govde.worldToLocal(mT);
    const pivot = new THREE.Group(); pivot.position.copy(mT); govde.add(pivot);
    const don = new THREE.Group(); pivot.add(don);
    pivot.updateMatrixWorld(true);
    don.attach(t);
    tekerler.push(don);
    if (s.on.includes(ad)) onPivot.push(pivot);
  }
  // sahte gölge (gölgeler kapalıyken)
  const gc = document.createElement("canvas"); gc.width = gc.height = 64;
  const gx = gc.getContext("2d"), gr = gx.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, "rgba(0,0,0,.6)"); gr.addColorStop(1, "rgba(0,0,0,0)"); gx.fillStyle = gr; gx.fillRect(0, 0, 64, 64);
  const golge = new THREE.Mesh(new THREE.PlaneGeometry(s.en * 1.4, s.boy * 1.15),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, depthWrite: false, opacity: GOLGE ? 0.45 : 1 }));
  golge.rotation.x = -Math.PI / 2;
  return { kok, govde, tekerler, onPivot, golge };
}
function arabaModeli(s) { return MODEL_SABLON[s.id]; }

// ================== ARABA DURUMU / FİZİK ==================
const araba = { x: 0, z: 0, y: 0, vy: 0, yon: 0, vx: 0, vz: 0, dir: 0, zeminde: true, oncekiZemin: 0,
  egimX: 0, egimZ: 0, yalpa: 0, tekerDonus: 0, spec: ARABALAR[0], model: null, kayma: 0, ileriHiz: 0, yolda: true };
const giris = { sol: false, sag: false, gaz: false, fren: false, el: false };

function arabaYerlestir(i) {
  i = ((i % yol.n) + yol.n) % yol.n;
  araba.x = yol.x[i]; araba.z = yol.z[i];
  araba.yon = Math.atan2(yol.tx[i], yol.tz[i]);
  araba.y = zeminH(araba.x, araba.z); araba.oncekiZemin = araba.y; araba.vy = 0;
  araba.vx = araba.vz = 0; araba.dir = 0; araba.zeminde = true;
}

let carpmaSoguma = 0;
function fizik(dt, kilitli) {
  const s = araba.spec;
  const fx = Math.sin(araba.yon), fz = Math.cos(araba.yon), lx = Math.cos(araba.yon), lz = -Math.sin(araba.yon);
  let vF = araba.vx * fx + araba.vz * fz, vL = araba.vx * lx + araba.vz * lz;
  const yolda = SEHIR ? (sokakMu(araba.x, araba.z) || Math.abs(araba.x) < SEHIR_SINIR && Math.abs(araba.z) < SEHIR_SINIR)
    : enYakinYol(araba.x, araba.z).d < YOL_YARI + 0.8;
  araba.yolda = yolda;
  const suda = araziH(araba.x, araba.z) < SU_Y - 0.3;

  // direksiyon
  const hedef = kilitli ? 0 : (giris.sag ? 1 : 0) - (giris.sol ? 1 : 0);
  araba.dir += (hedef - araba.dir) * Math.min(1, dt * (hedef === 0 ? 9 : 5.5));

  if (araba.zeminde) {
    const maxH = s.maxHiz * (yolda ? 1 : 0.6) * (suda ? 0.3 : 1);
    if (!kilitli && giris.gaz) vF += s.ivme * Math.max(0, 1 - Math.max(0, vF) / maxH) * dt * (vF < 0 ? 2 : 1);
    if (!kilitli && giris.fren) {
      if (vF > 0.8) vF -= 30 * dt; else vF = Math.max(-15, vF - 10 * dt);
    }
    if (vF > maxH) vF -= (vF - maxH) * 1.4 * dt;
    vF -= vF * (0.05 + (yolda ? 0 : 0.35) + (suda ? 2.5 : 0)) * dt;
    if (!giris.gaz && !giris.fren) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 2.2 * dt);
    if (giris.el && !kilitli) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 7 * dt);

    // önce hızı eski yöne göre dünyaya geri yaz
    araba.vx = fx * vF + lx * vL; araba.vz = fz * vF + lz * vL;

    const hizOran = Math.min(1, Math.abs(vF) / 7);
    const azalt = 1 / (1 + Math.abs(vF) / 55);
    let donus = -araba.dir * s.donus * hizOran * azalt * (vF >= 0 ? 1 : -1);
    if (giris.el) donus *= 1.5;
    araba.yon += donus * dt;

    // yeni yöne göre ayrıştır: burun dönünce hız yana kalır (kayma)
    const nfx = Math.sin(araba.yon), nfz = Math.cos(araba.yon), nlx = Math.cos(araba.yon), nlz = -Math.sin(araba.yon);
    vF = araba.vx * nfx + araba.vz * nfz; vL = araba.vx * nlx + araba.vz * nlz;
    let tutus = s.tutus * (yolda ? 1 : 0.65);
    if (giris.el) tutus = s.driftTutus;
    else if (giris.gaz && Math.abs(araba.dir) > 0.6 && vF > 22) tutus = lerp(tutus, s.driftTutus * 1.6, 0.6);
    // yana kayan hızın bir kısmı ileri hıza dönüşür (tutunma)
    const kalan = vL * Math.exp(-tutus * dt);
    vF += Math.abs(vL - kalan) * 0.35 * Math.sign(vF || 1);
    vL = kalan;
    araba.vx = nfx * vF + nlx * vL; araba.vz = nfz * vF + nlz * vL;
    // eğim etkisi
    const e = 1.5, gx = (araziH(araba.x + e, araba.z) - araziH(araba.x - e, araba.z)) / (2 * e),
      gz = (araziH(araba.x, araba.z + e) - araziH(araba.x, araba.z - e)) / (2 * e);
    if (!yolda) { araba.vx -= gx * 9.8 * 0.6 * dt; araba.vz -= gz * 9.8 * 0.6 * dt; }
  }
  araba.ileriHiz = vF;
  araba.kayma = Math.abs(vF) > 4 ? Math.atan2(Math.abs(vL), Math.abs(vF)) : 0;

  araba.x += araba.vx * dt; araba.z += araba.vz * dt;

  // sınırlar
  const sinir = YARI - 12;
  if (Math.abs(araba.x) > sinir) { araba.x = Math.sign(araba.x) * sinir; araba.vx *= -0.3; }
  if (Math.abs(araba.z) > sinir) { araba.z = Math.sign(araba.z) * sinir; araba.vz *= -0.3; }

  // ağaç / kaya çarpışması
  carpmaSoguma -= dt;
  const kx = Math.floor(araba.x / ENGEL_KOVA), kz = Math.floor(araba.z / ENGEL_KOVA);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const liste = engelKova.get((kx + a) + "," + (kz + b)); if (!liste) continue;
    for (const i of liste) {
      const o = engeller[i], dx = araba.x - o.x, dz = araba.z - o.z, d = Math.hypot(dx, dz), r = o.r + 1.15;
      if (d < r && d > 0.001) {
        const nx = dx / d, nz = dz / d;
        araba.x = o.x + nx * r; araba.z = o.z + nz * r;
        const vn = araba.vx * nx + araba.vz * nz;
        if (vn < 0) {
          araba.vx -= vn * nx * 1.3; araba.vz -= vn * nz * 1.3;
          araba.vx *= 0.55; araba.vz *= 0.55;
          if (carpmaSoguma <= 0 && -vn > 4) { carpmaSoguma = 0.4; carpti(-vn); }
        }
      }
    }
  }

  // bina çarpışması (eksene hizalı dikdörtgenler)
  if (kutular.length) {
    const liste = kutuKova.get(Math.floor(araba.x / KUTU_KOVA) + "," + Math.floor(araba.z / KUTU_KOVA));
    if (liste) for (const k of liste) {
      const px = clamp(araba.x, k.x0, k.x1), pz = clamp(araba.z, k.z0, k.z1);
      let dx = araba.x - px, dz = araba.z - pz, d = Math.hypot(dx, dz);
      const r = 1.2;
      if (d < r) {
        if (d < 0.001) { // merkez içeride: en yakın kenara it
          const sec = [[k.x0 - araba.x, 0], [k.x1 - araba.x, 0], [0, k.z0 - araba.z], [0, k.z1 - araba.z]].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
          dx = -Math.sign(sec[0]); dz = -Math.sign(sec[1]); d = 0;
          araba.x += sec[0] - dx * r; araba.z += sec[1] - dz * r;
        } else { dx /= d; dz /= d; araba.x = px + dx * r; araba.z = pz + dz * r; }
        const vn = araba.vx * dx + araba.vz * dz;
        if (vn < 0) {
          araba.vx -= vn * dx * 1.25; araba.vz -= vn * dz * 1.25;
          araba.vx *= 0.6; araba.vz *= 0.6;
          if (carpmaSoguma <= 0 && -vn > 4) { carpmaSoguma = 0.4; carpti(-vn); }
        }
      }
    }
  }

  // dikey
  const zemin = zeminH(araba.x, araba.z);
  araba.vy -= 26 * dt;
  araba.y += araba.vy * dt;
  if (araba.y <= zemin) {
    if (!araba.zeminde && araba.vy < -9) inis(-araba.vy);
    araba.y = zemin; araba.vy = clamp((zemin - araba.oncekiZemin) / Math.max(dt, 0.001), -20, 14); araba.zeminde = true;
  } else if (araba.zeminde && araba.y - zemin < 0.22 && araba.vy < 0.8) {
    araba.y = zemin; araba.vy = clamp((zemin - araba.oncekiZemin) / Math.max(dt, 0.001), -20, 14);
  } else araba.zeminde = false;
  araba.oncekiZemin = zemin;
}

function modelGuncelle(dt) {
  const m = araba.model, s = araba.spec;
  m.kok.position.set(araba.x, araba.y, araba.z);
  // arazi eğimi
  const fx = Math.sin(araba.yon), fz = Math.cos(araba.yon), lx = Math.cos(araba.yon), lz = -Math.sin(araba.yon);
  const hb = s.boy * 0.45, he = s.en * 0.45;
  const hOn = zeminH(araba.x + fx * hb, araba.z + fz * hb), hArka = zeminH(araba.x - fx * hb, araba.z - fz * hb);
  const hSol = zeminH(araba.x + lx * he, araba.z + lz * he), hSag = zeminH(araba.x - lx * he, araba.z - lz * he);
  const hedefX = araba.zeminde ? -Math.atan2(hOn - hArka, hb * 2) : araba.egimX * 0.98;
  const hedefZ = araba.zeminde ? Math.atan2(hSol - hSag, he * 2) : araba.egimZ;
  araba.egimX = lerp(araba.egimX, hedefX, Math.min(1, dt * 10));
  araba.egimZ = lerp(araba.egimZ, hedefZ, Math.min(1, dt * 10));
  m.kok.rotation.order = "YXZ";
  m.kok.rotation.set(araba.egimX, araba.yon, araba.egimZ);
  // gövde yalpası (virajda yatma)
  const hedefYalpa = clamp(araba.dir * Math.min(1, Math.abs(araba.ileriHiz) / 30) * 0.06, -0.08, 0.08);
  araba.yalpa = lerp(araba.yalpa, hedefYalpa, Math.min(1, dt * 6));
  m.govde.rotation.z = araba.yalpa;
  m.govde.rotation.x = clamp(-(giris.gaz ? 0.012 : 0) + (giris.fren && araba.ileriHiz > 2 ? 0.025 : 0), -0.05, 0.05);
  araba.tekerDonus += araba.ileriHiz * dt / 0.37;
  for (const t of m.tekerler) t.rotation.x = araba.tekerDonus;
  for (const p of m.onPivot) p.rotation.y = -araba.dir * 0.45;
  const gzemin = zeminH(araba.x, araba.z);
  m.golge.position.set(araba.x, gzemin + 0.08, araba.z);
  m.golge.rotation.z = araba.yon;
  m.golge.material.opacity = clamp(1 - (araba.y - gzemin) / 6, 0.2, 1);
}

// ================== KAMERA ==================
let kameraModu = 0; // 0 takip, 1 uzak takip, 2 kaput
const kamPos = new THREE.Vector3(), kamHedef = new THREE.Vector3();
function kameraGuncelle(dt, ani) {
  const fx = Math.sin(araba.yon), fz = Math.cos(araba.yon);
  const hiz = Math.hypot(araba.vx, araba.vz);
  if (kameraModu === 2) {
    kamera.position.set(araba.x + fx * 0.4, araba.y + 1.42, araba.z + fz * 0.4);
    kamera.lookAt(araba.x + fx * 30, araba.y + 1.0 - Math.sin(araba.egimX) * 30, araba.z + fz * 30);
  } else {
    // hız yönüne biraz bak (drift'te güzel görünür)
    let bx = fx, bz = fz;
    if (hiz > 5) { bx = lerp(fx, araba.vx / hiz, 0.35); bz = lerp(fz, araba.vz / hiz, 0.35); const L = Math.hypot(bx, bz); bx /= L; bz /= L; }
    const uzak = kameraModu === 0 ? 8.5 : 13, yuk = kameraModu === 0 ? 3.3 : 5.2;
    const hedef = new THREE.Vector3(araba.x - bx * uzak, araba.y + yuk, araba.z - bz * uzak);
    const k = ani ? 1 : 1 - Math.exp(-dt * 7);
    kamPos.lerp(hedef, k);
    const minY = zeminH(kamPos.x, kamPos.z) + 1.2;
    if (kamPos.y < minY) kamPos.y = minY;
    kamera.position.copy(kamPos);
    kamHedef.set(araba.x + fx * 4, araba.y + 1.2, araba.z + fz * 4);
    kamera.lookAt(kamHedef);
  }
  const hedefFov = 60 + clamp(hiz / araba.spec.maxHiz, 0, 1) * 16;
  kamera.fov = lerp(kamera.fov, hedefFov, Math.min(1, dt * 3));
  kamera.updateProjectionMatrix();
}

// ================== SES ==================
let ses = null, sesAcik = kayit.oku("ses", true);
const motor = {};
function sesBaslat() {
  if (ses) { if (ses.state === "suspended") ses.resume(); return; }
  try { ses = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  motor.ana = ses.createGain(); motor.ana.gain.value = sesAcik ? 1 : 0; motor.ana.connect(ses.destination);
  motor.o1 = ses.createOscillator(); motor.o1.type = "sawtooth";
  motor.o2 = ses.createOscillator(); motor.o2.type = "square";
  motor.filtre = ses.createBiquadFilter(); motor.filtre.type = "lowpass"; motor.filtre.frequency.value = 700;
  motor.g = ses.createGain(); motor.g.gain.value = 0;
  const g2 = ses.createGain(); g2.gain.value = 0.5;
  motor.o1.connect(motor.filtre); motor.o2.connect(g2).connect(motor.filtre); motor.filtre.connect(motor.g).connect(motor.ana);
  motor.o1.start(); motor.o2.start();
  // lastik sesi
  const n = ses.sampleRate, b = ses.createBuffer(1, n, n), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  motor.gurultu = ses.createBufferSource(); motor.gurultu.buffer = b; motor.gurultu.loop = true;
  const bp = ses.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 3;
  motor.lastik = ses.createGain(); motor.lastik.gain.value = 0;
  motor.gurultu.connect(bp).connect(motor.lastik).connect(motor.ana); motor.gurultu.start();
  motor.buffer = b;
}
function sesGuncelle(rpm, gazVar, kayma) {
  if (!ses || !motor.o1) return;
  const t = ses.currentTime, taban = araba.spec.motor;
  motor.o1.frequency.setTargetAtTime(taban + rpm * taban * 3.2, t, 0.05);
  motor.o2.frequency.setTargetAtTime((taban + rpm * taban * 3.2) / 2, t, 0.05);
  motor.filtre.frequency.setTargetAtTime(500 + rpm * 1800 + (gazVar ? 400 : 0), t, 0.08);
  motor.g.gain.setTargetAtTime(oyunDurumu === "surus" ? 0.07 + (gazVar ? 0.06 : 0) : 0, t, 0.1);
  motor.lastik.gain.setTargetAtTime(oyunDurumu === "surus" ? clamp((kayma - 0.18) * 0.5, 0, 0.16) : 0, t, 0.05);
}
function vurusSesi(guc) {
  if (!ses || !sesAcik || !motor.buffer) return;
  const s = ses.createBufferSource(), g = ses.createGain(), f = ses.createBiquadFilter();
  s.buffer = motor.buffer; f.type = "lowpass"; f.frequency.value = 400;
  g.gain.setValueAtTime(clamp(guc / 30, 0.1, 0.5), ses.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ses.currentTime + 0.35);
  s.connect(f).connect(g).connect(ses.destination); s.start(); s.stop(ses.currentTime + 0.4);
}
function bip(f, sure = 0.15, tip = "sine", hacim = 0.08) {
  if (!ses || !sesAcik) return;
  const o = ses.createOscillator(), g = ses.createGain(), t = ses.currentTime;
  o.type = tip; o.frequency.value = f; g.gain.setValueAtTime(hacim, t); g.gain.exponentialRampToValueAtTime(0.001, t + sure);
  o.connect(g).connect(ses.destination); o.start(t); o.stop(t + sure + 0.02);
}

// ================== MODLAR ==================
const MODLAR = [
  { id: "serbest", ad: "Serbest Sürüş", aciklama: "Hedef yok, dağda istediğin gibi gez" },
  { id: "yaris", ad: "Kontrol Noktalı Yarış", aciklama: "Tüm kapılardan geçerek bir tur at" },
  { id: "radar", ad: "Hız Radarları", aciklama: "3 radardan olabildiğince hızlı geç" },
  { id: "drift", ad: "Drift", aciklama: "Kayarak puan topla, çarpma" }
];
let secMod = kayit.oku("mod", "serbest"), secAraba = kayit.oku("araba", "kizil");
if (!ARABALAR.some(a => a.id === secAraba)) secAraba = ARABALAR[0].id;
let oyunDurumu = "yukleniyor"; // menu | surus | durdu | bitti

// --- Kapılar ---
const KAPI_SAYI = 10;
const kapilar = [];
function kapiKur() {
  const sutunG = new THREE.BoxGeometry(0.7, 7, 0.7), ustG = new THREE.BoxGeometry(YOL_YARI * 2 + 3, 1.1, 0.7);
  for (let k = 0; k < KAPI_SAYI; k++) {
    const i = Math.floor((k * yol.n) / KAPI_SAYI + 4) % yol.n;
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9 });
    for (const sx of [-1, 1]) { const c = new THREE.Mesh(sutunG, mat); c.position.set(sx * (YOL_YARI + 1.5), 3.5, 0); g.add(c); }
    const u = new THREE.Mesh(ustG, mat); u.position.y = 7; g.add(u);
    g.position.set(yol.x[i], yol.y[i], yol.z[i]);
    g.rotation.y = Math.atan2(yol.tx[i], yol.tz[i]);
    g.visible = false;
    sahne.add(g);
    kapilar.push({ i, g, mat });
  }
}
// --- Radarlar ---
const radarlar = [];
function radarKur() {
  // en düz yerleri bul
  const puan = [];
  for (let i = 0; i < yol.n; i++) {
    const a = (i - 30 + yol.n) % yol.n, b = (i + 30) % yol.n;
    const d = yol.tx[a] * yol.tx[b] + yol.tz[a] * yol.tz[b];
    puan.push({ i, d });
  }
  puan.sort((p, q) => q.d - p.d);
  const secilen = [];
  for (const p of puan) {
    if (secilen.every(s => { const f = Math.abs(s - p.i); return Math.min(f, yol.n - f) > yol.n / 5; })) secilen.push(p.i);
    if (secilen.length === 3) break;
  }
  const direkG = new THREE.CylinderGeometry(0.15, 0.15, 5, 6), kutuG = new THREE.BoxGeometry(0.8, 0.6, 0.6);
  secilen.forEach((i, n) => {
    const rx = yol.tz[i], rz = -yol.tx[i];
    const x = yol.x[i] + rx * (YOL_YARI + 2.5), z = yol.z[i] + rz * (YOL_YARI + 2.5);
    const g = new THREE.Group();
    const d = new THREE.Mesh(direkG, new THREE.MeshLambertMaterial({ color: 0x9aa3ad })); d.position.y = 2.5; g.add(d);
    const k = new THREE.Mesh(kutuG, new THREE.MeshBasicMaterial({ color: 0x3ec5ff })); k.position.y = 5.2; g.add(k);
    const halka = new THREE.Mesh(new THREE.TorusGeometry(YOL_YARI + 1, 0.12, 6, 40), new THREE.MeshBasicMaterial({ color: 0x3ec5ff, transparent: true, opacity: 0.5 }));
    halka.position.set(-rx * (YOL_YARI + 2.5), 0.2, -rz * (YOL_YARI + 2.5)); halka.rotation.x = Math.PI / 2;
    g.add(halka);
    g.position.set(x, araziH(x, z), z);
    g.visible = false;
    sahne.add(g);
    radarlar.push({ i, g, x: yol.x[i], z: yol.z[i], ad: "Radar " + (n + 1), soguma: 0 });
  });
}

// --- Mod durumu ---
const md = { sure: 0, sonraki: 0, geri: 0, bitti: false, drift: 0, driftCarpan: 1, driftSure: 0, driftBos: 0, driftToplam: 0 };
function modBaslat() {
  const m = secMod;
  kapilar.forEach(k => k.g.visible = false);
  radarlar.forEach(r => r.g.visible = m === "radar" || m === "serbest");
  md.sure = 0; md.sonraki = 1; md.geri = m === "yaris" ? 3.5 : 0; md.bitti = false;
  md.drift = 0; md.driftCarpan = 1; md.driftSure = 0; md.driftBos = 0; md.driftToplam = 0;
  arabaYerlestir(m === "yaris" ? kapilar[0].i - 25 : baslangicNoktasi());
  if (m === "yaris") kapiGoster();
  $("ok").classList.toggle("gizli", m !== "yaris");
  $("drift").classList.add("gizli");
  hudMod();
}
function baslangicNoktasi() {
  if (!SEHIR) return 0;
  let en = 0, ed = Infinity;
  for (let i = 0; i < yol.n; i++) { const d = Math.hypot(yol.x[i] + 200, yol.z[i] - BULVAR_Z); if (d < ed) { ed = d; en = i; } }
  return en;
}
function kapiGoster() {
  kapilar.forEach((k, n) => {
    const hedefMi = n === md.sonraki % KAPI_SAYI, ikinci = n === (md.sonraki + 1) % KAPI_SAYI;
    k.g.visible = hedefMi || ikinci;
    k.mat.color.set(hedefMi ? 0xff7a1a : 0xffffff); k.mat.opacity = hedefMi ? 0.92 : 0.35;
  });
}

let bildirimZaman = 0;
function bildirim(metin, alt = "", sure = 1.8) {
  $("bildirim").innerHTML = metin + (alt ? "<small>" + alt + "</small>" : "");
  $("bildirim").style.opacity = 1; bildirimZaman = sure;
}

function carpti(guc) {
  vurusSesi(guc);
  if (secMod === "drift" && md.drift > 0) { bildirim("DRİFT KAYBOLDU", "", 1.2); md.drift = 0; md.driftCarpan = 1; md.driftSure = 0; }
  try { navigator.vibrate && navigator.vibrate(40); } catch (e) {}
}
function inis(guc) { vurusSesi(guc * 0.6); }

function modGuncelle(dt) {
  const hiz = Math.hypot(araba.vx, araba.vz);
  if (secMod === "yaris") {
    if (md.geri > 0) {
      const once = Math.ceil(md.geri); md.geri -= dt; const sonra = Math.ceil(md.geri);
      if (sonra !== once) { if (sonra > 0) { bildirim(String(sonra)); bip(520, 0.15, "square", 0.06); } else { bildirim("BAŞLA!"); bip(1040, 0.3, "square", 0.07); } }
    } else if (!md.bitti) {
      md.sure += dt;
      const k = kapilar[md.sonraki % KAPI_SAYI];
      if (Math.hypot(araba.x - yol.x[k.i], araba.z - yol.z[k.i]) < YOL_YARI + 4) {
        bip(880, 0.12, "triangle", 0.07);
        if (md.sonraki % KAPI_SAYI === 0) { turBitti(); }
        else { md.sonraki++; kapiGoster(); }
      }
    }
  }
  if (secMod === "radar" || secMod === "serbest") {
    for (const r of radarlar) {
      r.soguma -= dt;
      if (r.soguma <= 0 && Math.hypot(araba.x - r.x, araba.z - r.z) < YOL_YARI + 3) {
        r.soguma = 3;
        const kmh = Math.round(hiz * 3.6);
        const rek = kayit.oku("radar_" + HARITA + r.ad, 0);
        if (kmh > rek) { kayit.yaz("radar_" + HARITA + r.ad, kmh); bildirim(kmh + " km/sa", r.ad + " · YENİ REKOR", 2.2); bip(1320, 0.25, "triangle", 0.08); }
        else bildirim(kmh + " km/sa", r.ad + " · rekor " + rek, 2);
      }
    }
  }
  if (secMod === "drift") {
    const kayiyor = araba.zeminde && hiz > 11 && araba.kayma > 0.22 && araba.ileriHiz > 0;
    if (kayiyor) {
      md.driftBos = 0; md.driftSure += dt;
      md.driftCarpan = Math.min(5, 1 + Math.floor(md.driftSure / 2));
      md.drift += hiz * araba.kayma * dt * 15 * md.driftCarpan;
    } else if (md.drift > 0) {
      md.driftBos += dt;
      if (md.driftBos > 1.3) {
        const p = Math.round(md.drift); md.driftToplam += p;
        const rek = kayit.oku("drift", 0);
        if (p > rek) { kayit.yaz("drift", p); bildirim("+" + p, "EN İYİ DRİFT!", 2); bip(1200, 0.3, "triangle", 0.08); }
        else bildirim("+" + p, "drift", 1.4);
        md.drift = 0; md.driftCarpan = 1; md.driftSure = 0;
      }
    }
    const el = $("drift");
    if (md.drift > 0) { el.classList.remove("gizli"); el.innerHTML = Math.round(md.drift) + "<small>DRİFT x" + md.driftCarpan + "</small>"; }
    else el.classList.add("gizli");
  }
  hudMod();
}

function turBitti() {
  md.bitti = true;
  const rek = kayit.oku("tur_" + HARITA + "_" + araba.spec.id, 0);
  const yeni = !rek || md.sure < rek;
  if (yeni) kayit.yaz("tur_" + HARITA + "_" + araba.spec.id, md.sure);
  $("sonBaslik").textContent = "TUR TAMAMLANDI · " + araba.spec.ad;
  $("sonSure").textContent = sureYaz(md.sure);
  $("sonRekor").textContent = yeni ? "Yeni rekor!" : "Rekor: " + sureYaz(rek);
  oyunDurumu = "bitti";
  goster("sonPanel", true); goster("kontrol", false);
  bip(660, 0.15); setTimeout(() => bip(880, 0.15), 150); setTimeout(() => bip(1320, 0.3), 300);
}

function hudMod() {
  const m = MODLAR.find(x => x.id === secMod);
  if (secMod === "yaris") {
    $("g1").textContent = "YARIŞ · KAPI " + Math.min(md.sonraki, KAPI_SAYI) + "/" + KAPI_SAYI;
    $("g2").textContent = sureYaz(md.sure);
    const rek = kayit.oku("tur_" + HARITA + "_" + araba.spec.id, 0);
    const k = kapilar[md.sonraki % KAPI_SAYI];
    const mes = k ? Math.round(Math.hypot(araba.x - yol.x[k.i], araba.z - yol.z[k.i])) : 0;
    $("g3").textContent = (rek ? "Rekor " + sureYaz(rek) + " · " : "") + "Sonraki kapı " + mes + " m";
  } else if (secMod === "drift") {
    $("g1").textContent = "DRİFT";
    $("g2").textContent = String(md.driftToplam);
    $("g3").textContent = "En iyi tek drift: " + kayit.oku("drift", 0);
  } else if (secMod === "radar") {
    $("g1").textContent = "HIZ RADARLARI";
    let en = radarlar[0], ed = Infinity;
    for (const r of radarlar) { const d = Math.hypot(araba.x - r.x, araba.z - r.z); if (d < ed) { ed = d; en = r; } }
    $("g2").textContent = en ? en.ad + " · " + Math.round(ed) + " m" : "";
    $("g3").textContent = radarlar.map(r => r.ad.replace("Radar ", "R") + ": " + kayit.oku("radar_" + HARITA + r.ad, 0)).join("  ·  ");
  } else {
    $("g1").textContent = "SERBEST SÜRÜŞ"; $("g2").textContent = araba.spec.ad; $("g3").textContent = m ? m.aciklama : "";
  }
}

// ================== MİNİ HARİTA ==================
const mini = $("mini"), mctx = mini.getContext("2d");
let miniArka = null;
function miniHazirla() {
  miniArka = document.createElement("canvas"); miniArka.width = miniArka.height = 256;
  const c = miniArka.getContext("2d"), o = 256 / (2 * YARI);
  if (SEHIR) {
    c.fillStyle = "rgba(201,170,120,.6)"; c.beginPath(); c.arc(128, 128, 128, 0, 6.29); c.fill();
    c.fillStyle = "rgba(27,140,174,.9)"; c.fillRect(0, (345 + YARI) * o, 256, 256);
    c.fillStyle = "rgba(60,62,66,.9)"; c.fillRect((-SEHIR_SINIR + YARI) * o, (-SEHIR_SINIR + YARI) * o, 2 * SEHIR_SINIR * o, 2 * SEHIR_SINIR * o);
    c.fillStyle = "rgba(170,165,150,.95)";
    for (let i = 0; i < SOKAKLAR.length - 1; i++) for (let j = 0; j < SOKAKLAR.length - 1; j++) {
      const x0 = SOKAKLAR[i] + SOKAK_YARI, x1 = SOKAKLAR[i + 1] - SOKAK_YARI, z0 = SOKAKLAR[j] + sokakYari("z", SOKAKLAR[j]), z1 = SOKAKLAR[j + 1] - sokakYari("z", SOKAKLAR[j + 1]);
      c.fillRect((x0 + YARI) * o, (z0 + YARI) * o, (x1 - x0) * o, (z1 - z0) * o);
    }
    c.strokeStyle = "rgba(255,122,26,.75)"; c.lineWidth = 3; c.beginPath();
    for (let i = 0; i <= yol.n; i += 3) { const k = i % yol.n, x = (yol.x[k] + YARI) * o, y = (yol.z[k] + YARI) * o; i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.closePath(); c.stroke();
    return;
  }
  c.fillStyle = "rgba(47,90,43,.55)"; c.beginPath(); c.arc(128, 128, 128, 0, 6.29); c.fill();
  c.fillStyle = "rgba(47,111,158,.9)"; c.beginPath(); c.arc((GOL.x + YARI) * o, (GOL.z + YARI) * o, GOL.r * o * 1.2, 0, 6.29); c.fill();
  c.strokeStyle = "#e9ece6"; c.lineWidth = 5; c.lineJoin = "round"; c.beginPath();
  for (let i = 0; i <= yol.n; i += 4) { const k = i % yol.n, x = (yol.x[k] + YARI) * o, y = (yol.z[k] + YARI) * o; i ? c.lineTo(x, y) : c.moveTo(x, y); }
  c.closePath(); c.stroke();
}
function miniCiz() {
  const o = 256 / (2 * YARI);
  mctx.clearRect(0, 0, 256, 256);
  mctx.save(); mctx.beginPath(); mctx.arc(128, 128, 126, 0, 6.29); mctx.clip();
  mctx.drawImage(miniArka, 0, 0);
  if (secMod === "yaris") {
    const k = kapilar[md.sonraki % KAPI_SAYI];
    if (k) { mctx.fillStyle = "#ff7a1a"; mctx.beginPath(); mctx.arc((yol.x[k.i] + YARI) * o, (yol.z[k.i] + YARI) * o, 9, 0, 6.29); mctx.fill(); }
  }
  if (secMod === "radar" || secMod === "serbest") {
    mctx.fillStyle = "#3ec5ff";
    for (const r of radarlar) { mctx.beginPath(); mctx.arc((r.x + YARI) * o, (r.z + YARI) * o, 7, 0, 6.29); mctx.fill(); }
  }
  const x = (araba.x + YARI) * o, y = (araba.z + YARI) * o;
  mctx.translate(x, y); mctx.rotate(-araba.yon + Math.PI);
  mctx.fillStyle = "#ffffff"; mctx.strokeStyle = "#1b0d00"; mctx.lineWidth = 2;
  mctx.beginPath(); mctx.moveTo(0, -13); mctx.lineTo(9, 10); mctx.lineTo(0, 5); mctx.lineTo(-9, 10); mctx.closePath(); mctx.fill(); mctx.stroke();
  mctx.restore();
}
// Mini harita: x sağa, z aşağı çiziliyor. Ok, arabanın yönüne göre döndürülür.

// ================== KONTROLLER ==================
function tusBagla(id, alan) {
  const el = $(id);
  const bas = e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) {} giris[alan] = true; el.classList.add("basili"); };
  const birak = () => { giris[alan] = false; el.classList.remove("basili"); };
  el.addEventListener("pointerdown", bas);
  el.addEventListener("pointerup", birak);
  el.addEventListener("pointercancel", birak);
  el.addEventListener("lostpointercapture", birak);
}
tusBagla("tSol", "sol"); tusBagla("tSag", "sag"); tusBagla("tGaz", "gaz"); tusBagla("tFren", "fren"); tusBagla("tEl", "el");
const tusHarita = { ArrowLeft: "sol", a: "sol", ArrowRight: "sag", d: "sag", ArrowUp: "gaz", w: "gaz", ArrowDown: "fren", s: "fren", " ": "el" };
window.addEventListener("keydown", e => { if (tusHarita[e.key]) { giris[tusHarita[e.key]] = true; e.preventDefault(); } if (e.key === "c") kameraDegis(); });
window.addEventListener("keyup", e => { if (tusHarita[e.key]) giris[tusHarita[e.key]] = false; });
function girisSifirla() { for (const k in giris) giris[k] = false; document.querySelectorAll(".tus").forEach(t => t.classList.remove("basili")); }
function kameraDegis() { kameraModu = (kameraModu + 1) % 3; kameraGuncelle(0.016, true); }
$("tKamera").addEventListener("click", kameraDegis);

// ================== MENÜ ==================
function goster(id, acik) { $(id).classList.toggle("gizli", !acik); }
function menuCiz() {
  $("haritaEtiket").textContent = SEHIR ? "ÇÖL ŞEHRİ · SAHİL BULVARI" : "ÇAM ORMANI · DAĞ YOLU";
  const hd = $("haritalar"); hd.innerHTML = "";
  for (const [id, ad, alt] of [["dag", "Dağ Yolu", "Çam ormanı, göl, virajlar"], ["sehir", "Çöl Şehri", "Gökdelenler, bulvar, sahil"]]) {
    const b = document.createElement("button");
    b.className = "harita" + (id === HARITA ? " secili" : "");
    b.innerHTML = ad + "<small>" + alt + "</small>";
    b.addEventListener("click", () => { if (id === HARITA) return; kayit.yaz("harita", id); $("yukleniyor").textContent = "Harita yükleniyor…"; goster("yukleniyor", true); setTimeout(() => location.reload(), 30); });
    hd.appendChild(b);
  }
  const modlar = $("modlar"); modlar.innerHTML = "";
  for (const m of MODLAR) {
    const b = document.createElement("button");
    b.className = "mod" + (m.id === secMod ? " secili" : "");
    let rek = "";
    if (m.id === "yaris") { const r = kayit.oku("tur_" + HARITA + "_" + secAraba, 0); rek = r ? "Rekor " + sureYaz(r) : ""; }
    if (m.id === "drift") { const r = kayit.oku("drift", 0); rek = r ? "En iyi " + r : ""; }
    if (m.id === "radar") { const r = Math.max(0, ...[1, 2, 3].map(n => kayit.oku("radar_" + HARITA + "Radar " + n, 0))); rek = r ? "En hızlı " + r + " km/sa" : ""; }
    b.innerHTML = `<span><b>${m.ad}</b><small>${m.aciklama}</small></span><span class="rek">${rek}</span>`;
    b.addEventListener("click", () => { secMod = m.id; kayit.yaz("mod", secMod); menuCiz(); });
    modlar.appendChild(b);
  }
  const ar = $("arabalar"); ar.innerHTML = "";
  for (const s of ARABALAR) {
    const b = document.createElement("button");
    b.className = "araba" + (s.id === secAraba ? " secili" : "");
    const hex = "#" + s.renk.toString(16).padStart(6, "0"), hex2 = "#" + s.aksan.toString(16).padStart(6, "0");
    const satir = (ad, v) => `<div class="ozellik"><span>${ad}</span><div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div></div>`;
    b.innerHTML = `<div class="renk" style="background:linear-gradient(90deg,${hex} 70%,${hex2} 70%)"></div>
      <div class="ad">${s.ad}</div><div class="tip">${s.tip}</div>
      ${satir("Son hız", s.puan.hiz)}${satir("Hızlanma", s.puan.ivme)}${satir("Yol tutuş", s.puan.yol)}${satir("Drift", s.puan.drift)}
      <div class="tip">${Math.round(s.maxHiz * 3.6)} km/sa</div>`;
    b.addEventListener("click", () => { secAraba = s.id; kayit.yaz("araba", secAraba); arabaSec(); menuCiz(); });
    ar.appendChild(b);
  }
  $("sesAyar").textContent = "Ses: " + (sesAcik ? "Açık" : "Kapalı");
  $("kaliteAyar").textContent = "Grafik: " + (kalite === "yuksek" ? "Yüksek" : "Düşük");
}
$("sesAyar").addEventListener("click", () => { sesAcik = !sesAcik; kayit.yaz("ses", sesAcik); if (motor.ana) motor.ana.gain.value = sesAcik ? 1 : 0; menuCiz(); });
$("kaliteAyar").addEventListener("click", () => { kalite = kalite === "yuksek" ? "dusuk" : "yuksek"; kayit.yaz("kalite", kalite); boyutla(); menuCiz(); });

function arabaSec() {
  const s = ARABALAR.find(a => a.id === secAraba) || ARABALAR[0];
  if (araba.model) { sahne.remove(araba.model.kok); sahne.remove(araba.model.golge); }
  araba.spec = s; araba.model = arabaModeli(s);
  sahne.add(araba.model.kok, araba.model.golge);
}

function menuyeDon() {
  oyunDurumu = "menu"; girisSifirla();
  goster("menu", true); goster("hud", false); goster("kontrol", false); goster("durPanel", false); goster("sonPanel", false);
  kapilar.forEach(k => k.g.visible = false);
  arabaYerlestir(Math.floor(yol.n * 0.62));
  menuCiz();
}
function surusBaslat() {
  sesBaslat();
  oyunDurumu = "surus"; girisSifirla();
  goster("menu", false); goster("hud", true); goster("kontrol", true); goster("durPanel", false); goster("sonPanel", false);
  modBaslat();
  kameraGuncelle(0.016, true);
  const m = MODLAR.find(x => x.id === secMod);
  if (secMod !== "yaris") bildirim(m.ad, araba.spec.ad, 1.8);
}
$("surBtn").addEventListener("click", surusBaslat);
function duraklat() { if (oyunDurumu !== "surus") return; oyunDurumu = "durdu"; girisSifirla(); goster("durPanel", true); goster("kontrol", false); }
function devam() { oyunDurumu = "surus"; goster("durPanel", false); goster("kontrol", true); sonZaman = performance.now(); }
$("tDur").addEventListener("click", duraklat);
$("devamBtn").addEventListener("click", devam);
$("yenidenBtn").addEventListener("click", surusBaslat);
$("garajBtn").addEventListener("click", menuyeDon);
$("garaj2Btn").addEventListener("click", menuyeDon);
$("tekrarBtn").addEventListener("click", surusBaslat);
$("serbestBtn").addEventListener("click", () => { secMod = "serbest"; kayit.yaz("mod", secMod); surusBaslat(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) duraklat(); });
// Android uygulaması için
window.oyunDuraklat = duraklat;
window.geriTusu = () => {
  if (oyunDurumu === "surus") { duraklat(); return ""; }
  if (oyunDurumu === "durdu") { devam(); return ""; }
  if (oyunDurumu === "bitti") { menuyeDon(); return ""; }
  return "cik";
};

// ================== DÖNGÜ ==================
let sonZaman = performance.now(), menuAci = 0;
function dongu(simdi) {
  requestAnimationFrame(dongu);
  let dt = (simdi - sonZaman) / 1000; sonZaman = simdi;
  if (dt > 0.05) dt = 0.05;
  if (oyunDurumu === "surus") {
    const kilitli = secMod === "yaris" && md.geri > 0;
    // fiziği iki alt adımda çalıştır (daha kararlı)
    fizik(dt / 2, kilitli); fizik(dt / 2, kilitli);
    modelGuncelle(dt);
    kameraGuncelle(dt, false);
    modGuncelle(dt);
    const kmh = Math.round(Math.hypot(araba.vx, araba.vz) * 3.6);
    $("hizSayi").textContent = kmh;
    // vites ve devir
    const oran = clamp(Math.abs(araba.ileriHiz) / araba.spec.maxHiz, 0, 1);
    const sinirlar = [0, 0.16, 0.31, 0.47, 0.63, 0.8, 1.01];
    let v = 1; while (v < 6 && oran > sinirlar[v]) v++;
    const rpm = clamp((oran - sinirlar[v - 1]) / (sinirlar[v] - sinirlar[v - 1]), 0, 1) * 0.8 + 0.2;
    $("vites").textContent = araba.ileriHiz < -0.5 ? "R" : String(v);
    sesGuncelle(rpm, giris.gaz, araba.kayma);
    if (secMod === "yaris") {
      const k = kapilar[md.sonraki % KAPI_SAYI];
      if (k) {
        const aci = Math.atan2(yol.x[k.i] - araba.x, yol.z[k.i] - araba.z) - araba.yon;
        $("ok").style.transform = "rotate(" + (-aci * 180 / Math.PI) + "deg)";
      }
    }
    miniCiz();
  } else if (oyunDurumu === "menu") {
    // garaj: araba etrafında yavaş dönen kamera
    menuAci += dt * 0.25;
    modelGuncelle(dt);
    const r = 9;
    kamera.position.set(araba.x + Math.sin(menuAci) * r, araba.y + 2.6, araba.z + Math.cos(menuAci) * r);
    kamera.lookAt(araba.x, araba.y + 0.9, araba.z);
    kamera.fov = 50; kamera.updateProjectionMatrix();
    sesGuncelle(0.2, false, 0);
  } else {
    sesGuncelle(0.2, false, 0);
  }
  if (bildirimZaman > 0) { bildirimZaman -= dt; if (bildirimZaman <= 0) $("bildirim").style.opacity = 0; }
  gunesTakip(araba.x, araba.y, araba.z);
  renderer.render(sahne, kamera);
}

// ================== BAŞLAT ==================
async function kur() {
  boyutla();
  await modelleriYukle();
  yolKur();
  araziYuksekligiHesapla();
  araziMeshKur();
  if (SEHIR) sehirKur(); else { yolMeshKur(); doga(); }
  kapiKur();
  radarKur();
  miniHazirla();
  arabaSec();
  menuyeDon();
  goster("yukleniyor", false);
  requestAnimationFrame(dongu);
}
// Yükleme yazısı ekrana çizilsin diye bir kare bekle
requestAnimationFrame(() => setTimeout(() => kur().catch(e => { $("yukleniyor").textContent = "Yükleme hatası: " + e; }), 30));

// Test için
window.__zirve = { kamera, ciz: () => { gok.position.copy(kamera.position); renderer.render(sahne, kamera); }, araba, giris, durum: () => oyunDurumu, surusBaslat, md, secModAyarla: m => { secMod = m; }, adim: (dt) => { fizik(dt/2,false); fizik(dt/2,false); modGuncelle(dt); }, arabaYerlestir, yol };
})();

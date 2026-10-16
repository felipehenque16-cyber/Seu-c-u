// ===== Coordenadas (localização exata) =====
const LAT = -7.211743433422754;
const LNG = -34.836187617846136;
const CITY = "João Pessoa";

// ===== Data em que começamos a namorar =====
const START_DATE = new Date(2017, 9, 15); // 15/10/2017 (mês 9 = outubro)

// ===== Elementos =====
const canvas = document.getElementById('sky');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;
const DPR = window.devicePixelRatio || 1;
const skyView = { zoom: 1, panX: 0, panY: 0 };

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  clampSkyView();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ===== Dados astronômicos reais (Open-Meteo): Sol e Lua juntos =====
let solarTimes = null; // { sunrise: Date, sunset: Date }
let moonData = null;   // { date: string, rise: Date|null, set: Date|null, phase: number|null }
let lastDate = null;
let weatherState = { available: false, error: false, isRaining: false, cloudCover: 35, rain: 0, showers: 0, code: null, updatedAt: null };
let celestialPanoramaActive = false;
let celestialPanoramaCacheKey = '';

function weatherDescription(code) {
  const descriptions = { 0:'céu limpo',1:'predomínio de céu limpo',2:'parcialmente nublado',3:'nublado',45:'névoa',48:'névoa congelante',51:'garoa fraca',53:'garoa moderada',55:'garoa intensa',56:'garoa congelante',57:'garoa congelante intensa',61:'chuva fraca',63:'chuva moderada',65:'chuva intensa',66:'chuva congelante',67:'chuva congelante intensa',71:'neve fraca',73:'neve moderada',75:'neve intensa',77:'grãos de neve',80:'pancadas fracas',81:'pancadas moderadas',82:'pancadas fortes',85:'pancadas de neve',86:'pancadas fortes de neve',95:'trovoada',96:'trovoada com granizo',99:'trovoada forte com granizo' };
  return descriptions[code] || 'condição atual';
}

function updateWeatherStatus() {
  const status = document.getElementById('weather-status');
  if (!status) return;
  status.classList.toggle('is-raining', weatherState.available && weatherState.isRaining);
  if (!weatherState.available) {
    status.innerText = weatherState.error ? 'TEMPO LOCAL · INDISPONÍVEL' : 'TEMPO LOCAL · AGUARDANDO DADOS';
    status.title = weatherState.error ? 'Sem conexão com a fonte meteorológica no momento.' : 'Aguardando atualização meteorológica';
    return;
  }
  const condition = weatherDescription(weatherState.code);
  status.innerText = weatherState.isRaining ? 'CHUVA AGORA · JOÃO PESSOA' : `${condition.toUpperCase()} · JOÃO PESSOA`;
  status.title = `Condição meteorológica estimada: ${condition}. Atualizada às ${weatherState.updatedAt.toLocaleTimeString('pt-BR')}.`;
}


// A API retorna "YYYY-MM-DDTHH:MM" em UTC (usamos timezone=UTC)
function parseUTCDate(dateStr) {
  if (!dateStr) return null;
  const [datePart, timePart] = dateStr.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm));
}

async function fetchAstronomy() {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LNG}` +
      `&daily=sunrise,sunset,moonrise,moonset,moon_phase` +
      `&current=precipitation,rain,showers,weather_code,cloud_cover&timezone=UTC&forecast_days=2`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo respondeu ${res.status}`);
    const data = await res.json();
    const d = data.daily;
    if (!d || !d.time || !d.time.length) return;

    if (data.current) {
      const current = data.current;
      const code = Number(current.weather_code);
      const rain = Number(current.rain) || 0;
      const showers = Number(current.showers) || 0;
      weatherState = {
        available: true, code, rain, showers,
        cloudCover: Number(current.cloud_cover) || 0,
        isRaining: rain > 0.05 || showers > 0.05 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95,
        updatedAt: current.time ? parseUTCDate(current.time) : new Date()
      };
      updateWeatherStatus();
    }

    solarTimes = {
      sunrise: parseUTCDate(d.sunrise[0]),
      sunset: parseUTCDate(d.sunset[0])
    };
    moonData = {
      date: d.time[0],
      rise: parseUTCDate(d.moonrise[0]),
      set: parseUTCDate(d.moonset[0]),
      phase: (d.moon_phase && typeof d.moon_phase[0] === 'number') ? d.moon_phase[0] : null
    };
  } catch (e) {
    console.warn('Não foi possível atualizar astronomia e tempo local; usando dados disponíveis.', e);
    if (!weatherState.available) { weatherState.error = true; updateWeatherStatus(); }
  }
}

async function ensureAstronomy() {
  const today = new Date().toISOString().split('T')[0];
  if (today !== lastDate) {
    lastDate = today;
    await fetchAstronomy();
  }
}

// Retorna um valor 0 (dia pleno) a 1 (noite plena), com transição suave
function nightFactor(now) {
  if (!solarTimes) {
    const h = now.getHours();
    return (h >= 18 || h < 6) ? 1 : 0;
  }
  const nowMs = now.getTime();
  const srMs = solarTimes.sunrise.getTime();
  const ssMs = solarTimes.sunset.getTime();
  const fade = 45 * 60 * 1000; // 45 min de transição (crepúsculo)

  // Antes do nascer do sol: noite -> dia
  if (nowMs < srMs - fade) return 1;
  if (nowMs < srMs + fade) {
    return 1 - (nowMs - (srMs - fade)) / (2 * fade);
  }
  // Dia
  if (nowMs < ssMs - fade) return 0;
  // Pôr do sol: dia -> noite
  if (nowMs < ssMs + fade) {
    return (nowMs - (ssMs - fade)) / (2 * fade);
  }
  return 1;
}

// ===== Utilidades =====
function lerp(a, b, t) { return a + (b - a) * t; }

function lerpColor(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t))
  ];
}
function rgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ===== Catálogo estelar e transformação para o céu local =====
// O catálogo local contém estrelas reais; as coordenadas J2000 são precessionadas
// para a data atual e convertidas de ascensão reta/declinação para azimute/altura.
const stars = (window.STAR_CATALOG || []).map(([hr, catalogName, ra, dec, magnitude]) => ({
  hr, catalogName, ra, dec, magnitude
}));
const starsByHR = new Map(stars.map(star => [star.hr, star]));
const STAR_NAMES = {
  2491: 'Sírius', 2326: 'Canopus', 5340: 'Arcturus', 7001: 'Vega',
  1708: 'Capella', 2943: 'Procyon', 472: 'Achernar', 7557: 'Altair',
  5459: 'Alpha Centauri', 6134: 'Antares', 5056: 'Spica', 8728: 'Fomalhaut',
  424: 'Polaris', 1713: 'Rigel', 2061: 'Betelgeuse', 4301: 'Dubhe',
  4295: 'Merak', 4554: 'Phecda', 4660: 'Megrez', 4905: 'Alioth',
  5054: 'Mizar', 5191: 'Alkaid', 21: 'Caph', 168: 'Schedar',
  264: 'Tsih', 403: 'Ruchbah', 542: 'Segin', 1790: 'Bellatrix',
  1852: 'Mintaka', 1903: 'Alnilam', 1948: 'Alnitak', 2004: 'Saiph',
  4730: 'Acrux', 4853: 'Mimosa', 4763: 'Gacrux', 4769: 'Delta Crucis',
  5267: 'Hadar', 5459: 'Alpha Centauri', 5193: 'Menkent', 4819: 'Muhlifain',
  5984: 'Acrab', 5953: 'Dschubba', 6553: 'Sargas', 6527: 'Shaula', 6508: 'Lesath',
  6746: 'Alnasl', 6859: 'Kaus Media', 6879: 'Kaus Australis', 7121: 'Nunki', 7194: 'Ascella',
  3982: 'Regulus', 4057: 'Algieba', 4357: 'Zosma', 4534: 'Denebola',
  2294: 'Mirzam', 2693: 'Wezen', 2618: 'Adhara', 2657: 'Muliphein',
  3685: 'Miaplacidus', 3307: 'Avior', 3699: 'Aspidiske', 4199: 'Theta Carinae',
  5469: 'Alpha Lupi', 5571: 'Beta Lupi', 5776: 'Gamma Lupi', 5695: 'Delta Lupi',
  5056: 'Spica', 4932: 'Vindemiatrix', 4825: 'Gamma Virginis', 4910: 'Delta Virginis', 4540: 'Beta Virginis'
};
const CONSTELLATIONS = [
  { name: 'Ursa Maior', ids: [4301,4295,4554,4660,4905,5054,5191], links: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,3]] },
  { name: 'Cassiopeia', ids: [21,168,264,403,542], links: [[0,1],[1,2],[2,3],[3,4]] },
  { name: 'Órion', ids: [1790,2061,1852,1903,1948,1713,2004], links: [[0,1],[0,2],[1,2],[2,3],[3,4],[4,5],[5,6],[1,3]] },
  { name: 'Cruzeiro do Sul', ids: [4730,4853,4763,4769], links: [[0,1],[1,2],[1,3],[2,3]] },
  { name: 'Centauro', ids: [5459,5267,5288,5132,4819,4621,4467], links: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[3,4]] },
  { name: 'Escorpião', ids: [5984,5953,6134,6241,6380,6553,6527,6508], links: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7]] },
  { name: 'Sagitário', ids: [6746,6859,6879,7121,7194], links: [[0,1],[1,2],[2,3],[3,4],[4,1]] },
  { name: 'Leão', ids: [3982,4057,4031,4357,4359,4534], links: [[0,1],[1,2],[2,3],[3,4],[4,5],[1,3]] },
  { name: 'Cão Maior', ids: [2294,2491,2580,2618,2657,2693], links: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,2]] },
  { name: 'Carina', ids: [2326,3685,3307,3699,4199], links: [[0,1],[1,2],[2,3],[3,4]] },
  { name: 'Virgem', ids: [4540,4825,4910,5056,4932], links: [[0,1],[1,2],[2,3],[3,4],[4,1]] },
  { name: 'Lobo', ids: [5469,5571,5776,5695,5708], links: [[0,1],[1,2],[2,3],[3,4],[4,0]] }
];

function normalizeDegrees(deg) { return ((deg % 360) + 360) % 360; }
function signedDegrees(deg) { return ((deg + 540) % 360) - 180; }
function radians(deg) { return deg * Math.PI / 180; }
function degrees(rad) { return rad * 180 / Math.PI; }

function precessJ2000(raDeg, decDeg, date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const T2 = T * T, T3 = T2 * T;
  const arcsecToRad = Math.PI / (180 * 3600);
  const zeta = (2306.2181*T + 0.30188*T2 + 0.017998*T3) * arcsecToRad;
  const z = (2306.2181*T + 1.09468*T2 + 0.018203*T3) * arcsecToRad;
  const theta = (2004.3109*T - 0.42665*T2 - 0.041833*T3) * arcsecToRad;
  const ra = radians(raDeg), dec = radians(decDeg);
  const A = Math.cos(dec) * Math.sin(ra + zeta);
  const B = Math.cos(theta) * Math.cos(dec) * Math.cos(ra + zeta) - Math.sin(theta) * Math.sin(dec);
  const C = Math.sin(theta) * Math.cos(dec) * Math.cos(ra + zeta) + Math.cos(theta) * Math.sin(dec);
  return { ra: normalizeDegrees(degrees(Math.atan2(A, B) + z)), dec: degrees(Math.asin(Math.max(-1, Math.min(1, C)))) };
}

function localSiderealDegrees(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933*T*T - T*T*T/38710000;
  return normalizeDegrees(gmst + LNG);
}

function projectEquatorial(raDeg, decDeg, date) {
  const position = precessJ2000(raDeg, decDeg, date);
  return projectOfDate(position.ra, position.dec, date);
}

function projectOfDate(raDeg, decDeg, date) {
  const hourAngle = radians(signedDegrees(localSiderealDegrees(date) - raDeg));
  const dec = radians(decDeg), lat = radians(LAT);
  const sinAlt = Math.sin(dec)*Math.sin(lat) + Math.cos(dec)*Math.cos(lat)*Math.cos(hourAngle);
  const altitude = degrees(Math.asin(Math.max(-1, Math.min(1, sinAlt))));
  const azimuth = normalizeDegrees(degrees(Math.atan2(
    Math.sin(hourAngle), Math.cos(hourAngle)*Math.sin(lat) - Math.tan(dec)*Math.cos(lat)
  )) + 180);
  const deltaAz = signedDegrees(azimuth - 180);
  // O modo de constelações abre o panorama completo do horizonte (360°).
  return { x: W * (0.5 + deltaAz / baseFovDegrees()), y: H * (1 - altitude / 90), altitude, azimuth };
}

function sunEquatorial(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const L0 = normalizeDegrees(280.46646 + T*(36000.76983 + 0.0003032*T));
  const M = radians(normalizeDegrees(357.52911 + T*(35999.05029 - 0.0001537*T)));
  const C = Math.sin(M)*(1.914602 - T*(0.004817 + 0.000014*T)) + Math.sin(2*M)*(0.019993 - 0.000101*T) + Math.sin(3*M)*0.000289;
  const omega = radians(125.04 - 1934.136*T);
  const lambda = radians(L0 + C - 0.00569 - 0.00478*Math.sin(omega));
  const epsilon = radians(23.439291 - 0.0130042*T + 0.00256*Math.cos(omega));
  const ra = normalizeDegrees(degrees(Math.atan2(Math.cos(epsilon)*Math.sin(lambda), Math.cos(lambda))));
  const dec = degrees(Math.asin(Math.sin(epsilon)*Math.sin(lambda)));
  return { ra, dec };
}

// Órbita lunar simplificada (precisão típica de poucos décimos a cerca de 1 grau).
function moonEquatorial(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const d = jd - 2451543.5;
  const N = radians(normalizeDegrees(125.1228 - 0.0529538083*d));
  const inclination = radians(5.1454);
  const w = radians(normalizeDegrees(318.0634 + 0.1643573223*d));
  const e = 0.0549;
  const M = radians(normalizeDegrees(115.3654 + 13.0649929509*d));
  const E = M + e*Math.sin(M)*(1 + e*Math.cos(M));
  const xv = 60.2666*(Math.cos(E)-e);
  const yv = 60.2666*Math.sqrt(1-e*e)*Math.sin(E);
  const v = Math.atan2(yv, xv), r = Math.hypot(xv, yv);
  const xh = r*(Math.cos(N)*Math.cos(v+w) - Math.sin(N)*Math.sin(v+w)*Math.cos(inclination));
  const yh = r*(Math.sin(N)*Math.cos(v+w) + Math.cos(N)*Math.sin(v+w)*Math.cos(inclination));
  const zh = r*Math.sin(v+w)*Math.sin(inclination);
  const lambda = Math.atan2(yh, xh);
  const beta = Math.atan2(zh, Math.hypot(xh, yh));
  const epsilon = radians(23.4393);
  const ra = normalizeDegrees(degrees(Math.atan2(Math.sin(lambda)*Math.cos(epsilon)-Math.tan(beta)*Math.sin(epsilon), Math.cos(lambda))));
  const dec = degrees(Math.asin(Math.sin(beta)*Math.cos(epsilon) + Math.cos(beta)*Math.sin(epsilon)*Math.sin(lambda)));
  return { ra, dec };
}

// Lúmina é a dedicatória do presente, marcada sobre a estrela real Sírius (HR 2491).
const specialStar = starsByHR.get(2491) || null;
// Altere este texto para personalizar o nome que aparece sob a estrela.
const STAR_NAME = 'Lúmina';

// Os desenhos das constelações usam agora as coordenadas do catálogo estelar.
let constellationsVisible = false;
let gridVisible = false;
let selectedStarHR = null;

const CONTROL_ICONS = {
  soundOn: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  soundOff: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m17 9 5 6m0-6-5 6"/></svg>',
  eyeOpen: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeClosed: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a15 15 0 0 1-3.1 3.7M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7c1 0 2-.2 2.9-.5"/></svg>'
};

// ===== Nuvens volumétricas (geradas localmente, sem depender de cloud.jpg) =====
const cloudSprite = document.createElement('canvas');
cloudSprite.width = 420;
cloudSprite.height = 220;
const cloudCtx = cloudSprite.getContext('2d');
// Camadas de volumes suaves com base mais densa e bordas iluminadas.
const cloudPuffs = [
  [55, 128, 64, 40, 0.60], [105, 105, 58, 52, 0.65],
  [158, 128, 78, 48, 0.70], [216, 96, 66, 58, 0.62],
  [274, 124, 76, 47, 0.68], [333, 104, 62, 53, 0.61],
  [375, 132, 48, 35, 0.56]
];
for (const [x, y, rx, ry, opacity] of cloudPuffs) {
  const puff = cloudCtx.createRadialGradient(x, y, ry * 0.08, x, y, rx);
  puff.addColorStop(0, `rgba(255,255,255,${opacity})`);
  puff.addColorStop(0.46, `rgba(235,244,255,${opacity * 0.72})`);
  puff.addColorStop(0.78, `rgba(220,234,250,${opacity * 0.32})`);
  puff.addColorStop(1, 'rgba(210,230,250,0)');
  cloudCtx.fillStyle = puff;
  cloudCtx.beginPath();
  cloudCtx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  cloudCtx.fill();
}
const cloudBase = cloudCtx.createLinearGradient(0, 130, 0, 205);
cloudBase.addColorStop(0, 'rgba(248,250,255,0.48)');
cloudBase.addColorStop(0.55, 'rgba(214,229,248,0.38)');
cloudBase.addColorStop(1, 'rgba(190,214,239,0)');
cloudCtx.fillStyle = cloudBase;
cloudCtx.beginPath();
cloudCtx.ellipse(210, 160, 190, 50, 0, 0, Math.PI * 2);
cloudCtx.fill();

const clouds = [];
function makeClouds() {
  for (let i = 0; i < 11; i++) {
    clouds.push({
      x: Math.random(),
      y: 0.34 + Math.random() * 0.48,
      scale: 0.42 + Math.random() * 1.05,
      alpha: 0.55 + Math.random() * 0.35,
      speed: 0.0015 + Math.random() * 0.003
    });
  }
}
makeClouds();

// ===== Céu (gradiente dia/noite com pôr do sol) =====
const TOP_STOPS = [
  [0.00, [92, 160, 214]],
  [0.40, [78, 132, 198]],
  [0.50, [54, 76, 140]],
  [0.60, [30, 34, 78]],
  [0.75, [12, 16, 44]],
  [1.00, [3, 6, 20]]
];
const MID_STOPS = [
  [0.00, [148, 192, 230]],
  [0.40, [150, 170, 210]],
  [0.50, [120, 110, 150]],
  [0.60, [70, 52, 90]],
  [0.75, [28, 30, 60]],
  [1.00, [12, 20, 48]]
];
const HOR_STOPS = [
  [0.00, [228, 240, 250]],
  [0.35, [255, 220, 170]],
  [0.45, [255, 160, 110]],
  [0.52, [235, 110, 90]],
  [0.60, [150, 80, 110]],
  [0.70, [80, 50, 90]],
  [0.85, [40, 40, 80]],
  [1.00, [26, 34, 62]]
];

function colorAt(stops, n) {
  if (n <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (n <= b[0]) {
      const t = (n - a[0]) / (b[0] - a[0]);
      return lerpColor(a[1], b[1], t);
    }
  }
  return stops[stops.length - 1][1];
}

// ===== Fase da Lua (fallback local) =====
function moonPhase(date) {
  const REF = Date.UTC(2000, 0, 6, 18, 14, 0); // lua nova de referência
  const SYNODIC = 29.53058867 * 86400000;
  const diff = date.getTime() - REF;
  return ((diff % SYNODIC) + SYNODIC) % SYNODIC / SYNODIC; // 0 = nova, 0.5 = cheia
}

// Verifica se a Lua está acima do horizonte agora (João Pessoa)
function isMoonUp(now) {
  // null indica que a efeméride está indisponível ou ficou desatualizada.
  if (!moonData || moonData.date !== now.toISOString().slice(0, 10)) return null;
  const nowMs = now.getTime();
  const rise = moonData.rise;
  const set = moonData.set;

  if (rise && set) {
    const riseMs = rise.getTime();
    const setMs = set.getTime();
    if (riseMs < setMs) {
      return nowMs >= riseMs && nowMs <= setMs;
    }
    // nasce depois do pôr (cruza a meia-noite): está visível antes do pôr OU depois do nascer
    return nowMs <= setMs || nowMs >= riseMs;
  }
  if (rise) return nowMs >= rise.getTime();
  if (set) return nowMs <= set.getTime();
  return false;
}

// ===== Faixa da Via Láctea projetada a partir do plano galáctico =====
function galacticToEquatorial(longitudeDeg, latitudeDeg) {
  const l = radians(longitudeDeg), b = radians(latitudeDeg);
  const gx = Math.cos(b)*Math.cos(l), gy = Math.cos(b)*Math.sin(l), gz = Math.sin(b);
  // Transposta da rotação ICRS/J2000 -> galáctica definida pela IAU.
  const x = -0.0548755604*gx + 0.4941094279*gy - 0.8676661490*gz;
  const y = -0.8734370902*gx - 0.4448296300*gy - 0.1980763734*gz;
  const z = -0.4838350155*gx + 0.7469822445*gy + 0.4559837762*gz;
  return { ra: normalizeDegrees(degrees(Math.atan2(y, x))), dec: degrees(Math.asin(z)) };
}

let milkyWayProjectionCache = { key: '', paths: [] };
function getMilkyWayPaths(now) {
  const key = `${Math.floor(now.getTime()/5000)}:${W}:${H}:${baseFovDegrees()}`;
  if (milkyWayProjectionCache.key === key) return milkyWayProjectionCache.paths;
  const paths = [];
  for (const latitude of [-8,-5,-2.5,0,2.5,5,8]) {
    let segments = [], segment = [];
    for (let longitude = 0; longitude <= 360; longitude += 3) {
      const eq = galacticToEquatorial(longitude, latitude);
      const point = projectEquatorial(eq.ra, eq.dec, now);
      const valid = point.altitude > 0 && point.x >= 0 && point.x <= W && point.y >= 0 && point.y <= H;
      if (!valid || (segment.length && Math.abs(point.x - segment[segment.length - 1].x) > W * 0.1)) {
        if (segment.length > 1) segments.push(segment);
        segment = [];
        if (!valid) continue;
      }
      segment.push(point);
    }
    if (segment.length > 1) segments.push(segment);
    paths.push({ latitude, segments });
  }
  milkyWayProjectionCache = { key, paths };
  return paths;
}

// ===== Estrela cadente =====
let shooting = null;

// ===== Desenho =====
function drawSky(n) {
  const top = colorAt(TOP_STOPS, n);
  const mid = colorAt(MID_STOPS, n);
  const hor = colorAt(HOR_STOPS, n);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgb(top));
  g.addColorStop(0.55, rgb(mid));
  g.addColorStop(1, rgb(hor));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawSun(n, now) {
  // Posição aparente calculada a partir da data, hora e coordenadas do observador.
  const a = 1 - n;
  if (a <= 0.02) return;
  const sun = sunEquatorial(now);
  const point = projectOfDate(sun.ra, sun.dec, now);
  if (point.altitude <= 0 || point.x < 0 || point.x > W) return;
  const x = point.x, y = point.y;
  // Ícone cartográfico ampliado para continuar fácil de localizar no panorama 360°.
  const r = Math.max(9, Math.min(14, W * 0.012));
  const glow = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 4.8);
  glow.addColorStop(0, `rgba(255,250,225,${0.98 * a})`);
  glow.addColorStop(0.22, `rgba(255,230,164,${0.72 * a})`);
  glow.addColorStop(0.58, `rgba(255,196,103,${0.24 * a})`);
  glow.addColorStop(1, 'rgba(255,196,103,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - r * 4.8, y - r * 4.8, r * 9.6, r * 9.6);

  ctx.fillStyle = `rgba(255,250,235,${a})`;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.globalAlpha = Math.max(0.82, a);
  ctx.strokeStyle = `rgba(255,247,220,${0.88 * a})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r + 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = '700 10px Inter, Segoe UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(35,55,78,0.88)';
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 5;
  ctx.fillText('SOL', x + r + 9, y + 4);
  ctx.restore();
}

function drawMoon(n, phase, now) {
  const lunar = moonEquatorial(now);
  const point = projectOfDate(lunar.ra, lunar.dec, now);
  const apiMoonUp = isMoonUp(now);
  const aboveHorizon = apiMoonUp == null ? point.altitude > 0 : apiMoonUp;
  if (!aboveHorizon || point.x < 0 || point.x > W) return;
  // Os horários lunares vêm da efeméride diária; um pequeno erro do modelo
  // orbital perto do horizonte não deve fazer a Lua desaparecer do mapa.
  const x = point.x, y = H * (1 - Math.max(0.35, point.altitude) / 90);
  const moonAlpha = 0.38 + n * 0.62;
  const r = Math.max(8, Math.min(11, W * 0.009));

  // brilho
  const glow = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 4);
  glow.addColorStop(0, `rgba(220,228,255,${0.72 * moonAlpha})`);
  glow.addColorStop(1, 'rgba(220,228,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);

  ctx.save();
  ctx.globalAlpha = moonAlpha;
  // recorta no disco da lua
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();

  // lado iluminado
  ctx.fillStyle = 'rgba(240,244,252,0.98)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // crateras sutis (ficam só no lado iluminado)
  ctx.fillStyle = 'rgba(170,182,205,0.32)';
  ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.2, r * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + r * 0.25, y + r * 0.28, r * 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + r * 0.1, y - r * 0.4, r * 0.11, 0, Math.PI * 2); ctx.fill();

  // sombra (fase): disco escuro deslocado horizontalmente
  const phi = phase * 2 * Math.PI;
  const waxing = phi <= Math.PI;
  const s = r * (1 - Math.cos(phi));
  const shadowX = waxing ? (x - s) : (x + s);
  ctx.fillStyle = 'rgba(28,32,50,0.97)';
  ctx.beginPath();
  ctx.arc(shadowX, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  ctx.save();
  ctx.globalAlpha = Math.max(0.66, moonAlpha);
  ctx.font = '600 10px Inter, Segoe UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = n > 0.5 ? 'rgba(230,238,255,0.9)' : 'rgba(34,52,77,0.82)';
  ctx.shadowColor = n > 0.5 ? 'rgba(5,10,22,0.95)' : 'rgba(255,255,255,0.85)';
  ctx.shadowBlur = 5;
  ctx.fillText('LUA', x + r + 7, y - r - 2);
  ctx.restore();
}

let projectedStarsCache = { key: '', points: new Map() };
function starPoint(star, now) {
  if (!star) return null;
  const key = `${Math.floor(now.getTime() / 5000)}:${W}:${H}:${baseFovDegrees()}`;
  if (projectedStarsCache.key !== key) projectedStarsCache = { key, points: new Map() };
  if (projectedStarsCache.points.has(star.hr)) return projectedStarsCache.points.get(star.hr);
  const point = projectEquatorial(star.ra, star.dec, now);
  const visiblePoint = point.altitude > 0 && point.x >= 0 && point.x <= W ? point : null;
  projectedStarsCache.points.set(star.hr, visiblePoint);
  return visiblePoint;
}

const STAR_DESCRIPTIONS = {
  2491: 'A estrela mais brilhante do céu noturno. Sírius faz parte da constelação do Cão Maior e é a estrela escolhida para representar a Lúmina de vocês.',
  2326: 'Canopus é a segunda estrela mais brilhante do céu noturno e uma das referências de navegação mais conhecidas do hemisfério sul.',
  5459: 'Alpha Centauri é o sistema estelar mais próximo do Sol. No céu, aparece como um dos pontos mais brilhantes do Centauro.',
  6134: 'Antares é uma supergigante vermelha na constelação de Escorpião. Seu nome vem de uma antiga associação visual com Marte.',
  7001: 'Vega é uma das estrelas mais brilhantes do céu e forma, com Deneb e Altair, o conhecido Triângulo de Verão.',
  1713: 'Rigel é uma estrela supergigante azul e uma das estrelas mais brilhantes da constelação de Órion.',
  2061: 'Betelgeuse é uma supergigante vermelha que marca um dos ombros de Órion.',
  4730: 'Acrux é a estrela mais brilhante do Cruzeiro do Sul, um dos asterismos mais reconhecíveis do céu austral.',
  5056: 'Spica é a estrela mais brilhante da constelação de Virgem e um sistema estelar binário.'
};

function constellationForStar(hr) {
  const match = CONSTELLATIONS.find(item => item.ids.includes(hr));
  return match ? match.name : 'Céu de João Pessoa';
}

function readableStarName(star) {
  return STAR_NAMES[star.hr] || star.catalogName.trim() || `Estrela HR ${star.hr}`;
}

function closeStarCard() {
  const card = document.getElementById('star-card');
  if (!card) return;
  card.classList.add('hidden');
  card.setAttribute('aria-hidden', 'true');
}

function showStarCard(star, point) {
  const card = document.getElementById('star-card');
  if (!card || !star) return;
  const isOurs = star.hr === 2491;
  const constellation = constellationForStar(star.hr);
  document.getElementById('star-card-title').innerText = isOurs ? 'Lúmina · Sírius' : readableStarName(star);
  document.getElementById('star-card-description').innerText = STAR_DESCRIPTIONS[star.hr] ||
    `${readableStarName(star)} é uma estrela catalogada na constelação de ${constellation}. Sua magnitude aparente é ${star.magnitude.toFixed(2)}.`;
  document.getElementById('star-card-designation').innerText = isOurs ? 'A ESTRELA DE VOCÊS' : constellation.toUpperCase();
  document.getElementById('star-card-catalog').innerText = `HR ${star.hr} · magnitude ${star.magnitude.toFixed(2)}`;
  document.getElementById('star-card-position').innerText = `Alt ${point.altitude.toFixed(1)}° · Az ${point.azimuth.toFixed(1)}°`;
  card.classList.toggle('is-ours', isOurs);
  card.classList.remove('hidden');
  card.setAttribute('aria-hidden', 'false');
}

function selectStarAt(event) {
  const rect = canvas.getBoundingClientRect();
  const offsetX = W * (1 - skyView.zoom) * 0.5 + skyView.panX;
  const offsetY = H * (1 - skyView.zoom) * 0.5 + skyView.panY;
  const x = (event.clientX - rect.left - offsetX) / skyView.zoom;
  const y = (event.clientY - rect.top - offsetY) / skyView.zoom;
  const now = new Date();
  let closest = null, closestDistance = 18;
  for (const star of stars) {
    const point = starPoint(star, now);
    if (!point || point.y < 0 || point.y > H) continue;
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < closestDistance) {
      closest = { star, point };
      closestDistance = distance;
    }
  }
  if (!closest) {
    selectedStarHR = null;
    closeStarCard();
    return;
  }
  selectedStarHR = closest.star.hr;
  showStarCard(closest.star, closest.point);
}

function drawStars(n, now) {
  if (n <= 0.02 && !constellationsVisible) return;
  ctx.save();
  for (const star of stars) {
    const point = starPoint(star, now);
    if (!point || point.y < 0 || point.y > H) continue;
    const clearSkyFactor = weatherState.available ? Math.max(0.12, 1 - weatherState.cloudCover / 100 * 0.78) : 1;
    const visualAlpha = constellationsVisible ? 0.95 : n * clearSkyFactor;
    const radius = Math.max(0.65, 2.25 - Math.max(-1.5, star.magnitude) * 0.29);
    const name = STAR_NAMES[star.hr];
    ctx.globalAlpha = Math.max(0.12, visualAlpha);
    ctx.fillStyle = star.magnitude < 1.5 ? 'rgba(255,244,218,1)' : 'rgba(226,237,255,1)';
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (star.hr === selectedStarHR) {
      ctx.globalAlpha = 0.96;
      ctx.strokeStyle = '#f5d58e';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (name && (star.magnitude < 1.8 || constellationsVisible)) {
      ctx.globalAlpha = Math.max(0.38, visualAlpha * 0.8);
      ctx.font = '11px Inter, Segoe UI, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = n > 0.5 ? 'rgba(222,232,245,0.94)' : 'rgba(27,49,73,0.9)';
      ctx.fillText(name, point.x + 6, point.y - 6);
    }
  }
  ctx.restore();
}

function drawCoordinateGrid(n) {
  if (!gridVisible) return;
  ctx.save();
  ctx.strokeStyle = n > 0.5 ? 'rgba(157, 193, 225, 0.45)' : 'rgba(28, 62, 95, 0.42)';
  ctx.fillStyle = n > 0.5 ? 'rgba(213, 228, 246, 0.72)' : 'rgba(24, 53, 82, 0.72)';
  ctx.lineWidth = 0.75;
  ctx.font = '10px Inter, Segoe UI, sans-serif';
  ctx.textAlign = 'left';

  // Grade altazimutal coerente com a projeção do mapa: altura e azimute reais.
  for (let altitude = 15; altitude < 90; altitude += 15) {
    const y = H * (1 - altitude / 90);
    ctx.globalAlpha = altitude === 45 ? 0.82 : 0.58;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillText(`${altitude}°`, 8, y - 4);
  }
  const fov = baseFovDegrees();
  const azimuths = fov === 360 ? Array.from({length: 13}, (_, i) => i * 30) : [120,140,160,180,200,220,240];
  for (const azimuth of azimuths) {
    const x = W * (0.5 + signedDegrees(azimuth - 180) / fov);
    ctx.globalAlpha = azimuth === 180 ? 0.82 : 0.58;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(`${azimuth}°`, x, H - 9);
  }
  ctx.globalAlpha = 0.9;
  ctx.textAlign = 'center';
  ctx.font = '600 10px Inter, Segoe UI, sans-serif';
  ctx.fillText(fov === 360 ? 'PANORAMA · 360°' : 'SUL · 180°', W * 0.5, H - 25);
  ctx.restore();
}

function drawConstellations(n, now) {
  if (!constellationsVisible) return;
  ctx.save();
  const lineColor = n > 0.5 ? 'rgba(180, 211, 242, 0.86)' : 'rgba(31, 65, 100, 0.86)';
  const labelColor = n > 0.5 ? 'rgba(226, 237, 249, 0.96)' : 'rgba(20, 48, 79, 0.96)';
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.35;
  ctx.setLineDash([4, 4]);
  for (const constellation of CONSTELLATIONS) {
    const points = constellation.ids.map(id => starPoint(starsByHR.get(id), now));
    let visible = 0, sumX = 0, sumY = 0;
    for (const point of points) {
      if (!point || point.y < 0 || point.y > H) continue;
      visible++;
      sumX += point.x;
      sumY += point.y;
    }
    for (const [from, to] of constellation.links) {
      const a = points[from], b = points[to];
      if (!a || !b || a.y < 0 || a.y > H || b.y < 0 || b.y > H) continue;
      // Evita traçar uma linha longa quando o segmento sai do campo de visão.
      if (Math.abs(a.x - b.x) > W * 0.65) continue;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    if (visible >= 2) {
      const x = sumX / visible, y = sumY / visible;
      ctx.setLineDash([]);
      ctx.font = '600 12px Inter, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = labelColor;
      ctx.shadowColor = n > 0.5 ? 'rgba(4, 9, 20, 0.9)' : 'rgba(242, 247, 252, 0.9)';
      ctx.shadowBlur = 5;
      ctx.fillText(constellation.name, x, y - 12);
      ctx.shadowBlur = 0;
      ctx.setLineDash([4, 4]);
    }
  }
  ctx.restore();
}

function drawMilkyWay(n, now) {
  if (n <= 0.08) return;
  const paths = getMilkyWayPaths(now);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const { latitude, segments } of paths) {
    const centerWeight = Math.max(0, 1 - Math.abs(latitude) / 9);
    ctx.strokeStyle = `rgba(190, 202, 238, ${n * (0.025 + centerWeight * 0.085)})`;
    ctx.lineWidth = Math.max(2, H * (Math.abs(latitude) < 3 ? 0.009 : 0.006));
    ctx.shadowColor = `rgba(181, 195, 235, ${n * 0.13})`;
    ctx.shadowBlur = Math.min(18, H * 0.018);
    for (const segment of segments) {
      ctx.beginPath();
      ctx.moveTo(segment[0].x, segment[0].y);
      for (let i = 1; i < segment.length; i++) ctx.lineTo(segment[i].x, segment[i].y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawSpecialStar(n, t, now) {
  if (!specialStar) return;
  const point = starPoint(specialStar, now);
  if (!point || point.y < 0 || point.y > H) return;
  const x = point.x;
  const y = point.y;
  const pulse = 0.8 + 0.2 * Math.sin(t * 1.2);
  // Lúmina permanece identificada no mapa mesmo durante o dia, quando as
  // estrelas comuns ficam ocultas pelo brilho do céu.
  const a = Math.max(n, constellationsVisible ? 0.9 : 0, 0.72) * pulse;

  // halo suave
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 42);
  glow.addColorStop(0, `rgba(255,250,230,${0.85 * a})`);
  glow.addColorStop(0.4, `rgba(255,230,180,${0.25 * a})`);
  glow.addColorStop(1, 'rgba(255,230,180,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - 48, y - 48, 96, 96);

  // pontas de luz (difração)
  ctx.strokeStyle = `rgba(255,252,240,${0.9 * a})`;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 4; i++) {
    const ang = (Math.PI / 2) * i + Math.PI / 4;
    const len = 14 + 3 * Math.sin(t * 2 + i);
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(ang) * 4, y - Math.sin(ang) * 4);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }

  // Anel dourado persistente para localizar a estrela escolhida por vocês.
  ctx.strokeStyle = `rgba(245,213,142,${0.9 * a})`;
  ctx.lineWidth = 1.1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.arc(x, y, 12 + 2 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // núcleo
  ctx.fillStyle = `rgba(255,255,255,${a})`;
  ctx.beginPath();
  ctx.arc(x, y, 3.2, 0, Math.PI * 2);
  ctx.fill();

  // rótulo delicado ao lado da estrela
  const labelA = a * 0.95;
  ctx.globalAlpha = labelA;
  ctx.fillStyle = 'rgba(255,250,235,0.95)';
  ctx.font = 'italic 15px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(255,240,210,0.9)';
  ctx.shadowBlur = 12;
  ctx.fillText(STAR_NAME, x, y + 34);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.textAlign = 'start';
}

function drawClouds(n, t) {
  // Clouds remain visible at night with low moonlight; they no longer vanish
  // when the sky transitions to its night palette.
  const cloudCover = weatherState.available ? weatherState.cloudCover / 100 : 0.35;
  const a = (0.16 + cloudCover * 0.62) * (0.48 + (1 - n) * 0.52);
  const aspect = cloudSprite.height / cloudSprite.width;
  for (const c of clouds) {
    const w = c.scale * Math.min(W, H) * 0.22;
    const h = w * aspect;
    const x = ((c.x + t * c.speed) % 1.2) * (W + w * 2) - w;
    const y = c.y * H;
    ctx.globalAlpha = a * c.alpha;
    ctx.drawImage(cloudSprite, x, y, w, h);
  }
  ctx.globalAlpha = 1;
}

const rainDrops = Array.from({ length: 190 }, () => ({
  x: Math.random(), y: Math.random(), length: 7 + Math.random() * 12, speed: 0.55 + Math.random() * 0.7
}));
function drawRain(dt) {
  if (!weatherState.available || !weatherState.isRaining) return;
  const intensity = Math.min(1, Math.max(0.22, (weatherState.rain + weatherState.showers) / 3));
  ctx.save();
  const veil = ctx.createLinearGradient(0, 0, 0, H);
  veil.addColorStop(0, `rgba(8, 17, 31, ${0.08 + intensity * 0.12})`);
  veil.addColorStop(1, `rgba(12, 24, 40, ${0.02 + intensity * 0.06})`);
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = `rgba(197, 221, 245, ${0.17 + intensity * 0.22})`;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (const drop of rainDrops) {
    drop.y += dt * drop.speed * (0.8 + intensity) * 0.72;
    drop.x -= dt * drop.speed * 0.08;
    if (drop.y > 1.05) { drop.y = -0.05; drop.x = Math.random(); }
    if (drop.x < -0.03) drop.x = 1.02;
    const x = drop.x * W, y = drop.y * H;
    ctx.moveTo(x, y);
    ctx.lineTo(x - 3, y + drop.length * (0.65 + intensity * 0.3));
  }
  ctx.stroke();
  ctx.restore();
}

function spawnShooting() {
  shooting = {
    x: Math.random() * W * 0.7 + W * 0.1,
    y: Math.random() * H * 0.3,
    vx: -(W * 0.0015) * (0.7 + Math.random()),
    vy: (H * 0.001) * (0.5 + Math.random()),
    life: 1
  };
}

function drawShooting(n, dt) {
  if (n <= 0.3) { shooting = null; return; }
  if (!shooting && Math.random() < 0.003) spawnShooting();
  if (!shooting) return;

  shooting.x += shooting.vx * dt * 60;
  shooting.y += shooting.vy * dt * 60;
  shooting.life -= dt * 1.6;
  if (shooting.life <= 0) { shooting = null; return; }

  const a = shooting.life * n;
  const tailX = shooting.x - shooting.vx * 12;
  const tailY = shooting.y - shooting.vy * 12;
  const g = ctx.createLinearGradient(shooting.x, shooting.y, tailX, tailY);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(shooting.x, shooting.y);
  ctx.lineTo(tailX, tailY);
  ctx.stroke();
}

// ===== Data/hora e localização =====
function updateDateTime() {
  const now = new Date();
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const dateStr = now.toLocaleDateString('pt-BR', options);
  const timeStr = now.toLocaleTimeString('pt-BR');
  document.getElementById('datetime').innerText = `${dateStr} – ${timeStr}`;
  return now;
}

function startLocation() {
  const locSpan = document.getElementById('location');
  locSpan.innerText = `Lat: ${LAT.toFixed(6)}, Lng: ${LNG.toFixed(6)} — ${CITY}`;
}

// ===== Contador de tempo juntos =====
function elapsed(now, start) {
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  let days = now.getDate() - start.getDate();
  let hours = now.getHours() - start.getHours();
  let minutes = now.getMinutes() - start.getMinutes();
  let seconds = now.getSeconds() - start.getSeconds();

  if (seconds < 0) { seconds += 60; minutes--; }
  if (minutes < 0) { minutes += 60; hours--; }
  if (hours < 0) { hours += 24; days--; }
  if (days < 0) {
    const prevMonthDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    days += prevMonthDays;
    months--;
  }
  if (months < 0) { months += 12; years--; }
  return { years, months, days, hours, minutes, seconds };
}

function updateCounter() {
  const el = document.getElementById('counter');
  if (!el) return;
  const now = new Date();
  const e = elapsed(now, START_DATE);
  const parts = [
    `${e.years} ${e.years === 1 ? 'ano' : 'anos'}`,
    `${e.months} ${e.months === 1 ? 'mês' : 'meses'}`,
    `${e.days} ${e.days === 1 ? 'dia' : 'dias'}`,
    `${e.hours} ${e.hours === 1 ? 'hora' : 'horas'}`,
    `${e.minutes} ${e.minutes === 1 ? 'minuto' : 'minutos'}`,
    `${e.seconds} ${e.seconds === 1 ? 'segundo' : 'segundos'}`
  ];
  el.innerText = parts.join(', ');
}

function updateClock() {
  updateDateTime();
  updateCounter();
}

// ===== Música de fundo (arquivo local) =====
const audio = document.getElementById('music');
let musicOn = false;

function startMusic() {
  if (!audio || musicOn) return;
  audio.volume = 0.55;
  audio.play().then(() => {
    musicOn = true;
    updateMusicBtn();
  }).catch(() => {
    showMusicHint();
  });
}

function toggleMusic() {
  if (!audio) return;
  if (musicOn) {
    audio.pause();
    musicOn = false;
    updateMusicBtn();
  } else {
    audio.play().then(() => {
      musicOn = true;
      updateMusicBtn();
    }).catch(() => {
      showMusicHint();
    });
  }
}

function updateMusicBtn() {
  const btn = document.getElementById('music-toggle');
  if (!btn) return;
  btn.innerHTML = musicOn ? CONTROL_ICONS.soundOn : CONTROL_ICONS.soundOff;
  btn.title = musicOn ? 'Desativar música' : 'Ativar música';
  btn.setAttribute('aria-label', btn.title);
  btn.setAttribute('aria-pressed', String(musicOn));
}

let hintTimer = null;
function showMusicHint() {
  const hint = document.getElementById('music-hint');
  if (!hint) return;
  hint.classList.remove('hidden');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.add('hidden'), 7000);
}

// ===== Tela de abertura =====
function setupWelcome() {
  const welcome = document.getElementById('welcome');
  const enterBtn = document.getElementById('enter-btn');
  const musicBtn = document.getElementById('music-toggle');

  enterBtn.addEventListener('click', () => {
    welcome.classList.add('hidden');
    startMusic();
  });

  updateMusicBtn();
  musicBtn.addEventListener('click', toggleMusic);
}

// ===== Modo imersivo =====
function setupImmersive() {
  const btn = document.getElementById('immerse-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const immersive = document.body.classList.toggle('immersive');
    btn.innerHTML = immersive ? CONTROL_ICONS.eyeClosed : CONTROL_ICONS.eyeOpen;
    btn.title = immersive ? 'Sair do modo imersivo' : 'Ver só o céu';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(immersive));
  });
  btn.innerHTML = CONTROL_ICONS.eyeOpen;
  btn.setAttribute('aria-pressed', 'false');
}

// ===== Navegação do mapa celeste =====
function clampSkyView() {
  const maxX = Math.max(0, W * (skyView.zoom - 1) * 0.5);
  const maxY = Math.max(0, H * (skyView.zoom - 1) * 0.5);
  skyView.panX = Math.max(-maxX, Math.min(maxX, skyView.panX));
  skyView.panY = Math.max(-maxY, Math.min(maxY, skyView.panY));
}

function baseFovDegrees() { return constellationsVisible || celestialPanoramaActive ? 360 : 120; }

let luminaStatusMinute = -1;
function updateLuminaStatus(now) {
  const minute = Math.floor(now.getTime() / 60000);
  if (minute === luminaStatusMinute) return;
  luminaStatusMinute = minute;
  const status = document.getElementById('lumina-status');
  if (!status || !specialStar) return;
  const position = projectEquatorial(specialStar.ra, specialStar.dec, now);
  const aboveHorizon = position.altitude > 0;
  status.textContent = aboveHorizon
    ? 'LÚMINA · ACIMA DO HORIZONTE'
    : 'LÚMINA · ABAIXO DO HORIZONTE';
  status.classList.toggle('is-below', !aboveHorizon);
  status.title = aboveHorizon
    ? 'Sírius, a estrela de vocês, está acima do horizonte e marcada no mapa.'
    : 'Sírius está abaixo do horizonte de João Pessoa neste momento; a posição volta a ser marcada quando estiver acima dele.';
}

function updateCelestialPanorama(now) {
  updateLuminaStatus(now);
  const key = Math.floor(now.getTime() / 5000);
  if (key === celestialPanoramaCacheKey) return;
  celestialPanoramaCacheKey = key;
  if (constellationsVisible) { celestialPanoramaActive = false; return; }
  const sun = sunEquatorial(now), moon = moonEquatorial(now);
  const sunPoint = projectOfDate(sun.ra, sun.dec, now);
  const moonPoint = projectOfDate(moon.ra, moon.dec, now);
  const luminaPoint = specialStar ? projectEquatorial(specialStar.ra, specialStar.dec, now) : null;
  const apiMoonUp = isMoonUp(now);
  const moonAbove = apiMoonUp == null ? moonPoint.altitude > 0 : apiMoonUp;
  const targets = [
    { point: sunPoint, above: sunPoint.altitude > 0 },
    { point: moonPoint, above: moonAbove },
    { point: luminaPoint, above: !!luminaPoint && luminaPoint.altitude > 0 }
  ];
  // Mantém o panorama aberto enquanto qualquer alvo estiver fora do campo
  // inicial de 120°; usar o FOV atual aqui faria o modo 360° oscilar.
  const next = targets.some(({ point, above }) => above &&
    Math.abs(signedDegrees(point.azimuth - 180)) > 60);
  if (next !== celestialPanoramaActive) {
    celestialPanoramaActive = next;
    updateFovReadout();
  }
}

function updateFovReadout() {
  const readout = document.getElementById('fov-readout');
  if (readout) readout.innerHTML = `FOV&nbsp;${Math.round(baseFovDegrees() / skyView.zoom)}°`;
}

function zoomSky(factor, anchorX = W / 2, anchorY = H / 2) {
  const oldZoom = skyView.zoom;
  const newZoom = Math.max(1, Math.min(5, oldZoom * factor));
  if (newZoom === oldZoom) return;

  const offsetX = W * (1 - oldZoom) * 0.5 + skyView.panX;
  const offsetY = H * (1 - oldZoom) * 0.5 + skyView.panY;
  const skyX = (anchorX - offsetX) / oldZoom;
  const skyY = (anchorY - offsetY) / oldZoom;
  skyView.zoom = newZoom;
  skyView.panX = anchorX - skyX * newZoom - W * (1 - newZoom) * 0.5;
  skyView.panY = anchorY - skyY * newZoom - H * (1 - newZoom) * 0.5;
  clampSkyView();
  updateFovReadout();
}

function setLayerButton(button, enabled, onLabel, offLabel) {
  button.setAttribute('aria-pressed', String(enabled));
  button.title = enabled ? onLabel : offLabel;
  button.setAttribute('aria-label', button.title);
}

function setupMapControls() {
  const zoomIn = document.getElementById('zoom-in');
  const zoomOut = document.getElementById('zoom-out');
  const reset = document.getElementById('reset-view');
  const constellations = document.getElementById('constellations-toggle');
  const grid = document.getElementById('grid-toggle');
  const closeStar = document.getElementById('star-card-close');
  closeStar.addEventListener('click', () => { selectedStarHR = null; closeStarCard(); });

  zoomIn.addEventListener('click', () => zoomSky(1.25));
  zoomOut.addEventListener('click', () => zoomSky(0.8));
  reset.addEventListener('click', () => {
    skyView.zoom = 1;
    skyView.panX = 0;
    skyView.panY = 0;
    updateFovReadout();
  });
  constellations.addEventListener('click', () => {
    constellationsVisible = !constellationsVisible;
    setLayerButton(constellations, constellationsVisible, 'Ocultar constelações · panorama 360°', 'Mostrar constelações · panorama 360°');
    updateFovReadout();
  });
  grid.addEventListener('click', () => {
    gridVisible = !gridVisible;
    setLayerButton(grid, gridVisible, 'Ocultar grade celeste', 'Mostrar grade celeste');
  });
  setLayerButton(constellations, constellationsVisible, 'Ocultar constelações · panorama 360°', 'Mostrar constelações · panorama 360°');
  setLayerButton(grid, gridVisible, 'Ocultar grade celeste', 'Mostrar grade celeste');
  updateFovReadout();

  let drag = null;
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: skyView.panX, panY: skyView.panY };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-dragging');
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    skyView.panX = drag.panX + event.clientX - drag.x;
    skyView.panY = drag.panY + event.clientY - drag.y;
    clampSkyView();
  });
  const endDrag = event => {
    if (!drag || drag.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
    drag = null;
    canvas.classList.remove('is-dragging');
    if (event.type === 'pointerup' && moved < 6) selectStarAt(event);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const bounds = canvas.getBoundingClientRect();
    zoomSky(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - bounds.left, event.clientY - bounds.top);
  }, { passive: false });
  canvas.addEventListener('dblclick', () => reset.click());

  window.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === '+' || event.key === '=') zoomSky(1.2);
    else if (event.key === '-' || event.key === '_') zoomSky(1 / 1.2);
    else if (event.key === 'ArrowLeft') skyView.panX += 32;
    else if (event.key === 'ArrowRight') skyView.panX -= 32;
    else if (event.key === 'ArrowUp') skyView.panY += 32;
    else if (event.key === 'ArrowDown') skyView.panY -= 32;
    else return;
    event.preventDefault();
    clampSkyView();
  });
}

// ===== Loop principal =====
let lastFrame = 0;
function frame(nowMs) {
  const dt = lastFrame ? (nowMs - lastFrame) / 1000 : 0.016;
  lastFrame = nowMs;
  const now = new Date();
  const t = nowMs / 1000;
  const n = nightFactor(now);
  updateCelestialPanorama(now);
  const phase = (moonData && moonData.date === now.toISOString().slice(0, 10) && moonData.phase != null)
    ? moonData.phase
    : moonPhase(now);

  const zoom = skyView.zoom;
  ctx.setTransform(
    DPR * zoom, 0, 0, DPR * zoom,
    DPR * (W * (1 - zoom) * 0.5 + skyView.panX),
    DPR * (H * (1 - zoom) * 0.5 + skyView.panY)
  );
  drawSky(n);
  drawMilkyWay(n, now);
  drawSun(n, now);
  drawCoordinateGrid(n);
  drawStars(n, now);
  drawConstellations(n, now);
  drawMoon(n, phase, now);
  drawSpecialStar(n, t, now);
  drawShooting(n, dt);
  drawClouds(n, t);
  drawRain(dt);

  requestAnimationFrame(frame);
}

// ===== Inicialização =====
async function init() {
  setupWelcome();
  setupImmersive();
  setupMapControls();
  updateClock();
  setInterval(updateClock, 1000);
  startLocation();
  updateWeatherStatus();
  requestAnimationFrame(frame);
  ensureAstronomy();
  setInterval(fetchAstronomy, 10 * 60 * 1000);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Não foi possível preparar o acesso offline.', error));
  }
}
init();

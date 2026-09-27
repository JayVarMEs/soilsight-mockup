/* SoilSight mock data + soil math.
   The "model" here is a stand-in: it picks a soil profile from the photo's bytes so the UI
   can be tested end to end. Replace `mockPredict` with a call to the real model API later. */
(function () {
  'use strict';

  // Sieve / hydrometer sizes (mm) where the curve is reported
  const SIZES = [0.002, 0.0063, 0.02, 0.075, 0.15, 0.3, 0.6, 1.18, 2, 4.75, 9.5, 19];

  // % passing at each size for typical soils (example shapes, not measured data)
  const PROFILES = {
    'Sand':       [1, 2, 3, 4, 12, 45, 75, 88, 92, 96, 99, 100],
    'Silty sand': [5, 9, 15, 22, 40, 65, 82, 91, 95, 98, 100, 100],
    'Gravel':     [0, 1, 1, 2, 4, 8, 14, 22, 30, 45, 72, 95],
    'Silt':       [12, 30, 62, 85, 93, 97, 99, 100, 100, 100, 100, 100],
    'Clay':       [48, 64, 79, 91, 95, 98, 99, 100, 100, 100, 100, 100]
  };
  const TYPES = Object.keys(PROFILES);

  // Deterministic random from a seed string
  function seeded(seedStr) {
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () {
      h += 0x6D2B79F5; let t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Interpolate the size (mm) where the curve reaches `p` % passing (log-linear)
  function dAt(curve, p) {
    for (let i = 1; i < curve.length; i++) {
      const [d0, p0] = curve[i - 1], [d1, p1] = curve[i];
      if (p0 <= p && p1 >= p && p1 !== p0) {
        const t = (p - p0) / (p1 - p0);
        return Math.pow(10, Math.log10(d0) + t * (Math.log10(d1) - Math.log10(d0)));
      }
    }
    return p <= curve[0][1] ? curve[0][0] : null;
  }
  // % passing at size d (log-linear)
  function passingAt(curve, d) {
    if (d <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) {
      const [d0, p0] = curve[i - 1], [d1, p1] = curve[i];
      if (d <= d1) { const t = (Math.log10(d) - Math.log10(d0)) / (Math.log10(d1) - Math.log10(d0)); return p0 + t * (p1 - p0); }
    }
    return 100;
  }

  function analyze(curve) {
    const clay = passingAt(curve, 0.002);
    const fines = passingAt(curve, 0.075);
    const sandTop = passingAt(curve, 4.75);
    const f = {
      gravel: Math.round(100 - sandTop),
      sand: Math.round(sandTop - fines),
      silt: Math.round(fines - clay),
      clay: Math.round(clay)
    };
    // make fractions sum to 100
    const diff = 100 - (f.gravel + f.sand + f.silt + f.clay);
    const biggest = Object.keys(f).sort((a, b) => f[b] - f[a])[0];
    f[biggest] += diff;

    const d10 = dAt(curve, 10), d30 = dAt(curve, 30), d50 = dAt(curve, 50), d60 = dAt(curve, 60);
    const cu = d10 && d60 ? d60 / d10 : null;
    const cc = d10 && d30 && d60 ? (d30 * d30) / (d10 * d60) : null;

    // Simplified USCS
    let uscs;
    if (fines >= 50) {
      uscs = clay >= 30 ? 'CL' : 'ML';
    } else {
      const g = f.gravel > f.sand ? 'G' : 'S';
      const wellGraded = cu && cc && cc >= 1 && cc <= 3 && cu >= (g === 'G' ? 4 : 6);
      const grade = wellGraded ? 'W' : 'P';
      if (fines < 5) uscs = g + grade;
      else if (fines <= 12) uscs = g + grade + '-' + g + 'M';
      else uscs = g + 'M';
    }
    return { fractions: f, d10, d30, d50, d60, cu, cc, uscs };
  }

  function mockPredict(seedStr, forceType) {
    const rnd = seeded(seedStr);
    const pick = TYPES[Math.floor(rnd() * TYPES.length)];
    const type = forceType || pick;
    let last = 0;
    const curve = SIZES.map((d, i) => {
      const base = PROFILES[type][i];
      let p = base === 100 ? 100 : Math.min(100, Math.max(0, base + (rnd() * 6 - 3)));
      p = Math.max(p, last); last = p;
      return [d, Math.round(p * 10) / 10];
    });
    const confidence = Math.round(62 + rnd() * 32);
    const others = TYPES.filter(t => t !== type).sort(() => rnd() - 0.5).slice(0, 2);
    const rest = 100 - confidence;
    const a1 = Math.round(rest * (0.55 + rnd() * 0.3));
    return {
      type, confidence, curve,
      alternatives: [{ type: others[0], p: a1 }, { type: others[1], p: rest - a1 }],
      ...analyze(curve)
    };
  }

  function makeExample(id, site, date, seed, type) {
    const p = mockPredict(seed, type);
    return { id, site, date, scale: 24.5, depth: null, photos: 1, thumb: null, example: true, model: '[MODEL NAME] v0.1', ...p };
  }
  const EXAMPLES = [
    makeExample('S-024', 'Site A', '2026-09-27T14:32:00', 'a24', 'Sand'),
    makeExample('S-023', 'Site A', '2026-09-26T10:05:00', 'a23x', 'Silty sand'),
    makeExample('S-022', 'Site B', '2026-09-24T16:40:00', 'b22', 'Gravel'),
    makeExample('S-021', 'Site B', '2026-09-24T09:12:00', 'b21q', 'Sand'),
    makeExample('S-020', 'Site C', '2026-09-20T13:55:00', 'c20', 'Silt')
  ];

  // ---------- storage (localStorage, safe) ----------
  const KEY = 'soilsight.history.v1';
  const Store = {
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) { /* storage blocked */ }
      return EXAMPLES.slice();
    },
    save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; } }
  };

  window.Soil = { SIZES, TYPES, mockPredict, analyze, Store };
})();

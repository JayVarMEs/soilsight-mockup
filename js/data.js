/* SoilSight data + soil math + API client.
   Real predictions come from the Python API (backend/serve.py, POST /api/predict).
   If the API is not reachable, the app falls back to `mockPredict` (clearly marked as simulated). */
(function () {
  'use strict';

  // Grain sizes (mm) where % passing is predicted — same 11 sizes as the Kaggle task (DIN EN ISO 14688-1)
  const SIZES = [0.002, 0.0063, 0.02, 0.063, 0.2, 0.63, 2, 6.3, 20, 63, 200];

  // % passing at each size for typical soils (demo shapes only, not measured data)
  const PROFILES = {
    'Sand':       [1, 2, 3, 5, 25, 70, 96, 99, 100, 100, 100],
    'Silty sand': [5, 9, 15, 30, 55, 82, 97, 99, 100, 100, 100],
    'Gravel':     [0, 1, 1, 2, 4, 8, 18, 45, 80, 97, 100],
    'Silt':       [12, 30, 62, 88, 96, 99, 100, 100, 100, 100, 100],
    'Clay':       [48, 64, 79, 92, 97, 99, 100, 100, 100, 100, 100]
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
    // Fractions use ISO 14688 limits (clay < 0.002 < silt < 0.063 < sand < 2 mm < gravel; gravel includes cobbles)
    const clay = passingAt(curve, 0.002);
    const siltTop = passingAt(curve, 0.063);
    const sandTop = passingAt(curve, 2);
    const f = {
      gravel: Math.round(100 - sandTop),
      sand: Math.round(sandTop - siltTop),
      silt: Math.round(siltTop - clay),
      clay: Math.round(clay)
    };
    // USCS still uses its own limits (0.075 / 4.75 mm), read from the curve
    const fines = passingAt(curve, 0.075);
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
      const gravelU = 100 - passingAt(curve, 4.75), sandU = passingAt(curve, 4.75) - fines;
      const g = gravelU > sandU ? 'G' : 'S';
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
      type, confidence, curve, simulated: true,
      alternatives: [{ type: others[0], p: a1 }, { type: others[1], p: rest - a1 }],
      ...analyze(curve)
    };
  }

  function makeExample(id, site, date, seed, type) {
    const p = mockPredict(seed, type);
    return { id, site, date, scale: 24.5, depth: null, photos: 1, thumb: null, example: true, model: 'Example (simulated)', ...p };
  }
  const EXAMPLES = [
    makeExample('S-024', 'Site A', '2026-09-27T14:32:00', 'a24', 'Sand'),
    makeExample('S-023', 'Site A', '2026-09-26T10:05:00', 'a23x', 'Silty sand'),
    makeExample('S-022', 'Site B', '2026-09-24T16:40:00', 'b22', 'Gravel'),
    makeExample('S-021', 'Site B', '2026-09-24T09:12:00', 'b21q', 'Sand'),
    makeExample('S-020', 'Site C', '2026-09-20T13:55:00', 'c20', 'Silt')
  ];

  // ---------- storage (localStorage, safe) ----------
  const KEY = 'soilsight.history.v2'; // v2: 11 ISO grain sizes
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

  // ---------- API client ----------
  // API address: ?api=http://host:8000 in the URL (remembered), else the same server that serves the app.
  function apiBase() {
    try {
      const q = new URLSearchParams(location.search).get('api');
      if (q !== null) localStorage.setItem('soilsight.api', q);
      return (q ?? localStorage.getItem('soilsight.api') ?? '').replace(/\/$/, '');
    } catch (e) { return ''; }
  }
  const Api = {
    base: apiBase(),
    async health() {
      if (location.protocol === 'file:' && !this.base) return { ok: false, error: 'Opened as a file' };
      try {
        const r = await fetch(this.base + '/api/health', { signal: AbortSignal.timeout(4000) });
        if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
        return await r.json();
      } catch (e) { return { ok: false, error: 'API not reachable' }; }
    },
    // Photo info + automatic scale + warnings, before predicting (fast, no model)
    async inspect(files) {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f, f.name));
      const r = await fetch(this.base + '/api/inspect', { method: 'POST', body: fd });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail || 'Could not check the photos (HTTP ' + r.status + ')');
      return body.photos;
    },
    // ppms: one px/mm per photo, null = let the server work it out
    async predict(files, ppms) {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f, f.name));
      if (ppms && ppms.some(v => v)) fd.append('ppms', JSON.stringify(ppms.map(v => v || null)));
      let r;
      try { r = await fetch(this.base + '/api/predict', { method: 'POST', body: fd }); }
      catch (e) { throw new Error('Lost connection to the SoilSight server. Is the black server window still open?'); }
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail || 'Prediction failed (HTTP ' + r.status + ')');
      return body;
    }
  };

  window.Soil = { SIZES, TYPES, mockPredict, analyze, Store, Api };
})();

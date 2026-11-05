/* SoilSight mockup — tiny hash router + views. No build step, no dependencies. */
(function () {
  'use strict';
  const { Store, mockPredict, analyze, Api } = window.Soil;
  const { fmt } = window.GrainChart;
  const main = document.getElementById('main');

  // ---------- state ----------
  const state = {
    history: Store.load().map(h => ({ uid: h.uid || h.id, ...h })),
    files: [],            // [{file, url, w, h}]
    current: null,        // latest prediction (maybe unsaved)
    query: '', filter: 'All',
    api: { ok: false, checked: false }   // filled by Api.health() at start
  };
  const persist = () => Store.save(state.history);


  // ---------- helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = {
    upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>',
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>',
    save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/></svg>'
  };
  const fmtDate = iso => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtDay = iso => new Date(iso).toISOString().slice(0, 10);
  const num = (v, dp = 2) => (v == null ? '—' : v.toFixed(dp));
  const mm = v => (v == null ? '—' : fmt(v) + ' mm');
  const thumbHtml = (item, cls = '') => item.thumb
    ? `<img class="thumb ${cls}" src="${item.thumb}" alt="" width="56" height="56">`
    : `<span class="thumb ${cls}" aria-hidden="true"></span>`;

  let toastTimer;
  function toast(msg, actionLabel, onAction) {
    const t = document.getElementById('toast');
    t.innerHTML = `<span>${esc(msg)}</span>` + (actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : '');
    if (actionLabel) t.querySelector('button').onclick = () => { onAction(); t.classList.remove('show'); };
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), actionLabel ? 6000 : 3000);
  }

  function downloadCsv(name, rows) {
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csvHeader = ['sample_id', 'site', 'date', 'predicted_type', 'confidence_pct', 'gravel_pct', 'sand_pct', 'silt_pct', 'clay_pct', 'd10_mm', 'd30_mm', 'd50_mm', 'd60_mm', 'cu', 'cc', 'uscs', ...window.Soil.SIZES.map(s => `pass_${s}mm`)];
  const csvRow = r => [r.id, r.site, r.date, r.type, r.confidence, r.fractions.gravel, r.fractions.sand, r.fractions.silt, r.fractions.clay,
    num(r.d10, 4), num(r.d30, 4), num(r.d50, 4), num(r.d60, 4), num(r.cu), num(r.cc), r.uscs, ...r.curve.map(c => c[1])];

  // ---------- views ----------
  function viewHome() {
    const ex = state.history[0];
    const recent = state.history.slice(0, 3);
    return `
    <section class="hero fade-in">
      <div>
        <div class="eyebrow">For soil &amp; geotechnical researchers</div>
        <h1>Grain size distribution from a single photo.</h1>
        <p class="lead">Take a phone photo of soil. SoilSight tells you what kind of soil it is, how sure it is, and its grain size curve — no lab or ruler needed.</p>
        <div class="actions">
          <a class="btn btn--primary" href="#/upload">${icon.camera} Analyze soil</a>
          <a class="btn btn--ghost" href="#/history">View history</a>
        </div>
      </div>
      ${ex ? `
      <a class="card hero-card" href="#/result/${encodeURIComponent(ex.uid)}">
        <div class="hero-card__top">
          ${thumbHtml(ex, 'thumb--lg')}
          <div>
            <div class="muted" style="font-size:13px">Latest result · ${esc(ex.id)}</div>
            <div class="hero-card__type">${esc(ex.type)}</div>
            <div style="color:var(--color-primary);font-weight:600">${ex.confidence}% confident</div>
          </div>
        </div>
        <div id="hero-chart"></div>
      </a>` : ''}
    </section>

    <section aria-labelledby="how">
      <h2 id="how" class="visually-hidden">How it works</h2>
      <div class="steps">
        <div class="card step"><div class="step__num">01</div><h3>Take a photo</h3><p>Phone flat, about 20 cm (one hand-span) above dry, spread-out soil, in daylight.</p></div>
        <div class="card step"><div class="step__num">02</div><h3>Upload it</h3><p>SoilSight reads the photo and works out the scale, place and date by itself.</p></div>
        <div class="card step"><div class="step__num">03</div><h3>Read the result</h3><p>Soil type in plain words, how sure the model is, and the full grain size curve.</p></div>
      </div>
    </section>

    <h2 class="section-title">Recent predictions <a href="#/history">See all</a></h2>
    <div class="recent">
      ${recent.map(r => `
        <a class="card recent-item" href="#/result/${encodeURIComponent(r.uid)}">
          ${thumbHtml(r)}
          <div><div style="font-weight:600">${esc(r.id)} · ${esc(r.type)}</div><div class="muted" style="font-size:14px">${r.confidence}% · ${fmtDay(r.date)}</div></div>
        </a>`).join('') || '<p class="muted">No predictions yet.</p>'}
    </div>`;
  }
  function afterHome() {
    const ex = state.history[0];
    const box = document.getElementById('hero-chart');
    if (ex && box) window.GrainChart.render(box, ex, { interactive: false });
  }

  // ---------- upload ----------
  // Reference objects people have at hand, for the "measure with a coin" tool (sizes in mm)
  const REFS = [
    { id: 'b10', name: '10 baht coin', mm: 26 }, { id: 'b5', name: '5 baht coin', mm: 24 },
    { id: 'b2', name: '2 baht coin', mm: 21.75 }, { id: 'b1', name: '1 baht coin', mm: 20 },
    { id: 'card', name: 'Bank / ID card (long side)', mm: 85.6 }, { id: 'ruler', name: 'Ruler (I type the length)', mm: null }
  ];
  const DEPTHS = [
    ['', 'Not sure / not recorded'], ['0.15', 'Surface (top 30 cm)'], ['0.6', 'About 0.3–1 m deep'],
    ['2', 'About 1–3 m deep'], ['4', 'Deeper than 3 m'], ['custom', 'I know the exact depth…']
  ];
  const SOURCE_LABEL = {
    measured: 'measured by you', camera: 'known phone, ~20 cm', photo_info: 'from photo info, ~20 cm', guess: 'rough guess — measure with a coin'
  };
  const nextSampleId = () => 'S-' + String(state.history.reduce((m, h) => Math.max(m, parseInt(String(h.id).replace(/\D/g, ''), 10) || 0), 0) + 1).padStart(3, '0');

  const guideSvg = `
    <svg class="guide-art" viewBox="0 0 320 170" role="img" aria-label="Hold the phone flat, about 20 centimetres (one hand-span) above the soil, pointing straight down. A coin next to the soil is optional.">
      <rect x="10" y="132" width="230" height="22" rx="6" fill="#C9A77C"/>
      <g fill="#8A6A45">${[22, 44, 70, 95, 120, 150, 178, 205, 225].map((x, i) => `<circle cx="${x}" cy="${140 + (i % 3) * 4}" r="${3 + (i % 4)}"/>`).join('')}</g>
      <circle cx="262" cy="143" r="10" fill="#E5C07B" stroke="#A16207" stroke-width="2"/><text x="262" y="147" text-anchor="middle" font-size="9" fill="#7A4A05">10</text>
      <text x="262" y="166" text-anchor="middle" font-size="10" fill="currentColor">coin (optional)</text>
      <rect x="70" y="14" width="110" height="20" rx="6" fill="#1F2937"/><circle cx="125" cy="34" r="5" fill="#15803D"/>
      <path d="M125 40 L60 130 M125 40 L190 130" stroke="#15803D" stroke-width="1.5" stroke-dasharray="4 4" fill="none"/>
      <path d="M215 26 V128" stroke="currentColor" stroke-width="1.5"/><path d="M209 32 l6 -8 6 8 M209 122 l6 8 6 -8" stroke="currentColor" stroke-width="1.5" fill="none"/>
      <text x="224" y="72" font-size="13" font-weight="600" fill="currentColor">≈ 20 cm</text>
      <text x="224" y="88" font-size="11" fill="currentColor">one hand-span</text>
      <text x="10" y="28" font-size="11" fill="currentColor">phone flat,</text><text x="10" y="42" font-size="11" fill="currentColor">camera down</text>
    </svg>`;

  function viewUpload() {
    const offline = state.api.checked && !state.api.ok;
    return `
    <div class="page-head fade-in">
      <div><h1>Analyze a soil sample</h1><p>Take or choose 2–5 photos of the <strong>same</strong> soil. SoilSight reads the photos and fills in the details for you.</p></div>
    </div>
    ${offline ? `<div class="banner banner--warn" role="alert"><strong>The prediction server is not running.</strong> On the computer with SoilSight, double-click <code>backend\\start.bat</code> (or run <code>python serve.py</code>) and keep the window open, then reload this page. Until then, results are only simulated.</div>` : ''}
    <div class="upload-grid">
      <section aria-label="Photos">
        <details class="card guide" ${state.history.some(h => !h.example) ? '' : 'open'}>
          <summary><strong>How to take the photo</strong> <span class="muted">(30 seconds)</span></summary>
          <div class="guide__body">
            ${guideSvg}
            <ol class="guide__steps">
              <li><strong>Spread</strong> a handful of dry soil flat on paper or a tray.</li>
              <li><strong>Hold the phone flat</strong>, camera pointing straight down, about <strong>20 cm</strong> above (one hand-span).</li>
              <li><strong>Daylight</strong>, no flash, no shadow of your hand. Tap the soil on the screen to focus.</li>
              <li><em>Optional, for best accuracy:</em> put a <strong>coin</strong> next to the soil. You can then measure it below.</li>
            </ol>
          </div>
        </details>

        <div class="pick-row">
          <label class="btn btn--primary pick-btn">${icon.camera} Take photo
            <input id="camera-input" type="file" accept="image/*" capture="environment" class="visually-hidden">
          </label>
          <label class="btn btn--ghost pick-btn">${icon.image} Choose photos
            <input id="file-input" type="file" accept="image/*" multiple class="visually-hidden">
          </label>
        </div>
        <label class="dropzone dropzone--slim" id="dropzone" for="file-input">
          <span class="muted">…or drag photos here · JPG, PNG, WebP · up to 20 MB each · up to 10 photos</span>
        </label>
        <p class="field error" id="file-error" role="alert" style="margin-top:8px"></p>
        <ul class="files" id="file-list" aria-live="polite"></ul>
        <p class="tip-more" id="more-photos" hidden>${icon.camera} <span><strong>Tip:</strong> add 1–2 more photos of the same soil (move the phone a little). 2–3 photos give a clearly more accurate result than 1.</span></p>
      </section>

      <aside style="display:grid;gap:16px;align-content:start">
        <form class="card form" id="predict-form" novalidate>
          <h2 style="font-size:18px">Sample details</h2>
          <p class="muted" style="font-size:14px;margin:-6px 0 4px">Filled in from the photos where possible. You can change anything.</p>
          <div class="form-error" id="form-error" role="alert"></div>
          <div class="field" id="f-id">
            <label for="sid">Sample name</label>
            <input id="sid" type="text" value="${nextSampleId()}" autocomplete="off" aria-describedby="sid-help">
            <span class="help muted" id="sid-help">Any name, so you can find it later.</span>
          </div>
          <div class="field">
            <label for="site">Where was the soil taken?</label>
            <input id="site" type="text" placeholder="e.g. Rangsit campus, pit 2" autocomplete="off" aria-describedby="site-help">
            <span class="help muted" id="site-help">Optional. Filled from the photo's GPS when it has one.</span>
          </div>
          <div class="field">
            <label for="depth-sel">How deep in the ground?</label>
            <select id="depth-sel" aria-describedby="depth-help">${DEPTHS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
            <input id="depth" type="number" inputmode="decimal" min="0" step="0.1" placeholder="Depth in metres" style="display:none;margin-top:8px" aria-label="Exact depth in metres">
            <span class="help muted" id="depth-help">Optional, for your notes only. It does not change the result.</span>
          </div>
          <details class="adv" id="adv">
            <summary>Scale <span class="muted" id="scale-summary">— automatic</span></summary>
            <div class="adv__body">
              <p class="help muted">The <strong>scale</strong> tells the model how big 1 mm of soil is in the photo (pixels per mm), so it knows the real size of the grains.
              SoilSight works it out from each photo by itself. For the best accuracy, put a coin next to the soil and press <em>Measure with a coin</em> on the photo: pick the coin and fit the circle over it.</p>
              <label class="check"><input type="checkbox" id="ppm-override"> I know the scale for all photos</label>
              <input id="ppm" type="number" inputmode="decimal" min="0.5" max="200" step="0.01" placeholder="pixels per mm" style="display:none" aria-label="Scale in pixels per millimetre">
            </div>
          </details>
          <label class="check"><input type="checkbox" id="autosave" checked> Save the result to my history</label>
          <button class="btn btn--primary" type="submit" id="run-btn">Analyze soil ${icon.arrow}</button>
        </form>
      </aside>
    </div>`;
  }

  function scaleLine(f) {
    if (f.ppm) return `<span class="chip-ok">Scale ${f.ppm.toFixed(2)} px/mm · measured by you</span>`;
    const sc = f.inspect && f.inspect.scale;
    if (!sc) return f.inspecting ? '<span class="muted">Checking photo…</span>' : '<span class="muted">Scale: automatic</span>';
    const cls = sc.source === 'guess' ? 'chip-warn' : 'chip-ok';
    return `<span class="${cls}" title="${esc(sc.note)}">Scale ${sc.ppm.toFixed(2)} px/mm · ${SOURCE_LABEL[sc.source] || sc.source}${sc.camera ? ' (' + esc(sc.camera) + ')' : ''}</span>`;
  }

  function renderFiles() {
    const list = document.getElementById('file-list');
    if (!list) return;
    list.innerHTML = state.files.map((f, i) => {
      const ins = f.inspect || {};
      const warns = (ins.checks || []).map(c => `<li>${esc(c.text)}</li>`).join('');
      return `
      <li class="file file--rich">
        <img class="thumb" src="${f.url}" alt="" width="56" height="56" onerror="this.style.visibility='hidden'">
        <div class="file__meta">
          <div class="file__name">${esc(f.file.name)}</div>
          <div class="file__sub">${(f.file.size / 1048576).toFixed(1)} MB${ins.width ? ` · ${ins.width} × ${ins.height}` : ''}${ins.info && ins.info.model ? ' · ' + esc(ins.info.model) : ''}</div>
          <div class="file__scale">${ins.error ? `<span class="chip-bad">${esc(ins.error)}</span>` : scaleLine(f)}</div>
          ${warns ? `<ul class="file__warn">${warns}</ul>` : ''}
        </div>
        <div class="file__actions">
          ${ins.error ? '' : `<button class="btn btn--ghost btn--sm" type="button" data-measure="${i}">Measure with a coin</button>`}
          <button class="btn btn--ghost btn--icon" type="button" data-remove="${i}" aria-label="Remove ${esc(f.file.name)}">${icon.x}</button>
        </div>
      </li>`;
    }).join('');
    list.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
      const i = +b.dataset.remove; URL.revokeObjectURL(state.files[i].url); state.files.splice(i, 1); renderFiles();
    });
    list.querySelectorAll('[data-measure]').forEach(b => b.onclick = () => openMeasure(+b.dataset.measure));
    const tip = document.getElementById('more-photos');
    if (tip) tip.hidden = state.files.length !== 1;
    const sum = document.getElementById('scale-summary');
    if (sum) {
      const srcs = [...new Set(state.files.map(f => f.ppm ? 'measured' : f.inspect && f.inspect.scale && f.inspect.scale.source).filter(Boolean))];
      sum.textContent = document.getElementById('ppm-override')?.checked ? '— set by you' : srcs.length ? '— automatic (' + srcs.map(s => SOURCE_LABEL[s]).join(', ') + ')' : '— automatic';
    }
  }

  function autofillFromPhotos() {
    const site = document.getElementById('site');
    const gps = state.files.map(f => f.inspect && f.inspect.info && f.inspect.info.gps).find(Boolean);
    if (site && gps && !site.value.trim()) {
      site.value = `${gps.lat.toFixed(5)}, ${gps.lon.toFixed(5)}`;
      site.dataset.auto = '1';
      document.getElementById('site-help').innerHTML = `From the photo's GPS · <a href="https://www.openstreetmap.org/?mlat=${gps.lat}&mlon=${gps.lon}#map=17/${gps.lat}/${gps.lon}" target="_blank" rel="noopener">see on map</a>. You can type a name instead.`;
    }
  }

  async function addFiles(fileList) {
    const err = document.getElementById('file-error');
    const msgs = [], added = [];
    Array.from(fileList).forEach(file => {
      const isImg = /^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
      if (!isImg) { msgs.push(`${file.name} is not a photo.`); return; }
      if (file.size > 20 * 1048576) { msgs.push(`${file.name} is larger than 20 MB.`); return; }
      if (state.files.length >= 10) { msgs.push('You can add up to 10 photos.'); return; }
      const entry = { file, url: URL.createObjectURL(file), inspecting: state.api.ok };
      state.files.push(entry); added.push(entry);
    });
    err.textContent = msgs.join(' ');
    err.style.display = msgs.length ? 'block' : 'none';
    renderFiles();
    if (!added.length || !state.api.ok) return;
    try {
      const res = await Api.inspect(added.map(e => e.file));
      added.forEach((e, i) => { e.inspect = res[i]; e.inspecting = false; });
      autofillFromPhotos();
    } catch (e) {
      added.forEach(x => { x.inspecting = false; });
      toast(e.message);
    }
    renderFiles();
  }

  // ---------- measure with a coin ----------
  // Coins: pick the coin, a circle appears, drag it onto the real coin and make it the same size.
  // Card / ruler: tap the two ends.
  function openMeasure(i) {
    const f = state.files[i];
    const est = (f.inspect && f.inspect.scale && f.inspect.scale.ppm) || null;
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="overlay__panel measure" role="dialog" aria-modal="true" aria-labelledby="m-title">
      <h2 id="m-title">Measure with a coin</h2>
      <div class="m-step"><span class="m-num">1</span> What is in the photo?</div>
      <div class="m-refs" role="radiogroup" aria-label="Reference object">
        ${REFS.map((r, k) => `<button type="button" class="m-ref${k === 0 ? ' is-on' : ''}" role="radio" aria-checked="${k === 0}" data-ref="${r.id}">
          ${r.mm && r.id !== 'card' ? `<span class="m-coin" style="--d:${Math.round(r.mm * 1.15)}px">${r.id.replace('b', '')}</span>` : r.id === 'card' ? '<span class="m-card"></span>' : '<span class="m-ruler"></span>'}
          <span>${r.name.replace(' (long side)', '').replace(' (I type the length)', '')}${r.mm ? `<small>${r.mm} mm</small>` : ''}</span></button>`).join('')}
      </div>
      <input id="m-len" type="number" min="1" step="0.5" placeholder="Distance between your two taps, in mm" style="display:none" aria-label="Length on the ruler in millimetres">
      <div class="m-step"><span class="m-num">2</span> <span id="m-hint"></span></div>
      <div class="measure__stage" id="m-stage">
        <img id="m-img" src="${f.url}" alt="Your photo" draggable="false">
        <svg id="m-svg" aria-hidden="true"></svg>
      </div>
      <div class="m-size" id="m-size">
        <button type="button" class="btn btn--ghost btn--icon" id="m-minus" aria-label="Make the circle smaller">−</button>
        <input type="range" id="m-range" min="5" max="1000" step="1" aria-label="Circle size">
        <button type="button" class="btn btn--ghost btn--icon" id="m-plus" aria-label="Make the circle bigger">+</button>
        <button type="button" class="btn btn--ghost btn--sm" id="m-zoom">Zoom in</button>
      </div>
      <p class="measure__out" id="m-out" aria-live="polite"></p>
      <div class="actions" style="justify-content:flex-end">
        <button class="btn btn--ghost" type="button" id="m-cancel">Cancel</button>
        <button class="btn btn--primary" type="button" id="m-ok" disabled>Use this scale</button>
      </div></div>`;
    document.body.appendChild(ov);
    const $ = sel => ov.querySelector(sel);
    const img = $('#m-img'), svg = $('#m-svg'), stage = $('#m-stage'), out = $('#m-out'), okBtn = $('#m-ok');
    const range = $('#m-range'), len = $('#m-len');
    let ref = REFS[0], zoom = 1, ppm = null;
    let circle = null;          // {x, y, r} in photo pixels
    let pts = [];               // two taps for card / ruler, photo pixels
    let drag = null;

    const isCoin = () => ref.mm && ref.id !== 'card';
    const refMm = () => ref.mm || parseFloat(len.value) || null;
    const k = () => img.clientWidth / img.naturalWidth;               // screen px per photo px
    const toPhoto = e => {
      const r = img.getBoundingClientRect();
      return { x: (e.clientX - r.left) / k(), y: (e.clientY - r.top) / k() };
    };
    function placeCircle(x, y) {
      // start at the size the coin SHOULD have with the automatic scale, so often only a small fix is needed
      const r0 = est ? est * ref.mm / 2 : Math.min(img.naturalWidth, img.naturalHeight) / 20;
      circle = { x: x ?? img.naturalWidth / 2, y: y ?? img.naturalHeight / 2, r: circle ? circle.r : r0 };
      if (!circle.r) circle.r = r0;
    }
    function setHint() {
      $('#m-hint').textContent = isCoin()
        ? 'Tap the coin in the photo. Drag the circle to move it, drag the white dot (or use − / +) until the circle fits the coin edge.'
        : ref.id === 'card' ? 'Tap one short end of the card, then the other short end (along its long side).'
        : 'Tap two marks on the ruler, then type how many mm apart they are.';
      $('#m-size').style.display = isCoin() ? '' : 'none';
      len.style.display = ref.id === 'ruler' ? '' : 'none';
      stage.classList.toggle('is-coin', !!isCoin());
    }
    function draw() {
      if (!img.naturalWidth) return;
      const s = k();
      svg.setAttribute('viewBox', `0 0 ${img.clientWidth} ${img.clientHeight}`);
      svg.style.width = img.clientWidth + 'px'; svg.style.height = img.clientHeight + 'px';
      ppm = null;
      if (isCoin() && circle) {
        const cx = circle.x * s, cy = circle.y * s, r = circle.r * s;
        svg.innerHTML = `<circle class="m-fill" cx="${cx}" cy="${cy}" r="${r}"/>
          <circle class="m-ring" cx="${cx}" cy="${cy}" r="${r}"/>
          <line class="m-cross" x1="${cx - 6}" y1="${cy}" x2="${cx + 6}" y2="${cy}"/><line class="m-cross" x1="${cx}" y1="${cy - 6}" x2="${cx}" y2="${cy + 6}"/>
          <circle class="m-knob" cx="${cx + r}" cy="${cy}" r="9"/>`;
        range.max = Math.round(Math.min(img.naturalWidth, img.naturalHeight) / 2);
        range.value = Math.round(circle.r);
        ppm = (2 * circle.r) / ref.mm;
        out.textContent = `Circle ${Math.round(2 * circle.r)} px wide = ${ref.mm} mm  →  scale ${ppm.toFixed(2)} px/mm` + (est ? `  (automatic: ${est.toFixed(2)})` : '');
      } else if (!isCoin()) {
        svg.innerHTML = pts.map(p => `<circle class="m-ring" cx="${p.x * s}" cy="${p.y * s}" r="7"/>`).join('') +
          (pts.length === 2 ? `<line class="m-line" x1="${pts[0].x * s}" y1="${pts[0].y * s}" x2="${pts[1].x * s}" y2="${pts[1].y * s}"/>` : '');
        if (pts.length === 2 && refMm()) {
          const px = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
          ppm = px / refMm();
          out.textContent = `${Math.round(px)} px = ${refMm()} mm  →  scale ${ppm.toFixed(2)} px/mm` + (est ? `  (automatic: ${est.toFixed(2)})` : '');
        } else out.textContent = pts.length === 2 ? 'Type the distance in mm.' : '';
      } else { svg.innerHTML = ''; out.textContent = ''; }
      okBtn.disabled = !(ppm > 0.5 && ppm < 200);
    }
    function centreOnCircle() {
      if (!circle || zoom === 1) return;
      stage.scrollLeft = circle.x * k() - stage.clientWidth / 2;
      stage.scrollTop = circle.y * k() - stage.clientHeight / 2;
    }

    // pointer: drag the knob = resize, drag inside = move, tap elsewhere = move the circle there
    stage.addEventListener('pointerdown', e => {
      if (!img.naturalWidth) return;
      const p = toPhoto(e), s = k();
      if (isCoin()) {
        if (!circle) placeCircle(p.x, p.y);
        const dKnob = Math.hypot(p.x - (circle.x + circle.r), p.y - circle.y) * s;
        const dCentre = Math.hypot(p.x - circle.x, p.y - circle.y);
        if (dKnob < 22) drag = { mode: 'size' };
        else if (dCentre < circle.r) drag = { mode: 'move', dx: p.x - circle.x, dy: p.y - circle.y };
        else { circle.x = p.x; circle.y = p.y; drag = { mode: 'move', dx: 0, dy: 0 }; }
        stage.setPointerCapture(e.pointerId);
        e.preventDefault();
        draw();
      } else {
        pts = pts.length >= 2 ? [p] : [...pts, p];
        draw();
      }
    });
    stage.addEventListener('pointermove', e => {
      if (!drag || !circle) return;
      const p = toPhoto(e);
      if (drag.mode === 'move') { circle.x = p.x - drag.dx; circle.y = p.y - drag.dy; }
      else circle.r = Math.max(3, Math.hypot(p.x - circle.x, p.y - circle.y));
      draw();
    });
    const endDrag = () => { drag = null; };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('wheel', e => {
      if (!isCoin() || !circle) return;
      e.preventDefault();
      circle.r = Math.max(3, circle.r * (e.deltaY < 0 ? 1.02 : 0.98));
      draw();
    }, { passive: false });

    range.oninput = () => { if (circle) { circle.r = +range.value; draw(); } };
    const nudge = f => { if (circle) { circle.r = Math.max(3, circle.r * f); draw(); } };
    $('#m-minus').onclick = () => nudge(0.98);
    $('#m-plus').onclick = () => nudge(1.02);
    $('#m-zoom').onclick = e => {
      zoom = zoom === 1 ? 2 : zoom === 2 ? 4 : 1;
      stage.style.setProperty('--zoom', zoom);
      stage.classList.toggle('is-zoom', zoom > 1);
      e.target.textContent = zoom === 4 ? 'Fit photo' : `Zoom ${zoom * 2}×`.replace('Zoom 2×', 'Zoom in').replace('Zoom 4×', 'Zoom more');
      requestAnimationFrame(() => { draw(); centreOnCircle(); });
    };
    ov.querySelectorAll('.m-ref').forEach(b => b.onclick = () => {
      ov.querySelectorAll('.m-ref').forEach(x => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-checked', String(x === b)); });
      const keep = circle && isCoin();
      const oldMm = ref.mm;
      ref = REFS.find(r => r.id === b.dataset.ref);
      pts = [];
      if (isCoin()) {
        if (keep && oldMm) circle.r = circle.r * ref.mm / oldMm;  // same scale, other coin size
        else if (!circle) placeCircle();
      }
      setHint(); draw();
    });
    len.oninput = draw;
    const close = () => { ov.remove(); window.removeEventListener('resize', draw); };
    $('#m-cancel').onclick = close;
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', draw);
    img.onload = () => { placeCircle(); setHint(); draw(); };
    if (img.complete && img.naturalWidth) img.onload();
    okBtn.onclick = () => {
      f.ppm = Math.round(ppm * 1000) / 1000;
      close(); renderFiles();
      toast(`Scale set to ${f.ppm.toFixed(2)} px/mm` + (est ? ` (automatic was ${est.toFixed(2)}, ${Math.abs(Math.round(100 * (est / f.ppm - 1)))}% different)` : ''));
    };
    $('.overlay__panel').setAttribute('tabindex', '-1');
    $('.overlay__panel').focus();
  }

  function makeThumb(url) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const s = 160, c = document.createElement('canvas'); c.width = c.height = s;
        const k = Math.max(s / img.width, s / img.height), w = img.width * k, h = img.height * k;
        c.getContext('2d').drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
        resolve(c.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // Shows the progress overlay until `work` (a promise) finishes. Resolves with its value.
  function runAnalysis(work) {
    return new Promise((resolve, reject) => {
    const stages = ['Reading the photos', 'Working out the scale', 'Looking at the grains', 'Building the grain size curve'];
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="overlay__panel" role="dialog" aria-modal="true" aria-labelledby="ov-title" aria-busy="true">
      <h2 id="ov-title">Analyzing your soil…</h2>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Analysis progress"><div class="progress__bar"></div></div>
      <ol class="stage-list">${stages.map(s => `<li><span class="dot" aria-hidden="true"></span>${s}</li>`).join('')}</ol>
      <p class="muted" style="font-size:13px;margin-top:12px">Usually 2–5 seconds per photo.</p>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector('.overlay__panel').setAttribute('tabindex', '-1');
    ov.querySelector('.overlay__panel').focus();
    const bar = ov.querySelector('.progress__bar'), pb = ov.querySelector('.progress'), lis = ov.querySelectorAll('li');
    let i = 0, finished = false, result, error;
    work.then(v => { result = v; }, e => { error = e; }).finally(() => { finished = true; });
    const step = () => {
      lis.forEach((li, j) => { li.className = j < i ? 'done' : j === i ? 'active' : ''; });
      const pct = Math.round((i / stages.length) * 100);
      bar.style.width = pct + '%'; pb.setAttribute('aria-valuenow', pct);
      if (error) { ov.remove(); reject(error); return; }
      if (i === stages.length) { setTimeout(() => { ov.remove(); resolve(result); }, 350); return; }
      if (i === stages.length - 1 && !finished) { setTimeout(step, 200); return; }   // wait for the model
      i++; setTimeout(step, 550);
    };
    step();
    });
  }

  function afterUpload() {
    renderFiles();
    ['file-input', 'camera-input'].forEach(id => {
      const input = document.getElementById(id);
      input.onchange = () => { addFiles(input.files); input.value = ''; };
    });
    const dz = document.getElementById('dropzone');
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('is-over'); }));
    dz.addEventListener('drop', e => addFiles(e.dataTransfer.files));

    const depthSel = document.getElementById('depth-sel'), depth = document.getElementById('depth');
    depthSel.onchange = () => { depth.style.display = depthSel.value === 'custom' ? '' : 'none'; if (depthSel.value === 'custom') depth.focus(); };
    const ovr = document.getElementById('ppm-override'), ppm = document.getElementById('ppm');
    ovr.onchange = () => { ppm.style.display = ovr.checked ? '' : 'none'; if (ovr.checked) ppm.focus(); renderFiles(); };

    const form = document.getElementById('predict-form');
    form.onsubmit = async e => {
      e.preventDefault();
      const fe = document.getElementById('form-error');
      const show = msg => { fe.textContent = msg; fe.classList.toggle('show', !!msg); };
      if (!state.files.length) { show('Add at least one photo first.'); document.getElementById('file-input').focus(); return; }
      const bad = state.files.filter(f => f.inspect && f.inspect.error);
      if (bad.length) { show(`Remove the photo SoilSight can't read: ${bad.map(f => f.file.name).join(', ')}.`); return; }
      const all = ovr.checked ? parseFloat(ppm.value) : null;
      if (ovr.checked && !(all >= 0.5 && all <= 200)) { show('Type a scale between 0.5 and 200 px/mm, or untick "I know the scale".'); ppm.focus(); return; }
      show('');

      const btn = document.getElementById('run-btn'); btn.disabled = true;
      const first = state.files[0];
      const thumb = await makeThumb(first.url);
      const seed = state.files.map(f => f.file.name + f.file.size + f.file.lastModified).join('|');
      const ppms = state.files.map(f => all || f.ppm || null);
      // Real model when the API is up, otherwise a clearly marked simulated result
      const work = state.api.ok
        ? Api.predict(state.files.map(f => f.file), ppms).then(p => ({ ...p, ...analyze(p.curve), simulated: false }))
        : Promise.resolve({ ...mockPredict(seed), model: 'Demo (simulated — model offline)' });
      let p;
      try { p = await runAnalysis(work); }
      catch (err) { btn.disabled = false; toast(err.message || 'Prediction failed'); return; }
      const photosInfo = p.photos || [];
      const scales = photosInfo.map(x => x.scale.ppm);
      const taken = photosInfo.map(x => x.info && x.info.taken_at).find(Boolean) || null;
      const depthVal = depthSel.value === 'custom' ? (depth.value ? parseFloat(depth.value) : null) : depthSel.value ? parseFloat(depthSel.value) : null;
      const rec = {
        uid: 'u' + Date.now().toString(36),
        id: document.getElementById('sid').value.trim() || nextSampleId(),
        site: document.getElementById('site').value.trim() || '—',
        date: new Date().toISOString(), takenAt: taken,
        scale: scales.length ? Math.round(scales.reduce((a, b) => a + b, 0) / scales.length * 100) / 100 : (all || null),
        scaleSources: [...new Set(photosInfo.map(x => x.scale.source))],
        depth: depthVal, depthLabel: depthSel.value && depthSel.value !== 'custom' ? depthSel.options[depthSel.selectedIndex].text : null,
        photos: state.files.length, thumb, photoUrl: first.url, example: false,
        warnings: [...new Set(photosInfo.flatMap(x => (x.checks || []).map(c => c.text)))],
        ...p
      };
      rec.photoScales = photosInfo.map(x => ({ file: x.file, ppm: x.scale.ppm, source: x.scale.source }));
      rec.photos = state.files.length;
      state.current = rec;
      const auto = document.getElementById('autosave')?.checked;
      state.files = [];
      if (auto) saveRecord(rec, true);
      location.hash = '#/result/' + encodeURIComponent(rec.uid);
    };
  }

  function isSaved(rec) { return state.history.some(h => h.uid === rec.uid); }
  function saveRecord(rec, silent) {
    if (isSaved(rec)) return;
    const { photoUrl, ...clean } = rec;
    state.history.unshift(clean);
    const ok = persist();
    if (!silent) toast(ok ? 'Saved to history' : 'Saved for this session only (browser storage is off)');
  }

  function findRecord(uid) {
    if (state.current && state.current.uid === uid) return state.current;
    return state.history.find(h => h.uid === uid);
  }

  // ---------- plain-language result text ----------
  const FRACTION_WORDS = {
    gravel: 'gravel (small stones, 2–63 mm)', sand: 'sand (grains you can see, 0.06–2 mm)',
    silt: 'silt (fine powder, feels smooth)', clay: 'clay (very fine, sticky when wet)'
  };
  function explain(r) {
    const f = r.fractions;
    const order = ['gravel', 'sand', 'silt', 'clay'].sort((a, b) => f[b] - f[a]);
    const main = order[0], second = order[1];
    let t = `Mostly <strong>${FRACTION_WORDS[main]}</strong> (${f[main]}%)`;
    if (f[second] >= 15) t += `, with a lot of <strong>${FRACTION_WORDS[second]}</strong> (${f[second]}%)`;
    t += '.';
    const fines = f.silt + f.clay;
    t += fines < 10 ? ' Very little fine material, so water drains through easily.'
      : fines > 35 ? ' Lots of fine material, so it holds water and can get soft when wet.'
      : ' Some fine material between the larger grains.';
    return t;
  }
  // Thresholds checked on the 24 lab samples: when the main group is >= 80 %, it was right 96 % of the time
  const confWord = c => (c >= 80 ? 'High' : c >= 50 ? 'Medium' : 'Low');
  function confText(r) {
    if (r.simulated) return 'Simulated result — not a real prediction.';
    const w = confWord(r.confidence);
    if (r.detail) {
      return w === 'High' ? `The model is sure this is mainly <strong>${esc(r.type.toLowerCase())}</strong>. In our tests, answers this sure were right ${state.api.reliability_at_80 || 98}% of the time.`
        : w === 'Medium' ? 'Likely, but the next group is also possible. A clearer photo (or more photos) can help.'
        : 'The model is unsure between groups. Take 2–3 more photos of the same soil, or check in the lab if it matters.';
    }
    return w === 'High' ? 'The model is fairly sure about this soil type.'
      : w === 'Medium' ? 'Likely, but the next option is also possible.'
      : 'The model is unsure between a few types — treat this as a first guess and check in the lab if it matters.';
  }
  const scaleSourceText = r => {
    const s = r.scaleSources || [];
    if (!s.length) return '';
    if (s.includes('measured')) return 'measured by you';
    if (s.includes('guess')) return 'rough guess — measure with a coin for better accuracy';
    if (s.includes('photo_info')) return 'from the photo info (assumes ~20 cm above the soil)';
    return 'known phone (assumes ~20 cm above the soil)';
  };

  function viewResult(uid) {
    const r = findRecord(uid);
    if (!r) return `<div class="card empty">${icon.layers}<h1 style="font-size:24px">Result not found</h1><p class="muted">It may have been deleted.</p><a class="btn btn--primary" href="#/history">Back to history</a></div>`;
    const f = r.fractions;
    const photo = r.photoUrl || r.thumb;
    const saved = isSaved(r);
    return `
    <div class="page-head fade-in">
      <div>
        <div class="crumbs"><a href="#/history">History</a> / ${esc(r.id)}</div>
        <h1>Prediction result</h1>
      </div>
      <div class="actions">
        <a class="btn btn--ghost" href="#/upload">New prediction</a>
        <button class="btn btn--ghost" type="button" id="print-one">${icon.download} Report (PDF)</button>
        <button class="btn btn--ghost" type="button" id="export-one">${icon.download} Export CSV</button>
        <button class="btn ${saved ? 'btn--ghost' : 'btn--primary'}" type="button" id="save-btn" ${saved ? 'disabled' : ''}>${saved ? icon.check + ' Saved' : icon.save + ' Save to history'}</button>
      </div>
    </div>

    ${r.simulated && !r.example ? '<p class="sim-note" role="note">This result is <strong>simulated</strong> because the prediction server was not running. On the computer, double-click <code>backend\\start.bat</code>, then analyze again.</p>' : ''}
    <section class="card plain" aria-labelledby="plain-label">
      <div class="card__label" id="plain-label">In plain words</div>
      <p class="plain__text">${explain(r)}</p>
      <p class="plain__conf"><span class="conf-pill conf-${confWord(r.confidence).toLowerCase()}">${confWord(r.confidence)} confidence · ${r.confidence}%</span> ${confText(r)}</p>
      ${r.photos === 1 && !r.simulated && !r.example ? `<p class="plain__more">Based on 1 photo. Analyze again with 2–3 photos of the same soil for a more accurate and more confident result.</p>` : ''}
      ${(r.warnings || []).length ? `<div class="plain__warn"><strong>Photo tips for next time:</strong><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    </section>
    <div class="result-grid">
      <aside>
        ${photo ? `<img class="photo" src="${photo}" alt="Uploaded photo of sample ${esc(r.id)}">` : `<div class="photo thumb" role="img" aria-label="Example sample photo (placeholder)"></div>`}
        <dl class="meta card" style="margin-top:16px">
          <div><dt>Sample</dt><dd>${esc(r.id)}${r.example ? ' <span class="tag-example">example</span>' : ''}</dd></div>
          <div><dt>Site</dt><dd>${esc(r.site)}</dd></div>
          <div><dt>Analyzed</dt><dd>${fmtDate(r.date)}</dd></div>
          <div class="span-2"><dt>Scale</dt><dd>${r.scale != null ? r.scale + ' px/mm' : '—'}${scaleSourceText(r) ? `<div class="muted" style="font-size:13px;font-weight:400">${esc(scaleSourceText(r))}</div>` : ''}</dd></div>
          <div><dt>Photos</dt><dd>${r.photos}</dd></div>
          <div><dt>Depth</dt><dd>${r.depthLabel ? esc(r.depthLabel) : r.depth != null ? r.depth + ' m' : '—'}</dd></div>
          ${r.takenAt ? `<div class="span-2"><dt>Photo taken</dt><dd>${fmtDate(r.takenAt)}</dd></div>` : ''}
          <div class="span-2"><dt>Model</dt><dd>${esc(r.model)}</dd></div>
        </dl>
      </aside>

      <div>
        <div class="summary">
          <section class="card" aria-labelledby="pt-label">
            <div class="card__label" id="pt-label">${r.detail ? 'Main soil group' : 'Predicted soil type'}</div>
            <div class="pred-type"><strong>${esc(r.type)}</strong><span class="pct">${r.confidence}%</span></div>
            <div class="bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${r.confidence}" aria-label="Confidence"><span style="width:${r.confidence}%"></span></div>
            <div class="conf-note muted">${r.simulated ? 'Confidence (simulated)' : 'Confidence = how often the model gets the same answer when we allow for its usual error.'}</div>
            ${r.detail || r.coarse ? `<dl class="sub-answers">
              ${r.coarse ? `<div><dt>Coarse or fine soil</dt><dd><strong>${esc(r.coarse.type)}</strong> <span class="mono">${r.coarse.confidence}%</span></dd></div>` : ''}
              ${r.detail ? `<div><dt>Closest detailed type</dt><dd><strong>${esc(r.detail.type)}</strong> <span class="mono">${r.detail.confidence}%</span></dd></div>` : ''}
            </dl>` : ''}
            ${(r.alternatives || []).length ? `<div class="alts">
              <div class="muted" style="font-size:13px">Other possible groups</div>
              ${r.alternatives.map(a => `<div><span>${esc(a.type)}</span><span class="mono">${a.p}%</span></div>`).join('')}
            </div>` : ''}
          </section>
          <section class="card" aria-labelledby="comp-label">
            <div class="card__label" id="comp-label">Composition</div>
            <div class="stack" role="img" aria-label="Gravel ${f.gravel}%, sand ${f.sand}%, silt ${f.silt}%, clay ${f.clay}%">
              <span style="width:${f.gravel}%;background:var(--soil-gravel)"></span>
              <span style="width:${f.sand}%;background:var(--soil-sand)"></span>
              <span style="width:${f.silt}%;background:var(--soil-silt)"></span>
              <span style="width:${f.clay}%;background:var(--soil-clay)"></span>
            </div>
            <div class="legend" aria-hidden="true">
              <span><i class="swatch" style="background:var(--soil-gravel)"></i>Gravel ${f.gravel}%</span>
              <span><i class="swatch" style="background:var(--soil-sand)"></i>Sand ${f.sand}%</span>
              <span><i class="swatch" style="background:var(--soil-silt)"></i>Silt ${f.silt}%</span>
              <span><i class="swatch" style="background:var(--soil-clay)"></i>Clay ${f.clay}%</span>
            </div>
            <dl class="params">
              <div><dt>D10</dt><dd>${mm(r.d10)}</dd></div>
              <div><dt>D30</dt><dd>${mm(r.d30)}</dd></div>
              <div><dt>D60</dt><dd>${mm(r.d60)}</dd></div>
              <div><dt>Cu</dt><dd>${num(r.cu, 1)}</dd></div>
              <div><dt>Cc</dt><dd>${num(r.cc)}</dd></div>
              <div><dt>USCS</dt><dd>${esc(r.uscs)}</dd></div>
            </dl>
          </section>
        </div>

        <section class="card" aria-labelledby="chart-label">
          <div class="chart-head">
            <div class="card__label" id="chart-label" style="margin:0">Cumulative grain size distribution</div>
            <div class="chart-legend" aria-hidden="true"><span><i></i>Predicted % passing</span>${r.band ? '<span><i class="ci"></i>Likely range (80%)</span>' : ''}<span><i class="d"></i>D10 / D50 / D60</span></div>
          </div>
          <p class="chart-scroll-hint" id="chart-scroll-hint">Swipe horizontally to explore the full chart.</p>
          <div id="result-chart" aria-describedby="chart-scroll-hint"></div>
          <details class="data-table">
            <summary>Show data table</summary>
            <table class="table">
              <thead><tr><th scope="col">Grain size (mm)</th><th scope="col" class="num">% passing</th>${r.band ? '<th scope="col" class="num">Likely range</th>' : ''}</tr></thead>
              <tbody>${r.curve.map(([d, p], i) => `<tr><td class="mono">${d}</td><td class="num">${p}</td>${r.band ? `<td class="num">${r.band.lo[i]}–${r.band.hi[i]}</td>` : ''}</tr>`).join('')}</tbody>
            </table>
          </details>
        </section>
        <details class="card glossary">
          <summary><strong>What do these words and numbers mean?</strong></summary>
          <dl>
            <div><dt>Grain size curve</dt><dd>For each grain size (bottom), the line shows how much of the soil (by weight) is <em>smaller</em> than that size. A line far to the left = fine soil; far to the right = coarse, stony soil.</dd></div>
            <div><dt>Likely range</dt><dd>The shaded band. The real curve is inside it about 8 times out of 10.</dd></div>
            <div><dt>Gravel, sand, silt, clay</dt><dd>Grain sizes, from big to small: gravel 2–63 mm (small stones), sand 0.063–2 mm, silt 0.002–0.063 mm (powder), clay below 0.002 mm.</dd></div>
            <div><dt>D10, D30, D60</dt><dd>The grain size that 10%, 30% or 60% of the soil is smaller than. D10 is often used to estimate how fast water flows through soil.</dd></div>
            <div><dt>Cu (uniformity)</dt><dd>D60 ÷ D10. Below about 4–6: grains are mostly one size. Higher: many different sizes mixed.</dd></div>
            <div><dt>Cc (curvature)</dt><dd>Shows if the mix of sizes is even. Between 1 and 3 together with a high Cu means "well graded" (good for building on).</dd></div>
            <div><dt>USCS</dt><dd>An engineering soil code. First letter: G = gravel, S = sand, M = silt, C = clay. Second: W = well graded, P = poorly graded. E.g. SP-SM = poorly graded sand with some silt.</dd></div>
            <div><dt>Confidence</dt><dd>How sure the model is. The big answer is the <em>main group</em> (gravel, sand, silt or clay): when it says 80% or more, it was right 98% of the time on lab-tested samples. The detailed name (e.g. "sandy gravel") is a harder question, so its % is lower. The model was trained on only 24 lab-tested samples.</dd></div>
            <div><dt>Coarse / fine</dt><dd>Coarse = mostly sand and gravel (water drains well). Fine = mostly silt and clay (holds water, can get soft). Engineers use this split first.</dd></div>
          </dl>
        </details>
      </div>
    </div>`;
  }
  function afterResult(uid) {
    const r = findRecord(uid);
    if (!r) return;
    window.GrainChart.render(document.getElementById('result-chart'), r);
    document.getElementById('export-one').onclick = () => downloadCsv(`soilsight_${r.id}.csv`, [csvHeader, csvRow(r)]);
    // Print view = a one-page report; the browser's print dialog can "Save as PDF"
    document.getElementById('print-one').onclick = () => {
      const old = document.title;
      document.title = `SoilSight report ${r.id}`;
      document.querySelectorAll('.data-table, .glossary').forEach(d => { d.dataset.wasOpen = d.open ? '1' : ''; d.open = true; });
      window.print();
      document.querySelectorAll('.data-table, .glossary').forEach(d => { d.open = !!d.dataset.wasOpen; });
      document.title = old;
    };
    const sb = document.getElementById('save-btn');
    if (sb && !sb.disabled) sb.onclick = () => {
      saveRecord(r);
      sb.disabled = true; sb.className = 'btn btn--ghost'; sb.innerHTML = icon.check + ' Saved';
    };
  }

  function filtered() {
    const q = state.query.trim().toLowerCase();
    return state.history.filter(r => (state.filter === 'All' || r.type === state.filter) && (!q || `${r.id} ${r.site}`.toLowerCase().includes(q)));
  }

  function viewHistory() {
    return `
    <div class="page-head fade-in">
      <div><h1>Prediction history</h1><p>Every saved prediction. Open one to see its full curve, or export all for analysis.</p></div>
      <div class="actions">
        <button class="btn btn--ghost" type="button" id="export-all">${icon.download} Export all (CSV)</button>
        <a class="btn btn--primary" href="#/upload">New prediction</a>
      </div>
    </div>
    <div class="toolbar">
      <div class="search">
        ${icon.search}
        <label for="q" class="visually-hidden">Search sample ID or site</label>
        <input id="q" type="search" placeholder="Search sample ID or site" value="${esc(state.query)}">
      </div>
      <div class="chips" role="group" aria-label="Filter by soil type">
        ${['All', ...new Set(state.history.map(h => h.type))].map(t => `<button type="button" class="chip" data-filter="${esc(t)}" aria-pressed="${t === state.filter}">${esc(t)}</button>`).join('')}
      </div>
      <div class="count" id="count" aria-live="polite"></div>
    </div>
    <div class="card history-card" id="history-body"></div>`;
  }

  function renderHistoryRows() {
    const rows = filtered();
    document.getElementById('count').textContent = `${rows.length} result${rows.length === 1 ? '' : 's'}`;
    const body = document.getElementById('history-body');
    if (!state.history.length) {
      body.innerHTML = `<div class="empty">${icon.layers}<h2 style="font-size:20px">No predictions yet</h2><p class="muted">Upload a soil photo to get your first result.</p><a class="btn btn--primary" href="#/upload">${icon.camera} Analyze soil</a></div>`;
      return;
    }
    if (!rows.length) {
      body.innerHTML = `<div class="empty">${icon.search}<h2 style="font-size:20px">No matches</h2><p class="muted">Try another search or filter.</p><button class="btn btn--ghost" type="button" id="clear-f">Clear filters</button></div>`;
      document.getElementById('clear-f').onclick = () => { state.query = ''; state.filter = 'All'; render(); };
      return;
    }
    body.innerHTML = `<table class="table responsive">
      <caption class="visually-hidden">Saved predictions</caption>
      <thead><tr><th scope="col">Sample</th><th scope="col">Site</th><th scope="col">Date</th><th scope="col">Predicted type</th><th scope="col">Confidence</th><th scope="col">D50</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td class="cell-first"><div class="cell-sample">${thumbHtml(r)}<strong>${esc(r.id)}</strong>${r.example ? '<span class="tag-example">example</span>' : ''}</div></td>
          <td data-label="Site">${esc(r.site)}</td>
          <td data-label="Date" class="mono" style="font-size:14px">${fmtDay(r.date)}</td>
          <td data-label="Type"><strong>${esc(r.type)}</strong></td>
          <td data-label="Confidence"><span class="conf" style="display:inline-flex"><span class="bar"><span style="width:${r.confidence}%"></span></span><span class="mono">${r.confidence}%</span></span></td>
          <td data-label="D50" class="mono">${mm(r.d50)}</td>
          <td class="row-actions-cell"><div class="row-actions">
            <a class="btn btn--ghost btn--sm" href="#/result/${encodeURIComponent(r.uid)}">View</a>
            <button class="btn btn--danger btn--sm btn--icon" type="button" data-del="${esc(r.uid)}" aria-label="Delete ${esc(r.id)}">${icon.trash}</button>
          </div></td>
        </tr>`).join('')}</tbody></table>`;
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const idx = state.history.findIndex(h => h.uid === b.dataset.del);
      if (idx < 0) return;
      const [removed] = state.history.splice(idx, 1);
      persist(); renderHistoryRows();
      toast(`Deleted ${removed.id}`, 'Undo', () => { state.history.splice(idx, 0, removed); persist(); renderHistoryRows(); });
    });
  }

  function afterHistory() {
    renderHistoryRows();
    const q = document.getElementById('q');
    let t;
    q.oninput = () => { clearTimeout(t); t = setTimeout(() => { state.query = q.value; renderHistoryRows(); }, 150); };
    document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => {
      state.filter = b.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      renderHistoryRows();
    });
    document.getElementById('export-all').onclick = () => downloadCsv('soilsight_history.csv', [csvHeader, ...state.history.map(csvRow)]);
  }

  // ---------- router ----------
  function render() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const [, page, arg] = hash.split('/');
    let html, after, nav;
    switch (page) {
      case 'upload': html = viewUpload(); after = afterUpload; nav = 'upload'; break;
      case 'result': html = viewResult(decodeURIComponent(arg || '')); after = () => afterResult(decodeURIComponent(arg || '')); nav = 'history'; break;
      case 'history': html = viewHistory(); after = afterHistory; nav = 'history'; break;
      default: html = viewHome(); after = afterHome; nav = 'home';
    }
    main.innerHTML = html;
    document.querySelectorAll('[data-nav]').forEach(a => { if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const titles = { home: 'Home', upload: 'New prediction', history: page === 'result' ? 'Prediction result' : 'History' };
    document.title = `SoilSight — ${titles[nav]}`;
    after && after();
  }
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); main.focus({ preventScroll: true }); });

  function showModelStatus() {
    const h = state.api;
    const badge = document.getElementById('model-badge');
    const foot = document.getElementById('model-name');
    if (badge) {
      badge.textContent = h.ok ? 'Live model' : h.loading ? 'Starting…' : 'Demo mode';
      badge.classList.toggle('is-live', !!h.ok);
      badge.title = h.ok ? `${h.model} · trained on ${h.n_samples} samples · CV EMD ${h.cv_emd?.toFixed(1)}` : `Model offline (${h.error || 'not reachable'}). Results are simulated.`;
    }
    if (foot) foot.textContent = h.ok ? h.model : 'offline — results are simulated';
  }
  render();
  // Ask the server if the model is ready; while it is still loading, ask again every 2 s
  async function checkServer(tries = 0) {
    const h = await Api.health();
    const was = state.api.ok;
    state.api = { ...h, checked: true };
    showModelStatus();
    if (h.loading && tries < 60) { setTimeout(() => checkServer(tries + 1), 2000); return; }
    const page = (location.hash.split('/')[1] || '');
    if (page === 'upload' && was !== h.ok && !state.files.length) render();   // show / hide the "server not running" note
  }
  checkServer();
})();

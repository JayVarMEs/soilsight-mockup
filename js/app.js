/* SoilSight mockup — tiny hash router + views. No build step, no dependencies. */
(function () {
  'use strict';
  const { Store, mockPredict, TYPES } = window.Soil;
  const { fmt } = window.GrainChart;
  const main = document.getElementById('main');

  // ---------- state ----------
  const state = {
    history: Store.load().map(h => ({ uid: h.uid || h.id, ...h })),
    files: [],            // [{file, url, w, h}]
    current: null,        // latest prediction (maybe unsaved)
    query: '', filter: 'All'
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
        <p class="lead">Upload a photo of a soil sample. SoilSight predicts its grain size curve, the soil type, and how confident the model is — then keeps every result in your history.</p>
        <div class="actions">
          <a class="btn btn--primary" href="#/upload">${icon.upload} Upload a sample</a>
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
        <div class="card step"><div class="step__num">01</div><h3>Photograph the sample</h3><p>Top-down, even light, with a ruler in the frame so the scale is known.</p></div>
        <div class="card step"><div class="step__num">02</div><h3>Upload and set the scale</h3><p>Add one or more photos of the same sample and enter pixels per mm.</p></div>
        <div class="card step"><div class="step__num">03</div><h3>Get the prediction</h3><p>Grain size curve, soil type and confidence %. Save it to history.</p></div>
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

  function viewUpload() {
    const nextId = 'S-' + String(state.history.reduce((m, h) => Math.max(m, parseInt(String(h.id).replace(/\D/g, ''), 10) || 0), 0) + 1).padStart(3, '0');
    return `
    <div class="page-head fade-in">
      <div><h1>New prediction</h1><p>Upload photos of one soil sample. Several photos of the same sample give a steadier result.</p></div>
    </div>
    <div class="upload-grid">
      <section aria-label="Photos">
        <label class="dropzone" id="dropzone">
          <span class="dropzone__icon">${icon.image}</span>
          <strong>Drag photos here, or <span class="link">choose files</span></strong>
          <span class="muted" style="font-size:14px">JPG, PNG or WebP · up to 20 MB each · up to 10 photos</span>
          <input id="file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-describedby="file-error">
        </label>
        <p class="field error" id="file-error" role="alert" style="margin-top:8px"></p>
        <ul class="files" id="file-list" aria-live="polite"></ul>
      </section>

      <aside style="display:grid;gap:16px">
        <form class="card form" id="predict-form" novalidate>
          <h2 style="font-size:18px">Sample details</h2>
          <div class="form-error" id="form-error" role="alert"></div>
          <div class="field" id="f-id">
            <label for="sid">Sample ID <span class="req" aria-hidden="true">*</span></label>
            <input id="sid" name="sid" type="text" value="${nextId}" required autocomplete="off" aria-describedby="sid-err">
            <span class="error" id="sid-err">Enter a sample ID.</span>
          </div>
          <div class="row-2">
            <div class="field" id="f-scale">
              <label for="ppm">Scale (px/mm) <span class="req" aria-hidden="true">*</span></label>
              <input id="ppm" name="ppm" type="number" inputmode="decimal" min="0.1" step="0.1" value="24.5" required aria-describedby="ppm-help ppm-err">
              <span class="error" id="ppm-err">Must be above 0.</span>
            </div>
            <div class="field">
              <label for="depth">Depth (m)</label>
              <input id="depth" name="depth" type="number" inputmode="decimal" min="0" step="0.1" placeholder="Optional">
            </div>
          </div>
          <span class="help muted" id="ppm-help" style="font-size:13px;margin-top:-8px">Measure from the ruler in the photo.</span>
          <div class="field">
            <label for="site">Site / location</label>
            <input id="site" name="site" type="text" placeholder="e.g. Site A" autocomplete="off">
          </div>
          <label class="check"><input type="checkbox" id="autosave" checked> Save result to history automatically</label>
          <button class="btn btn--primary" type="submit" id="run-btn">Run prediction ${icon.arrow}</button>
        </form>
        <div class="tips">
          <h2>Photo tips</h2>
          <ul><li>Shoot straight down, even light, no flash glare</li><li>Include a ruler for the scale</li><li>Use a dry, spread-out sample</li></ul>
        </div>
      </aside>
    </div>`;
  }

  function renderFiles() {
    const list = document.getElementById('file-list');
    if (!list) return;
    list.innerHTML = state.files.map((f, i) => `
      <li class="file">
        <img class="thumb" src="${f.url}" alt="" width="56" height="56">
        <div class="file__meta">
          <div class="file__name">${esc(f.file.name)}</div>
          <div class="file__sub">${(f.file.size / 1048576).toFixed(1)} MB${f.w ? ` · ${f.w} × ${f.h}` : ''}</div>
        </div>
        <span class="file__status">Ready</span>
        <button class="btn btn--ghost btn--icon" type="button" data-remove="${i}" aria-label="Remove ${esc(f.file.name)}">${icon.x}</button>
      </li>`).join('');
    list.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
      const i = +b.dataset.remove; URL.revokeObjectURL(state.files[i].url); state.files.splice(i, 1); renderFiles();
    });
  }

  function addFiles(fileList) {
    const err = document.getElementById('file-error');
    const msgs = [];
    Array.from(fileList).forEach(file => {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { msgs.push(`${file.name}: not a JPG/PNG/WebP image.`); return; }
      if (file.size > 20 * 1048576) { msgs.push(`${file.name}: larger than 20 MB.`); return; }
      if (state.files.length >= 10) { msgs.push('Max 10 photos.'); return; }
      const entry = { file, url: URL.createObjectURL(file) };
      const img = new Image();
      img.onload = () => { entry.w = img.naturalWidth; entry.h = img.naturalHeight; renderFiles(); };
      img.src = entry.url;
      state.files.push(entry);
    });
    err.textContent = msgs.join(' ');
    err.style.display = msgs.length ? 'block' : 'none';
    renderFiles();
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

  function runAnalysis(onDone) {
    const stages = ['Reading photos', 'Correcting scale', 'Measuring grains', 'Building the curve'];
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="overlay__panel" role="dialog" aria-modal="true" aria-labelledby="ov-title" aria-busy="true">
      <h2 id="ov-title">Analyzing sample…</h2>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Analysis progress"><div class="progress__bar"></div></div>
      <ol class="stage-list">${stages.map(s => `<li><span class="dot" aria-hidden="true"></span>${s}</li>`).join('')}</ol>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector('.overlay__panel').setAttribute('tabindex', '-1');
    ov.querySelector('.overlay__panel').focus();
    const bar = ov.querySelector('.progress__bar'), pb = ov.querySelector('.progress'), lis = ov.querySelectorAll('li');
    let i = 0;
    const step = () => {
      lis.forEach((li, j) => { li.className = j < i ? 'done' : j === i ? 'active' : ''; });
      const pct = Math.round((i / stages.length) * 100);
      bar.style.width = pct + '%'; pb.setAttribute('aria-valuenow', pct);
      if (i === stages.length) { setTimeout(() => { ov.remove(); onDone(); }, 350); return; }
      i++; setTimeout(step, 550);
    };
    step();
  }

  function afterUpload() {
    renderFiles();
    const input = document.getElementById('file-input');
    const dz = document.getElementById('dropzone');
    input.onchange = () => { addFiles(input.files); input.value = ''; };
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('is-over'); }));
    dz.addEventListener('drop', e => addFiles(e.dataTransfer.files));

    const form = document.getElementById('predict-form');
    const sid = document.getElementById('sid'), ppm = document.getElementById('ppm');
    const check = (input, box, ok) => { document.getElementById(box).classList.toggle('has-error', !ok); input.setAttribute('aria-invalid', String(!ok)); return ok; };
    sid.addEventListener('blur', () => check(sid, 'f-id', sid.value.trim() !== ''));
    ppm.addEventListener('blur', () => check(ppm, 'f-scale', parseFloat(ppm.value) > 0));

    form.onsubmit = async e => {
      e.preventDefault();
      const okId = check(sid, 'f-id', sid.value.trim() !== '');
      const okScale = check(ppm, 'f-scale', parseFloat(ppm.value) > 0);
      const fe = document.getElementById('form-error');
      const okFiles = state.files.length > 0;
      fe.textContent = okFiles ? '' : 'Add at least one photo first.';
      fe.classList.toggle('show', !okFiles);
      if (!okId) { sid.focus(); return; }
      if (!okScale) { ppm.focus(); return; }
      if (!okFiles) { document.getElementById('file-input').focus(); return; }

      const btn = document.getElementById('run-btn'); btn.disabled = true;
      const first = state.files[0];
      const thumb = await makeThumb(first.url);
      const seed = state.files.map(f => f.file.name + f.file.size + f.file.lastModified).join('|');
      runAnalysis(() => {
        const p = mockPredict(seed);
        const rec = {
          uid: 'u' + Date.now().toString(36),
          id: sid.value.trim(), site: document.getElementById('site').value.trim() || '—',
          date: new Date().toISOString(), scale: parseFloat(ppm.value),
          depth: document.getElementById('depth').value ? parseFloat(document.getElementById('depth').value) : null,
          photos: state.files.length, thumb, photoUrl: first.url, example: false, model: '[MODEL NAME] v0.1', ...p
        };
        state.current = rec;
        const auto = document.getElementById('autosave')?.checked;
        state.files = [];
        if (auto) saveRecord(rec, true);
        location.hash = '#/result/' + encodeURIComponent(rec.uid);
      });
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
        <button class="btn btn--ghost" type="button" id="export-one">${icon.download} Export CSV</button>
        <button class="btn ${saved ? 'btn--ghost' : 'btn--primary'}" type="button" id="save-btn" ${saved ? 'disabled' : ''}>${saved ? icon.check + ' Saved' : icon.save + ' Save to history'}</button>
      </div>
    </div>

    <div class="result-grid">
      <aside>
        ${photo ? `<img class="photo" src="${photo}" alt="Uploaded photo of sample ${esc(r.id)}">` : `<div class="photo thumb" role="img" aria-label="Example sample photo (placeholder)"></div>`}
        <dl class="meta card" style="margin-top:16px">
          <div><dt>Sample</dt><dd>${esc(r.id)}${r.example ? ' <span class="tag-example">example</span>' : ''}</dd></div>
          <div><dt>Site</dt><dd>${esc(r.site)}</dd></div>
          <div><dt>Analyzed</dt><dd>${fmtDate(r.date)}</dd></div>
          <div><dt>Scale</dt><dd>${r.scale} px/mm</dd></div>
          <div><dt>Photos</dt><dd>${r.photos}</dd></div>
          <div><dt>Depth</dt><dd>${r.depth != null ? r.depth + ' m' : '—'}</dd></div>
          <div class="span-2"><dt>Model</dt><dd>${esc(r.model)}</dd></div>
        </dl>
      </aside>

      <div>
        <div class="summary">
          <section class="card" aria-labelledby="pt-label">
            <div class="card__label" id="pt-label">Predicted soil type</div>
            <div class="pred-type"><strong>${esc(r.type)}</strong><span class="pct">${r.confidence}%</span></div>
            <div class="bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${r.confidence}" aria-label="Confidence"><span style="width:${r.confidence}%"></span></div>
            <div class="conf-note muted">Confidence · USCS class ${esc(r.uscs)}</div>
            <div class="alts">
              <div class="muted" style="font-size:13px">Other possibilities</div>
              ${r.alternatives.map(a => `<div><span>${esc(a.type)}</span><span class="mono">${a.p}%</span></div>`).join('')}
            </div>
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
            <div class="chart-legend" aria-hidden="true"><span><i></i>Predicted % passing</span><span><i class="d"></i>D10 / D50 / D60</span></div>
          </div>
          <p class="chart-scroll-hint" id="chart-scroll-hint">Swipe horizontally to explore the full chart.</p>
          <div id="result-chart" aria-describedby="chart-scroll-hint"></div>
          <details class="data-table">
            <summary>Show data table</summary>
            <table class="table">
              <thead><tr><th scope="col">Grain size (mm)</th><th scope="col" class="num">% passing</th></tr></thead>
              <tbody>${r.curve.map(([d, p]) => `<tr><td class="mono">${d}</td><td class="num">${p}</td></tr>`).join('')}</tbody>
            </table>
          </details>
        </section>
      </div>
    </div>`;
  }
  function afterResult(uid) {
    const r = findRecord(uid);
    if (!r) return;
    window.GrainChart.render(document.getElementById('result-chart'), r);
    document.getElementById('export-one').onclick = () => downloadCsv(`soilsight_${r.id}.csv`, [csvHeader, csvRow(r)]);
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
        ${['All', ...TYPES].map(t => `<button type="button" class="chip" data-filter="${esc(t)}" aria-pressed="${t === state.filter}">${esc(t)}</button>`).join('')}
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
      body.innerHTML = `<div class="empty">${icon.layers}<h2 style="font-size:20px">No predictions yet</h2><p class="muted">Upload a soil photo to get your first result.</p><a class="btn btn--primary" href="#/upload">${icon.upload} Upload a sample</a></div>`;
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
  render();
})();

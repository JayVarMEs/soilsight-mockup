/* Cumulative grain size curve (% passing vs log grain size). Plain SVG, keyboard + hover tooltips. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const W = 760, H = 320, M = { l: 52, r: 16, t: 28, b: 52 };
  const PW = W - M.l - M.r, PH = H - M.t - M.b;
  const LMIN = -3, LMAX = Math.log10(300); // 0.001 mm .. 300 mm

  const x = d => ((Math.log10(d) - LMIN) / (LMAX - LMIN)) * PW;
  const y = p => PH - (p / 100) * PH;

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  const fmt = d => (d < 0.01 ? d.toFixed(4) : d < 1 ? d.toFixed(3) : d.toFixed(2)).replace(/0+$/, '').replace(/\.$/, '');

  function render(container, result, options) {
    const interactive = options?.interactive !== false;
    container.innerHTML = '';
    const svgAttrs = interactive
      ? { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'group', 'aria-label': `Cumulative grain size curve. D50 is ${fmt(result.d50)} millimetres.` }
      : { viewBox: `0 0 ${W} ${H}`, class: 'chart', 'aria-hidden': 'true', focusable: 'false' };
    const svg = el('svg', svgAttrs);
    const g = el('g', { transform: `translate(${M.l},${M.t})` }, svg);

    // soil bands
    // ISO 14688 fraction limits
    const bands = [['Clay', 0.001, 0.002, '#EEF7EF'], ['Silt', 0.002, 0.063, '#F5FBF6'], ['Sand', 0.063, 2, '#FFFBEB'], ['Gravel', 2, 63, '#F7F1EA'], ['Cobbles', 63, 300, '#EFE7DD']];
    bands.forEach(([name, a, b, fill]) => {
      el('rect', { x: x(a), y: 0, width: x(b) - x(a), height: PH, fill }, g);
      const t = el('text', { x: (x(a) + x(b)) / 2, y: -10, 'text-anchor': 'middle', class: 'band-label' }, g);
      t.textContent = name;
    });

    // grid + y ticks
    [0, 25, 50, 75, 100].forEach(p => {
      el('line', { x1: 0, x2: PW, y1: y(p), y2: y(p), class: 'grid' }, g);
      const t = el('text', { x: -10, y: y(p) + 4, 'text-anchor': 'end', class: 'tick' }, g);
      t.textContent = p + '%';
    });
    // x ticks
    [0.001, 0.01, 0.1, 1, 10, 100].forEach(d => {
      el('line', { x1: x(d), x2: x(d), y1: PH, y2: PH + 6, stroke: '#86C79B' }, g);
      const t = el('text', { x: x(d), y: PH + 22, 'text-anchor': 'middle', class: 'tick' }, g);
      t.textContent = d;
    });
    const xt = el('text', { x: PW / 2, y: PH + 44, 'text-anchor': 'middle', class: 'axis-title' }, g);
    xt.textContent = 'Grain size (mm, log scale)';

    // D-lines
    [['D10', result.d10, 10], ['D50', result.d50, 50], ['D60', result.d60, 60]].forEach(([label, d, p], i) => {
      if (!d) return;
      el('line', { x1: x(d), x2: x(d), y1: PH, y2: y(p), class: 'dline' }, g);
      const t = el('text', { x: x(d) + 4, y: y(p) - 6 - (i === 2 ? 10 : 0), class: 'dlabel' }, g);
      t.textContent = label;
    });

    // uncertainty band (10th-90th percentile from the model), if the result has one
    if (result.band && result.band.lo && result.band.hi) {
      const up = result.curve.map(([d], i) => `${x(d).toFixed(1)} ${y(result.band.hi[i]).toFixed(1)}`);
      const down = result.curve.map(([d], i) => `${x(d).toFixed(1)} ${y(result.band.lo[i]).toFixed(1)}`).reverse();
      el('path', { d: 'M' + up.join(' L') + ' L' + down.join(' L') + ' Z', class: 'ci-band' }, g);
    }

    // curve
    const pts = result.curve;
    const dpath = pts.map(([d, p], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
    const path = el('path', { d: dpath, class: 'curve' }, g);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const len = Math.ceil(path.getTotalLength()) + 2;
      path.style.strokeDasharray = len; path.style.strokeDashoffset = len;
      path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 700, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' });
    }

    const wrap = document.createElement('div');
    wrap.className = 'chart-wrap';
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.setAttribute('aria-hidden', 'true');

    pts.forEach(([d, p]) => {
      const label = `${fmt(d)} mm: ${p}% passing`;
      const attrs = interactive
        ? { class: 'pt', tabindex: '0', role: 'img', 'aria-label': label }
        : { class: 'pt', 'aria-hidden': 'true' };
      const pt = el('g', attrs, g);
      el('circle', { cx: x(d), cy: y(p), r: 5, class: 'dot' }, pt);
      el('circle', { cx: x(d), cy: y(p), r: 14, class: 'hit' }, pt); // bigger hit area
      const show = () => {
        tip.textContent = label;
        tip.style.left = ((M.l + x(d)) / W * 100) + '%';
        tip.style.top = ((M.t + y(p)) / H * 100) + '%';
        tip.classList.add('show');
      };
      const hide = () => tip.classList.remove('show');
      if (interactive) {
        pt.addEventListener('mouseenter', show); pt.addEventListener('focus', show);
        pt.addEventListener('mouseleave', hide); pt.addEventListener('blur', hide);
      }
    });

    wrap.appendChild(svg); wrap.appendChild(tip);
    container.appendChild(wrap);
  }

  window.GrainChart = { render, fmt };
})();

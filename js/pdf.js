// PDF vectorial: un contexto que imita la parte de la API de Canvas 2D que usa el dibujado (trayectos, arcos, recortes,
// texto y degradados) y escribe operadores PDF. Así se reutiliza exactamente el mismo código de dibujado que la pantalla.
// Coordenadas del contexto: puntos con el eje Y hacia abajo (como un canvas); al escribir se invierte con la altura de página.

const mctx = document.createElement('canvas').getContext('2d');
const n4 = v => (Math.abs(v) < 1e-9 ? '0' : String(+v.toFixed(4)));
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// Colores CSS sencillos → [r, g, b, a] (0..1)
function parseColor(c) {
  if (typeof c !== 'string') return [0, 0, 0, 1];
  let m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).concat(1);
  m = c.match(/^#([0-9a-f]{3})$/i);
  if (m) return [...m[1]].map(h => parseInt(h + h, 16) / 255).concat(1);
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) { const p = m[1].split(',').map(parseFloat); return [p[0] / 255, p[1] / 255, p[2] / 255, p[3] ?? 1]; }
  return c === 'white' ? [1, 1, 1, 1] : [0, 0, 0, 1];
}
// Mezcla con el blanco del papel para simular la transparencia
const flat = ([r, g, b, a], alpha) => { const k = a * alpha; return [r * k + 1 - k, g * k + 1 - k, b * k + 1 - k]; };

// Fuentes estándar de PDF (no se incrustan)
const BASE14 = {
  helv: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  times: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  cour: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
};
function pdfFont(css) {
  const bold = /\bbold\b/.test(css), italic = /\bitalic\b/.test(css), fam = (css.match(/px\s+(.*)$/) || [, ''])[1].toLowerCase();
  const set = /times|georgia/.test(fam) ? BASE14.times : /courier|consolas|mono/.test(fam) ? BASE14.cour : BASE14.helv;
  return set[(bold ? 1 : 0) + (italic ? 2 : 0)];
}
// WinAnsiEncoding: los caracteres latinos (á, ñ, °, ±, Ø…) coinciden con Latin-1
const WIN = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99, '⁄': 0x2f, ' ': 0x20 };
function pdfString(s) {
  let out = '(';
  for (const ch of String(s)) {
    let c = WIN[ch] ?? ch.charCodeAt(0);
    if (c > 255) c = 0x3f;
    if (c === 0x28 || c === 0x29 || c === 0x5c) out += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) out += '\\' + c.toString(8).padStart(3, '0');
    else out += String.fromCharCode(c);
  }
  return out + ')';
}

class Gradient {
  constructor(kind, a) { this.kind = kind; this.a = a; this.stops = []; }
  addColorStop(t, c) { this.stops.push([t, parseColor(c)]); this.stops.sort((x, y) => x[0] - y[0]); }
  at(t) {
    const s = this.stops;
    if (!s.length) return [0, 0, 0, 1];
    if (t <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) if (t <= s[i][0]) { const [t0, c0] = s[i - 1], [t1, c1] = s[i], k = (t - t0) / ((t1 - t0) || 1); return c0.map((v, j) => v + (c1[j] - v) * k); }
    return s[s.length - 1][1];
  }
}

export class PdfContext {
  constructor(H) {
    this.H = H; this.ops = []; this.fonts = new Set(); this.path = []; this.cur = null;
    this.st = { m: [1, 0, 0, 1, 0, 0], strokeStyle: '#000000', fillStyle: '#000000', lineWidth: 1, lineCap: 'butt', dash: [], globalAlpha: 1, font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic' };
    this.stack = [];
    for (const k of ['strokeStyle', 'fillStyle', 'lineWidth', 'lineCap', 'globalAlpha', 'font', 'textAlign', 'textBaseline']) {
      Object.defineProperty(this, k, { get: () => this.st[k], set: v => { this.st[k] = v; } });
    }
    this.lineJoin = 'miter'; this.shadowColor = ''; this.shadowBlur = 0; this.shadowOffsetX = 0; this.shadowOffsetY = 0;
  }
  // ---- estado y transformaciones ----
  save() { this.stack.push({ ...this.st, dash: [...this.st.dash] }); this.ops.push('q'); }
  restore() { if (!this.stack.length) return; this.st = this.stack.pop(); this.ops.push('Q'); }
  setTransform(a, b, c, d, e, f) { this.st.m = [a, b, c, d, e, f]; }
  transform(a, b, c, d, e, f) { this.st.m = mul(this.st.m, [a, b, c, d, e, f]); }
  translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); this.transform(c, s, -s, c, 0, 0); }
  scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
  setLineDash(d) { this.st.dash = [...d]; }
  getLineDash() { return [...this.st.dash]; }
  measureText(s) { mctx.font = this.st.font; return mctx.measureText(s); }
  createLinearGradient(x0, y0, x1, y1) { return new Gradient('linear', { x0, y0, x1, y1, m: [...this.st.m] }); }
  createRadialGradient(x0, y0, r0, x1, y1, r1) { return new Gradient('radial', { x: x1, y: y1, r: r1, m: [...this.st.m] }); }
  // ---- trayectos (se guardan ya transformados, en coordenadas de página) ----
  dev(x, y) { const [X, Y] = ap(this.st.m, x, y); return [X, this.H - Y]; }
  beginPath() { this.path = []; this.cur = null; }
  moveTo(x, y) { const p = this.dev(x, y); this.path.push(`${n4(p[0])} ${n4(p[1])} m`); this.cur = p; this.start = p; }
  lineTo(x, y) { if (!this.cur) return this.moveTo(x, y); const p = this.dev(x, y); this.path.push(`${n4(p[0])} ${n4(p[1])} l`); this.cur = p; }
  closePath() { if (this.cur) { this.path.push('h'); this.cur = this.start; } }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  // Arco elíptico general como curvas de Bézier (trozos de 90° como máximo)
  ellipse(x, y, rx, ry, rot, a0, a1, ccw = false) {
    let sw = a1 - a0;
    if (!ccw && sw < 0) sw = sw % (2 * Math.PI) + 2 * Math.PI;
    if (ccw && sw > 0) sw = sw % (2 * Math.PI) - 2 * Math.PI;
    if (Math.abs(a1 - a0) >= 2 * Math.PI - 1e-9) sw = ccw ? -2 * Math.PI : 2 * Math.PI;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const P = t => { const ex = rx * Math.cos(t), ey = ry * Math.sin(t); return [x + ex * cr - ey * sr, y + ex * sr + ey * cr]; };
    const D = t => { const ex = -rx * Math.sin(t), ey = ry * Math.cos(t); return [ex * cr - ey * sr, ex * sr + ey * cr]; };
    const p0 = P(a0);
    if (this.cur) this.lineTo(p0[0], p0[1]); else this.moveTo(p0[0], p0[1]);
    const n = Math.max(1, Math.ceil(Math.abs(sw) / (Math.PI / 2))), h = sw / n, k = 4 / 3 * Math.tan(h / 4);
    for (let i = 0; i < n; i++) {
      const t0 = a0 + i * h, t1 = t0 + h, q0 = P(t0), q1 = P(t1), d0 = D(t0), d1 = D(t1);
      const c1 = this.dev(q0[0] + k * d0[0], q0[1] + k * d0[1]), c2 = this.dev(q1[0] - k * d1[0], q1[1] - k * d1[1]), e = this.dev(q1[0], q1[1]);
      this.path.push(`${n4(c1[0])} ${n4(c1[1])} ${n4(c2[0])} ${n4(c2[1])} ${n4(e[0])} ${n4(e[1])} c`);
      this.cur = e;
    }
  }
  arc(x, y, r, a0, a1, ccw = false) { this.ellipse(x, y, r, r, 0, a0, a1, ccw); }
  // ---- pintado ----
  scaleOf() { const m = this.st.m; return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])); }
  strokeColor() { const c = flat(parseColor(this.st.strokeStyle instanceof Gradient ? '#808080' : this.st.strokeStyle), this.st.globalAlpha); return `${c.map(n4).join(' ')} RG`; }
  stroke() {
    if (!this.path.length) return;
    const k = this.scaleOf(), dash = this.st.dash.length ? `[${this.st.dash.map(d => n4(Math.max(d * k, 0.01))).join(' ')}] 0 d` : '[] 0 d';
    this.ops.push(this.strokeColor(), `${n4(Math.max(this.st.lineWidth * k, 0.05))} w`, `${this.st.lineCap === 'round' ? 1 : this.st.lineCap === 'square' ? 2 : 0} J 1 j`, dash, ...this.path, 'S');
  }
  fill(rule) {
    if (!this.path.length) return;
    const eo = rule === 'evenodd' ? '*' : '';
    if (this.st.fillStyle instanceof Gradient) { this.ops.push('q', ...this.path, `W${eo} n`); this.gradient(this.st.fillStyle); this.ops.push('Q'); return; }
    const c = flat(parseColor(this.st.fillStyle), this.st.globalAlpha);
    this.ops.push(`${c.map(n4).join(' ')} rg`, ...this.path, `f${eo}`);
  }
  clip(rule) { if (this.path.length) this.ops.push(...this.path, `W${rule === 'evenodd' ? '*' : ''} n`); }
  fillRect(x, y, w, h) { const saved = [this.path, this.cur]; this.beginPath(); this.rect(x, y, w, h); this.fill(); [this.path, this.cur] = saved; }
  strokeRect(x, y, w, h) { const saved = [this.path, this.cur]; this.beginPath(); this.rect(x, y, w, h); this.stroke(); [this.path, this.cur] = saved; }
  clearRect() {}
  // Degradado aproximado con bandas (lineal) o círculos concéntricos (radial), dentro del recorte actual
  gradient(g) {
    const N = 64, a = g.a, m = this.st.m, saved = [this.path, this.cur, this.st.m];
    this.st.m = a.m;
    const band = (col, draw) => { const c = flat(col, this.st.globalAlpha); this.path = []; this.cur = null; draw(); this.ops.push(`${c.map(n4).join(' ')} rg`, ...this.path, 'f'); };
    if (g.kind === 'linear') {
      const dx = a.x1 - a.x0, dy = a.y1 - a.y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, px = -uy * L * 20, py = ux * L * 20;
      const quad = (t0, t1) => () => {
        const x0 = a.x0 + dx * t0, y0 = a.y0 + dy * t0, x1 = a.x0 + dx * t1, y1 = a.y0 + dy * t1;
        this.moveTo(x0 - px, y0 - py); this.lineTo(x1 - px, y1 - py); this.lineTo(x1 + px, y1 + py); this.lineTo(x0 + px, y0 + py); this.closePath();
      };
      band(g.at(0), quad(-20, 0)); band(g.at(1), quad(1, 21));
      for (let i = 0; i < N; i++) band(g.at((i + 0.5) / N), quad(i / N, (i + 1) / N + 0.002));
    } else {
      band(g.at(1), () => this.rect(a.x - a.r * 20, a.y - a.r * 20, a.r * 40, a.r * 40));
      for (let i = N; i >= 1; i--) band(g.at((i - 0.5) / N), () => this.arc(a.x, a.y, a.r * i / N, 0, 2 * Math.PI));
    }
    [this.path, this.cur, this.st.m] = saved;
    void m;
  }
  fillText(str, x, y) {
    if (!str) return;
    const font = this.st.font, size = parseFloat((font.match(/([\d.]+)px/) || [, 10])[1]), name = pdfFont(font);
    this.fonts.add(name);
    if (this.st.textAlign === 'center' || this.st.textAlign === 'right') { const w = this.measureText(str).width; x -= this.st.textAlign === 'center' ? w / 2 : w; }
    const [a, b, c, d, e, f] = this.st.m;
    const col = flat(parseColor(this.st.fillStyle instanceof Gradient ? '#000000' : this.st.fillStyle), this.st.globalAlpha);
    const tm = [a, -b, -c, d, a * x + c * y + e, this.H - (b * x + d * y + f)].map(n4).join(' ');
    this.ops.push(`${col.map(n4).join(' ')} rg`, `BT /F${[...this.fonts].indexOf(name) + 1} ${n4(size)} Tf ${tm} Tm ${pdfString(str)} Tj ET`);
  }
}

const enc = new TextEncoder();
async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('deflate'), w = cs.writable.getWriter();
  w.write(bytes); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

// pages: [{w, h (puntos), ctx: PdfContext}] → Blob del PDF
export async function buildPdf(pages, title = 'TrazoCAD') {
  const fontNames = [...new Set(pages.flatMap(p => [...p.ctx.fonts]))];
  const objs = []; // contenido de cada objeto (Uint8Array)
  const add = parts => { objs.push(parts); return objs.length; };
  const catalog = add(null), pagesObj = add(null);
  const fontObj = fontNames.map(n => add(enc.encode(`<< /Type /Font /Subtype /Type1 /BaseFont /${n} /Encoding /WinAnsiEncoding >>`)));
  const kids = [];
  for (const p of pages) {
    // Los índices de fuente de cada página se renumeran a la lista global
    const local = [...p.ctx.fonts], remap = s => s.replace(/\/F(\d+) /g, (m, i) => `/G${fontNames.indexOf(local[+i - 1]) + 1} `);
    const raw = enc.encode(p.ctx.ops.map(remap).join('\n'));
    const z = await deflate(raw), data = z || raw;
    const head = enc.encode(`<< /Length ${data.length}${z ? ' /Filter /FlateDecode' : ''} >>\nstream\n`), tail = enc.encode('\nendstream');
    const content = add(concat([head, data, tail]));
    const fontRes = fontNames.map((n, i) => `/G${i + 1} ${fontObj[i]} 0 R`).join(' ');
    kids.push(add(enc.encode(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n4(p.w)} ${n4(p.h)}] /Resources << /Font << ${fontRes} >> >> /Contents ${content} 0 R >>`)));
  }
  objs[catalog - 1] = enc.encode(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  objs[pagesObj - 1] = enc.encode(`<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const info = add(enc.encode(`<< /Title ${pdfString(title)} /Producer (TrazoCAD) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}) >>`));
  const chunks = [enc.encode('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')], offsets = [];
  let pos = chunks[0].length;
  objs.forEach((body, i) => {
    offsets.push(pos);
    const c = concat([enc.encode(`${i + 1} 0 obj\n`), body, enc.encode('\nendobj\n')]);
    chunks.push(c); pos += c.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  chunks.push(enc.encode(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return new Blob(chunks, { type: 'application/pdf' });
}
function concat(arrs) {
  const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

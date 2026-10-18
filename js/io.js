// Archivos: nuevo, abrir, guardar (.tcad), exportar DXF/SVG/PNG, imprimir y autoguardado.
import * as G from './geom.js';
import { dimParts, ellPts, TXT_K, FONT, plPieces, blockEnts, bbPts } from './entities.js';
import { writeDXF, readDXF } from './dxf.js';
import { hatchSegments } from './patterns.js';
import { makeRV, setWorld, vpModelRect } from './render.js';

const AUTOSAVE_KEY = 'trazocad.autosave';
const fsAccess = 'showSaveFilePicker' in window;

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const baseName = n => n.replace(/\.[^.]+$/, '');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const printColor = c => (c.toLowerCase() === '#ffffff' ? '#000000' : c);
const n5 = v => +(+v).toFixed(5);

export class IO {
  constructor(app) {
    this.app = app;
    this.handle = null;
    let t = null;
    app.doc.on(kind => {
      if (kind === 'reset') return;
      clearTimeout(t); t = setTimeout(() => this.autosave(), 800);
    });
  }

  autosave() {
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.app.doc.toJSON())); } catch { /* cuota llena o sin almacenamiento */ }
  }
  restore() {
    try {
      const s = localStorage.getItem(AUTOSAVE_KEY);
      if (!s) return false;
      const o = JSON.parse(s);
      if (!(o.model || o.ents)?.length && !o.layouts?.length) return false;
      this.app.doc.fromJSON(o);
      this.app.doc.dirty = true;
      return true;
    } catch { return false; }
  }

  async confirmDiscard() {
    const d = this.app.doc;
    if (!d.dirty || (!d.model.length && !d.layouts.length)) return true;
    return this.app.ui.confirm('El dibujo tiene cambios sin guardar. ¿Desea descartarlos?', 'Descartar');
  }

  async newDoc() {
    if (!(await this.confirmDiscard())) return;
    this.app.doc.reset();
    this.handle = null;
    this.app.afterLoad();
    this.app.print('Nuevo dibujo creado.');
  }

  async open() {
    if (!(await this.confirmDiscard())) return;
    let file, handle = null;
    if ('showOpenFilePicker' in window) {
      try {
        [handle] = await window.showOpenFilePicker({ types: [{ description: 'Dibujos', accept: { 'application/octet-stream': ['.tcad', '.dxf', '.json'] } }] });
        file = await handle.getFile();
      } catch { return; }
    } else {
      file = await new Promise(res => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.tcad,.dxf,.json';
        inp.onchange = () => res(inp.files[0]);
        inp.click();
      });
      if (!file) return;
    }
    await this.loadFile(file, handle);
  }

  async loadFile(file, handle = null) {
    const text = await file.text(), doc = this.app.doc;
    try {
      if (/\.dxf$/i.test(file.name)) {
        const r = readDXF(text);
        doc.reset();
        doc.layers = r.layers;
        doc.blocks = r.blocks;
        for (const s of r.textStyles) if (!doc.textStyles.some(t => t.name === s.name)) doc.textStyles.push(s);
        for (const e of r.ents) doc.add(e);
        doc.undoS = []; doc.redoS = [];
        doc.name = baseName(file.name);
        this.handle = null;
        this.app.print(`DXF importado: ${r.ents.length} objetos, ${r.layers.length} capas, ${Object.keys(r.blocks).length} bloques${r.skipped ? `, ${r.skipped} entidades no compatibles omitidas` : ''}.`);
      } else {
        const o = JSON.parse(text);
        if (o.app !== 'TrazoCAD') throw new Error('Formato no reconocido');
        doc.fromJSON(o);
        doc.name = baseName(file.name);
        this.handle = handle;
        this.app.print(`Dibujo abierto: ${file.name} (${doc.model.length} objetos, ${doc.layouts.length} presentaciones).`);
      }
      doc.dirty = false;
      this.app.afterLoad();
    } catch (err) {
      console.error(err);
      this.app.print(`Error al abrir el archivo: ${err.message}`, 'err');
    }
  }

  async writeFile(content, name, mime, ext, desc, useHandle) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    if (fsAccess) {
      try {
        let h = useHandle ? this.handle : null;
        if (!h) h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: desc, accept: { [mime]: [ext] } }] });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        return h;
      } catch (err) {
        if (err.name === 'AbortError') return null;
      }
    }
    download(blob, name);
    return 'download';
  }

  async save(as) {
    const doc = this.app.doc;
    const h = await this.writeFile(JSON.stringify(doc.toJSON()), `${doc.name}.tcad`, 'application/json', '.tcad', 'Dibujo TrazoCAD', !as);
    if (!h) return;
    if (h !== 'download') { this.handle = h; doc.name = baseName(h.name); }
    doc.dirty = false;
    this.app.ui.updateTitle();
    this.app.print(`Dibujo guardado: ${doc.name}.tcad`);
  }

  async exportDXF(version = '2000') {
    const doc = this.app.doc;
    const h = await this.writeFile(writeDXF(doc, version), `${doc.name}.dxf`, 'application/dxf', '.dxf', 'DXF', false);
    if (h) this.app.print(`Exportado a DXF ${version === 'R12' ? 'R12' : '2000'}: ${doc.name}.dxf (espacio modelo y bloques).`);
  }

  // ---------- SVG ----------
  // lwScale: unidades de dibujo por mm de grosor (null = trazo fino independiente del zoom)
  svgEnts(ents, lwScale, out, clipId) {
    const doc = this.app.doc;
    const stroke = e => {
      const st = doc.style(e), col = printColor(st.color);
      const dash = st.pat.length ? ` stroke-dasharray="${st.pat.map(v => n5(Math.abs(v) * doc.settings.ltscale) || 0.2).join(' ')}"` : '';
      const w = lwScale ? `stroke-width="${n5(Math.max(0.13, st.lw) * lwScale)}"` : `stroke-width="${n5(Math.max(0.25, st.lw) * 3.78 / 3)}" vector-effect="non-scaling-stroke"`;
      return `stroke="${col}" ${w} fill="none" stroke-linecap="round" stroke-linejoin="round"${dash}`;
    };
    const textEl = (t, col) => {
      const st = doc.textStyle(t.style), anchor = t.align === 'c' ? 'middle' : t.align === 'r' ? 'end' : 'start';
      const extra = `${st.width && st.width !== 1 ? ` scale(${st.width} 1)` : ''}${st.oblique ? ` skewX(${-st.oblique})` : ''}`;
      return `<text transform="translate(${n5(t.p.x)} ${n5(t.p.y)}) scale(1 -1) rotate(${n5(-G.deg(t.rot || 0))})${extra}" font-family="${esc(st.font)}, ${FONT}" font-size="${n5(t.h * TXT_K)}" text-anchor="${anchor}" fill="${col}">${esc(t.text ?? t.str)}</text>`;
    };
    const plD = e => {
      let d = `M${n5(e.pts[0].x)} ${n5(e.pts[0].y)}`;
      for (const pc of plPieces(e)) {
        if (!pc.bulge) d += ` L${n5(pc.b.x)} ${n5(pc.b.y)}`;
        else { const sw = Math.abs(4 * Math.atan(pc.bulge)); d += ` A${n5(pc.prim.r)} ${n5(pc.prim.r)} 0 ${sw > Math.PI ? 1 : 0} ${pc.bulge > 0 ? 1 : 0} ${n5(pc.b.x)} ${n5(pc.b.y)}`; }
      }
      return d + (e.closed ? ' Z' : '');
    };
    const pts = l => l.map(p => `${n5(p.x)},${n5(p.y)}`).join(' ');
    for (const e of ents) {
      if (!doc.visible(e)) continue;
      const s = stroke(e), col = printColor(doc.style(e).color);
      switch (e.type) {
        case 'line': out.push(`<line x1="${n5(e.p1.x)}" y1="${n5(e.p1.y)}" x2="${n5(e.p2.x)}" y2="${n5(e.p2.y)}" ${s}/>`); break;
        case 'circle': out.push(`<circle cx="${n5(e.c.x)}" cy="${n5(e.c.y)}" r="${n5(e.r)}" ${s}/>`); break;
        case 'arc': { const a = G.polar(e.c, e.a1, e.r), b = G.polar(e.c, e.a2, e.r); out.push(`<path d="M${n5(a.x)} ${n5(a.y)} A${n5(e.r)} ${n5(e.r)} 0 ${G.sweep(e.a1, e.a2) > Math.PI ? 1 : 0} 1 ${n5(b.x)} ${n5(b.y)}" ${s}/>`); break; }
        case 'pline': out.push(`<path d="${plD(e)}" ${s}/>`); break;
        case 'ellipse': out.push(`<polygon points="${pts(ellPts(e, 96))}" ${s}/>`); break;
        case 'point': out.push(`<circle cx="${n5(e.p.x)}" cy="${n5(e.p.y)}" r="${n5(lwScale ? 0.3 : 0.5)}" fill="${col}"/>`); break;
        case 'text': out.push(textEl(e, col)); break;
        case 'hatch': {
          if (e.pattern === 'SOLID') { out.push(`<path d="${e.loops.map(l => `M${pts(l).replace(/ /g, ' L')} Z`).join(' ')}" fill="${col}" fill-rule="evenodd"/>`); break; }
          const segs = hatchSegments(e, bbPts(e.loops.flat()));
          out.push(`<path d="${segs.map(([a, b]) => `M${n5(a.x)} ${n5(a.y)}L${n5(b.x)} ${n5(b.y)}`).join('')}" ${s}/>`);
          break;
        }
        case 'insert': out.push('<g>'); this.svgEnts(blockEnts(e), lwScale, out); out.push('</g>'); break;
        case 'dim': {
          const d = dimParts(e);
          out.push(`<path d="${d.lines.map(([a, b]) => `M${n5(a.x)} ${n5(a.y)}L${n5(b.x)} ${n5(b.y)}`).join('')}" ${s}/>`);
          for (const tri of d.arrows) out.push(`<polygon points="${pts(tri)}" fill="${col}"/>`);
          for (const [c, r] of d.dots) out.push(`<circle cx="${n5(c.x)}" cy="${n5(c.y)}" r="${n5(r)}" fill="${col}"/>`);
          out.push(textEl(d.text, col));
          break;
        }
        case 'vport': {
          const id = `vp${e.id}`, m = vpModelRect(e), sc = e.s, vcx = (e.p1.x + e.p2.x) / 2, vcy = (e.p1.y + e.p2.y) / 2;
          out.push(`<clipPath id="${id}"><rect x="${n5(e.p1.x)}" y="${n5(e.p1.y)}" width="${n5(e.p2.x - e.p1.x)}" height="${n5(e.p2.y - e.p1.y)}"/></clipPath>`);
          out.push(`<g clip-path="url(#${id})"><g transform="matrix(${n5(sc)} 0 0 ${n5(sc)} ${n5(vcx - sc * e.cx)} ${n5(vcy - sc * e.cy)})">`);
          const doc2 = this.app.doc;
          this.svgEnts(this.app.spatial.of(doc2.model, doc2.ver).query(m, true), lwScale / sc, out);
          out.push('</g></g>');
          out.push(`<rect x="${n5(e.p1.x)}" y="${n5(e.p1.y)}" width="${n5(e.p2.x - e.p1.x)}" height="${n5(e.p2.y - e.p1.y)}" ${s}/>`);
          break;
        }
      }
    }
    return out;
  }

  buildSVG() {
    const app = this.app, doc = app.doc, lay = app.layoutShown();
    let x1, y1, w, h, body, size;
    if (lay) {
      x1 = 0; y1 = 0; w = lay.w; h = lay.h;
      body = this.svgEnts(lay.ents, 1, []);
      size = `width="${n5(w)}mm" height="${n5(h)}mm"`;
    } else {
      const b = doc.extents(doc.model.filter(e => doc.visible(e)));
      if (!b) return null;
      const pad = Math.max(b.x2 - b.x1, b.y2 - b.y1) * 0.03 || 5;
      x1 = b.x1 - pad; y1 = b.y1 - pad; w = b.x2 - b.x1 + 2 * pad; h = b.y2 - b.y1 + 2 * pad;
      body = this.svgEnts(doc.model, null, []);
      size = `width="${n5(w)}mm" height="${n5(h)}mm"`;
    }
    return { size: [w, h], paper: !!lay, svg: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n5(x1)} ${n5(-y1 - h)} ${n5(w)} ${n5(h)}" ${size}>
<rect x="${n5(x1)}" y="${n5(-y1 - h)}" width="${n5(w)}" height="${n5(h)}" fill="#ffffff"/>
<g transform="scale(1 -1)">
${body.join('\n')}
</g>
</svg>` };
  }

  async exportSVG() {
    const r = this.buildSVG();
    if (!r) return this.app.print('El dibujo está vacío.');
    const h = await this.writeFile(r.svg, `${this.app.doc.name}${r.paper ? '-' + this.app.layoutShown().name : ''}.svg`, 'image/svg+xml', '.svg', 'Imagen SVG', false);
    if (h) this.app.print(r.paper ? `Presentación exportada a SVG (${n5(r.size[0])}×${n5(r.size[1])} mm, escala real).` : 'Exportado a SVG.');
  }

  async exportPNG() {
    const app = this.app, doc = app.doc, lay = app.layoutShown();
    let W, H, R, sty;
    if (lay) {
      const ppm = 8; // píxeles por mm (~200 ppp)
      W = Math.round(lay.w * ppm); H = Math.round(lay.h * ppm);
      R = makeRV(lay.w / 2, lay.h / 2, ppm, W, H, 1);
      sty = e => { const st = doc.style(e); return { color: printColor(st.color), px: Math.max(1, st.lw * ppm), pat: st.pat, ltscale: doc.settings.ltscale }; };
    } else {
      const b = doc.extents(doc.model.filter(e => doc.visible(e)));
      if (!b) return app.print('El dibujo está vacío.');
      const bw = b.x2 - b.x1 || 1, bh = b.y2 - b.y1 || 1;
      W = 2400; H = Math.max(200, Math.min(4800, Math.round(W * bh / bw)));
      R = makeRV((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, Math.min(W / bw, H / bh) * 0.94, W, H, 1);
      sty = e => { const st = doc.style(e); return { color: printColor(st.color), px: Math.max(1.5, st.lw * 8), pat: st.pat, ltscale: doc.settings.ltscale }; };
    }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
    if (lay) app.renderer.drawLayout(c, R, lay, sty, true);
    else { setWorld(c, R); app.renderer.paintList(c, R, doc.model, sty); }
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    const h = await this.writeFile(blob, `${doc.name}${lay ? '-' + lay.name : ''}.png`, 'image/png', '.png', 'Imagen PNG', false);
    if (h) app.print(`Exportado a PNG (${W}×${H}).`);
  }

  async print() {
    const r = this.buildSVG();
    if (!r) return this.app.print('El dibujo está vacío.');
    const [w, h] = r.size;
    const page = r.paper ? `@page{size:${n5(w)}mm ${n5(h)}mm;margin:0}svg{width:${n5(w)}mm;height:${n5(h)}mm}` : '@page{margin:10mm}svg{width:100%;height:100%;max-height:100vh}';
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(fr);
    const d = fr.contentDocument;
    d.open();
    d.write(`<!doctype html><html><head><title>${esc(this.app.doc.name)}</title><style>html,body{margin:0}${page}</style></head><body>${r.svg.replace(/^<\?xml[^>]*>/, '').replace(/width="[^"]*mm" height="[^"]*mm"/, '')}</body></html>`);
    d.close();
    if (r.paper) this.app.print(`Imprimiendo la presentación a escala 1:1 en papel de ${n5(w)}×${n5(h)} mm.`);
    setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 1500); }, 250);
  }
}


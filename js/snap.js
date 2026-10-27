// Ayudas de precisión: referencia a objetos (REFENT), rastreo, polar, orto y forzado a rejilla.
import * as G from './geom.js';
import { snapsOf, primsOf } from './entities.js';
import { ISO_AXES } from './render.js';
import { NO_ASSOC } from './assoc.js';
import { ucsOf, toUcs, fromUcs } from './ucs.js';

export const OSNAP_MODES = {
  end: 'Punto final', mid: 'Punto medio', cen: 'Centro', qua: 'Cuadrante', int: 'Intersección',
  per: 'Perpendicular', nea: 'Cercano', nod: 'Punto', ins: 'Inserción',
};
const APERTURE = 12;   // px
const TRACK_TOL = 7;   // px
const POLAR_TOL = 9;   // px

export class Snapper {
  constructor(app) { this.app = app; }

  osnap(w, base) {
    const app = this.app, doc = app.doc, modes = app.osnapModes, tol = APERTURE / app.view.scale;
    const near = app.idx().query({ x1: w.x - tol, y1: w.y - tol, x2: w.x + tol, y2: w.y + tol }).filter(e => doc.visible(e));
    if (!near.length) return null;
    let best = null;
    // ref: entidad y punto de referencia (para las cotas asociativas)
    const consider = (pt, mode, bias = 0, ref = null) => {
      const d = G.dist(pt, w);
      if (d > tol) return;
      const score = d + bias * tol;
      if (!best || score < best.score) best = { pt, mode, score, ref };
    };
    for (const e of near) {
      const s = snapsOf(e), assoc = !NO_ASSOC.has(e.type);
      for (const k in s) if (modes[k]) s[k].forEach((p, i) => consider(p, k, k === 'mid' || k === 'qua' ? 0.05 : 0, assoc ? { id: e.id, snap: k, i } : null));
    }
    if (modes.int || modes.per || modes.nea) {
      const prs = [], own = [];
      for (const e of near) for (const q of primsOf(e)) if (G.bbNear(G.primBB(q), w, tol)) { prs.push(q); own.push(NO_ASSOC.has(e.type) ? null : e.id); }
      if (modes.int && prs.length < 400) {
        for (let i = 0; i < prs.length; i++)
          for (let j = i + 1; j < prs.length; j++) {
            const ref = own[i] != null && own[j] != null ? { ids: [own[i], own[j]], snap: 'int' } : null;
            for (const p of G.primInt(prs[i], prs[j])) consider(p, 'int', 0.02, ref);
          }
      }
      if (modes.per && base) {
        for (const q of prs) {
          if (q.k === 's') {
            const d = G.sub(q.b, q.a), l2 = G.dot(d, d);
            if (l2 < 1e-18) continue;
            const t = G.dot(G.sub(base, q.a), d) / l2;
            if (t >= -1e-9 && t <= 1 + 1e-9) consider(G.add(q.a, G.mul(d, t)), 'per', 0.1);
          } else if (G.dist(base, q.c) > 1e-12) {
            const a = G.ang(q.c, base);
            for (const aa of [a, a + Math.PI]) if (G.angIn(aa, q.a1, q.a2)) consider(G.polar(q.c, aa, q.r), 'per', 0.1);
          }
        }
      }
      if (!best && modes.nea) {
        let bd = Infinity, bp = null;
        for (const q of prs) { const p = G.nearPrim(w, q), d = G.dist(p, w); if (d < bd) { bd = d; bp = p; } }
        if (bp && bd <= tol) best = { pt: bp, mode: 'nea' };
      }
    }
    return best ? { pt: best.pt, mode: best.mode, ref: best.ref || null } : null;
  }

  track(m) {
    const app = this.app, v = app.view;
    let vx = null, hy = null, bvx = TRACK_TOL, bhy = TRACK_TOL;
    for (const p of app.acquired) {
      const s = v.toScreen(p);
      const dx = Math.abs(s.x - m.sx), dy = Math.abs(s.y - m.sy);
      if (dx < bvx) { bvx = dx; vx = p; }
      if (dy < bhy) { bhy = dy; hy = p; }
    }
    if (!vx && !hy) return null;
    const lines = [];
    let pt = { ...m.w };
    if (vx) { pt.x = vx.x; lines.push({ from: vx, vertical: true }); }
    if (hy) { pt.y = hy.y; lines.push({ from: hy, vertical: false }); }
    return { pt, lines };
  }

  // Devuelve {pt, snap, track, polar}
  resolve(m, base, noSnap) {
    const app = this.app, T = app.T, S = app.doc.settings;
    let pt = m.w, snap = null, track = null, polar = null;
    if (T.osnap && !noSnap) snap = this.osnap(m.w, base);
    if (snap) { pt = snap.pt; app.considerAcquire(snap.pt); return { pt, snap, track, polar }; }
    app.considerAcquire(null);
    if (T.otrack && app.acquired.length && !noSnap) track = this.track(m);
    if (track) return { pt: track.pt, snap, track, polar };
    const iso = S.iso && app.tab === 'model', u = ucsOf(app.doc);
    if (T.snap && S.snapX > 0) {
      if (iso) { // retícula isométrica: p = i·a + j·b con a a 30° y b a 150°
        const s = S.snapX, a = G.P(Math.cos(Math.PI / 6) * s, 0.5 * s), b = G.P(-Math.cos(Math.PI / 6) * s, 0.5 * s);
        const det = a.x * b.y - a.y * b.x, i = Math.round((pt.x * b.y - pt.y * b.x) / det), j = Math.round((a.x * pt.y - a.y * pt.x) / det);
        pt = G.add(G.mul(a, i), G.mul(b, j));
      } else { const q = toUcs(u, pt); pt = fromUcs(u, G.P(Math.round(q.x / S.snapX) * S.snapX, Math.round(q.y / S.snapX) * S.snapX)); } // retícula del SCP
    }
    if (base) {
      if (T.ortho && iso) { // orto isométrico: los dos ejes del plano actual
        const v = G.sub(pt, base);
        let bestP = pt, bd = -1;
        for (const deg of ISO_AXES[S.isoPlane]) {
          const u = G.P(Math.cos(G.rad(deg)), Math.sin(G.rad(deg))), d = G.dot(v, u);
          if (Math.abs(d) > bd) { bd = Math.abs(d); bestP = G.add(base, G.mul(u, d)); }
        }
        pt = bestP;
      } else if (T.ortho) { // ejes del SCP
        const ux = G.P(Math.cos(u.ang), Math.sin(u.ang)), uy = G.perp(ux), v = G.sub(pt, base), dx = G.dot(v, ux), dy = G.dot(v, uy);
        pt = Math.abs(dx) >= Math.abs(dy) ? G.add(base, G.mul(ux, dx)) : G.add(base, G.mul(uy, dy));
      } else if (T.polar) { // ángulos polares medidos desde el eje X del SCP
        const inc = G.rad(S.polarInc || 90), a = G.ang(base, m.w) - u.ang;
        const k = Math.round(a / inc) * inc + u.ang, dir = G.P(Math.cos(k), Math.sin(k));
        const d = G.dot(G.sub(m.w, base), dir);
        const off = Math.abs(G.cross(dir, G.sub(m.w, base))) * app.view.scale;
        if (d > 0 && off < POLAR_TOL && d * app.view.scale > 8) {
          let dd = d;
          if (T.snap && S.snapX > 0) dd = Math.max(S.snapX, Math.round(d / S.snapX) * S.snapX);
          pt = G.add(base, G.mul(dir, dd));
          polar = { base, ang: k, d: dd };
        }
      }
    }
    return { pt, snap, track, polar };
  }
}

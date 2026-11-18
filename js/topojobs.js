// Puente topográfico: capturas de origen, worker cancelable y aplicación en una transacción.
import { jobControl, compute } from './geojobs.js';
import { metricFrame } from './geoframe.js';
import { fromReal } from './origin.js';
import { fromProjected } from './geographic.js';
import { transform, resolveCRS } from './projections.js';
import { plPolygon } from './entities.js';
import { wildcard, pointInGroup } from './survey.js';
import { rasterBounds } from './geotiff.js';
const pause = () => new Promise(r => setTimeout(r, 0));
const positive = (v, label) => {
  if (!(v > 0) || !Number.isFinite(v)) throw Error(label + ' debe ser positivo y finito.');
  return v;
};
const layerName = s => {
  if (typeof s !== 'string' || !s.trim() || ['__proto__', 'constructor', 'prototype'].includes(s))
    throw Error('Nombre de capa inválido.');
  return s.trim();
};
function apply(app, c, entities, layers, update, remove = []) {
  c.check();
  const d = c.doc;
  layers.forEach(layerName);
  d.begin();
  const checkpoint = d.savepoint();
  const quiet = d.quiet;
  d.quiet = true;
  let ids;
  try {
    for (const l of layers) if (!d.layers.some(q => q.name === l)) d.addLayer(l, '#77cbbd');
    d.removeMany(remove);
    ids = entities.map(e => d.add({ color: 'BYLAYER', ltype: 'BYLAYER', lw: 'BYLAYER', ...e }, d.model).id);
    update?.(ids);
  } catch (e) {
    d.rollback(checkpoint);
    throw e;
  } finally {
    d.quiet = quiet;
    d.changed();
    d.commit();
  }
  app.sel = new Set(ids);
  app.selChanged();
  app.renderer.flushTiles();
  return ids;
}
const pointsOf = e =>
  e.type === 'line'
    ? [
        { ...e.p1, z: e.z1 || 0 },
        { ...e.p2, z: e.z2 || 0 },
      ]
    : e.type === 'pline3d'
      ? e.pts
      : e.type === 'pline'
        ? plPolygon(e).map(p => ({ ...p, z: e.elev ?? 0 }))
        : null;
export async function surfaceMesh(doc, surface, options = {}, control) {
  const faces = surface.faceIds.map(id => doc.get(id)).filter(e => e?.type === 'face3d');
  if (!faces.length) throw Error('La superficie no conserva caras.');
  const frame = metricFrame(doc, faces, {
      metersPerUnit: surface.metersPerUnit,
      ...options,
    }),
    zScale = positive(surface.zMetersPerUnit || 1, 'Unidad vertical'),
    vertices = [],
    triangles = [];
  for (let k = 0; k < faces.length; k++) {
    const f = faces[k],
      i = vertices.length,
      ps = f.pts.slice(0, 4).map(p => ({ ...frame.forward(p), z: (p.z ?? 0) * zScale }));
    if (ps.some(p => ![p.x, p.y, p.z].every(Number.isFinite))) throw Error(`Cara ${f.id}: coordenadas inválidas.`);
    const tris = [[0, 1, 2]];
    if (ps[3] && Math.hypot(ps[3].x - ps[2].x, ps[3].y - ps[2].y, ps[3].z - ps[2].z) > 1e-12) tris.push([0, 2, 3]);
    for (const t of tris) {
      const [a, b, c] = t.map(j => ps[j]);
      if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-20)
        throw Error(`Cara ${f.id}: degenerada en XY; no define terreno 2,5D.`);
      triangles.push(t.map(j => i + j));
    }
    vertices.push(...ps);
    if (k % 512 === 0) {
      await pause();
      control?.check();
    }
  }
  return { mesh: { vertices, triangles }, frame, zScale };
}
export async function runTopoJob(app, options) {
  const c = jobControl(app, 'Topografía…', options),
    d = c.doc,
    { signal, onProgress, ...o } = options;
  const work = payload => compute(payload, c, new URL('./topoworker.js', import.meta.url));
  try {
    if (o.operation === 'points') {
      const rows = await work({
          operation: 'points',
          text: o.text,
          options: o,
        }),
        factor = positive(o.horizontalFactor ?? 1, 'Factor horizontal'),
        zf = positive(o.verticalFactor ?? 1, 'Factor vertical'),
        base = layerName(o.outputLayer || 'LEVANTAMIENTO'),
        entities = [],
        remove = [],
        seen = new Map(d.model.filter(e => e.topoPoint).map(e => [e.data?.numero, e]));
      if (!['error', 'skip', 'replace'].includes(o.duplicates || 'error'))
        throw Error('Política de duplicados inválida.');
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i],
          old = seen.get(r.number);
        if (old && (o.duplicates || 'error') === 'error') throw Error(`Ya existe el punto ${r.number}.`);
        if (old && o.duplicates === 'skip') continue;
        if (old) remove.push(old.id);
        let p = {
          x: (o.axes === 'ne' ? r.north : r.east) * factor,
          y: (o.axes === 'ne' ? r.east : r.north) * factor,
        };
        if (o.sourceCRS && resolveCRS(o.sourceCRS).axis === 'neu') p = { x: r.north * factor, y: r.east * factor };
        p = o.sourceCRS ? fromProjected(d, transform(p, o.sourceCRS, d.geo?.crs)) : fromReal(d, p);
        if (![p.x, p.y, r.z * zf].every(Number.isFinite)) throw Error('La conversión produjo coordenadas no finitas.');
        const key = d.topo.keys.find(k => wildcard(r.description, k.pattern)),
          style = {
            symbol: 'cross',
            label: 'PZD',
            size: positive(o.size ?? 1, 'Tamaño'),
            height: positive(o.height ?? 1.5, 'Altura'),
            ...key,
          };
        const layer = layerName(key?.layer || base);
        entities.push({
          type: 'point',
          p: { x: p.x, y: p.y },
          elev: r.z * zf,
          layer,
          data: {
            numero: r.number,
            descripcion: r.description,
            codigo: r.description.split(/\s+/)[0],
          },
          topoPoint: style,
        });
        if (i % 512 === 0) {
          await pause();
          c.check();
        }
      }
      const ids = apply(
        app,
        c,
        entities,
        [...new Set(entities.map(e => e.layer))],
        () => {
          d.topo.format = {
            format: o.format || 'PNEZD',
            delimiter: o.delimiter || ',',
            horizontalFactor: factor,
            verticalFactor: zf,
          };
        },
        remove
      );
      return { ids, points: ids.length };
    }
    if (o.operation === 'configure') {
      const groups = o.groups ?? d.topo.groups,
        keys = o.keys ?? d.topo.keys;
      if (!Array.isArray(groups) || !Array.isArray(keys)) throw Error('Grupos y claves deben ser listas.');
      if (
        new Set(groups.map(g => g.name)).size !== groups.length ||
        groups.some(g => typeof g.name !== 'string' || !g.name.trim())
      )
        throw Error('Los grupos necesitan nombres únicos y no vacíos.');
      for (const q of [...groups, ...keys]) {
        if (q.layer) layerName(q.layer);
        if (q.size != null) positive(q.size, 'Tamaño');
        if (q.height != null) positive(q.height, 'Altura');
        if (q.symbol && !['cross', 'circle', 'triangle', 'square'].includes(q.symbol)) throw Error('Símbolo inválido.');
      }
      c.check();
      d.begin();
      d.topo.groups = structuredClone(groups);
      d.topo.keys = structuredClone(keys);
      if (o.reapply) {
        for (const e of d.model.filter(e => e.topoPoint)) {
          const key = keys.find(k => wildcard(e.data?.descripcion || '', k.pattern));
          if (key) {
            if (key.layer && !d.layers.some(l => l.name === key.layer)) d.addLayer(key.layer);
            d.modify(e.id, q => {
              q.topoPoint = { ...q.topoPoint, ...key };
              if (key.layer) q.layer = key.layer;
            });
          }
        }
      }
      d.changed();
      d.commit();
      app.renderer.flushTiles();
      return { groups: groups.length, keys: keys.length };
    }
    if (o.operation === 'traverse') {
      const result = await work({ operation: 'traverse', options: o }),
        layer = layerName(o.outputLayer || 'POLIGONAL'),
        pts = result.points.map(p => ({ ...fromReal(d, p), z: p.z })),
        entities = [{ type: 'pline3d', pts, closed: false, layer }];
      pts.forEach((p, i) =>
        entities.push({
          type: 'point',
          p: { x: p.x, y: p.y },
          elev: p.z,
          layer,
          data: {
            numero: (o.prefix || 'T') + i,
            descripcion: 'Poligonal compensada',
          },
          topoPoint: { label: 'PZ' },
        })
      );
      const ids = apply(app, c, entities, [layer], ids =>
        d.topo.traverses.push({
          ...result,
          id: d.topo.nextId++,
          ids,
          name: o.name || layer,
        })
      );
      return { ...result, ids };
    }
    if (['tin', 'mdt'].includes(o.operation)) {
      const layer = layerName(o.outputLayer || 'SUPERFICIE'),
        zs = positive(o.zMetersPerUnit ?? 1, 'Metros por unidad de cota');
      let mesh,
        frame,
        sourceIds = [];
      if (o.operation === 'tin') {
        const group = o.group && d.topo.groups.find(g => g.name === o.group);
        if (o.group && !group) throw Error('Grupo inexistente.');
        const sources = d.model.filter(
          e =>
            e.type === 'point' &&
            (!o.ids || o.ids.includes(e.id)) &&
            (!o.inputLayer || e.layer === o.inputLayer) &&
            (!group || pointInGroup(e, group))
        );
        sourceIds = sources.map(e => e.id);
        frame = metricFrame(d, sources, o);
        const convert = p => ({ ...frame.forward(p), z: (p.z ?? 0) * zs });
        const paths = ids =>
          (ids || []).map(id => {
            const e = d.get(id),
              ps = e && pointsOf(e);
            if (!ps) throw Error('Use líneas o polilíneas como restricciones.');
            if (ids !== o.breaklineIds && !e.closed)
              throw Error('Los límites y exclusiones deben ser polilíneas cerradas.');
            return ps.map(convert);
          });
        mesh = await work({
          operation: 'tin',
          points: sources.map(e => convert({ ...e.p, z: e.elev ?? 0 })),
          options: {
            tolerance: o.tolerance,
            zTolerance: o.zTolerance,
            breaklines: paths(o.breaklineIds),
            boundaries: paths(o.boundaryIds),
            holes: paths(o.holeIds),
          },
        });
      } else {
        const e = d.get(o.id);
        if (!d.geo || !e?.gisRaster?.original) throw Error('Importe y georreferencie un MDT GeoTIFF.');
        mesh = await work({
          operation: 'mdt',
          original: e.gisRaster.original,
          crs: e.gisRaster.crs,
          options: o,
        });
        const b = rasterBounds(d, mesh.raster),
          tol = Math.max(b.w, b.h, 1) * 1e-7;
        if (
          Math.hypot(e.p.x - b.x1, e.p.y - b.y1) > tol ||
          Math.abs(e.w - b.w) > tol ||
          Math.abs(e.h - b.h) > tol ||
          Math.abs(e.rot || 0) > 1e-12 ||
          (e.clip && !e.clip.off)
        )
          throw Error('El MDT debe conservar su georreferenciación original.');
        for (let i = 0; i < mesh.vertices.length; i++) {
          const p = mesh.vertices[i];
          if (i % 512 === 0) {
            await pause();
            c.check();
          }
          const q = fromProjected(d, transform({ x: p.x, y: p.y }, mesh.crs, d.geo.crs));
          p.x = q.x;
          p.y = q.y;
        }
        frame = { inverse: p => p };
        sourceIds = [e.id];
      }
      const vertices = mesh.vertices.map(p => ({
          ...frame.inverse(p),
          z: o.operation === 'mdt' ? p.z : p.z / zs,
        })),
        surfaceId = o.surfaceId ?? d.topo.nextId,
        old = o.surfaceId && d.topo.surfaces.find(s => s.id === o.surfaceId);
      if (vertices.some(p => ![p.x, p.y, p.z].every(Number.isFinite)))
        throw Error('La superficie produjo coordenadas no finitas.');
      if (o.surfaceId && !old) throw Error('Superficie inexistente.');
      const entities = [];
      for (let i = 0; i < mesh.triangles.length; i++) {
        const t = mesh.triangles[i],
          ps = t.map(j => ({ ...vertices[j] }));
        entities.push({
          type: 'face3d',
          pts: [...ps, { ...ps[2] }],
          layer,
          topoSurface: surfaceId,
        });
        if (i % 512 === 0) {
          await pause();
          c.check();
        }
      }
      const ids = apply(
        app,
        c,
        entities,
        [layer],
        ids => {
          const s = {
            id: surfaceId,
            name: o.name || layer,
            faceIds: ids,
            sourceIds,
            zMetersPerUnit: zs,
            metersPerUnit: o.metersPerUnit,
            options: structuredClone(o),
          };
          if (old) d.topo.surfaces.splice(d.topo.surfaces.indexOf(old), 1, s);
          else {
            d.topo.surfaces.push(s);
            d.topo.nextId++;
          }
        },
        old?.faceIds
      );
      return { ids, surfaceId, duplicates: mesh.duplicates || 0 };
    }
    const surface = d.topo.surfaces.find(s => s.id === o.surfaceId);
    if (!surface) throw Error('Superficie inexistente.');
    const { mesh, frame, zScale } = await surfaceMesh(d, surface, o, c);
    if (o.operation === 'stats') {
      const result = await work({ operation: 'stats', mesh });
      c.check();
      return result;
    }
    if (o.operation === 'analysis') {
      if (!['elevation', 'slope'].includes(o.mode || 'elevation')) throw Error('Análisis desconocido.');
      const stats = await work({ operation: 'stats', mesh }),
        layer = layerName(o.outputLayer || 'ANALISIS_TIN'),
        low = o.min ?? (o.mode === 'slope' ? 0 : stats.min),
        high = o.max ?? (o.mode === 'slope' ? 45 : stats.max === stats.min ? stats.min + 1 : stats.max);
      if (![low, high].every(Number.isFinite) || high <= low) throw Error('El máximo debe superar al mínimo.');
      const entities = [];
      for (let i = 0; i < mesh.triangles.length; i++) {
        const t = mesh.triangles[i],
          ps = t.map(j => mesh.vertices[j]),
          a = ps[0],
          b = ps[1],
          q = ps[2],
          det = (b.x - a.x) * (q.y - a.y) - (q.x - a.x) * (b.y - a.y),
          gx = ((b.z - a.z) * (q.y - a.y) - (q.z - a.z) * (b.y - a.y)) / det,
          gy = ((b.x - a.x) * (q.z - a.z) - (q.x - a.x) * (b.z - a.z)) / det,
          value =
            o.mode === 'slope' ? (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI : ps.reduce((s, p) => s + p.z, 0) / 3,
          f = Math.max(0, Math.min(1, (value - low) / (high - low))),
          rgb = [Math.round(50 + 205 * f), Math.round(190 - 120 * f), Math.round(160 - 110 * f)],
          color = '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join(''),
          pts = ps.map(p => ({ ...frame.inverse(p), z: p.z / zScale }));
        entities.push({
          type: 'face3d',
          pts: [...pts, { ...pts[2] }],
          layer,
          color,
          topoAnalysis: true,
          data: {
            valor: value,
            unidad: o.mode === 'slope' ? 'grados' : 'm',
            superficie: surface.name,
          },
        });
        if (i % 512 === 0) {
          await pause();
          c.check();
        }
      }
      const ids = apply(app, c, entities, [layer]);
      return { ids, min: low, max: high, mode: o.mode || 'elevation' };
    }
    if (o.operation === 'sample') {
      const result = await work({
        operation: 'sample',
        mesh,
        point: frame.forward(o.point),
      });
      c.check();
      return result && { ...result, elevation: result.z / zScale };
    }
    if (o.operation === 'contours') {
      const curves = await work({
          operation: 'contours',
          mesh,
          options: {
            ...o,
            interval: o.interval * zScale,
            base: (o.base || 0) * zScale,
          },
        }),
        minor = layerName(o.outputLayer || 'CURVAS'),
        major = layerName(o.majorLayer || minor + '_MAYORES'),
        entities = [];
      for (let i = 0; i < curves.length; i++) {
        const curve = curves[i];
        if (i % 256 === 0) {
          await pause();
          c.check();
        }
        const pts = curve.pts.map(p => ({
            ...frame.inverse(p),
            z: p.z / zScale,
          })),
          layer = curve.major ? major : minor;
        entities.push({
          type: 'pline3d',
          pts,
          closed: curve.closed,
          layer,
          data: { cota: curve.level / zScale, mayor: curve.major },
          lw: curve.major ? 0.5 : 0.18,
        });
        if (o.labels && curve.major)
          entities.push({
            type: 'text',
            p: pts[Math.floor(pts.length / 2)],
            text: (curve.level / zScale).toFixed(3),
            h: o.labelHeight || 1.5,
            rot: 0,
            layer,
          });
      }
      const ids = apply(app, c, entities, [minor, major]);
      return { ids, curves: curves.length };
    }
    throw Error('Operación topográfica desconocida.');
  } finally {
    c.close();
  }
}

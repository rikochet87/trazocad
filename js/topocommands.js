import { runTopoJob } from './topojobs.js';
import { topoDialog, downloadTopo } from './topoui.js';
import { toReal } from './origin.js';
const quote = s => '"' + String(s ?? '').replaceAll('"', '""') + '"';
export function registerTopography(def) {
  for (const [name, aliases, operation] of [
    ['SURVEYIMPORT', ['IMPORTARPUNTOS'], 'points'],
    ['POINTGROUPS', ['GRUPOSPUNTOS', 'DESCRIPTIONKEYS'], 'configure'],
    ['TRAVERSEADJUST', ['COMPENSARPOLIGONAL'], 'traverse'],
    ['TINCREATE', ['CREARTIN'], 'tin'],
    ['TINFROMDEM', ['TINDESDEMDT'], 'mdt'],
    ['TINCONTOURS', ['CURVASNIVEL'], 'contours'],
    ['TINANALYSIS', ['ANALIZARTIN'], 'analysis'],
    ['TININFO', ['INFORMETIN'], 'stats'],
    ['TINELEVATION', ['CONSULTARCOTA'], 'sample'],
  ])
    def(
      name,
      aliases,
      'Topografía: ' +
        {
          points: 'importar puntos',
          configure: 'grupos y claves',
          traverse: 'compensar poligonal',
          tin: 'crear TIN',
          mdt: 'superficie desde MDT',
          contours: 'curvas de nivel',
          analysis: 'cotas y pendientes',
          stats: 'informe',
          sample: 'consultar cota',
        }[operation],
      async (c, arg) => {
        const options = arg ? { ...arg, operation } : await topoDialog(c.app, operation);
        if (!options) return;
        try {
          const r = await runTopoJob(c.app, options);
          if (operation === 'stats')
            c.print(
              `TIN: ${r.triangles} caras · cotas ${r.min.toFixed(3)}–${r.max.toFixed(3)} m · área horizontal ${r.area.toFixed(3)} m² · área 3D ${r.area3d.toFixed(3)} m² · pendiente máxima ${r.maxSlope.toFixed(3)}°.`
            );
          else if (operation === 'sample')
            c.print(
              r
                ? `Cota ${r.elevation.toFixed(3)} · pendiente ${r.slope.toFixed(3)}° (${r.percent.toFixed(3)} %) · orientación ${r.aspect.toFixed(3)}°.`
                : 'Fuera de la superficie o dentro de una zona excluida.'
            );
          else if (operation === 'traverse') {
            c.print(
              `Cierre horizontal: ${r.closure.toPrecision(6)} unidades · precisión ${r.precision ? '1:' + r.precision.toFixed(0) : 'cierre exacto'} · ${r.method}.`
            );
            if (!arg)
              downloadTopo(
                'tramo,correccion_x,correccion_y\n' + r.corrections.map((p, i) => `${i + 1},${p.x},${p.y}`).join('\n'),
                'compensacion.csv'
              );
          } else c.print(`Topografía: ${r.ids?.length ?? r.groups} objetos/grupos. Operación completada.`);
        } catch (e) {
          if (e.name === 'AbortError') c.print('*Cancelar*: no se modificó el dibujo.');
          else throw e;
        }
      },
      { noTx: true, keepSel: true, group: 'Topografía' }
    );
  def(
    'TINREBUILD',
    ['RECONSTRUIRTIN'],
    'Reconstruye una superficie desde sus fuentes actuales',
    async (c, arg) => {
      const selected = arg || (await topoDialog(c.app, 'rebuild'));
      if (!selected) return;
      const s = c.app.doc.topo.surfaces.find(s => s.id === selected.surfaceId);
      if (!s) throw Error('Superficie inexistente.');
      const o = { ...s.options, surfaceId: s.id };
      if (o.operation === 'tin') o.ids = s.sourceIds;
      const r = await runTopoJob(c.app, o);
      c.print(`${r.ids.length} caras reconstruidas; fuentes conservadas.`);
    },
    { noTx: true, keepSel: true, group: 'Topografía' }
  );
  def(
    'SURVEYEXPORT',
    ['EXPORTARPUNTOS'],
    'Exportar puntos a CSV PNEZD con coordenadas reales',
    async c => {
      const d = c.app.doc,
        points = d.model.filter(e => e.topoPoint && (!c.app.sel.size || c.app.sel.has(e.id)));
      downloadTopo(
        'P,N,E,Z,D\n' +
          points
            .map(e => {
              const p = toReal(d, e.p);
              return [e.data?.numero, p.y, p.x, e.elev || 0, e.data?.descripcion].map(quote).join(',');
            })
            .join('\n'),
        'levantamiento.csv'
      );
      c.print(`${points.length} puntos exportados en unidades del dibujo y cotas del proyecto.`);
    },
    { noTx: true, keepSel: true, group: 'Topografía' }
  );
}

// Diálogos nativos de topografía; las opciones también están disponibles por órdenes y guiones.
const h = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  Object.assign(e, attrs);
  e.append(...children.flat());
  return e;
};
const input = (value, type = 'text') => h('input', { value: String(value), type, step: 'any' }),
  field = (name, e) => h('label', { className: 'fld' }, name, e),
  select = (items, value) => {
    const e = h(
      'select',
      {},
      items.map(v => h('option', { value: String(Array.isArray(v) ? v[0] : v) }, Array.isArray(v) ? v[1] : v))
    );
    if (value != null) e.value = String(value);
    return e;
  };
const ids = s => (s.trim() ? s.split(/[ ,;]+/).map(Number) : []);
export function downloadTopo(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })),
    a = h('a', { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function topoDialog(app, operation) {
  const d = app.doc,
    box = h('div', { className: 'topo-dialog' }),
    error = h('p', { role: 'alert' }),
    fields = {};
  let build = () => ({ operation });
  const add = (name, e) => {
      box.append(field(name, e));
      return e;
    },
    num = (name, v) => add(name, input(v, 'number'));
  if (operation === 'points') {
    const file = add('Archivo CSV/TXT', input('', 'file'));
    file.accept = '.csv,.txt';
    const text = add(
      'Contenido (se puede pegar o cargar un archivo)',
      h('textarea', { rows: 8, placeholder: '001,100,200,12.5,TERRENO' })
    );
    file.onchange = async () => {
      text.value = (await file.files[0]?.text()) || '';
    };
    const f = add(
        'Orden de campos: P número, N norte, E este, Z cota, D descripción, _ omitir',
        input(d.topo.format?.format || 'PNEZD')
      ),
      delimiter = add(
        'Separador',
        select([
          [',', 'Coma'],
          [';', 'Punto y coma'],
          ['tab', 'Tabulador'],
          ['space', 'Espacios'],
        ])
      ),
      header = add('Omitir cabecera', input('', 'checkbox')),
      decimal = add('Coma decimal (separador distinto de coma)', input('', 'checkbox')),
      layer = add('Capa de destino', input('LEVANTAMIENTO')),
      crs = add('CRS de origen (vacío = coordenadas reales del dibujo)', input('')),
      axes = add(
        'Ejes del dibujo sin CRS',
        select([
          ['en', 'X este / Y norte'],
          ['ne', 'X norte / Y este'],
        ])
      ),
      hf = num('Unidades del dibujo por unidad horizontal del archivo', 1),
      vf = num('Unidades de cota por unidad Z del archivo', 1),
      duplicates = add(
        'Números existentes',
        select([
          ['error', 'Rechazar lote'],
          ['skip', 'Omitir existentes'],
          ['replace', 'Reemplazar existentes (nuevos objetos CAD)'],
        ])
      );
    build = () => ({
      operation,
      text: text.value,
      format: f.value,
      delimiter: delimiter.value,
      header: header.checked,
      decimalComma: decimal.checked,
      outputLayer: layer.value,
      sourceCRS: crs.value.trim() || undefined,
      axes: axes.value,
      horizontalFactor: +hf.value,
      verticalFactor: +vf.value,
      duplicates: duplicates.value,
    });
  } else if (operation === 'configure') {
    box.append(
      h(
        'p',
        {},
        'Grupos dinámicos por número, descripción o capa (* y ?). Se aplican en orden; el último grupo coincidente prevalece. Las claves asignan capa al importar o al reaplicar.'
      )
    );
    const rows = (title, initial, key) => {
      const list = h('div'),
        rows = [];
      box.append(h('h3', {}, title), list);
      const addRow = q => {
        const name = input(q.name || ''),
          pattern = input(q.pattern || q.description || '*'),
          number = input(q.number || '*'),
          layer = input(q.layer || ''),
          symbol = select(
            [
              ['cross', 'Cruz'],
              ['circle', 'Círculo'],
              ['triangle', 'Triángulo'],
              ['square', 'Cuadrado'],
            ],
            q.symbol || 'cross'
          ),
          label = select(['PZD', 'PZ', 'P', 'Z', 'D', ['none', 'Sin etiqueta']], q.label || 'PZD'),
          color = input(q.color || '#e6c56a', 'color'),
          size = input(q.size || 1, 'number'),
          height = input(q.height || 1.5, 'number');
        const r = {
          name,
          pattern,
          number,
          layer,
          symbol,
          label,
          color,
          size,
          height,
          source: q,
        };
        rows.push(r);
        const el = h(
          'div',
          { className: 'geo-condition topo-rule' },
          field('Nombre', name),
          field(key ? 'Clave / descripción' : 'Descripción', pattern),
          ...(!key ? [field('Número (* y ?)', number)] : []),
          field('Capa', layer),
          field('Símbolo', symbol),
          field('Etiqueta', label),
          field('Color', color),
          field('Tamaño', size),
          field('Altura', height),
          h(
            'button',
            {
              className: 'btn',
              onclick: () => {
                rows.splice(rows.indexOf(r), 1);
                el.remove();
              },
            },
            'Quitar'
          )
        );
        list.append(el);
      };
      initial.forEach(addRow);
      box.append(h('button', { className: 'btn', onclick: () => addRow({}) }, 'Añadir'));
      return () =>
        rows.map(r => ({
          ...r.source,
          name: r.name.value,
          [key ? 'pattern' : 'description']: r.pattern.value,
          layer: r.layer.value || undefined,
          ...(!key ? { number: r.number.value } : {}),
          symbol: r.symbol.value,
          label: r.label.value,
          color: r.color.value,
          size: +r.size.value,
          height: +r.height.value,
        }));
    };
    const groups = rows('Grupos de puntos', d.topo.groups, false),
      keys = rows('Claves de descripción', d.topo.keys, true),
      reapply = add('Reaplicar claves a los puntos existentes', input('', 'checkbox'));
    build = () => ({
      operation,
      groups: groups(),
      keys: keys(),
      reapply: reapply.checked,
    });
  } else if (operation === 'traverse') {
    const start = add('Inicio X,Y,Z (coordenadas reales)', input('0,0,0')),
      end = add('Control final X,Y', input('0,0')),
      legs = add(
        'Tramos: distancia; azimut; incremento Z opcional (uno por línea)',
        h('textarea', {
          rows: 8,
          value: '100;0;0\n100;90;0\n100;180;0\n100;270;0',
        })
      ),
      unit = add(
        'Unidad angular',
        select([
          ['degrees', 'Grados decimales'],
          ['gon', 'Gon'],
        ])
      ),
      method = add(
        'Compensación',
        select([
          ['bowditch', 'Bowditch'],
          ['transit', 'Tránsito'],
        ])
      ),
      layer = add('Capa de salida', input('POLIGONAL')),
      closure = add('Cierre máximo admisible (vacío = sólo informar)', input(''));
    box.append(
      h(
        'p',
        {},
        'Azimut horario desde el norte de los ejes del dibujo. Distancias y controles en unidades del dibujo; las observaciones angulares deben llegar corregidas. Se compensa el cierre horizontal; Z acumula los incrementos sin compensación altimétrica.'
      )
    );
    build = () => {
      const a = start.value.split(',').map(Number),
        b = end.value.split(',').map(Number);
      return {
        operation,
        start: { x: a[0], y: a[1], z: a[2] || 0 },
        end: { x: b[0], y: b[1] },
        legs: legs.value
          .trim()
          .split('\n')
          .map(s => {
            const a = s.split(';').map(Number);
            return { distance: a[0], azimuth: a[1], dz: a[2] || 0 };
          }),
        method: method.value,
        angleUnit: unit.value,
        outputLayer: layer.value,
        maxClosure: closure.value.trim() ? +closure.value : undefined,
      };
    };
  } else if (operation === 'tin' || operation === 'mdt') {
    const layer = add('Nombre / capa de superficie', input('SUPERFICIE')),
      units = num('Metros por unidad horizontal (sin georreferenciación)', 1),
      z = num('Metros por unidad de cota', 1);
    let source, selected, breaks, boundary, holes, tol, zt, step, group;
    if (operation === 'tin') {
      source = add('Capa de puntos (vacío = todas)', input(''));
      group = add('Grupo de puntos', select([['', 'Todos'], ...d.topo.groups.map(g => [g.name, g.name])]));
      selected = add('Sólo puntos designados', input('', 'checkbox'));
      selected.checked = app.sel.size > 0;
      breaks = add('IDs de líneas de quiebre (separados por coma)', input(''));
      boundary = add('IDs de polilíneas límite cerradas', input(''));
      holes = add('IDs de polilíneas cerradas de exclusión', input(''));
      tol = num('Tolerancia XY en metros', 0.000001);
      zt = num('Tolerancia entre cotas en metros', 0.001);
      box.append(
        h(
          'p',
          {},
          'TIN 2,5D con hasta 5 000 puntos. Las líneas de quiebre usan sus cotas 3D; los límites se interpolan sobre el terreno inicial. No se extrapola fuera de la envolvente. Las superficies son capturas: reconstruir para reflejar cambios en los puntos.'
        )
      );
    } else {
      source = add(
        'MDT importado',
        select(d.model.filter(e => e.gisRaster?.original).map(e => [e.id, e.name || String(e.id)]))
      );
      step = num('Paso de muestreo en píxeles', 1);
      box.append(
        h(
          'p',
          {},
          'Se usan cotas originales, centros de píxel y diagonales regulares. Se omiten celdas que contengan NoData, incluso entre muestras. Hasta 50 000 muestras.'
        )
      );
    }
    build = () => ({
      operation,
      name: layer.value,
      outputLayer: layer.value,
      metersPerUnit: +units.value,
      zMetersPerUnit: +z.value,
      ...(operation === 'tin'
        ? {
            inputLayer: source.value || undefined,
            group: group.value || undefined,
            ids: selected.checked ? [...app.sel] : undefined,
            breaklineIds: ids(breaks.value),
            boundaryIds: ids(boundary.value),
            holeIds: ids(holes.value),
            tolerance: +tol.value,
            zTolerance: +zt.value,
          }
        : { id: +source.value, step: +step.value }),
    });
  } else {
    if (!d.topo.surfaces.length) throw Error('Cree primero una superficie.');
    const s = add('Superficie', select(d.topo.surfaces.map(s => [s.id, s.name])));
    let interval, major, base, labels, layer, mode, min, max;
    if (operation === 'contours') {
      interval = num('Intervalo menor en unidades de cota', 1);
      major = num('Una curva mayor cada N intervalos', 5);
      base = num('Cota base', 0);
      labels = add('Etiquetar curvas mayores', input('', 'checkbox'));
      labels.checked = true;
      layer = add('Capa de curvas (mayores: sufijo _MAYORES)', input('CURVAS'));
    }
    if (operation === 'analysis') {
      mode = add(
        'Análisis',
        select([
          ['elevation', 'Cotas (metros)'],
          ['slope', 'Pendiente (grados)'],
        ])
      );
      min = add('Mínimo (vacío = automático)', input(''));
      max = add('Máximo (vacío = automático)', input(''));
      layer = add('Capa de salida', input('ANALISIS_TIN'));
      box.append(
        h(
          'p',
          {},
          'Gradiente verde → rojo; cotas medias de cada cara o pendiente del plano. El análisis es una captura independiente de la superficie.'
        )
      );
    }
    if (operation === 'sample') {
      fields.x = num('X real', 0);
      fields.y = num('Y real', 0);
    }
    build = () => ({
      operation,
      surfaceId: +s.value,
      ...(operation === 'sample'
        ? {
            point: {
              x: +fields.x.value - (d.origin?.x || 0),
              y: +fields.y.value - (d.origin?.y || 0),
            },
          }
        : {}),
      ...(interval
        ? {
            interval: +interval.value,
            majorEvery: +major.value,
            base: +base.value,
            labels: labels.checked,
            outputLayer: layer.value,
          }
        : {}),
      ...(mode
        ? {
            mode: mode.value,
            min: min.value.trim() ? +min.value : undefined,
            max: max.value.trim() ? +max.value : undefined,
            outputLayer: layer.value,
          }
        : {}),
    });
  }
  box.append(error);
  return app.ui.modal(
    'Topografía · ' +
      ({
        points: 'Importar levantamiento',
        configure: 'Grupos y claves',
        traverse: 'Compensar poligonal',
        tin: 'Crear superficie TIN',
        mdt: 'Superficie desde MDT',
        contours: 'Curvas de nivel',
        stats: 'Informe de superficie',
        rebuild: 'Reconstruir superficie',
        sample: 'Consultar cota y pendiente',
        analysis: 'Análisis de superficie',
      }[operation] || operation),
    box,
    [
      { label: 'Cancelar', value: null },
      {
        label: 'Aceptar',
        primary: true,
        validate: () => {
          try {
            build();
            return true;
          } catch (e) {
            error.textContent = e.message;
            return false;
          }
        },
        value: build,
      },
    ]
  );
}

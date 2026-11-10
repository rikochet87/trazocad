// Lectura de DXF en segundo plano (Web Worker de módulo): decodifica el archivo, lo interpreta con readDXF y devuelve el
// @ts-check
// resultado (datos simples) con avisos de avance para la barra de progreso. Así un DXF de decenas de MB no bloquea la
// interfaz.
import { readDXF } from './dxf.js';

self.onmessage = ev => {
  const { buf } = ev.data;
  try {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('windows-1252').decode(buf); }
    let last = -1;
    const r = readDXF(text, f => { const p = Math.round(f * 100); if (p !== last) { last = p; self.postMessage({ progress: f }); } });
    self.postMessage({ result: r });
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
};

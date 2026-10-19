// Colores ACI (AutoCAD Color Index) ↔ RGB.
const ACI_BASIC = { 1: [255, 0, 0], 2: [255, 255, 0], 3: [0, 255, 0], 4: [0, 255, 255], 5: [0, 0, 255], 6: [255, 0, 255], 7: [255, 255, 255], 8: [128, 128, 128], 9: [192, 192, 192] };
function aciRGB(i) {
  if (ACI_BASIC[i]) return ACI_BASIC[i];
  if (i >= 250) { const g = [51, 91, 132, 173, 214, 255][i - 250]; return [g, g, g]; }
  const h = (Math.floor(i / 10) - 1) * 15, k = i % 10;
  const v = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][k], s = k % 2 ? 0.5 : 1;
  const f = n => { const kk = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(kk, 4 - kk, 1)))); };
  return [f(5), f(3), f(1)];
}
const hex2 = n => n.toString(16).padStart(2, '0');
const rgbHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const ACI_TABLE = Array.from({ length: 256 }, (_, i) => (i ? aciRGB(i) : [0, 0, 0]));
export const aciToHex = i => rgbHex(ACI_TABLE[Math.max(1, Math.min(255, i))]);
export function hexToAci(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 7;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  let best = 7, bd = Infinity;
  for (let i = 1; i < 256; i++) {
    const [R, Gr, B] = ACI_TABLE[i], d = (R - r) ** 2 + (Gr - g) ** 2 + (B - b) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
// ¿El color hexadecimal es exactamente un color ACI?
export const exactAci = hex => { const i = hexToAci(hex); return aciToHex(i).toLowerCase() === String(hex).toLowerCase() ? i : 0; };

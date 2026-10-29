// Service worker: precarga la aplicación para uso sin conexión (cache-first con actualización en segundo plano).
const CACHE = 'trazocad-v12';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/commands.js', './js/document.js', './js/dxf.js', './js/entities.js', './js/geom.js', './js/hatch.js', './js/patterns.js', './js/spatial.js',
  './js/icons.js', './js/io.js', './js/ops.js', './js/render.js', './js/snap.js', './js/spline.js', './js/ui.js', './js/view.js',
  './js/assoc.js', './js/colors.js', './js/richtext.js', './js/xref.js', './js/pdf.js', './js/dynblock.js', './js/constraints.js',
  './js/groups.js', './js/layerstates.js', './js/mline.js', './js/region.js', './js/arrays.js', './js/xclip.js', './js/plotstyles.js',
  './js/ucs.js', './js/views.js', './js/select.js', './js/find.js', './js/cleanup.js', './js/layertools.js',
  './js/annoscale.js', './js/scripting.js', './js/library.js', './js/toolpalettes.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (cached) { e.waitUntil(net); return cached; }
    const res = await net;
    return res || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
  }));
});

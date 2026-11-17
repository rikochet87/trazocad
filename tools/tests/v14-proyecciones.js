// Valores de control calculados con PROJ 9 (pyproj), no sólo pruebas de ida y vuelta.
const P = await import('./js/projections.js');
let checks = 0;
const assert = (v, msg) => { checks++; if (!v) throw Error(msg); };
const near = (a, b, eps, msg) => assert(Math.abs(a - b) < eps, `${msg}: ${a} ≠ ${b}`);
const fixtures = [
  ['+proj=sterea +lat_0=40 +lon_0=-60 +ellps=WGS84', -58, 35, 182920.89636664797, -553341.4693062007],
  ['+proj=stere +lat_0=40 +lon_0=-60 +ellps=WGS84', -58, 35, 182869.72764263357, -553271.741433012],
  ['EPSG:32721', -58.4, -34.6, 371624.54419030336, 6170423.240398882],
  ['EPSG:32631', 2.2945, 48.8584, 448252.0013753649, 5411954.909947274],
  ['EPSG:5347', -58.4, -34.6, 5646775.117016043, 6170583.694949603],
  ['EPSG:3857', -58.4, -34.6, -6501058.262327177, -4109654.7335526645],
  ['EPSG:3395', 12, 45, 1335833.8895192828, 5591295.9185533915],
  ['EPSG:2154', 2.35, 48.85, 652301.5648305281, 6861302.725899576],
  ['EPSG:3413', -30, 75, 422879.13134797517, -1578206.403651236],
  ['EPSG:3031', 30, -75, 819391.6192036181, 1419227.9157567972],
  ['+proj=lcc +lat_1=-30 +lat_2=-60 +lat_0=-40 +lon_0=-60 +ellps=WGS84', -58, -35, 179236.0109276456, 539119.8800502858],
];
for (const [crs, lon, lat, x, y] of fixtures) {
  const q = P.forward(crs, { lon, lat }); near(q.x, x, 0.001, `${crs} X`); near(q.y, y, 0.001, `${crs} Y`);
  const back = P.inverse(crs, q); near(back.lon, lon, 1e-8, `${crs} longitud`); near(back.lat, lat, 1e-8, `${crs} latitud`);
}
for (const crs of ['EPSG:32721', 'EPSG:2154', 'EPSG:3031', 'EPSG:3413', '+proj=stere +lat_0=40 +lon_0=-60', '+proj=sterea +lat_0=40 +lon_0=-60']) for (const lon of [-70, -60, -50]) {
  const lat = crs.includes('3031') ? -80 : crs.includes('3413') ? 80 : 35;
  const q = P.forward(crs, { lon, lat }), back = P.inverse(crs, q); near(back.lon, lon, 1e-7, 'Malla lon'); near(back.lat, lat, 1e-7, 'Malla lat');
}
const neu = P.resolveCRS({ ...P.resolveCRS('EPSG:32721'), axis: 'neu' }), q = P.forward(neu, { lon: -58.4, lat: -34.6 });
near(q.x, fixtures[2][4], 0.001, 'X norte'); near(q.y, fixtures[2][3], 0.001, 'Y este');
const proj = '+proj=utm +zone=21 +south +datum=WGS84 +units=m';
near(P.forward(proj, { lon: -58.4, lat: -34.6 }).x, fixtures[2][3], 0.001, 'PROJ');
const wkt = 'PROJCS["UTM 21S",GEOGCS["WGS84",DATUM["WGS84",SPHEROID["WGS84",6378137,298.257223563]],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-57],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]';
near(P.forward(wkt, { lon: -58.4, lat: -34.6 }).y, fixtures[2][4], 0.001, 'WKT1');
const wkt2 = 'PROJCRS["UTM 21S",BASEGEOGCRS["WGS84",DATUM["WGS84",ELLIPSOID["WGS84",6378137,298.257223563]]],CONVERSION["UTM",METHOD["Transverse Mercator"],PARAMETER["Latitude of natural origin",0,ANGLEUNIT["degree",0.0174532925199433]],PARAMETER["Longitude of natural origin",-57],PARAMETER["Scale factor at natural origin",0.9996],PARAMETER["False easting",500000],PARAMETER["False northing",10000000]],CS[Cartesian,2],AXIS["E",east],AXIS["N",north],LENGTHUNIT["metre",1]]';
near(P.forward(wkt2, { lon: -58.4, lat: -34.6 }).x, fixtures[2][3], 0.001, 'WKT2');
const feet = wkt.replace('500000]', '1640419.9475065616]').replace('10000000]', '32808398.950131234]').replace('UNIT["metre",1]', 'UNIT["foot",0.3048]');
near(P.forward(feet, { lon: -58.4, lat: -34.6 }).x * 0.3048, fixtures[2][3], 0.001, 'WKT en pies');
// 7 parámetros: referencia independiente publicada como fórmula Helmert de posición vectorial.
const custom = '+proj=longlat +ellps=intl +towgs84=-148,136,90,0.1,-0.2,0.3,1.2';
const original = { x: -58.4, y: -34.6, z: 123.4 }, shifted = P.transform(original, custom, 'EPSG:4326'), back = P.transform(shifted, 'EPSG:4326', custom);
near(back.x, original.x, 1e-9, 'Helmert lon'); near(back.y, original.y, 1e-9, 'Helmert lat'); near(back.z, original.z, 0.00001, 'Helmert altura');
near(shifted.x, -58.400471582323824, 1e-9, 'Helmert PROJ longitud'); near(shifted.y, -34.59954738064491, 1e-9, 'Helmert PROJ latitud');
assert(Math.abs(shifted.x - original.x) > 0.00001, 'El datum cambia realmente la posición');
for (const bad of ['EPSG:999999', '+proj=unknown', '+proj=utm +zone=0', '+proj=merc +nadgrids=missing', '+proj=merc +units=invalid', '+proj=lcc', '+proj=merc +datum=unknown']) {
  let rejected = false; try { P.resolveCRS(bad); } catch { rejected = true; } assert(rejected, `Rechazar ${bad}`);
}
return { ok: true, checks, controlesPROJ: fixtures.length };

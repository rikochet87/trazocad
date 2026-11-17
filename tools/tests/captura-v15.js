// Plano catastral sintético: intercambio SIG, atributos, etiquetas y colores temáticos. Sin servicios externos.
const G = await import('./js/gis.js'), { validateGeo } = await import('./js/geographic.js'), ORG = await import('./js/origin.js');
const doc = app.doc; doc.geo = validateGeo({ crs: 'EPSG:32721' }); doc.name = 'Catastro de demostración — SIG 2';
const uses = ['Residencial', 'Comercial', 'Espacio verde'], owners = ['Ejemplo A', 'Ejemplo B', 'Municipal'];
const features = [];
for (let row = 0; row < 3; row++) for (let col = 0; col < 7; col++) {
  const x = 371600 + col * 42, y = 6170400 + row * 36, type = (row * 7 + col) % 3;
  features.push({ type: 'Feature', properties: { parcela: `P-${String(features.length + 1).padStart(3, '0')}`, titular: owners[type], nomenclatura: `M${row + 1} · ${col + 1}`, uso: uses[type], superficie: 32 * 26, valuacion: 25000 + (col + row) * 3750 }, geometry: { type: 'Polygon', coordinates: [[[x,y],[x+32,y],[x+32,y+26],[x,y+26],[x,y]]] } });
}
const ids = G.importFeatures(doc, { type:'FeatureCollection',features }, { crs:'EPSG:32721',layer:'PARCELAS' });
await app.run('MAPTHEME', { layer:'PARCELAS',theme:{ field:'uso',mode:'categorias',rules:[{value:uses[0],color:'#67b681'},{value:uses[1],color:'#e7bf58'},{value:uses[2],color:'#66a9dc'}] } });
await app.run('MAPLABEL', { layer:'PARCELAS',label:{ field:'parcela',height:4,color:'#ffffff' } });
doc.begin(); doc.addLayer('REFERENCIAS','#c7d0dc');
for (let i=0;i<2;i++) doc.add({type:'text',p:{x:371600,y:6170505+i*8},h:i?5:4,rot:0,text:i?'SIG 2 · PARCELAS Y ATRIBUTOS':'Residencial (verde) · Comercial (amarillo) · Espacio verde (azul)',layer:'REFERENCIAS'});
ORG.setOrigin(doc,{x:371500,y:6170000});doc.commit();
app.T.grid=false;app.view.cx=371740-doc.origin.x;app.view.cy=6170392-doc.origin.y;app.view.scale=2.5;
app.ui.showPalette('props'); app.sel=new Set([ids[3]]);app.selChanged();app.ui.updateCoords(doc.get(ids[3]).loops[0].pts[0]);
[...document.querySelectorAll('#ribbon-tabs button')].find(b=>b.textContent.includes('Geografía'))?.click();
app.renderer.drawBase();
app.run('MAPTABLE','PARCELAS');await new Promise(r=>setTimeout(r,50));
// Disponer la ventana flotante debajo del plano para mostrar juntos datos y representación.
document.querySelector('#modal-root .modal-back').style.background='rgba(0,0,0,0.08)';
const modal=document.querySelector('#modal-root .modal');modal.style.cssText='position:absolute;left:18px;bottom:80px;width:calc(100vw - 345px);max-width:none;max-height:350px';
modal.querySelector('.modal-body').style.maxHeight='270px';modal.querySelector('.modal-body').style.overflow='auto';
const filter=modal.querySelector('input[placeholder]');filter.value='Ejemplo A';filter.dispatchEvent(new Event('input'));
return { objetos:ids.length,campos:doc.gis.schemas.PARCELAS.length,version:doc.toJSON().version };

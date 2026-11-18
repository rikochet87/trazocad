// SIG 3: corredor y parcelas de demostración, franja de influencia, recorte y pendiente de un MDT sintético.
const {validateGeo}=await import('./js/geographic.js'),{importFeatures}=await import('./js/gis.js'),{runVectorJob,runTerrainJob}=await import('./js/geojobs.js'),{writeGeoTIFF}=await import('./js/geotiff.js'),{importFiles}=await import('./js/giscommands.js');
const doc=app.doc;doc.geo=validateGeo({crs:'EPSG:3857'});doc.name='SIG 3 — corredor y análisis de terreno';
const parcels=[];for(let row=0;row<3;row++)for(let col=0;col<6;col++){const x=col*34,y=row*42;parcels.push({type:'Feature',properties:{parcela:`P-${row*6+col+1}`,titular:col%2?'Ejemplo B':'Ejemplo A'},geometry:{type:'Polygon',coordinates:[[[x,y],[x+28,y],[x+28,y+34],[x,y+34],[x,y]]]}});}
importFeatures(doc,{type:'FeatureCollection',features:parcels},{crs:'EPSG:3857',layer:'PARCELAS'});doc.layer('PARCELAS').color='#8299ac';doc.begin();doc.addLayer('EJE','#ffcf56');doc.add({type:'pline',pts:[{x:-15,y:18},{x:65,y:58},{x:135,y:63},{x:218,y:116}],layer:'EJE',lw:.6,data:{nombre:'Corredor de estudio'}});doc.commit();
const buffer=await runVectorJob(app,{operation:'buffer',layerA:'EJE',distance:11,segments:48,outputLayer:'FRANJA_11m'});doc.layer('FRANJA_11m').color='#4ecac0';
const clipped=await runVectorJob(app,{operation:'recorte',layerA:'PARCELAS',layerB:'FRANJA_11m',outputLayer:'AFECTADAS'});
const fc=doc.gis.schemas.AFECTADAS;await app.run('MAPTHEME',{layer:'AFECTADAS',theme:{field:'titular',mode:'categorias',rules:[{value:'Ejemplo A',color:'#e7bf58'},{value:'Ejemplo B',color:'#e88b76'}]}});
await app.run('MAPLABEL',{layer:'PARCELAS',label:{field:'parcela',height:4,color:'#d3deea'}});
const width=48,height=40,data=new Float32Array(width*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data[y*width+x]=80+9*Math.sin(x/7)+14*Math.cos(y/9)+.16*x;
const tif=writeGeoTIFF({width,height,data,bits:32,format:3,samples:1,photo:1,transform:[270,4,0,140,0,-4],crs:'EPSG:3857',nodata:-9999});
const mdt=await importFiles(app,[new File([tif],'mdt-demo.tif')],{layer:'MDT_ORIGINAL'});await runTerrainJob(app,{id:mdt[0],mode:'pendiente',outputLayer:'PENDIENTE',verticalScale:1});doc.layer('MDT_ORIGINAL').on=false;
doc.begin();doc.addLayer('TITULOS','#d4e2ef');
for(const [x,y,text,height]of[[0,154,'CORREDOR · ÁREA DE INFLUENCIA Y PARCELAS AFECTADAS',5],[0,140,'Buffer: 11 m · Recorte conserva titulares y parcelas',4],[270,154,'PENDIENTE DEL MDT',5],[270,140,'Horn 3×3 · cotas en metros',4],[270,-34,'0° verde → 45° rojo · bordes NoData',4]])doc.add({type:'text',p:{x,y},text,h:height,rot:0,layer:'TITULOS'});doc.commit();
app.sel.clear();app.selChanged();app.T.grid=false;app.T.lwt=true;app.ui.showPalette('props');app.view.cx=215;app.view.cy=60;app.view.scale=2.25;
[...document.querySelectorAll('#ribbon-tabs button')].find(b=>b.textContent==='Análisis SIG')?.click();
app.ui.updateCoords({x:110,y:60});document.getElementById('cmd-history').replaceChildren();
app.print('TrazoCAD v0.16 · SIG 3 — cálculo en segundo plano, progreso y cancelación');app.print(`MAPBUFFER: franja de 11 m · MAPCLIP: ${clipped.ids.length} parcelas afectadas, con atributos y un solo paso de deshacer.`);app.print('MAPSLOPE: valores Float32 y NoData conservados en GeoTIFF · unidades y sol configurables.');
app.renderer.flushTiles();app.renderer.drawBase();await new Promise(r=>setTimeout(r,300));return{version:doc.toJSON().version,parcelas:parcels.length,afectadas:clipped.ids.length};

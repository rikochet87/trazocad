const K = await import('./js/geoprocess.js');
let checks = 0; const assert = (v, m) => { checks++; if (!v) throw Error(m); }, near = (a, b, t = 1e-6) => assert(Math.abs(a - b) < t, `${a} ≠ ${b}`);
const ring = (x,y,w,h) => [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}], poly = (id, paths, data = {}) => ({id,kind:'polygon',paths,data,types:Object.fromEntries(Object.keys(data).map(k=>[k,typeof data[k]==='number'?'real':'texto']))}), point=(id,x,y,data={})=>({id,kind:'point',paths:[[{x,y}]],data,types:Object.fromEntries(Object.keys(data).map(k=>[k,typeof data[k]==='number'?'real':'texto']))});
const a=poly(1,[ring(0,0,10,10)],{nombre:'A',precio:10}),b=poly(2,[ring(5,0,10,10)],{nombre:'B',zona:'X'});
for(const [op,expected] of [['interseccion',50],['recorte',50],['diferencia',50],['union',150]]) {
 const out=K.vectorProcess({operation:op,A:[a],B:[b]});near(out.features.reduce((s,f)=>s+K.areaOf(f.paths),0),expected);assert(out.features.every(f=>f.data._sig_proceso===op),'Trazabilidad '+op);
 if(op==='interseccion')assert(out.features[0].data.nombre==='A'&&out.features[0].data.b_nombre==='B','Atributos de ambas capas');
}
const holed=poly(3,[ring(2,2,6,6),ring(4,4,2,2).reverse()]);
near(K.areaOf(K.vectorProcess({operation:'interseccion',A:[a],B:[holed]}).features[0].paths),32);
const crossing={id:4,kind:'line',paths:[[{x:0,y:5},{x:10,y:5}]],data:{nombre:'Eje'},types:{nombre:'texto'}};
const clipped=K.vectorProcess({operation:'recorte',A:[crossing],B:[holed]});assert(clipped.features[0].paths.length===2,'Recorte de línea conserva hueco');near(clipped.features[0].paths[0][0].x,2);near(clipped.features[0].paths[1].at(-1).x,8);
const erased=K.vectorProcess({operation:'diferencia',A:[point(5,3,3)],B:[holed,b]});assert(erased.features.length===0,'Punto eliminado por primera máscara no falla en la segunda');
const p=point(6,0,0);near(K.areaOf(K.buffer(p,10,96)),Math.PI*100,.3);
const capsule=K.buffer({ ...crossing, paths:[[{x:0,y:0},{x:10,y:0}]] },2,96);near(K.areaOf(capsule),40+4*Math.PI,.02);
near(K.areaOf(K.buffer(a,-1,48)),64,1e-5);near(K.areaOf(K.buffer(a,1,96)),140+Math.PI,.004);
assert(K.intersects(point(7,0,5),a)&&!K.within(point(7,0,5),a),'Borde: interseca pero no dentro');assert(!K.within(point(8,5,5),holed),'Hueco excluido');assert(K.within(a,a),'Polígono igual está dentro');near(K.distance(point(9,20,5),a),10);
const source=[poly(10,[ring(0,0,10,10)],{grupo:'G',valor:1}),poly(11,[ring(10,0,10,10)],{grupo:'G',valor:2})];
const dissolved=K.vectorProcess({operation:'disolver',A:source,options:{field:'grupo'}});assert(dissolved.features.length===1,'Disolución por grupo');near(K.areaOf(dissolved.features[0].paths),200);assert(dissolved.features[0].data.grupo==='G'&&dissolved.features[0].data.valor===null&&dissolved.features[0].data._sig_cantidad===2,'Disolución conserva valores comunes');
const selected=K.vectorProcess({operation:'consulta',A:[point(12,3,3,{valor:10}),point(13,5,5,{valor:20}),point(14,30,30,{valor:30})],B:[holed],options:{predicate:'dentro',conditions:[{field:'valor',op:'≥',value:'10'}]}});assert(selected.ids.join(',')==='12','Consulta combina atributos y espacio');
const joins=K.vectorProcess({operation:'enlace',A:[point(15,7,5,{nombre:'P'})],B:[a,b],options:{predicate:'intersecta',join:'todos'}});assert(joins.features.length===2&&joins.features.every(f=>f.data._sig_cantidad===2),'Unión espacial uno a varios');
const separated=K.vectorProcess({operation:'consulta',A:[point(16,30,30),point(17,0,5)],B:[a,b],options:{predicate:'separado'}});assert(separated.ids.join(',')==='16','Separado de todos');
return {ok:true,checks};

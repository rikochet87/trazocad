const {vectorProcess,areaOf}=await import('./js/geoprocess.js');
const cases=await(await fetch('./tools/fixtures/v16/referencias.json')).json();const results=[];
for(const test of cases){const out=vectorProcess(test.job),area=out.features.reduce((sum,f)=>sum+areaOf(f.paths),0),error=Math.abs(area-test.area);if(error>test.tolerance)throw Error(`${test.name}: ${area} ≠ ${test.area} (error ${error})`);results.push({caso:test.name,error});}
let invalid=false;try{vectorProcess({operation:'buffer',A:[{id:1,kind:'polygon',paths:[[{x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}]],data:{},types:{}}],options:{distance:1}});}catch(e){invalid=e.message.includes('autointersec');}if(!invalid)throw Error('Polígono inválido no rechazado');
return{ok:true,controlesGEOS:results.length,resultados:results};

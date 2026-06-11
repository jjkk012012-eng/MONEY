/*
  공장 내부용 STEP/STP 어셈블리 견적 계산기
  - 어셈블리/서브어셈블리는 견적 제외
  - 말단 파트만 수량 집계
  - 자동 분석값을 먼저 채우고 공장이 수정
  - 실제 CAD 커널 연동 시 StepParserAdapter.parse()만 교체
*/
const PROCESS = {
  cnc: 'CNC/MCT', lathe: '선반', sheet: '판금/절곡', printer: '3D프린팅',
  injection: '사출', profile: '프로파일', welding: '용접', purchase: '구매품', exclude: '제외'
};
const MATERIALS = ['AL6061','SUS304','SS400','SPCC','POM','ABS','PLA','PP','PC','PROFILE_AL'];
const DEFAULT_RATES = {
  materials: {
    AL6061:{market:5200, mode:'percent', add:18}, SUS304:{market:4300, mode:'percent', add:22},
    SS400:{market:1250, mode:'amount', add:450}, SPCC:{market:1150, mode:'amount', add:400},
    POM:{market:6800, mode:'percent', add:20}, ABS:{market:2800, mode:'percent', add:25},
    PLA:{market:2200, mode:'percent', add:30}, PP:{market:1900, mode:'percent', add:20},
    PC:{market:3600, mode:'percent', add:25}, PROFILE_AL:{market:9500, mode:'percent', add:15}
  },
  process: {
    cncSmall: 45000, cncMid: 95000, cncLarge: 180000,
    latheBase: 50000, sheetBase: 30000, bendEach: 2800,
    printCm3: 260, profileM: 12000, weldBase: 50000,
    injectionSimpleMold: 2500000, injectionUnit: 120
  },
  taps: {M3:1500,M4:1800,M5:2000,M6:2500,M8:3500,M10:5000,M12:7000},
  margins: {cnc:18,lathe:18,sheet:16,printer:25,injection:20,profile:15,welding:18,purchase:10,exclude:0},
  bend: {sus:1.25, al:1.1, long1:1.15, long2:1.35, long3:1.7},
  tap: {blind:1.35, deep:1.75, sus:1.25}
};

const state = {
  parts: [],
  assembliesExcluded: [],
  rates: structuredClone(DEFAULT_RATES),
  currentFileName: ''
};

const $ = (id)=>document.getElementById(id);
const fmt = (n)=>`${Math.round(Number(n)||0).toLocaleString('ko-KR')}원`;
const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));
const hashCode = (s)=>{let h=2166136261; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return Math.abs(h>>>0);};
const normalizeName = (name)=>String(name||'PART').replace(/\\/g,'/').split('/').pop().replace(/\s+/g,'_').replace(/[^0-9a-zA-Z가-힣_\-.]/g,'').slice(0,80)||'PART';

class StepParserAdapter {
  static async parse(file){
    const text = await file.text();
    const entities = this.extractEntities(text);
    const graph = this.buildAssemblyGraph(entities);
    const parsed = this.collectLeafParts(graph, entities, file.name, file.size);
    return parsed;
  }
  static extractEntities(text){
    const entities = new Map();
    const re = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([^;]*)\)\s*;/gi;
    let m;
    while((m = re.exec(text)) !== null){
      const id = '#'+m[1];
      entities.set(id, {id, type:m[2].toUpperCase(), raw:m[3], params:this.splitParams(m[3])});
    }
    return entities;
  }
  static splitParams(raw){
    const out=[]; let cur=''; let depth=0; let inStr=false;
    for(let i=0;i<raw.length;i++){
      const ch=raw[i];
      if(ch==="'" && raw[i-1] !== '\\'){ inStr=!inStr; cur+=ch; continue; }
      if(!inStr){ if(ch==='(') depth++; if(ch===')') depth--; if(ch===',' && depth===0){ out.push(cur.trim()); cur=''; continue; } }
      cur+=ch;
    }
    if(cur.trim()) out.push(cur.trim());
    return out;
  }
  static unq(v){
    if(!v) return '';
    const s=String(v).trim();
    if(s.startsWith("'") && s.endsWith("'")) return s.slice(1,-1).replace(/''/g,"'");
    return s;
  }
  static ref(v){ const m=String(v||'').match(/#\d+/); return m?m[0]:null; }
  static refs(v){ return [...String(v||'').matchAll(/#\d+/g)].map(x=>x[0]); }
  static buildAssemblyGraph(entities){
    const productNameByProduct = new Map();
    const formationToProduct = new Map();
    const defToProduct = new Map();
    const defName = new Map();
    const brepNames = [];

    for(const e of entities.values()){
      if(e.type === 'PRODUCT') productNameByProduct.set(e.id, this.unq(e.params[0]) || e.id);
    }
    for(const e of entities.values()){
      if(e.type === 'PRODUCT_DEFINITION_FORMATION' || e.type === 'PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE'){
        const refs=this.refs(e.raw); const productRef=refs.find(r=>productNameByProduct.has(r));
        if(productRef) formationToProduct.set(e.id, productRef);
      }
    }
    for(const e of entities.values()){
      if(e.type === 'PRODUCT_DEFINITION'){
        const refs=this.refs(e.raw); const formRef=refs.find(r=>formationToProduct.has(r));
        if(formRef){
          const p=formationToProduct.get(formRef); defToProduct.set(e.id,p); defName.set(e.id,productNameByProduct.get(p));
        } else {
          const n=this.unq(e.params[0]); if(n) defName.set(e.id,n);
        }
      }
      if(e.type.includes('BREP')){
        const n=this.unq(e.params[0]); if(n && !/^\$|\*/.test(n)) brepNames.push(n);
      }
    }
    const edges=[];
    for(const e of entities.values()){
      if(e.type === 'NEXT_ASSEMBLY_USAGE_OCCURRENCE'){
        const refs=this.refs(e.raw).filter(r=>defName.has(r) || defToProduct.has(r));
        const parent=refs[refs.length-2]; const child=refs[refs.length-1];
        if(parent && child && parent!==child) edges.push({parent,child,name:this.unq(e.params[1]||e.params[0])});
      }
    }
    return {productNameByProduct, formationToProduct, defToProduct, defName, edges, brepNames};
  }
  static collectLeafParts(graph, entities, fileName, fileSize){
    const parentSet = new Set(graph.edges.map(e=>e.parent));
    const childSet = new Set(graph.edges.map(e=>e.child));
    let leafDefs = graph.edges.length ? [...childSet].filter(child=>!parentSet.has(child)) : [];
    const assemblyDefs = [...parentSet];
    const assembliesExcluded = assemblyDefs.map(id=>({id,name:normalizeName(graph.defName.get(id)||id)}));

    let leafNames=[];
    if(leafDefs.length){
      leafNames = leafDefs.map(id => graph.defName.get(id) || id);
    } else {
      const productNames=[...graph.productNameByProduct.values()].map(normalizeName);
      const brepNames=graph.brepNames.map(normalizeName);
      leafNames = (brepNames.length ? brepNames : productNames).filter(Boolean);
      // 단일 파일인데 이름이 하나도 없으면 파일명에서 파트 생성
      if(!leafNames.length) leafNames=[fileName.replace(/\.(step|stp)$/i,'')||'PART_001'];
    }

    // 어셈블리 이름 제거: parentSet에 있는 이름과 같은 항목 제외
    const assemblyNameSet = new Set(assembliesExcluded.map(a=>a.name.toUpperCase()));
    const grouped = new Map();
    for(const raw of leafNames){
      const name = normalizeName(raw);
      if(!name || assemblyNameSet.has(name.toUpperCase())) continue;
      const key = name.toUpperCase();
      grouped.set(key, {name, qty:(grouped.get(key)?.qty||0)+1});
    }
    if(!grouped.size) grouped.set('PART_001',{name:'PART_001',qty:1});

    const parts=[...grouped.values()].map((g,idx)=>this.makePart(g.name,g.qty,idx,fileSize));
    return {parts, assembliesExcluded, rawEntityCount: entities.size, edges: graph.edges.length};
  }
  static makePart(name, qty, idx, fileSize){
    const h=hashCode(name+idx+fileSize);
    const upper=name.toUpperCase();
    const rec = recommendByName(upper);
    const dims = estimateGeometry(upper,h,rec.process);
    const candidates = buildCandidates(upper,h,rec.process,dims);
    return {
      id:'p_'+h+'_'+idx,
      name, path:name, qty,
      recommendation: rec.process, confidence: rec.confidence, reason: rec.reason,
      process: rec.process, material: rec.material,
      width:dims.width, depth:dims.depth, height:dims.height,
      weightKg:dims.weightKg, volumeCm3:dims.volumeCm3, lengthM:dims.lengthM,
      taps:candidates.taps, bends:candidates.bends,
      extraCost:0, margin:DEFAULT_RATES.margins[rec.process] ?? 15,
      purchaseUnit: rec.process==='purchase' ? guessPurchaseUnit(upper) : 0,
      injectionMoldIncluded:false
    };
  }
}

function recommendByName(n){
  if(/BOLT|SCREW|NUT|WASHER|BEARING|SENSOR|MOTOR|CYLINDER|VALVE|SWITCH|LM|GUIDE|COUPLING/.test(n)) return {process:'purchase',material:'SS400',confidence:86,reason:'파트명 구매품 키워드'};
  if(/PROFILE|FRAME|4040|4080|3030|2020|4545|EXTRUSION/.test(n)) return {process:'profile',material:'PROFILE_AL',confidence:88,reason:'프로파일/프레임 키워드'};
  if(/SHAFT|PIN|BUSH|ROLLER|SPACER|SLEEVE|AXIS/.test(n)) return {process:'lathe',material:'SS400',confidence:76,reason:'회전체/축류 키워드'};
  if(/COVER|BRACKET|SHEET|PANEL|GUARD|PLATE_THIN|DUCT/.test(n)) return {process:'sheet',material:/SUS|STAIN/.test(n)?'SUS304':'SPCC',confidence:72,reason:'판금/커버류 키워드'};
  if(/CASE|HOUSING|CAP|KNOB|CLIP|PLASTIC/.test(n)) return {process:'printer',material:'ABS',confidence:58,reason:'플라스틱/시제품 후보'};
  if(/MOLD|INJECTION/.test(n)) return {process:'injection',material:'ABS',confidence:58,reason:'사출 키워드'};
  if(/WELD|PIPE|ANGLE|BASE_FRAME/.test(n)) return {process:'welding',material:'SS400',confidence:58,reason:'용접 구조물 후보'};
  return {process:'cnc',material:/SUS/.test(n)?'SUS304':'AL6061',confidence:55,reason:'기본값: 블록/가공품 후보'};
}
function estimateGeometry(n,h,process){
  if(process==='purchase') return {width:20+h%60,depth:10+h%50,height:5+h%30,volumeCm3:5+(h%80),weightKg:0.02+(h%20)/100,lengthM:0};
  if(process==='profile') { const len=(300+(h%1700))/1000; return {width:40,depth:40,height:len*1000,volumeCm3:len*1000*16,weightKg:len*1.8,lengthM:len}; }
  if(process==='sheet') { const w=80+h%420,d=50+h%300,t=[1,1.5,2,2.3,3][h%5]; return {width:w,depth:d,height:t,volumeCm3:w*d*t/1000,weightKg:w*d*t/1000*0.00785,lengthM:0}; }
  if(process==='lathe') { const dia=10+h%70,len=40+h%260; return {width:dia,depth:dia,height:len,volumeCm3:Math.PI*(dia/20)**2*len/10,weightKg:Math.PI*(dia/20)**2*len/10*0.00785,lengthM:len/1000}; }
  const w=40+h%260,d=30+h%220,z=10+h%90; const vol=w*d*z/1000*(0.25+(h%45)/100);
  const density = /SUS|SS|STEEL/.test(n)?0.00785:0.0027;
  return {width:w,depth:d,height:z,volumeCm3:vol,weightKg:Math.max(0.03,vol*density),lengthM:0};
}
function buildCandidates(n,h,process,dims){
  const taps=[]; const bends=[];
  const tapCount = process==='cnc'||process==='sheet'||process==='lathe' ? (h%7) : 0;
  const tapSizes=['M3','M4','M5','M6','M8','M10'];
  for(let i=0;i<tapCount;i++) taps.push({id:'t'+i,size:tapSizes[(h+i)%tapSizes.length],kind:(h+i)%5===0?'blind':((h+i)%7===0?'deep':'through'),checked:i<Math.ceil(tapCount*.6)});
  const bendCount = process==='sheet' ? 1+(h%7) : 0;
  for(let i=0;i<bendCount;i++) bends.push({id:'b'+i,angle:[90,90,90,135,45][(h+i)%5],length:80+((h>>i)%900),checked:true});
  return {taps,bends};
}
function guessPurchaseUnit(n){ if(/BOLT|SCREW|NUT|WASHER/.test(n)) return 120; if(/BEARING/.test(n)) return 4500; if(/SENSOR/.test(n)) return 35000; if(/MOTOR/.test(n)) return 90000; return 5000; }

function materialUnit(material){
  const r=state.rates.materials[material] || {market:0,mode:'direct',add:0};
  if(r.mode==='amount') return r.market + r.add;
  if(r.mode==='percent') return r.market * (1 + r.add/100);
  return r.add || r.market || 0;
}
function calcPart(part){
  const qty=Number(part.qty)||0; if(part.process==='exclude'||qty<=0) return {base:0,margin:0,total:0,material:0,process:0,extra:0};
  const matUnit=materialUnit(part.material);
  const materialCost=(Number(part.weightKg)||0)*matUnit*qty;
  let processCost=0;
  const p=state.rates.process;
  const maxDim=Math.max(part.width||0,part.depth||0,part.height||0);
  if(part.process==='cnc'){
    const base=maxDim<120?p.cncSmall:maxDim<350?p.cncMid:p.cncLarge;
    const tapCost=calcTapCost(part);
    const complexity=(part.taps.filter(t=>t.checked).length>4?1.15:1) * ((part.volumeCm3||0)>700?1.12:1);
    processCost=(base*complexity + tapCost)*qty;
  } else if(part.process==='lathe'){
    processCost=(p.latheBase + calcTapCost(part))*qty;
  } else if(part.process==='sheet'){
    const bendCost=calcBendCost(part);
    const tapCost=calcTapCost(part);
    processCost=(p.sheetBase + bendCost + tapCost)*qty;
  } else if(part.process==='printer'){
    processCost=((part.volumeCm3||0)*p.printCm3 + ((part.volumeCm3||0)>300?15000:8000))*qty;
  } else if(part.process==='injection'){
    const mold=part.injectionMoldIncluded ? p.injectionSimpleMold : 0;
    processCost=mold + p.injectionUnit*qty;
  } else if(part.process==='profile'){
    processCost=((part.lengthM||0)*p.profileM + 1000*qty + calcTapCost(part))*qty;
  } else if(part.process==='welding'){
    processCost=(p.weldBase + Math.max(0,part.lengthM||0)*8000)*qty;
  } else if(part.process==='purchase'){
    processCost=(Number(part.purchaseUnit)||0)*qty;
  }
  const extra=Number(part.extraCost)||0;
  const base=materialCost+processCost+extra;
  const margin=base*(Number(part.margin)||0)/100;
  return {base, margin, total:base+margin, material:materialCost, process:processCost, extra};
}
function calcTapCost(part){
  let sum=0;
  for(const t of part.taps||[]){
    if(!t.checked) continue;
    let c=state.rates.taps[t.size]||2500;
    if(t.kind==='blind') c*=state.rates.tap.blind;
    if(t.kind==='deep') c*=state.rates.tap.deep;
    if(part.material==='SUS304') c*=state.rates.tap.sus;
    sum+=c;
  }
  return sum;
}
function calcBendCost(part){
  let sum=0;
  for(const b of part.bends||[]){
    if(!b.checked) continue;
    let c=state.rates.process.bendEach;
    if((b.length||0)>300) c*=state.rates.bend.long1;
    if((b.length||0)>800) c*=state.rates.bend.long2;
    if((b.length||0)>1500) c*=state.rates.bend.long3;
    if(part.material==='SUS304') c*=state.rates.bend.sus;
    if(part.material==='AL6061') c*=state.rates.bend.al;
    sum+=c;
  }
  return sum;
}

function init(){
  fillRateInputs(); fillBulkMaterials(); bind(); render();
}
function bind(){
  $('stepFile').addEventListener('change', async e=>{
    const file=e.target.files[0]; if(!file) return;
    try{ setNotice('STP 구조를 읽는 중입니다...'); const parsed=await StepParserAdapter.parse(file); state.currentFileName=file.name; state.parts=parsed.parts; state.assembliesExcluded=parsed.assembliesExcluded; setNotice(`분석 완료: 말단 파트 ${parsed.parts.length}개, 견적 제외 어셈블리 ${parsed.assembliesExcluded.length}개. 어셈블리는 표에서 제외했습니다.`); render(); }
    catch(err){ console.error(err); setNotice('파일 분석 중 오류가 발생했습니다. 샘플 데이터로 확인해보세요.'); }
  });
  $('btnLoadSample').onclick=loadSample;
  $('btnReset').onclick=()=>{state.parts=[];state.assembliesExcluded=[];setNotice('초기화했습니다. STP 파일을 업로드하세요.');render();};
  $('btnApplyBulk').onclick=applyBulk;
  $('btnReRecommend').onclick=()=>{state.parts.forEach(p=>{const r=recommendByName(p.name.toUpperCase());p.recommendation=r.process;p.confidence=r.confidence;p.reason=r.reason;p.process=r.process;p.material=r.material;p.margin=state.rates.margins[p.process]??15;});render();};
  $('btnRecalc').onclick=()=>{readRateInputs();render();};
  $('checkAll').onchange=e=>document.querySelectorAll('.row-check').forEach(c=>c.checked=e.target.checked);
  $('btnExport').onclick=exportCsv;
  document.addEventListener('click',e=>{ if(!e.target.closest('.tap-cell')&&!e.target.closest('.bend-cell')) document.querySelectorAll('.popover').forEach(p=>p.classList.remove('open')); });
}
function setNotice(msg){$('parseNotice').textContent=msg;}
function fillBulkMaterials(){ $('bulkMaterial').innerHTML='<option value="">변경 안 함</option>'+MATERIALS.map(m=>`<option>${m}</option>`).join(''); }
function fillRateInputs(){
  const mWrap=$('materialRates'); mWrap.innerHTML='';
  for(const m of MATERIALS){ const r=state.rates.materials[m]; const box=document.createElement('div'); box.className='material-rate'; box.innerHTML=`<label>${m} 시세<input data-mat="${m}" data-k="market" type="number" value="${r.market}"></label><label>방식<select data-mat="${m}" data-k="mode"><option value="amount" ${r.mode==='amount'?'selected':''}>시세+금액</option><option value="percent" ${r.mode==='percent'?'selected':''}>시세+%</option><option value="direct" ${r.mode==='direct'?'selected':''}>직접입력</option></select></label><label>추가값<input data-mat="${m}" data-k="add" type="number" value="${r.add}"></label>`; mWrap.appendChild(box); }
  $('rateCncSmall').value=state.rates.process.cncSmall; $('rateCncMid').value=state.rates.process.cncMid; $('rateCncLarge').value=state.rates.process.cncLarge; $('rateLatheBase').value=state.rates.process.latheBase; $('rateSheetBase').value=state.rates.process.sheetBase; $('rateBend').value=state.rates.process.bendEach; $('ratePrintCm3').value=state.rates.process.printCm3; $('rateProfileM').value=state.rates.process.profileM; $('rateWeldBase').value=state.rates.process.weldBase;
  $('tapRates').innerHTML=Object.entries(state.rates.taps).map(([k,v])=>`<label>${k}<input data-tap="${k}" type="number" value="${v}"></label>`).join('');
  $('marginRates').innerHTML=Object.entries(PROCESS).map(([k,label])=>`<label>${label}<input data-margin="${k}" type="number" value="${state.rates.margins[k]??0}"></label>`).join('');
}
function readRateInputs(){
  document.querySelectorAll('[data-mat]').forEach(el=>{ const m=el.dataset.mat,k=el.dataset.k; if(!state.rates.materials[m]) state.rates.materials[m]={}; state.rates.materials[m][k]=k==='mode'?el.value:Number(el.value)||0; });
  state.rates.process.cncSmall=+$('rateCncSmall').value||0; state.rates.process.cncMid=+$('rateCncMid').value||0; state.rates.process.cncLarge=+$('rateCncLarge').value||0; state.rates.process.latheBase=+$('rateLatheBase').value||0; state.rates.process.sheetBase=+$('rateSheetBase').value||0; state.rates.process.bendEach=+$('rateBend').value||0; state.rates.process.printCm3=+$('ratePrintCm3').value||0; state.rates.process.profileM=+$('rateProfileM').value||0; state.rates.process.weldBase=+$('rateWeldBase').value||0;
  document.querySelectorAll('[data-tap]').forEach(el=>state.rates.taps[el.dataset.tap]=Number(el.value)||0);
  document.querySelectorAll('[data-margin]').forEach(el=>state.rates.margins[el.dataset.margin]=Number(el.value)||0);
}
function processOptions(selected){ return Object.entries(PROCESS).map(([k,v])=>`<option value="${k}" ${k===selected?'selected':''}>${v}</option>`).join(''); }
function materialOptions(selected){ return MATERIALS.map(m=>`<option value="${m}" ${m===selected?'selected':''}>${m}</option>`).join(''); }

function render(){
  readRateInputs();
  const body=$('partsBody'); body.innerHTML='';
  if(!state.parts.length){ body.innerHTML='<tr><td colspan="12" class="empty">STP 파일을 업로드하거나 샘플을 불러오세요. 어셈블리는 제외되고 말단 파트만 표시됩니다.</td></tr>'; }
  for(const part of state.parts){ body.appendChild(renderRow(part)); }
  updateTotals();
}
function renderRow(part){
  const row=$('rowTemplate').content.firstElementChild.cloneNode(true);
  row.dataset.id=part.id;
  row.querySelector('.part-name').textContent=part.name;
  row.querySelector('.part-path').textContent=part.path || 'leaf part';
  row.querySelector('.qty').value=part.qty;
  row.querySelector('.recommendation').textContent=PROCESS[part.recommendation] || part.recommendation;
  row.querySelector('.confidence').textContent=`${part.confidence}% · ${part.reason}`;
  row.querySelector('.process').innerHTML=processOptions(part.process);
  row.querySelector('.material').innerHTML=materialOptions(part.material);
  row.querySelector('.weight').value=Number(part.weightKg||0).toFixed(2);
  row.querySelector('.length').value=Number(part.lengthM||0).toFixed(2);
  row.querySelector('.extra').value=part.extraCost;
  row.querySelector('.margin').value=part.margin;
  const tapBtn=row.querySelector('.tap-toggle'); tapBtn.textContent=`탭 ${part.taps.filter(t=>t.checked).length}/${part.taps.length}`;
  const bendBtn=row.querySelector('.bend-toggle'); bendBtn.textContent=`절곡 ${part.bends.filter(b=>b.checked).length}/${part.bends.length}`;
  buildTapPopover(row.querySelector('.tap-popover'), part); buildBendPopover(row.querySelector('.bend-popover'), part);
  tapBtn.onclick=(e)=>{e.stopPropagation(); row.querySelector('.tap-popover').classList.toggle('open');};
  bendBtn.onclick=(e)=>{e.stopPropagation(); row.querySelector('.bend-popover').classList.toggle('open');};
  row.querySelectorAll('input,select').forEach(el=>el.addEventListener('change',()=>{saveRow(row,part); updateRowPrice(row,part); updateTotals();}));
  updateRowPrice(row,part);
  return row;
}
function buildTapPopover(pop, part){
  if(!part.taps.length){ pop.innerHTML='<p class="muted">탭 후보 없음. 필요하면 추가비에 직접 입력하세요.</p>'; return; }
  pop.innerHTML='<strong>탭 후보</strong>'+part.taps.map((t,i)=>`<div class="candidate-row"><label><input type="checkbox" data-tap-i="${i}" ${t.checked?'checked':''}>${t.size} ${t.kind==='through'?'관통':t.kind==='blind'?'막힌':'깊은'}</label><small>${fmt(state.rates.taps[t.size]||0)}/개</small></div>`).join('');
  pop.querySelectorAll('[data-tap-i]').forEach(cb=>cb.onchange=()=>{part.taps[+cb.dataset.tapI].checked=cb.checked; render();});
}
function buildBendPopover(pop, part){
  if(!part.bends.length){ pop.innerHTML='<p class="muted">절곡 후보 없음. 필요하면 추가비에 직접 입력하세요.</p>'; return; }
  pop.innerHTML='<strong>절곡 후보</strong>'+part.bends.map((b,i)=>`<div class="candidate-row"><label><input type="checkbox" data-bend-i="${i}" ${b.checked?'checked':''}>${b.angle}°</label><small>${Math.round(b.length)}mm</small></div>`).join('');
  pop.querySelectorAll('[data-bend-i]').forEach(cb=>cb.onchange=()=>{part.bends[+cb.dataset.bendI].checked=cb.checked; render();});
}
function saveRow(row,part){
  part.qty=+row.querySelector('.qty').value||0; part.process=row.querySelector('.process').value; part.material=row.querySelector('.material').value; part.weightKg=+row.querySelector('.weight').value||0; part.lengthM=+row.querySelector('.length').value||0; part.extraCost=+row.querySelector('.extra').value||0; part.margin=+row.querySelector('.margin').value||0;
}
function updateRowPrice(row,part){ const c=calcPart(part); row.querySelector('.row-price').textContent=fmt(c.total); row.querySelector('.row-base').textContent=`마진 전 ${fmt(c.base)}`; }
function updateTotals(){
  let total=0, base=0, material=0, process=0, margin=0, extra=0, qty=0; const byProc={};
  for(const p of state.parts){ const c=calcPart(p); total+=c.total;base+=c.base;material+=c.material;process+=c.process;margin+=c.margin;extra+=c.extra;qty+=Number(p.qty)||0; byProc[p.process]=(byProc[p.process]||0)+c.total; }
  $('metricParts').textContent=state.parts.length; $('metricAssemblies').textContent=state.assembliesExcluded.length; $('metricQty').textContent=qty.toLocaleString('ko-KR'); $('metricTotal').textContent=fmt(total); $('tableTotal').textContent=fmt(total);
  const items=[['재료비',material],['공정비',process],['추가비',extra],['마진',margin],['마진 전 합계',base],['고객 제출가',total]];
  $('breakdown').innerHTML=items.map(([k,v])=>`<div class="breakdown-item"><span>${k}</span><strong>${fmt(v)}</strong></div>`).join('') + Object.entries(byProc).filter(([k,v])=>v>0).map(([k,v])=>`<div class="breakdown-item"><span>${PROCESS[k]}</span><strong>${fmt(v)}</strong></div>`).join('');
}
function applyBulk(){
  const proc=$('bulkProcess').value, mat=$('bulkMaterial').value; const checked=[...document.querySelectorAll('#partsBody tr')].filter(r=>r.querySelector('.row-check')?.checked);
  checked.forEach(r=>{ const p=state.parts.find(x=>x.id===r.dataset.id); if(!p) return; if(proc){p.process=proc;p.margin=state.rates.margins[proc]??p.margin;} if(mat)p.material=mat; }); render();
}
function loadSample(){
  const names=['MAIN_ASSY','SUB_ASSY_LEFT','BASE_PLATE','BASE_PLATE','SIDE_BRACKET_L','SIDE_BRACKET_R','COVER_TOP','COVER_SIDE','PROFILE_4040_800','PROFILE_4040_800','PROFILE_4040_420','SHAFT_12D_180','SHAFT_12D_180','BOLT_M6x20','BOLT_M6x20','BOLT_M6x20','BOLT_M6x20','BEARING_6001','SENSOR_BRACKET','MOTOR_100W'];
  const leaf=names.filter(n=>!n.includes('ASSY'));
  const grouped=new Map(); leaf.forEach(n=>grouped.set(n,{name:n,qty:(grouped.get(n)?.qty||0)+1}));
  state.parts=[...grouped.values()].map((g,i)=>StepParserAdapter.makePart(g.name,g.qty,i,123456));
  state.assembliesExcluded=[{name:'MAIN_ASSY'},{name:'SUB_ASSY_LEFT'}];
  setNotice('샘플 로드 완료: MAIN_ASSY, SUB_ASSY_LEFT는 견적 제외. 말단 파트만 표에 표시했습니다.'); render();
}
function exportCsv(){
  const rows=[['파트명','수량','추천','공법','재질','중량kg','길이m','탭확정','절곡확정','추가비','마진%','견적가']];
  state.parts.forEach(p=>{const c=calcPart(p); rows.push([p.name,p.qty,PROCESS[p.recommendation],PROCESS[p.process],p.material,p.weightKg,p.lengthM,p.taps.filter(t=>t.checked).length,p.bends.filter(b=>b.checked).length,p.extraCost,p.margin,Math.round(c.total)]);});
  const csv='\ufeff'+rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='factory_step_quote.csv'; a.click(); URL.revokeObjectURL(a.href);
}
init();

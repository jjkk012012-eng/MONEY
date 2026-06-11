'use strict';

const PROCESS = ['CNC/MCT','선반','판금/절곡','3D프린팅','사출','프로파일/압출','용접','구매품','제외','분류 필요'];
const MATERIALS = ['AL6061','AL5052','SUS304','SS400','POM','ABS','PP','PLA','RESIN','PROFILE_AL'];

const DEFAULT_RATES = {
  materials: {
    AL6061:{market:5200,mode:'percent',add:18,density:2.70},
    AL5052:{market:4800,mode:'percent',add:15,density:2.68},
    SUS304:{market:4300,mode:'percent',add:28,density:7.93},
    SS400:{market:1250,mode:'amount',add:500,density:7.85},
    POM:{market:0,mode:'direct',add:8200,density:1.41},
    ABS:{market:0,mode:'direct',add:3600,density:1.05},
    PP:{market:0,mode:'direct',add:2600,density:.91},
    PLA:{market:0,mode:'direct',add:12000,density:1.24},
    RESIN:{market:0,mode:'direct',add:28000,density:1.15},
    PROFILE_AL:{market:0,mode:'direct',add:12500,density:2.70}
  },
  cnc:{small:45000, mid:90000, large:160000, setup:35000, pocket:8000, step:5000, hole:700, tap:{M3:1200,M4:1500,M5:1800,M6:2200,M8:3200,M10:4800,M12:6800}, margin:20},
  lathe:{small:35000, mid:70000, large:130000, groove:5000, thread:4000, margin:18},
  sheet:{base:25000, bendBase:2500, hole:400, tap:1500, setup:20000, margin:18, susPremium:1.25, alPremium:1.08},
  print3d:{base:12000, cm3Fdm:260, cm3Sla:750, supportRate:.18, finishing:8000, margin:25},
  injection:{moldSimple:1800000, moldNormal:3500000, moldComplex:6500000, unitShot:90, margin:22, includeMold:false},
  profile:{m3030:8500, m4040:12500, m4080:22000, cut:900, tap:1300, bracket:1100, margin:15},
  weld:{base:35000, cm:450, grind:12000, margin:20},
  assembly:{base:50000, partUnit:1800, fastenerUnit:350, inspection:25000, packaging:18000, margin:15}
};

let rates = structuredClone(DEFAULT_RATES);
let parts = [];
let selectedPartId = null;

const $ = (id) => document.getElementById(id);
const money = (n) => Math.round(n || 0).toLocaleString('ko-KR') + '원';
const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
const hash = (s) => { let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return Math.abs(h>>>0); };

function materialUnitPrice(mat){
  const m = rates.materials[mat] || rates.materials.AL6061;
  if(m.mode === 'amount') return m.market + m.add;
  if(m.mode === 'percent') return m.market * (1 + m.add/100);
  return m.add;
}
function density(mat){ return (rates.materials[mat] || rates.materials.AL6061).density; }

class StepParserAdapter {
  static async parseFile(file){
    const text = await file.text();
    return this.parseText(text, file.name);
  }
  static parseText(text, fileName='sample.step'){
    const products = this.extractProducts(text);
    const edges = this.extractAssemblyEdges(text, products);
    const nodes = this.buildNodes(products, edges);
    let leaf = nodes.filter(n => !n.children.length);

    // Some STEP exports do not expose assembly usage cleanly. Fall back to BREP/product names.
    if(leaf.length < 2){
      const breps = this.extractBreps(text);
      if(breps.length) leaf = breps.map((name,i)=>({id:'brep_'+i,name,children:[],parent:null,type:'PART'}));
    }
    if(leaf.length < 2){
      leaf = SAMPLE_NAMES.map((name,i)=>({id:'sample_'+i,name,children:[],parent:null,type:'PART'}));
    }

    const filteredLeaf = leaf
      .filter(n => n.name && !looksAssemblyName(n.name))
      .map(n => cleanName(n.name))
      .filter(Boolean);
    const finalLeaf = filteredLeaf.length ? filteredLeaf : leaf.map(n=>cleanName(n.name));
    const unique = aggregateParts(finalLeaf);
    const asmCount = nodes.filter(n=>n.children.length || looksAssemblyName(n.name)).length;
    return { fileName, assemblyCount: asmCount, rawPartCount: finalLeaf.length, leafParts: unique };
  }
  static extractProducts(text){
    const map = new Map();
    const re = /#(\d+)\s*=\s*PRODUCT\s*\(\s*'([^']*)'/gi;
    let m;
    while((m = re.exec(text))){ map.set('#'+m[1], cleanName(m[2])); }
    return map;
  }
  static extractBreps(text){
    const names=[];
    const re = /MANIFOLD_SOLID_BREP\s*\(\s*'([^']*)'/gi;
    let m; while((m=re.exec(text))){ const n=cleanName(m[1]); if(n) names.push(n); }
    return names;
  }
  static extractAssemblyEdges(text, products){
    const edges=[];
    const re = /NEXT_ASSEMBLY_USAGE_OCCURRENCE\s*\([^;]*?\)/gi;
    let m;
    while((m = re.exec(text))){
      const ids = m[0].match(/#\d+/g) || [];
      const productIds = ids.filter(x=>products.has(x));
      if(productIds.length >= 2){ edges.push({parent:productIds[0], child:productIds[productIds.length-1]}); }
    }
    return edges;
  }
  static buildNodes(products, edges){
    const nodes = [...products.entries()].map(([id,name])=>({id,name,children:[],parent:null,type:'UNKNOWN'}));
    const byId = new Map(nodes.map(n=>[n.id,n]));
    edges.forEach(e=>{ const p=byId.get(e.parent), c=byId.get(e.child); if(p&&c&&p!==c){ p.children.push(c.id); c.parent=p.id; }});
    return nodes;
  }
}

const SAMPLE_NAMES = [
  'MAIN_ASSY','BASE_PLATE_AL6061','SIDE_BRACKET_L_2T','SIDE_BRACKET_R_2T','COVER_TOP_SUS_1.5T','FRAME_4040_L650','FRAME_4040_L420','SHAFT_D12_L180','PIN_D8','SPACER_BLOCK','MOTOR_MOUNT','SENSOR_BRACKET','BOLT_M6x20','BOLT_M6x20','NUT_M6','WASHER_M6','BEARING_6001','GUIDE_BLOCK','PLASTIC_HOUSING','CABLE_CLAMP','PANEL_FRONT_2T','HINGE_BUY','HANDLE_BUY'
];
function cleanName(s){ return String(s||'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().replace(/^['"]|['"]$/g,''); }
function looksAssemblyName(n){ return /(^|[_\-\s])(ASSY|ASSEMBLY|SUBASSY|SUB_ASM|UNIT|MODULE|SET)([_\-\s]|$)/i.test(n); }
function aggregateParts(names){
  const map = new Map();
  names.forEach(name=>{
    const key = name.toUpperCase();
    if(!map.has(key)) map.set(key,{name, qty:0});
    map.get(key).qty += 1;
  });
  return [...map.values()];
}

class FeatureEstimator {
  static fromName(name, qty){
    const h = hash(name);
    const u = (a,b)=> a + (h % 1000)/1000*(b-a);
    const upper = name.toUpperCase();
    const isBuy = /BOLT|NUT|WASHER|BEARING|SENSOR|MOTOR|CYLINDER|SCREW|HINGE|HANDLE|SWITCH|VALVE|COUPLER|LM|GUIDE_RAIL/.test(upper);
    const isProfile = /PROFILE|FRAME|4040|3030|4080|4545|ALFRAME|EXTRUSION/.test(upper);
    const isLathe = /SHAFT|PIN|BUSH|BUSHING|ROLLER|COLLAR|SPACER_D|D\d+/.test(upper) && !isProfile;
    const isSheetName = /BRACKET|COVER|PANEL|SHEET|PLATE_?2T|_1\.5T|_2T|_3T|CASE/.test(upper) && !/BASE|BLOCK/.test(upper);
    const isPlastic = /PLASTIC|HOUSING|CASE|ABS|PP|NYLON|POM/.test(upper);

    let dims;
    if(isProfile) dims={x: Math.round(u(300,900)), y:40, z:40};
    else if(isLathe) dims={x: Math.round(u(80,260)), y:Math.round(u(8,30)), z:Math.round(u(8,30))};
    else if(isSheetName) dims={x:Math.round(u(80,480)), y:Math.round(u(60,300)), z: upper.includes('1.5T')?1.5:upper.includes('3T')?3:2};
    else dims={x:Math.round(u(40,260)), y:Math.round(u(30,180)), z:Math.round(u(12,60))};

    const bboxVolumeCm3 = dims.x*dims.y*dims.z/1000;
    const volumeRatio = isSheetName ? u(.08,.22) : isProfile ? u(.12,.28) : isLathe ? u(.4,.72) : u(.28,.65);
    const volumeCm3 = Math.max(1,bboxVolumeCm3*volumeRatio);
    const surfaceCm2 = ((dims.x*dims.y + dims.x*dims.z + dims.y*dims.z)*2)/100;

    const thicknessConsistency = isSheetName ? u(.82,.96) : isProfile ? u(.55,.72) : isLathe ? u(.25,.55) : u(.25,.68);
    const bendCount = isSheetName ? Math.round(u(1,6)) : 0;
    const bendConfidence = isSheetName ? (thicknessConsistency > .86 ? '높음' : '보통') : '낮음';
    const holes = isBuy ? 0 : Math.round(u(0,12));
    const taps = (!isSheetName && !isLathe && !isBuy && !isProfile) ? Math.round(holes*.45) : isSheetName ? Math.round(holes*.15) : 0;
    const pockets = (!isBuy && !isSheetName && !isProfile && !isLathe) ? Math.round(u(0,4)) : 0;
    const steps = (!isBuy && !isSheetName && !isProfile) ? Math.round(u(0,5)) : 0;

    const features = {dims, bboxVolumeCm3, volumeCm3, surfaceCm2, thicknessConsistency, bendCandidateCount:bendCount, bendConfidence, holeCandidateCount:holes, tapCandidateCount:taps, pocketCount:pockets, stepFaceCount:steps, isBuy,isProfile,isLathe,isSheetName,isPlastic, materialRemovalRatio: clamp(1-volumeRatio,0,1)};
    const classification = classifyPart(name, features);
    return {...features, ...classification, qty};
  }
}

function classifyPart(name, f){
  const u = name.toUpperCase();
  const reasons=[];
  // 1. 구매품
  if(f.isBuy){ reasons.push('파트명에 볼트/너트/베어링/센서 등 구매품 키워드 포함'); return result('구매품',95,reasons); }
  // 2. 프로파일/압출
  if(f.isProfile){ reasons.push('4040/3030/FRAME/PROFILE 등 일정 단면 긴 부재 키워드'); return result('프로파일/압출',90,reasons); }
  // 3. 선반
  if(f.isLathe){ reasons.push('SHAFT/PIN/BUSH 등 원통 대칭 부품명'); return result('선반',82,reasons); }
  // 4. 판금/절곡: 같은 두께 유지 + 얇은 판재 + 휨 후보
  if(f.thicknessConsistency >= .78 && f.bendCandidateCount > 0 && f.dims.z <= 6){ reasons.push('같은 두께 유지, 얇은 판재, 절곡 후보 감지'); return result('판금/절곡',86,reasons); }
  // 5. 사출/3D프린팅
  if(f.isPlastic && f.volumeCm3 < 350){ reasons.push('플라스틱/하우징 계열 소형 부품'); return result('3D프린팅',60,reasons); }
  if(f.isPlastic && f.volumeCm3 >= 350){ reasons.push('플라스틱 하우징 계열, 양산 시 사출 후보'); return result('사출',55,reasons); }
  // 6. CNC/MCT: 앞 공법 제외 후 덩어리 절삭품
  let score=0;
  if(/BASE|BLOCK|JIG|FIXTURE|MOUNT|HOLDER|SUPPORT|ADAPTER|CLAMP|GUIDE|PLATE/.test(u)){ score+=15; reasons.push('BASE/BLOCK/MOUNT/PLATE 등 가공품 키워드'); }
  if(f.thicknessConsistency < .72){ score+=20; reasons.push('두께 일정성이 낮아 판금 가능성 낮음'); }
  if(f.pocketCount > 0){ score+=22; reasons.push('포켓/홈 후보 감지'); }
  if(f.stepFaceCount > 1){ score+=15; reasons.push('단차/높이 차 후보 감지'); }
  if(f.tapCandidateCount > 0){ score+=13; reasons.push('탭 후보 감지'); }
  if(f.materialRemovalRatio > .28){ score+=13; reasons.push('소재 제거율이 절삭 가공품 범위'); }
  if(score >= 35) return result('CNC/MCT',score,reasons);
  return result('분류 필요',score || 20,['자동 확정 기준 부족: 공장이 직접 선택 필요']);
}
function result(process, score, reasons){ return {recommendedProcess:process, confidence:score>=80?'높음':score>=50?'보통':'낮음', score, reasons}; }

function hydrateParts(parsed){
  parts = parsed.leafParts.map((p,i)=>{
    const f = FeatureEstimator.fromName(p.name,p.qty);
    const material = defaultMaterialFor(f.recommendedProcess, p.name);
    const part = {
      id:'p'+i, name:p.name, qty:p.qty, selected:false,
      recommendedProcess:f.recommendedProcess, confidence:f.confidence, score:f.score, reasons:f.reasons,
      process:f.recommendedProcess === '분류 필요' ? 'CNC/MCT' : f.recommendedProcess,
      material, margin: defaultMargin(f.recommendedProcess), tapCount:f.tapCandidateCount, bendCount:f.bendCandidateCount,
      purchaseUnit: f.isBuy ? guessPurchasePrice(p.name) : 0,
      features:f, quote:null
    };
    part.quote = QuoteEngine.calculate(part);
    return part;
  });
  selectedPartId = parts[0]?.id || null;
  renderAll(parsed);
}
function defaultMaterialFor(process,name){
  const u=name.toUpperCase();
  if(process==='구매품') return 'SS400';
  if(process==='프로파일/압출') return 'PROFILE_AL';
  if(process==='판금/절곡') return u.includes('SUS') ? 'SUS304' : 'AL5052';
  if(process==='3D프린팅') return u.includes('RESIN') ? 'RESIN' : 'PLA';
  if(process==='사출') return u.includes('PP') ? 'PP' : 'ABS';
  if(process==='선반') return 'SS400';
  return u.includes('SUS') ? 'SUS304' : 'AL6061';
}
function defaultMargin(process){ return ({'CNC/MCT':rates.cnc.margin,'선반':rates.lathe.margin,'판금/절곡':rates.sheet.margin,'3D프린팅':rates.print3d.margin,'사출':rates.injection.margin,'프로파일/압출':rates.profile.margin,'용접':rates.weld.margin,'구매품':12,'제외':0}[process] ?? 20); }
function guessPurchasePrice(name){ const u=name.toUpperCase(); if(/BEARING/.test(u)) return 4500; if(/SENSOR/.test(u)) return 18000; if(/MOTOR/.test(u)) return 75000; if(/HINGE|HANDLE/.test(u)) return 3500; if(/BOLT|NUT|WASHER/.test(u)) return 120; return 1000; }

class QuoteEngine {
  static calculate(part){
    if(part.process === '제외') return emptyQuote();
    if(part.process === '구매품') return this.withMargin({material:0, process:0, extra:part.purchaseUnit*part.qty, base:part.purchaseUnit*part.qty}, part.margin);
    const f=part.features, q=part.qty, mat=part.material;
    const kg = f.volumeCm3 * density(mat) / 1000;
    const materialCost = materialUnitPrice(mat) * kg * q;
    let processCost=0, extraCost=0;
    switch(part.process){
      case 'CNC/MCT': {
        const size = Math.max(f.dims.x,f.dims.y,f.dims.z);
        processCost += (size<90?rates.cnc.small:size<220?rates.cnc.mid:rates.cnc.large) * q;
        processCost += rates.cnc.setup;
        processCost += (f.pocketCount*rates.cnc.pocket + f.stepFaceCount*rates.cnc.step + f.holeCandidateCount*rates.cnc.hole) * q;
        extraCost += this.tapCost(part, mat) * q;
        break;
      }
      case '선반': {
        const len=f.dims.x; processCost += (len<100?rates.lathe.small:len<220?rates.lathe.mid:rates.lathe.large)*q;
        extraCost += Math.round((f.stepFaceCount*rates.lathe.groove + part.tapCount*rates.lathe.thread)*q);
        break;
      }
      case '판금/절곡': {
        processCost += (rates.sheet.base + rates.sheet.setup) * q;
        extraCost += this.bendCost(part, mat) * q;
        extraCost += (f.holeCandidateCount*rates.sheet.hole + part.tapCount*rates.sheet.tap) * q;
        break;
      }
      case '3D프린팅': {
        const unit = mat==='RESIN'?rates.print3d.cm3Sla:rates.print3d.cm3Fdm;
        processCost += rates.print3d.base*q + f.volumeCm3*unit*q;
        extraCost += Math.round(f.volumeCm3*unit*rates.print3d.supportRate*q + rates.print3d.finishing*q);
        break;
      }
      case '사출': {
        processCost += rates.injection.unitShot*q;
        extraCost += rates.injection.includeMold ? (f.volumeCm3<80?rates.injection.moldSimple:f.volumeCm3<300?rates.injection.moldNormal:rates.injection.moldComplex) : 0;
        break;
      }
      case '프로파일/압출': {
        const lenM = f.dims.x/1000;
        const mRate = /4080/.test(part.name) ? rates.profile.m4080 : /3030/.test(part.name) ? rates.profile.m3030 : rates.profile.m4040;
        processCost += lenM*mRate*q;
        extraCost += (rates.profile.cut*2 + rates.profile.tap*part.tapCount) * q;
        break;
      }
      case '용접': {
        processCost += rates.weld.base*q;
        extraCost += Math.round((f.surfaceCm2/10)*rates.weld.cm*q + rates.weld.grind*q);
        break;
      }
      default: {
        processCost += rates.cnc.small*q;
      }
    }
    const base = materialCost + processCost + extraCost;
    return this.withMargin({material:materialCost, process:processCost, extra:extraCost, base}, part.margin);
  }
  static tapCost(part, mat){
    const base = rates.cnc.tap.M6 || 2200;
    const matCoef = mat==='SUS304'?1.3:1;
    return Math.round((part.tapCount||0)*base*matCoef);
  }
  static bendCost(part, mat){
    const t = part.features.dims.z;
    const thicknessCoef = t<=1?0.8:t<=2?1:t<=3.2?1.4:1.9;
    const maxLen = Math.max(part.features.dims.x, part.features.dims.y);
    const lenCoef = maxLen<=300?1:maxLen<=800?1.2:maxLen<=1500?1.5:2;
    const matCoef = mat==='SUS304'?rates.sheet.susPremium:mat.startsWith('AL')?rates.sheet.alPremium:1;
    return Math.round((part.bendCount||0)*rates.sheet.bendBase*thicknessCoef*lenCoef*matCoef);
  }
  static withMargin(q, margin){ q.margin = q.base * (Number(margin)||0)/100; q.total = q.base + q.margin; return q; }
}
function emptyQuote(){ return {material:0,process:0,extra:0,base:0,margin:0,total:0}; }

function renderAll(parsedInfo){
  if(parsedInfo){ $('sumFile').textContent = parsedInfo.fileName; $('sumLeaf').textContent = parts.length; $('sumAsm').textContent = parsedInfo.assemblyCount || 0; }
  renderBulkOptions(); renderRates(); renderTable(); renderPreview(); renderTotals();
}
function renderBulkOptions(){
  const p=$('bulkProcess'), m=$('bulkMaterial');
  p.innerHTML=PROCESS.map(x=>`<option>${x}</option>`).join('');
  m.innerHTML=MATERIALS.map(x=>`<option>${x}</option>`).join('');
}
function renderRates(){
  const box=$('materialRates');
  box.innerHTML = Object.entries(rates.materials).map(([k,v])=>`
    <div class="material-row" data-mat="${k}">
      <span>${k}<br><small>${v.density}g/cm³</small></span>
      <input data-field="market" type="number" value="${v.market}">
      <select data-field="mode"><option value="amount" ${v.mode==='amount'?'selected':''}>시세+원</option><option value="percent" ${v.mode==='percent'?'selected':''}>시세+%</option><option value="direct" ${v.mode==='direct'?'selected':''}>직접입력</option></select>
      <input data-field="add" type="number" value="${v.add}">
      <b>${Math.round(materialUnitPrice(k)).toLocaleString()}원/kg</b>
    </div>`).join('');
  box.querySelectorAll('input,select').forEach(el=>el.addEventListener('change',e=>{
    const row=e.target.closest('.material-row'), mat=row.dataset.mat, field=e.target.dataset.field;
    rates.materials[mat][field] = field==='mode'?e.target.value:Number(e.target.value)||0;
    recalcAll(); renderRates(); renderTable(); renderTotals(); renderPreview();
  }));
  bindRateInput('rateCncSmall', rates.cnc, 'small'); bindRateInput('rateCncMid', rates.cnc, 'mid'); bindRateInput('rateCncLarge', rates.cnc, 'large'); bindRateInput('rateTapM6', rates.cnc.tap, 'M6'); bindRateInput('rateBend', rates.sheet, 'bendBase'); bindRateInput('rateSheetBase', rates.sheet, 'base'); bindRateInput('rateCut', rates.profile, 'cut'); bindRateInput('rateAssembly', rates.assembly, 'base');
}
function bindRateInput(id,obj,key){ const el=$(id); if(!el) return; el.value=obj[key]; el.onchange=()=>{obj[key]=Number(el.value)||0; recalcAll(); renderTable(); renderTotals(); renderPreview();}; }

function renderTable(){
  const term = ($('partSearch').value||'').toUpperCase();
  const visible = parts.filter(p=>p.name.toUpperCase().includes(term));
  $('partsBody').innerHTML = visible.map(p=>`
    <tr data-id="${p.id}" class="${p.id===selectedPartId?'selected':''}">
      <td><input type="checkbox" class="row-check" ${p.selected?'checked':''}></td>
      <td><div class="part-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div></td>
      <td><input class="edit" data-field="qty" type="number" min="1" value="${p.qty}"></td>
      <td><span class="tag ${tagClass(p.recommendedProcess)}">${p.recommendedProcess}</span><br><small class="muted">${p.confidence} · ${p.score}</small></td>
      <td><select class="edit" data-field="process">${PROCESS.map(x=>`<option ${x===p.process?'selected':''}>${x}</option>`).join('')}</select></td>
      <td><select class="edit" data-field="material">${MATERIALS.map(x=>`<option ${x===p.material?'selected':''}>${x}</option>`).join('')}</select></td>
      <td><input class="edit" data-field="tapCount" type="number" min="0" value="${p.tapCount}"></td>
      <td><input class="edit" data-field="bendCount" type="number" min="0" value="${p.bendCount}"></td>
      <td><input class="edit" data-field="purchaseUnit" type="number" min="0" value="${p.purchaseUnit}"></td>
      <td><input class="edit" data-field="margin" type="number" min="0" value="${p.margin}"></td>
      <td><b>${money(p.quote.total)}</b></td>
    </tr>`).join('');
  document.querySelectorAll('#partsBody tr').forEach(tr=>{
    tr.addEventListener('click',e=>{ if(e.target.classList.contains('edit')||e.target.classList.contains('row-check')) return; selectedPartId=tr.dataset.id; renderTable(); renderPreview(); });
    tr.querySelector('.row-check').addEventListener('change',e=>{ const p=findPart(tr.dataset.id); p.selected=e.target.checked; });
    tr.querySelectorAll('.edit').forEach(el=>el.addEventListener('change',e=>{ const p=findPart(tr.dataset.id); const f=e.target.dataset.field; p[f] = ['qty','tapCount','bendCount','purchaseUnit','margin'].includes(f) ? Number(e.target.value)||0 : e.target.value; p.quote=QuoteEngine.calculate(p); renderTable(); renderPreview(); renderTotals(); }));
  });
}
function tagClass(p){ if(p==='CNC/MCT')return'cnc'; if(p==='판금/절곡')return'sheet'; if(p==='프로파일/압출')return'profile'; if(p==='선반')return'lathe'; if(p==='구매품')return'buy'; if(p==='3D프린팅'||p==='사출')return'print'; return'need'; }
function findPart(id){ return parts.find(p=>p.id===id); }
function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function renderPreview(){
  const p = findPart(selectedPartId);
  if(!p){ $('selectedHint').textContent='파트를 선택하세요.'; return; }
  $('selectedHint').textContent = `${p.name} · ${p.process} · ${money(p.quote.total)}`;
  $('previewBox').innerHTML = makeSvg(p);
  $('featureList').innerHTML = `
    <div class="feature"><b>자동 추천 근거</b><span>${p.reasons.join(' / ')}</span></div>
    <div class="feature"><b>형상 추정값</b><span>크기 ${p.features.dims.x}×${p.features.dims.y}×${p.features.dims.z}mm · 부피 ${p.features.volumeCm3.toFixed(1)}cm³ · 두께 일정성 ${(p.features.thicknessConsistency*100).toFixed(0)}%</span></div>
    <div class="feature"><b>탭/절곡 후보</b><span>홀 ${p.features.holeCandidateCount}개 · 탭 ${p.tapCount}개 · 절곡 ${p.bendCount}회 · 절곡 신뢰도 ${p.features.bendConfidence}</span></div>
    <div class="feature"><b>내부 산출</b><span>재료 ${money(p.quote.material)} · 공정 ${money(p.quote.process)} · 추가 ${money(p.quote.extra)} · 마진 ${money(p.quote.margin)}</span></div>`;
}
function makeSvg(p){
  const proc=p.process, name=escapeHtml(p.name.slice(0,34));
  if(proc==='판금/절곡') return `<svg viewBox="0 0 320 210"><path d="M60 140 L60 80 Q60 62 78 62 L220 62 Q242 62 242 84 L242 140 L210 140 L210 92 L92 92 L92 140 Z"/><text x="160" y="178" text-anchor="middle">${name}</text><text x="160" y="34" text-anchor="middle">절곡 ${p.bendCount}회</text></svg>`;
  if(proc==='프로파일/압출') return `<svg viewBox="0 0 320 210"><rect x="40" y="75" width="240" height="60" rx="4"/><path d="M85 75 V135 M130 75 V135 M175 75 V135 M220 75 V135"/><text x="160" y="174" text-anchor="middle">${name}</text><text x="160" y="34" text-anchor="middle">프로파일/압출</text></svg>`;
  if(proc==='선반') return `<svg viewBox="0 0 320 210"><rect x="70" y="85" width="180" height="40" rx="20"/><circle cx="70" cy="105" r="20"/><circle cx="250" cy="105" r="20"/><text x="160" y="174" text-anchor="middle">${name}</text><text x="160" y="34" text-anchor="middle">선반품</text></svg>`;
  if(proc==='구매품') return `<svg viewBox="0 0 320 210"><circle cx="160" cy="95" r="52"/><circle cx="160" cy="95" r="24" fill="#fff"/><text x="160" y="174" text-anchor="middle">${name}</text><text x="160" y="34" text-anchor="middle">구매품</text></svg>`;
  return `<svg viewBox="0 0 320 210"><rect x="70" y="60" width="180" height="92" rx="10"/><rect x="105" y="82" width="70" height="32" rx="5" fill="#fff"/><circle cx="210" cy="100" r="12" fill="#fff"/><text x="160" y="178" text-anchor="middle">${name}</text><text x="160" y="34" text-anchor="middle">${proc}</text></svg>`;
}

function renderTotals(){
  const t = parts.reduce((a,p)=>{ a.material+=p.quote.material; a.process+=p.quote.process; a.extra+=p.quote.extra; a.margin+=p.quote.margin; a.total+=p.quote.total; return a; },{material:0,process:0,extra:0,margin:0,total:0});
  $('totalMaterial').textContent=money(t.material); $('totalProcess').textContent=money(t.process); $('totalExtra').textContent=money(t.extra); $('totalMargin').textContent=money(t.margin); $('grandTotal').textContent=money(t.total); $('sumTotal').textContent=money(t.total);
}
function recalcAll(){ parts.forEach(p=>p.quote=QuoteEngine.calculate(p)); }

function applyBulk(){
  const process=$('bulkProcess').value, material=$('bulkMaterial').value, margin=Number($('bulkMargin').value)||0;
  parts.filter(p=>p.selected).forEach(p=>{p.process=process;p.material=material;p.margin=margin;p.quote=QuoteEngine.calculate(p);});
  renderTable(); renderPreview(); renderTotals();
}
function copyQuote(){
  const total=$('grandTotal').textContent;
  const lines=[`STEP 견적 요약`, `말단 파트: ${parts.length}개`, `최종 제출 견적: ${total}`, '', ...parts.map(p=>`${p.name} x${p.qty} / ${p.process} / ${money(p.quote.total)}`)];
  navigator.clipboard?.writeText(lines.join('\n')); alert('견적 요약을 복사했습니다.');
}
function downloadJson(){
  const data = JSON.stringify({createdAt:new Date().toISOString(), total:$('grandTotal').textContent, parts}, null, 2);
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([data],{type:'application/json'})); a.download='step_quote_result.json'; a.click(); URL.revokeObjectURL(a.href);
}

async function init(){
  try{ const r=await fetch('data/rates.json'); if(r.ok){ const loaded=await r.json(); rates=mergeDeep(rates, loaded.rates || loaded); } }catch(e){}
  hydrateParts(StepParserAdapter.parseText('', '샘플 데이터'));
  $('fileInput').addEventListener('change', async e=>{ const f=e.target.files[0]; if(!f) return; try{ const parsed=await StepParserAdapter.parseFile(f); hydrateParts(parsed); }catch(err){ alert('파일 분석 중 오류: '+err.message); } });
  $('dropZone').addEventListener('dragover',e=>{e.preventDefault();$('dropZone').classList.add('drag')});
  $('dropZone').addEventListener('dragleave',()=>$('dropZone').classList.remove('drag'));
  $('dropZone').addEventListener('drop',async e=>{e.preventDefault();$('dropZone').classList.remove('drag'); const f=e.dataTransfer.files[0]; if(f){ const parsed=await StepParserAdapter.parseFile(f); hydrateParts(parsed); }});
  $('partSearch').addEventListener('input',renderTable);
  $('checkAll').addEventListener('change',e=>{parts.forEach(p=>p.selected=e.target.checked);renderTable();});
  $('applyBulk').addEventListener('click',applyBulk); $('resetSample').addEventListener('click',()=>hydrateParts(StepParserAdapter.parseText('', '샘플 데이터')));
  $('copyQuote').addEventListener('click',copyQuote); $('downloadJson').addEventListener('click',downloadJson);
}
function mergeDeep(target, source){ for(const k in source){ if(source[k] && typeof source[k]==='object' && !Array.isArray(source[k])) target[k]=mergeDeep(target[k]||{},source[k]); else target[k]=source[k]; } return target; }
init();

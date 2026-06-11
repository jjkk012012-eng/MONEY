'use strict';

const KRW = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });
const numberFmt = new Intl.NumberFormat('ko-KR');

const PROCESS = {
  cnc: 'CNC/MCT',
  lathe: '선반',
  sheet: '판금/절곡',
  print3d: '3D프린팅',
  injection: '사출',
  profile: '프로파일/압출',
  weld: '용접',
  buy: '구매품',
  exclude: '제외'
};

const DEFAULT_STATE = {
  factoryName: '우리 공장',
  platformFeeRate: 0,
  global: { qty: 1, material: 'AL6061', finish: 'none', assemblyIncluded: 'yes' },
  selectedPartId: null,
  activeSettingsTab: 'materials',
  bigDataLoaded: false,
  materials: {
    AL6061: { label: 'AL6061', market: 5200, mode: 'percent', addValue: 18, density: 2.70, unit: 'kg' },
    AL7075: { label: 'AL7075', market: 8600, mode: 'percent', addValue: 22, density: 2.81, unit: 'kg' },
    SUS304: { label: 'SUS304', market: 4300, mode: 'amount', addValue: 1200, density: 7.93, unit: 'kg' },
    SS400: { label: 'SS400', market: 1250, mode: 'amount', addValue: 550, density: 7.85, unit: 'kg' },
    POM: { label: 'POM', market: 0, mode: 'direct', addValue: 8200, density: 1.42, unit: 'kg' },
    ABS: { label: 'ABS', market: 0, mode: 'direct', addValue: 4200, density: 1.04, unit: 'kg' },
    PLA: { label: 'PLA', market: 0, mode: 'direct', addValue: 7800, density: 1.24, unit: 'kg' },
    PP: { label: 'PP', market: 0, mode: 'direct', addValue: 2600, density: 0.90, unit: 'kg' }
  },
  finishes: {
    none: { label: '없음', base: 0, surfaceRate: 0 },
    anodize: { label: '아노다이징', base: 25000, surfaceRate: 55 },
    powder: { label: '분체도장', base: 50000, surfaceRate: 38 },
    plating: { label: '도금', base: 45000, surfaceRate: 45 },
    sanding: { label: '샌딩', base: 15000, surfaceRate: 18 }
  },
  processRates: {
    cnc: {
      margin: 22,
      setup: 80000,
      sizeBase: { small: 55000, medium: 130000, large: 290000, xlarge: 520000 },
      complexityAdd: { low: 0, normal: 20, high: 55, extreme: 95 },
      removalRate: 130,
      holeUnit: 800,
      tapUnit: { M3: 1500, M4: 2000, M5: 2200, M6: 2600, M8: 3700, M10: 5200, M12: 7200 },
      blindTapMultiplier: 1.4,
      deepTapMultiplier: 1.8,
      susMultiplier: 1.3
    },
    lathe: {
      margin: 20,
      setup: 60000,
      sizeBase: { small: 45000, medium: 95000, large: 180000, xlarge: 330000 },
      grooveUnit: 4500,
      threadUnit: 7000,
      materialMultiplier: { SUS304: 1.25, SS400: 1.0, AL6061: 1.0, AL7075: 1.1 }
    },
    sheet: {
      margin: 18,
      setup: 50000,
      base: 35000,
      cutPerMeter: 1700,
      bendByThickness: [
        { max: 1.0, unit: 1500 }, { max: 2.0, unit: 2600 }, { max: 3.2, unit: 4200 }, { max: 6.0, unit: 7600 }, { max: 999, unit: 12000 }
      ],
      bendLengthMultiplier: [{ max: 300, mul: 1.0 }, { max: 800, mul: 1.2 }, { max: 1500, mul: 1.55 }, { max: 99999, mul: 2.1 }],
      susMultiplier: 1.3,
      aluminumMultiplier: 1.1,
      holeUnit: 500,
      tapUnit: 1500,
      boxAddRate: 28
    },
    print3d: {
      margin: 30,
      setup: 12000,
      base: 15000,
      volumeRate: { PLA: 260, ABS: 390, POM: 510, AL6061: 0, SUS304: 0, SS400: 0, PP: 420 },
      supportMultiplier: 1.22,
      surfaceFinishBase: 10000,
      complexityAdd: { low: 0, normal: 12, high: 35, extreme: 60 }
    },
    injection: {
      margin: 24,
      moldBase: { simple: 3000000, normal: 5200000, complex: 8500000, extreme: 13500000 },
      shotUnit: 110,
      finishUnit: 60,
      undercutAdd: 600000,
      cavityMultiplier: { one: 1, two: 1.23, four: 1.58, eight: 2.15 }
    },
    profile: {
      margin: 16,
      setup: 25000,
      profiles: { '2020': 4800, '3030': 8200, '4040': 12800, '4080': 22600, '4545': 16200, '6060': 24800, '8080': 43600 },
      cutUnit: 1100,
      tapUnit: 1600,
      bracketUnit: 1300,
      boltNutSet: 350
    },
    weld: {
      margin: 22,
      setup: 60000,
      base: 80000,
      weldPerMeter: 18000,
      grindPerMeter: 6000,
      paintBase: 50000
    },
    buy: {
      margin: 12,
      defaultUnit: 1000
    },
    assembly: {
      margin: 18,
      simpleBase: 50000,
      normalBase: 150000,
      complexBase: 320000,
      fastenerUnit: 600,
      inspectionBase: 50000,
      packagingBase: 30000
    }
  },
  parts: []
};

let state = structuredClone(DEFAULT_STATE);
let heavyCatalog = null;

const $ = (id) => document.getElementById(id);
const els = {
  stepFile: $('stepFile'), dropZone: $('dropZone'), fileMeta: $('fileMeta'), globalQty: $('globalQty'), globalMaterial: $('globalMaterial'), globalFinish: $('globalFinish'), assemblyIncluded: $('assemblyIncluded'),
  customerTotal: $('customerTotal'), customerRange: $('customerRange'), partCount: $('partCount'), processCount: $('processCount'), confidenceAvg: $('confidenceAvg'),
  partList: $('partList'), partSearch: $('partSearch'), processFilter: $('processFilter'), selectedPartName: $('selectedPartName'), selectedPartHint: $('selectedPartHint'), partDetail: $('partDetail'),
  quoteTableBody: document.querySelector('#quoteTable tbody'), settingsContent: $('settingsContent'), loadBigDataBtn: $('loadBigDataBtn'), resetDemoBtn: $('resetDemoBtn'), exportBtn: $('exportBtn'), applyBulkBtn: $('applyBulkBtn'),
  copyCustomerQuoteBtn: $('copyCustomerQuoteBtn'), duplicatePartBtn: $('duplicatePartBtn'), excludePartBtn: $('excludePartBtn')
};

function money(v){ return KRW.format(Math.round(Number(v)||0)); }
function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function uid(){ return 'p_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); }
function pct(v){ return (Number(v)||0) / 100; }
function round(n, d=0){ const m = 10**d; return Math.round((Number(n)||0)*m)/m; }

function init(){
  populateGlobalSelects(); populateProcessFilter(); bindEvents(); createDemoAssembly(); renderAll();
}

function populateGlobalSelects(){
  els.globalMaterial.innerHTML = Object.entries(state.materials).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('');
  els.globalFinish.innerHTML = Object.entries(state.finishes).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('');
}
function populateProcessFilter(){
  els.processFilter.innerHTML = '<option value="all">전체 공법</option>' + Object.entries(PROCESS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
}

function bindEvents(){
  els.stepFile.addEventListener('change', e => handleFile(e.target.files[0]));
  ['dragenter','dragover'].forEach(evt => els.dropZone.addEventListener(evt, e => { e.preventDefault(); els.dropZone.classList.add('drag'); }));
  ['dragleave','drop'].forEach(evt => els.dropZone.addEventListener(evt, e => { e.preventDefault(); els.dropZone.classList.remove('drag'); }));
  els.dropZone.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
  els.globalQty.addEventListener('input', () => { state.global.qty = Number(els.globalQty.value)||1; recalcAll(); });
  els.globalMaterial.addEventListener('change', () => { state.global.material = els.globalMaterial.value; state.parts.forEach(p => { if(!p.userEdited.material) p.material = state.global.material; }); recalcAll(); });
  els.globalFinish.addEventListener('change', () => { state.global.finish = els.globalFinish.value; state.parts.forEach(p => { if(!p.userEdited.finish) p.finish = state.global.finish; }); recalcAll(); });
  els.assemblyIncluded.addEventListener('change', () => { state.global.assemblyIncluded = els.assemblyIncluded.value; recalcAll(); });
  els.partSearch.addEventListener('input', renderPartList);
  els.processFilter.addEventListener('change', renderPartList);
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => { state.activeSettingsTab = btn.dataset.tab; renderSettings(); }));
  els.loadBigDataBtn.addEventListener('click', loadLargeRates);
  els.resetDemoBtn.addEventListener('click', () => { createDemoAssembly(); toast('샘플 어셈블리를 다시 생성했습니다.'); renderAll(); });
  els.exportBtn.addEventListener('click', exportQuoteJson);
  els.applyBulkBtn.addEventListener('click', openBulkPopover);
  els.copyCustomerQuoteBtn.addEventListener('click', copyCustomerQuote);
  els.duplicatePartBtn.addEventListener('click', duplicateSelectedPart);
  els.excludePartBtn.addEventListener('click', excludeSelectedPart);
}

async function handleFile(file){
  if(!file) return;
  els.fileMeta.textContent = `${file.name} · ${(file.size/1024/1024).toFixed(2)}MB · 분석 중...`;
  try{
    const parser = new StepParserAdapter();
    const result = await parser.parse(file);
    state.parts = result.parts.map(p => normalizePart(p));
    state.selectedPartId = state.parts[0]?.id || null;
    els.fileMeta.textContent = `${file.name} · ${(file.size/1024/1024).toFixed(2)}MB · 파트 ${state.parts.length}개 추출`;
    toast('STP 파트 리스트와 자동 분석값을 생성했습니다.');
    renderAll();
  }catch(err){
    console.error(err); toast('파일 분석 중 오류가 발생해 샘플 분석값으로 대체했습니다.');
    createDemoAssembly(); renderAll();
  }
}

class StepParserAdapter{
  async parse(file){
    const text = await this.safeReadText(file);
    const names = this.extractPartNames(text, file.name);
    const uniq = this.groupNames(names);
    const seed = this.hash(file.name + file.size + text.slice(0,10000));
    const parts = uniq.map((item, idx) => this.fakeGeometryFromName(item.name, item.qty, seed + idx));
    return { source: 'step-text-adapter', parts };
  }
  async safeReadText(file){
    // ASCII STEP 파일이면 PRODUCT('파트명') 추출 가능. 바이너리/대형 파일은 앞부분만 읽음.
    const blob = file.slice(0, Math.min(file.size, 7 * 1024 * 1024));
    return await blob.text().catch(()=> '');
  }
  extractPartNames(text, fallback){
    const names = [];
    const patterns = [
      /PRODUCT\s*\(\s*'([^']{1,120})'/gi,
      /NEXT_ASSEMBLY_USAGE_OCCURRENCE\s*\([^,]+,[^,]+,'([^']{1,120})'/gi,
      /MANIFOLD_SOLID_BREP\s*\(\s*'([^']{1,120})'/gi,
      /ADVANCED_BREP_SHAPE_REPRESENTATION\s*\(\s*'([^']{1,120})'/gi
    ];
    for(const re of patterns){ let m; while((m = re.exec(text))){ const cleaned = this.cleanName(m[1]); if(cleaned) names.push(cleaned); } }
    const filtered = names.filter(n => !/^(NONE|ASSEMBLY|DEFAULT|UNKNOWN|PRODUCT)$/i.test(n));
    if(filtered.length) return filtered.slice(0, 220);
    return this.fallbackNames(fallback);
  }
  cleanName(s){ return String(s||'').trim().replace(/\\X2\\|\\X0\\/g,'').replace(/[<>]/g,'').slice(0,80); }
  groupNames(names){
    const map = new Map();
    names.forEach(n => { const key = n.toUpperCase(); map.set(key, { name:n, qty:(map.get(key)?.qty||0)+1 }); });
    return [...map.values()].slice(0,160);
  }
  fallbackNames(base){
    return ['BASE_PLATE','SIDE_BRACKET_L','SIDE_BRACKET_R','COVER_TOP','PROFILE_4040_FRONT','PROFILE_4040_SIDE','SHAFT_12D','BUSHING_12','MOTOR_BRACKET','SENSOR_BRACKET','BOLT_M6','NUT_M6','BEARING_6001','PANEL_GUARD','JIG_BLOCK','SPACER_PIN'];
  }
  hash(str){ let h=2166136261; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h += (h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24); } return Math.abs(h>>>0); }
  rnd(seed){ const x = Math.sin(seed) * 10000; return x - Math.floor(x); }
  fakeGeometryFromName(name, qty, seed){
    const upper = name.toUpperCase();
    let profile = 'block';
    if(/BOLT|NUT|BEARING|SENSOR|MOTOR|LM|CYLINDER|SWITCH|CHAIN|BELT/.test(upper)) profile='buy';
    else if(/PROFILE|FRAME|4040|3030|2020|4080|6060|8080/.test(upper)) profile='profile';
    else if(/COVER|BRACKET|SHEET|PANEL|GUARD|DUCT|BEND/.test(upper)) profile='sheet';
    else if(/SHAFT|PIN|BUSH|ROLLER|PIPE|SPACER/.test(upper)) profile='lathe';
    else if(/CASE|HOUSING|CAP|KNOB|HANDLE/.test(upper)) profile='injection';
    const r = (n,min,max) => round(min + this.rnd(seed+n)*(max-min), 1);
    let dims = { x:r(1,40,420), y:r(2,25,240), z:r(3,8,80) };
    if(profile==='sheet') dims = { x:r(1,80,620), y:r(2,45,420), z:r(3,1.0,3.2) };
    if(profile==='profile') dims = { x:r(1,300,1800), y:r(2,20,80), z:r(3,20,80) };
    if(profile==='lathe') dims = { x:r(1,40,360), y:r(2,8,65), z:r(2,8,65) };
    if(profile==='buy') dims = { x:r(1,6,80), y:r(2,6,80), z:r(3,3,45) };
    const bboxVol = dims.x*dims.y*dims.z/1000; // cm3
    const solidity = profile==='sheet'?0.18:profile==='profile'?0.42:profile==='lathe'?0.55:profile==='buy'?0.6:r(4,.28,.74);
    const volumeCm3 = round(bboxVol*solidity,1);
    const surfaceCm2 = round(2*(dims.x*dims.y+dims.y*dims.z+dims.x*dims.z)/100 * (profile==='sheet'?1.15:1),1);
    const holes = this.makeHoleCandidates(profile, seed, dims);
    const bends = this.makeBendCandidates(profile, seed, dims);
    const recommendation = recommendProcess(name, { dims, volumeCm3, surfaceCm2, holes, bends, profile });
    return { id: uid(), name, assemblyPath: 'ROOT/'+name, qty, dims, volumeCm3, surfaceCm2, thicknessMm: profile==='sheet'?round(dims.z,1):null, holes, bends, recommendation, confidence: recommendation.confidence, category: profile==='buy'?'buy':'make', process: recommendation.process, material: state.global.material, finish: state.global.finish, included:'yes', custom: defaultCustom(), userEdited:{} };
  }
  makeHoleCandidates(profile, seed, dims){
    if(profile==='buy' || profile==='profile') return [];
    const count = profile==='sheet' ? Math.floor(this.rnd(seed+8)*12) : Math.floor(this.rnd(seed+9)*16);
    const taps = [2.5,3.3,4.2,5.0,6.8,8.5,10.2];
    return Array.from({length:count},(_,i)=>{
      const dia = this.rnd(seed+i)>.55 ? taps[Math.floor(this.rnd(seed+i+2)*taps.length)] : round(3+this.rnd(seed+i+3)*15,1);
      const tap = tapFromDrillDia(dia);
      return { id: uid(), dia, depth: round(3+this.rnd(seed+i+4)*Math.max(6,dims.z),1), through: this.rnd(seed+i+5)>.35, isTapCandidate: !!tap, tapSize: tap||'일반홀', selected: !!tap && this.rnd(seed+i+6)>.25 };
    });
  }
  makeBendCandidates(profile, seed, dims){
    if(profile!=='sheet') return [];
    const count = Math.max(1, Math.floor(this.rnd(seed+13)*8));
    return Array.from({length:count},(_,i)=>({ id:uid(), angle:[90,90,90,135,45][Math.floor(this.rnd(seed+i)*5)], length: round(80+this.rnd(seed+i+1)*Math.max(dims.x,dims.y),0), selected:true }));
  }
}

function tapFromDrillDia(dia){
  const table = [{d:2.5,t:'M3'},{d:3.3,t:'M4'},{d:4.2,t:'M5'},{d:5.0,t:'M6'},{d:6.8,t:'M8'},{d:8.5,t:'M10'},{d:10.2,t:'M12'}];
  const found = table.find(x => Math.abs(dia-x.d)<=0.25); return found?.t || null;
}

function recommendProcess(name, g){
  const n = name.toUpperCase();
  const scores = { cnc:0, lathe:0, sheet:0, print3d:0, injection:0, profile:0, buy:0 };
  if(/BOLT|NUT|BEARING|SENSOR|MOTOR|CYLINDER|LM|SWITCH|BELT|CHAIN/.test(n)) scores.buy += 90;
  if(/PROFILE|FRAME|4040|3030|2020|4080|6060|8080/.test(n)) scores.profile += 85;
  if(/PLATE|BASE|BLOCK|JIG|MOUNT/.test(n)) scores.cnc += 45;
  if(/SHAFT|PIN|BUSH|ROLLER|PIPE|SPACER/.test(n)) scores.lathe += 70;
  if(/BRACKET|COVER|SHEET|PANEL|GUARD|DUCT/.test(n)) scores.sheet += 70;
  if(/CASE|HOUSING|CAP|KNOB|HANDLE/.test(n)) { scores.injection += 42; scores.print3d += 35; }
  const slender = g.dims.x / Math.max(g.dims.y,g.dims.z);
  if(slender > 8) scores.profile += 35;
  if(g.thicknessMm && g.thicknessMm <= 6 && g.bends.length) scores.sheet += 45;
  if(Math.abs(g.dims.y-g.dims.z) < 4 && g.dims.x > g.dims.y*2.5) scores.lathe += 35;
  if(g.volumeCm3 < 80 && g.surfaceCm2 > 120) scores.print3d += 20;
  if(g.holes.length > 4) scores.cnc += 20;
  const sorted = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  const process = sorted[0][0]; const confidence = clamp(Math.round(sorted[0][1]), 35, 96);
  return { process, confidence, scores };
}

function normalizePart(p){
  return { ...p, id:p.id||uid(), material:p.material||state.global.material, finish:p.finish||state.global.finish, included:p.included||'yes', category:p.category||'make', custom:{...defaultCustom(), ...(p.custom||{})}, userEdited:p.userEdited||{} };
}
function defaultCustom(){
  return { complexity:'normal', sizeClass:'auto', useTapCandidates:true, manualTapCount:0, useBendCandidates:true, manualBendCount:0, profileSpec:'4040', profileLengthMm:null, profileCuts:null, profileTapCount:0, bracketCount:0, boltNutCount:0, buyUnitPrice:1000, moldComplexity:'normal', cavity:'one', includeMold:true, supportNeeded:false, weldLengthM:0, grindLengthM:0, assemblyLevel:'normal' };
}

function createDemoAssembly(){
  const adapter = new StepParserAdapter();
  const names = ['BASE_PLATE','SIDE_BRACKET_L','SIDE_BRACKET_R','COVER_TOP','PROFILE_4040_FRONT','PROFILE_4040_SIDE','PROFILE_4040_SIDE','SHAFT_12D','BUSHING_12','MOTOR_BRACKET','SENSOR_BRACKET','BOLT_M6','BOLT_M6','BOLT_M6','BOLT_M6','NUT_M6','NUT_M6','BEARING_6001','PANEL_GUARD','JIG_BLOCK','SPACER_PIN','COVER_SMALL','FRAME_3030_REAR','BRACKET_BEND_2T'];
  state.parts = adapter.groupNames(names).map((item,idx)=>normalizePart(adapter.fakeGeometryFromName(item.name,item.qty,17000+idx*19)));
  state.selectedPartId = state.parts[0]?.id || null;
}

function materialUnitPrice(key){
  const m = state.materials[key] || state.materials.AL6061;
  if(m.mode==='percent') return m.market * (1 + pct(m.addValue));
  if(m.mode==='amount') return m.market + Number(m.addValue||0);
  return Number(m.addValue||0);
}
function partWeightKg(part){ const mat = state.materials[part.material] || state.materials.AL6061; return part.volumeCm3 * mat.density / 1000; }
function selectedTaps(part){ return part.holes.filter(h => h.selected && h.isTapCandidate); }
function selectedBends(part){ return part.bends.filter(b => b.selected); }
function sizeClass(part){
  if(part.custom.sizeClass && part.custom.sizeClass !== 'auto') return part.custom.sizeClass;
  const max = Math.max(part.dims.x, part.dims.y, part.dims.z);
  if(max < 80) return 'small'; if(max < 260) return 'medium'; if(max < 700) return 'large'; return 'xlarge';
}
function complexityMultiplier(part, rate){ return 1 + pct((rate.complexityAdd || {})[part.custom.complexity] || 0); }
function finishCost(part){
  const f = state.finishes[part.finish] || state.finishes.none;
  if(part.finish === 'none') return 0;
  return f.base + (part.surfaceCm2 * f.surfaceRate);
}
function marginApply(base, rate){ return base * (1 + pct(rate.margin || 0)); }

function calculatePart(part){
  if(part.included==='no' || part.category==='exclude' || part.process==='exclude') return zeroCost(part);
  if(part.category==='buy' || part.process==='buy') return calcBuy(part);
  const calculators = { cnc:calcCnc, lathe:calcLathe, sheet:calcSheet, print3d:calcPrint3d, injection:calcInjection, profile:calcProfile, weld:calcWeld };
  return (calculators[part.process] || calcCnc)(part);
}
function zeroCost(part){ return { partId:part.id, material:0, process:0, extra:0, margin:0, total:0, notes:['견적 제외']}; }
function baseMaterialCost(part){ return partWeightKg(part) * materialUnitPrice(part.material) * part.qty * state.global.qty; }
function calcCnc(part){
  const r = state.processRates.cnc; const qty = part.qty * state.global.qty; const matCost = baseMaterialCost(part);
  const bboxVol = part.dims.x*part.dims.y*part.dims.z/1000; const removalCm3 = Math.max(0, bboxVol - part.volumeCm3);
  const base = (r.sizeBase[sizeClass(part)] || r.sizeBase.medium) * qty;
  const removal = removalCm3 * r.removalRate * qty;
  const holes = part.holes.filter(h=>!h.selected).length * r.holeUnit * qty;
  let taps = 0; selectedTaps(part).forEach(h => { let u = r.tapUnit[h.tapSize] || 2500; if(!h.through) u *= r.blindTapMultiplier; if(h.depth > 2.5*h.dia) u *= r.deepTapMultiplier; if(part.material==='SUS304') u *= r.susMultiplier; taps += u * qty; });
  taps += (Number(part.custom.manualTapCount)||0) * (r.tapUnit.M6 || 2600) * qty;
  const process = (base + removal + holes + taps + r.setup) * complexityMultiplier(part,r);
  const extra = finishCost(part) * qty;
  const before = matCost + process + extra; const total = marginApply(before,r);
  return { partId:part.id, material:matCost, process, extra, margin:total-before, total, notes:[`탭 ${selectedTaps(part).length + Number(part.custom.manualTapCount||0)}개`, `홀 ${part.holes.length}개`, `크기 ${sizeClass(part)}`] };
}
function calcLathe(part){
  const r = state.processRates.lathe; const qty=part.qty*state.global.qty; const matCost=baseMaterialCost(part); const base=(r.sizeBase[sizeClass(part)]||r.sizeBase.medium)*qty; const grooves=Math.round(part.holes.length/2)*r.grooveUnit*qty; const mult=(r.materialMultiplier[part.material]||1); const process=(base+grooves+r.setup)*mult; const extra=finishCost(part)*qty; const before=matCost+process+extra; const total=marginApply(before,r); return {partId:part.id,material:matCost,process,extra,margin:total-before,total,notes:[`선반형 추정`, `홈/구멍 ${Math.round(part.holes.length/2)}개`]};
}
function bendUnitByThickness(th){ return (state.processRates.sheet.bendByThickness.find(x => th <= x.max) || {unit:8000}).unit; }
function bendLengthMul(len){ return (state.processRates.sheet.bendLengthMultiplier.find(x => len <= x.max) || {mul:2}).mul; }
function calcSheet(part){
  const r = state.processRates.sheet; const qty=part.qty*state.global.qty; const matCost=baseMaterialCost(part); const th=part.thicknessMm || Math.min(part.dims.x,part.dims.y,part.dims.z); const areaM2=(part.surfaceCm2/10000)*0.62; const cutLenM=(2*(part.dims.x+part.dims.y)/1000)+(part.holes.length*0.025); const cut=cutLenM*r.cutPerMeter*qty; let bend=0; selectedBends(part).forEach(b=>{ let unit=bendUnitByThickness(th); unit*=bendLengthMul(b.length); if(part.material==='SUS304') unit*=r.susMultiplier; if(part.material.startsWith('AL')) unit*=r.aluminumMultiplier; bend+=unit*qty; }); bend += (Number(part.custom.manualBendCount)||0)*bendUnitByThickness(th)*qty; const holes=part.holes.length*r.holeUnit*qty; const taps=selectedTaps(part).length*r.tapUnit*qty; const boxAdd=(selectedBends(part).length>=4)?pct(r.boxAddRate):0; const process=(r.base+r.setup+cut+bend+holes+taps)*(1+boxAdd); const extra=finishCost(part)*qty; const before=matCost+process+extra; const total=marginApply(before,r); return {partId:part.id,material:matCost,process,extra,margin:total-before,total,notes:[`두께 ${round(th,1)}T`, `절곡 ${selectedBends(part).length+Number(part.custom.manualBendCount||0)}회`, `절단 ${round(cutLenM,2)}m`]};
}
function calcPrint3d(part){
  const r=state.processRates.print3d; const qty=part.qty*state.global.qty; const matCost=baseMaterialCost(part); const volumeRate=r.volumeRate[part.material] || r.volumeRate.ABS; const volumeCost=part.volumeCm3*volumeRate*qty; const support=part.custom.supportNeeded?volumeCost*(r.supportMultiplier-1):0; const process=(r.base+r.setup+volumeCost+support)*complexityMultiplier(part,r); const extra=(part.finish==='none'?0:r.surfaceFinishBase)*qty; const before=matCost+process+extra; const total=marginApply(before,r); return {partId:part.id,material:matCost,process,extra,margin:total-before,total,notes:[`부피 ${round(part.volumeCm3,1)}cm³`, part.custom.supportNeeded?'서포트 포함':'서포트 미포함']};
}
function calcInjection(part){
  const r=state.processRates.injection; const qty=part.qty*state.global.qty; const matCost=baseMaterialCost(part); const mold=part.custom.includeMold ? (r.moldBase[part.custom.moldComplexity]||r.moldBase.normal)*(r.cavityMultiplier[part.custom.cavity]||1) : 0; const shot=(r.shotUnit+r.finishUnit)*qty; const undercut=part.recommendation.scores.injection>50 && part.custom.moldComplexity!=='simple' ? r.undercutAdd : 0; const process=mold+shot+undercut; const extra=finishCost(part)*qty; const before=matCost+process+extra; const total=marginApply(before,r); return {partId:part.id,material:matCost,process,extra,margin:total-before,total,notes:[part.custom.includeMold?'금형 포함':'금형 제외', `금형 ${part.custom.moldComplexity}`, `캐비티 ${part.custom.cavity}`]};
}
function calcProfile(part){
  const r=state.processRates.profile; const qty=part.qty*state.global.qty; const spec=part.custom.profileSpec||'4040'; const lenMm=Number(part.custom.profileLengthMm)||Math.max(part.dims.x,part.dims.y,part.dims.z); const cuts=Number(part.custom.profileCuts)||part.qty; const lengthM=(lenMm/1000)*part.qty*state.global.qty; const material=lengthM*(r.profiles[spec]||r.profiles['4040']); const process=r.setup+(cuts*r.cutUnit*state.global.qty)+(Number(part.custom.profileTapCount||0)*r.tapUnit*qty)+(Number(part.custom.bracketCount||0)*r.bracketUnit*state.global.qty)+(Number(part.custom.boltNutCount||0)*r.boltNutSet*state.global.qty); const extra=finishCost(part)*qty; const before=material+process+extra; const total=marginApply(before,r); return {partId:part.id,material,process,extra,margin:total-before,total,notes:[`${spec}`, `${round(lengthM,2)}m`, `절단 ${cuts}회`]};
}
function calcWeld(part){
  const r=state.processRates.weld; const qty=part.qty*state.global.qty; const matCost=baseMaterialCost(part); const weld=Number(part.custom.weldLengthM||0)*r.weldPerMeter*qty; const grind=Number(part.custom.grindLengthM||0)*r.grindPerMeter*qty; const process=r.base+r.setup+weld+grind; const extra=part.finish==='powder'?r.paintBase:finishCost(part)*qty; const before=matCost+process+extra; const total=marginApply(before,r); return {partId:part.id,material:matCost,process,extra,margin:total-before,total,notes:[`용접 ${part.custom.weldLengthM||0}m`, `사상 ${part.custom.grindLengthM||0}m`]};
}
function calcBuy(part){
  const r=state.processRates.buy; const qty=part.qty*state.global.qty; const unit=Number(part.custom.buyUnitPrice)||r.defaultUnit; const before=unit*qty; const total=marginApply(before,r); return {partId:part.id,material:0,process:before,extra:0,margin:total-before,total,notes:[`구매품 단가 ${money(unit)}`]};
}
function calcAssembly(){
  if(state.global.assemblyIncluded !== 'yes') return {material:0, process:0, extra:0, margin:0, total:0, notes:['조립 미포함']};
  const r=state.processRates.assembly; const included=state.parts.filter(p=>p.included==='yes'&&p.process!=='exclude'); const partUnits=included.reduce((a,p)=>a+p.qty,0)*state.global.qty; const fasteners=state.parts.reduce((a,p)=>a+(p.name.match(/BOLT|NUT|SCREW/i)?p.qty:0),0)*state.global.qty; const level=partUnits>50?'complex':partUnits>18?'normal':'simple'; const base=level==='complex'?r.complexBase:level==='normal'?r.normalBase:r.simpleBase; const process=base+(fasteners*r.fastenerUnit); const extra=r.inspectionBase+r.packagingBase; const before=process+extra; const total=marginApply(before,r); return {material:0, process, extra, margin:total-before, total, notes:[`조립 난이도 ${level}`, `체결류 ${fasteners}개`]};
}

function recalcAll(){ renderAll(); }
function getCosts(){ const partCosts=state.parts.map(p=>calculatePart(p)); const assembly=calcAssembly(); const partsTotal=partCosts.reduce((a,c)=>a+c.total,0); return {partCosts, assembly, total:partsTotal+assembly.total}; }

function renderAll(){ populateGlobalSelects(); els.globalQty.value=state.global.qty; els.globalMaterial.value=state.global.material; els.globalFinish.value=state.global.finish; els.assemblyIncluded.value=state.global.assemblyIncluded; renderPartList(); renderPartDetail(); renderSettings(); renderQuoteTable(); renderTotals(); }
function renderPartList(){
  const q=els.partSearch.value?.toLowerCase()||''; const f=els.processFilter.value||'all'; const rows=state.parts.filter(p=>(!q||p.name.toLowerCase().includes(q))&&(f==='all'||p.process===f));
  if(!rows.length){ els.partList.className='part-list empty'; els.partList.textContent='표시할 파트가 없습니다.'; return; }
  els.partList.className='part-list';
  els.partList.innerHTML=rows.map(p=>`<div class="part-item ${p.id===state.selectedPartId?'active':''} ${p.included==='no'?'excluded':''}" data-id="${p.id}">
    <input type="checkbox" data-check="${p.id}" ${p.bulkSelected?'checked':''}/>
    <div><div class="name">${escapeHtml(p.name)}</div><div class="meta">x${p.qty} · ${round(p.dims.x)}×${round(p.dims.y)}×${round(p.dims.z)}mm · 신뢰도 ${p.confidence}%</div></div>
    <span class="process-pill">${PROCESS[p.process]||p.process}</span>
  </div>`).join('');
  els.partList.querySelectorAll('.part-item').forEach(el=> el.addEventListener('click', e=>{ if(e.target.type==='checkbox'){ const p=partById(e.target.dataset.check); p.bulkSelected=e.target.checked; return; } state.selectedPartId=el.dataset.id; renderPartList(); renderPartDetail(); }));
}
function partById(id){ return state.parts.find(p=>p.id===id); }
function renderPartDetail(){
  const part=partById(state.selectedPartId); if(!part){ els.partDetail.innerHTML='<div class="empty-state"><h3>파트 없음</h3><p>샘플 생성 또는 STP 파일을 업로드하세요.</p></div>'; return; }
  els.selectedPartName.textContent=part.name; els.selectedPartHint.textContent=`${part.assemblyPath} · 자동 추천 ${PROCESS[part.recommendation.process]} · 신뢰도 ${part.confidence}%`;
  const tpl=document.getElementById('partDetailTemplate').content.cloneNode(true); const root=document.createElement('div'); root.appendChild(tpl); els.partDetail.innerHTML=''; els.partDetail.appendChild(root);
  const metrics=root.querySelector('.analysis-metrics');
  metrics.innerHTML=[['크기',`${round(part.dims.x)} × ${round(part.dims.y)} × ${round(part.dims.z)} mm`],['부피',`${round(part.volumeCm3,1)} cm³`],['표면적',`${round(part.surfaceCm2,1)} cm²`],['예상 중량',`${round(partWeightKg(part),3)} kg`],['홀 후보',`${part.holes.length}개`],['탭 후보',`${part.holes.filter(h=>h.isTapCandidate).length}개`],['절곡 후보',`${part.bends.length}회`],['두께 추정',part.thicknessMm?`${part.thicknessMm}T`:'-']].map(([a,b])=>`<div class="metric"><span>${a}</span><b>${b}</b></div>`).join('');
  root.querySelector('.recommend-box').innerHTML=`<b>추천 공법: ${PROCESS[part.recommendation.process]}</b><br><span class="hint">자동값은 초기값입니다. 실제 견적은 공장이 오른쪽에서 수정/확정합니다.</span>`;
  bindBaseFields(root, part); renderProcessOptions(root, part); renderPartCost(root, part);
}
function bindBaseFields(root, part){
  const setSelect = (sel, options, val) => { sel.innerHTML=options; sel.value=val; };
  setSelect(root.querySelector('[data-field="process"]'), Object.entries(PROCESS).map(([k,v])=>`<option value="${k}">${v}</option>`).join(''), part.process);
  setSelect(root.querySelector('[data-field="material"]'), Object.entries(state.materials).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join(''), part.material);
  setSelect(root.querySelector('[data-field="finish"]'), Object.entries(state.finishes).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join(''), part.finish);
  root.querySelector('[data-field="included"]').value=part.included;
  root.querySelector('[data-field="qty"]').value=part.qty;
  root.querySelector('[data-field="category"]').value=part.category;
  root.querySelectorAll('[data-field]').forEach(el=>el.addEventListener('change',()=>{ const field=el.dataset.field; let value=el.value; if(field==='qty') value=Number(value)||1; part[field]=value; part.userEdited[field]=true; if(field==='process') { if(value==='buy') part.category='buy'; if(value==='exclude') part.category='exclude'; } renderAll(); }));
}
function renderProcessOptions(root, part){
  const box=root.querySelector('.process-options');
  if(part.process==='cnc' || part.process==='lathe') box.innerHTML=renderCncOptions(part);
  else if(part.process==='sheet') box.innerHTML=renderSheetOptions(part);
  else if(part.process==='profile') box.innerHTML=renderProfileOptions(part);
  else if(part.process==='print3d') box.innerHTML=renderPrintOptions(part);
  else if(part.process==='injection') box.innerHTML=renderInjectionOptions(part);
  else if(part.process==='weld') box.innerHTML=renderWeldOptions(part);
  else if(part.process==='buy' || part.category==='buy') box.innerHTML=renderBuyOptions(part);
  else box.innerHTML='<p class="hint">견적 제외 또는 공법 미선택 상태입니다.</p>';
  box.querySelectorAll('[data-custom]').forEach(el=>el.addEventListener('change',()=>{ const k=el.dataset.custom; if(el.type==='checkbox') part.custom[k]=el.checked; else if(el.value==='true') part.custom[k]=true; else if(el.value==='false') part.custom[k]=false; else part.custom[k]=el.value; renderAll(); }));
  box.querySelectorAll('[data-hole]').forEach(el=>el.addEventListener('change',()=>{ const h=part.holes.find(x=>x.id===el.dataset.hole); if(h) h.selected=el.checked; renderAll(); }));
  box.querySelectorAll('[data-bend]').forEach(el=>el.addEventListener('change',()=>{ const b=part.bends.find(x=>x.id===el.dataset.bend); if(b) b.selected=el.checked; renderAll(); }));
}
function renderCncOptions(part){
  return `<div class="option-grid"><label>복잡도<select data-custom="complexity"><option value="low" ${part.custom.complexity==='low'?'selected':''}>낮음</option><option value="normal" ${part.custom.complexity==='normal'?'selected':''}>보통</option><option value="high" ${part.custom.complexity==='high'?'selected':''}>높음</option><option value="extreme" ${part.custom.complexity==='extreme'?'selected':''}>매우 높음</option></select></label><label>크기 등급<select data-custom="sizeClass"><option value="auto" ${part.custom.sizeClass==='auto'?'selected':''}>자동</option><option value="small" ${part.custom.sizeClass==='small'?'selected':''}>소형</option><option value="medium" ${part.custom.sizeClass==='medium'?'selected':''}>중형</option><option value="large" ${part.custom.sizeClass==='large'?'selected':''}>대형</option><option value="xlarge" ${part.custom.sizeClass==='xlarge'?'selected':''}>초대형</option></select></label><label>수동 탭 추가<input data-custom="manualTapCount" type="number" min="0" value="${part.custom.manualTapCount}"></label></div>${renderTapCandidates(part)}`;
}
function renderTapCandidates(part){
  if(!part.holes.length) return '<p class="hint">홀/탭 후보가 없습니다. 필요하면 수동 탭 추가를 사용하세요.</p>';
  return `<h4>탭 후보 확인</h4><div class="candidate-list">${part.holes.map(h=>`<label class="candidate"><input type="checkbox" data-hole="${h.id}" ${h.selected?'checked':''}/><span>Ø${h.dia} · ${h.tapSize||'일반홀'} · ${h.through?'관통':'막힌'} · 깊이 ${h.depth}mm<br><small>${h.isTapCandidate?'탭 드릴 규격 후보':'일반 홀 후보'}</small></span><b>${h.selected?'적용':'미적용'}</b></label>`).join('')}</div>`;
}
function renderSheetOptions(part){
  return `<div class="option-grid"><label>복잡도<select data-custom="complexity"><option value="low" ${part.custom.complexity==='low'?'selected':''}>낮음</option><option value="normal" ${part.custom.complexity==='normal'?'selected':''}>보통</option><option value="high" ${part.custom.complexity==='high'?'selected':''}>높음</option><option value="extreme" ${part.custom.complexity==='extreme'?'selected':''}>매우 높음</option></select></label><label>수동 절곡 추가<input data-custom="manualBendCount" type="number" min="0" value="${part.custom.manualBendCount}"></label></div>${renderBendCandidates(part)}${renderTapCandidates(part)}`;
}
function renderBendCandidates(part){
  if(!part.bends.length) return '<p class="hint">절곡 후보가 없습니다. 수동 절곡 추가로 보정할 수 있습니다.</p>';
  return `<h4>절곡 후보 확인</h4><div class="candidate-list">${part.bends.map((b,i)=>`<label class="candidate"><input type="checkbox" data-bend="${b.id}" ${b.selected?'checked':''}/><span>절곡 ${i+1} · ${b.angle}° · 길이 ${b.length}mm<br><small>일정 두께 + 접힌 엣지 기반 후보</small></span><b>${b.selected?'적용':'미적용'}</b></label>`).join('')}</div>`;
}
function renderProfileOptions(part){ return `<div class="option-grid"><label>프로파일 규격<select data-custom="profileSpec">${Object.keys(state.processRates.profile.profiles).map(x=>`<option value="${x}" ${part.custom.profileSpec===x?'selected':''}>${x}</option>`).join('')}</select></label><label>파트당 길이 mm<input data-custom="profileLengthMm" type="number" min="0" value="${part.custom.profileLengthMm||Math.max(part.dims.x,part.dims.y,part.dims.z)}"></label><label>절단 횟수<input data-custom="profileCuts" type="number" min="0" value="${part.custom.profileCuts||part.qty}"></label><label>탭 개수<input data-custom="profileTapCount" type="number" min="0" value="${part.custom.profileTapCount}"></label><label>브라켓 개수<input data-custom="bracketCount" type="number" min="0" value="${part.custom.bracketCount}"></label><label>볼트/너트 세트<input data-custom="boltNutCount" type="number" min="0" value="${part.custom.boltNutCount}"></label></div>`; }
function renderPrintOptions(part){ return `<div class="option-grid"><label>복잡도<select data-custom="complexity"><option value="low" ${part.custom.complexity==='low'?'selected':''}>낮음</option><option value="normal" ${part.custom.complexity==='normal'?'selected':''}>보통</option><option value="high" ${part.custom.complexity==='high'?'selected':''}>높음</option><option value="extreme" ${part.custom.complexity==='extreme'?'selected':''}>매우 높음</option></select></label><label>서포트 필요<select data-custom="supportNeeded"><option value="false" ${!part.custom.supportNeeded?'selected':''}>아니오</option><option value="true" ${part.custom.supportNeeded?'selected':''}>예</option></select></label></div>`; }
function renderInjectionOptions(part){ return `<div class="option-grid"><label>금형 포함<select data-custom="includeMold"><option value="true" ${part.custom.includeMold?'selected':''}>포함</option><option value="false" ${!part.custom.includeMold?'selected':''}>제외</option></select></label><label>금형 난이도<select data-custom="moldComplexity"><option value="simple" ${part.custom.moldComplexity==='simple'?'selected':''}>단순</option><option value="normal" ${part.custom.moldComplexity==='normal'?'selected':''}>보통</option><option value="complex" ${part.custom.moldComplexity==='complex'?'selected':''}>복잡</option><option value="extreme" ${part.custom.moldComplexity==='extreme'?'selected':''}>매우 복잡</option></select></label><label>캐비티<select data-custom="cavity"><option value="one" ${part.custom.cavity==='one'?'selected':''}>1</option><option value="two" ${part.custom.cavity==='two'?'selected':''}>2</option><option value="four" ${part.custom.cavity==='four'?'selected':''}>4</option><option value="eight" ${part.custom.cavity==='eight'?'selected':''}>8</option></select></label></div>`; }
function renderWeldOptions(part){ return `<div class="option-grid"><label>용접 길이 m<input data-custom="weldLengthM" type="number" min="0" step="0.1" value="${part.custom.weldLengthM}"></label><label>사상 길이 m<input data-custom="grindLengthM" type="number" min="0" step="0.1" value="${part.custom.grindLengthM}"></label></div>`; }
function renderBuyOptions(part){ return `<div class="option-grid"><label>구매 단가<input data-custom="buyUnitPrice" type="number" min="0" value="${part.custom.buyUnitPrice}"></label><label>구매 마진율 %<input data-rate="buy.margin" type="number" min="0" value="${state.processRates.buy.margin}"></label></div>`; }
function renderPartCost(root, part){
  const c=calculatePart(part); root.querySelector('.part-cost-box').innerHTML=`${line('재료비',c.material)}${line('공정비',c.process)}${line('후처리/추가',c.extra)}${line('공법 마진',c.margin)}<div class="cost-line total"><span>고객 제출가</span><b>${money(c.total)}</b></div><div class="hint">${c.notes.map(n=>`<span class="summary-chip">${escapeHtml(n)}</span>`).join('')}</div>`;
}
function line(label,val){ return `<div class="cost-line"><span>${label}</span><b>${money(val)}</b></div>`; }

function renderSettings(){
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===state.activeSettingsTab));
  if(state.activeSettingsTab==='materials') renderMaterialSettings();
  else if(state.activeSettingsTab==='processes') renderProcessSettings();
  else renderAssemblySettings();
}
function renderMaterialSettings(){
  els.settingsContent.innerHTML=Object.entries(state.materials).map(([k,m])=>`<div class="settings-block"><h3>${m.label}</h3><div class="settings-row"><label>기준 시세 원/kg<input data-material="${k}" data-key="market" type="number" value="${m.market}"></label><label>적용 방식<select data-material="${k}" data-key="mode"><option value="amount" ${m.mode==='amount'?'selected':''}>시세 + 금액</option><option value="percent" ${m.mode==='percent'?'selected':''}>시세 + %</option><option value="direct" ${m.mode==='direct'?'selected':''}>직접 입력</option></select></label><label>추가값 / 직접단가<input data-material="${k}" data-key="addValue" type="number" value="${m.addValue}"></label><label>적용 단가<input readonly value="${Math.round(materialUnitPrice(k))} 원/kg"></label></div></div>`).join('');
  els.settingsContent.querySelectorAll('[data-material]').forEach(el=>el.addEventListener('change',()=>{ const m=state.materials[el.dataset.material]; const key=el.dataset.key; m[key]=key==='mode'?el.value:Number(el.value)||0; renderAll(); }));
}
function renderProcessSettings(){
  const entries=['cnc','lathe','sheet','print3d','injection','profile','weld','buy'];
  els.settingsContent.innerHTML=entries.map(k=>`<div class="settings-block"><h3>${PROCESS[k]} 마진/기본비</h3><div class="settings-row"><label>마진율 %<input data-process="${k}" data-key="margin" type="number" value="${state.processRates[k].margin||0}"></label>${renderMainRateInput(k)}</div></div>`).join('');
  els.settingsContent.querySelectorAll('[data-process]').forEach(el=>el.addEventListener('change',()=>{ const r=state.processRates[el.dataset.process]; r[el.dataset.key]=Number(el.value)||0; renderAll(); }));
}
function renderMainRateInput(k){
  const r=state.processRates[k]; if(k==='cnc') return `<label>셋업비<input data-process="${k}" data-key="setup" type="number" value="${r.setup}"></label>`;
  if(k==='sheet') return `<label>절곡/판금 셋업비<input data-process="${k}" data-key="setup" type="number" value="${r.setup}"></label>`;
  if(k==='print3d') return `<label>출력 기본비<input data-process="${k}" data-key="base" type="number" value="${r.base}"></label>`;
  if(k==='profile') return `<label>프로파일 셋업비<input data-process="${k}" data-key="setup" type="number" value="${r.setup}"></label>`;
  if(k==='buy') return `<label>기본 구매 단가<input data-process="${k}" data-key="defaultUnit" type="number" value="${r.defaultUnit}"></label>`;
  return `<label>기본비<input data-process="${k}" data-key="setup" type="number" value="${r.setup||r.base||0}"></label>`;
}
function renderAssemblySettings(){
  const r=state.processRates.assembly;
  els.settingsContent.innerHTML=`<div class="settings-block"><h3>조립/검사/포장</h3><div class="settings-row"><label>조립 마진율 %<input data-assembly="margin" type="number" value="${r.margin}"></label><label>단순 조립 기본비<input data-assembly="simpleBase" type="number" value="${r.simpleBase}"></label><label>보통 조립 기본비<input data-assembly="normalBase" type="number" value="${r.normalBase}"></label><label>복잡 조립 기본비<input data-assembly="complexBase" type="number" value="${r.complexBase}"></label><label>체결류 개당 비용<input data-assembly="fastenerUnit" type="number" value="${r.fastenerUnit}"></label><label>검사 기본비<input data-assembly="inspectionBase" type="number" value="${r.inspectionBase}"></label><label>포장 기본비<input data-assembly="packagingBase" type="number" value="${r.packagingBase}"></label></div></div>`;
  els.settingsContent.querySelectorAll('[data-assembly]').forEach(el=>el.addEventListener('change',()=>{ state.processRates.assembly[el.dataset.assembly]=Number(el.value)||0; renderAll(); }));
}

function renderQuoteTable(){
  const costs=getCosts();
  els.quoteTableBody.innerHTML=state.parts.map(p=>{ const c=costs.partCosts.find(x=>x.partId===p.id)||zeroCost(p); return `<tr class="${p.included==='no'?'excluded':''}"><td><b>${escapeHtml(p.name)}</b><br><span class="hint">${escapeHtml(p.assemblyPath)}</span></td><td>${p.qty*state.global.qty}</td><td>${PROCESS[p.process]||p.process}</td><td>${p.category==='buy'?'-':p.material}</td><td><span class="confidence">${p.confidence}%</span><br><span class="hint">${c.notes.join(' · ')}</span></td><td class="money">${money(c.material)}</td><td class="money">${money(c.process)}</td><td class="money">${money(c.extra)}</td><td class="money">${money(c.margin)}</td><td class="money"><b>${money(c.total)}</b></td></tr>`; }).join('') + `<tr><td><b>조립/검사/포장</b></td><td>-</td><td>조립</td><td>-</td><td><span class="hint">${costs.assembly.notes.join(' · ')}</span></td><td class="money">0원</td><td class="money">${money(costs.assembly.process)}</td><td class="money">${money(costs.assembly.extra)}</td><td class="money">${money(costs.assembly.margin)}</td><td class="money"><b>${money(costs.assembly.total)}</b></td></tr>`;
}
function renderTotals(){
  const costs=getCosts(); const rangeLow=costs.total*0.92, rangeHigh=costs.total*1.12;
  els.customerTotal.textContent=money(costs.total); els.customerRange.textContent=`예상 범위: ${money(rangeLow)} ~ ${money(rangeHigh)}`;
  const active=state.parts.filter(p=>p.included==='yes'); els.partCount.textContent=active.length; els.processCount.textContent=new Set(active.map(p=>p.process)).size; els.confidenceAvg.textContent=active.length ? Math.round(active.reduce((a,p)=>a+p.confidence,0)/active.length)+'%' : '-';
}

function openBulkPopover(){
  const selected=state.parts.filter(p=>p.bulkSelected); if(!selected.length){ toast('일괄 적용할 파트를 체크하세요.'); return; }
  const old=document.querySelector('.bulk-popover'); if(old) old.remove();
  const div=document.createElement('div'); div.className='bulk-popover'; div.innerHTML=`<h3>${selected.length}개 파트 일괄 적용</h3><div class="form-grid"><label>공법<select id="bulkProcess"><option value="">변경 안 함</option>${Object.entries(PROCESS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label>재질<select id="bulkMaterial"><option value="">변경 안 함</option>${Object.keys(state.materials).map(k=>`<option value="${k}">${k}</option>`).join('')}</select></label><label>후처리<select id="bulkFinish"><option value="">변경 안 함</option>${Object.entries(state.finishes).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label><label>복잡도<select id="bulkComplex"><option value="">변경 안 함</option><option value="low">낮음</option><option value="normal">보통</option><option value="high">높음</option><option value="extreme">매우 높음</option></select></label></div><div style="display:flex;gap:8px;margin-top:14px"><button id="bulkApply" class="primary small">적용</button><button id="bulkClose" class="ghost small">닫기</button></div>`;
  document.body.appendChild(div); div.querySelector('#bulkClose').onclick=()=>div.remove(); div.querySelector('#bulkApply').onclick=()=>{ const bp=div.querySelector('#bulkProcess').value,bm=div.querySelector('#bulkMaterial').value,bf=div.querySelector('#bulkFinish').value,bc=div.querySelector('#bulkComplex').value; selected.forEach(p=>{ if(bp)p.process=bp; if(bm)p.material=bm; if(bf)p.finish=bf; if(bc)p.custom.complexity=bc; p.bulkSelected=false; }); div.remove(); renderAll(); toast('일괄 적용했습니다.'); };
}
function duplicateSelectedPart(){ const p=partById(state.selectedPartId); if(!p) return; const copy=structuredClone(p); copy.id=uid(); copy.name=p.name+'_COPY'; state.parts.push(copy); state.selectedPartId=copy.id; renderAll(); }
function excludeSelectedPart(){ const p=partById(state.selectedPartId); if(!p) return; p.included=p.included==='no'?'yes':'no'; p.process=p.included==='no'?'exclude':p.recommendation.process; renderAll(); }
function exportQuoteJson(){
  const data={ exportedAt:new Date().toISOString(), factory:state.factoryName, global:state.global, parts:state.parts, costs:getCosts() };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='factory-step-quote.json'; a.click(); URL.revokeObjectURL(a.href);
}
function copyCustomerQuote(){
  const total=getCosts().total; const text=`STEP 견적 결과\n고객 제출 견적가: ${money(total)}\n예상 범위: ${money(total*0.92)} ~ ${money(total*1.12)}\n플랫폼 이용료: 0원\n※ 세부 원가/공정 산출근거는 내부 관리용입니다.`;
  navigator.clipboard?.writeText(text); toast('고객 제출 요약을 복사했습니다.');
}
async function loadLargeRates(){
  try{ const res=await fetch('data/rates.large.json'); heavyCatalog=await res.json(); state.bigDataLoaded=true; toast(`대용량 단가 데이터 로드: ${heavyCatalog.meta.records.toLocaleString()}개 레코드`); }
  catch(e){ toast('로컬 파일 직접 실행에서는 브라우저가 fetch를 막을 수 있습니다. 서버로 열면 로드됩니다.'); }
}
function toast(msg){ const old=document.querySelector('.toast'); if(old) old.remove(); const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2600); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m])); }

init();

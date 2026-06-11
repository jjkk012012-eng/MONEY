const PROCESS_LABELS = {
  cnc: 'CNC/MCT',
  sheetMetal: '판금/절곡',
  printing3d: '3D프린팅',
  injection: '사출',
  profile: '프로파일',
  assembly: '조립',
  purchased: '구매품 추정'
};

const materials = [
  { code: 'AL6061', name: '알루미늄 6061', density: 2.70, marketPriceKg: 5200 },
  { code: 'SUS304', name: 'SUS304', density: 7.93, marketPriceKg: 4700 },
  { code: 'SS400', name: 'SS400', density: 7.85, marketPriceKg: 1300 },
  { code: 'POM', name: 'POM', density: 1.41, marketPriceKg: 8200 },
  { code: 'ABS', name: 'ABS', density: 1.04, marketPriceKg: 3600 },
  { code: 'PP', name: 'PP', density: 0.90, marketPriceKg: 2400 },
  { code: 'PLA', name: 'PLA', density: 1.24, marketPriceKg: 12500 },
  { code: 'RESIN', name: '광경화 레진', density: 1.12, marketPriceKg: 28000 }
];

const state = {
  vendors: [],
  lastQuote: null,
  fileInfo: null
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const fmt = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function init() {
  materials.forEach(m => {
    const option = document.createElement('option');
    option.value = m.code;
    option.textContent = `${m.name} · 시세 ${m.marketPriceKg.toLocaleString()}원/kg`;
    $('#materialSelect').appendChild(option);
  });

  $$('.nav-btn').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  $('#addVendor').addEventListener('click', () => addVendor());
  $('#runQuote').addEventListener('click', runQuote);
  $('#stepFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    state.fileInfo = file ? { name: file.name, size: file.size } : null;
    if (file) document.querySelector('.upload-box span').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)}MB`;
  });

  addVendor({ name: '익산정밀가공', process: 'cnc', margin: 22, mode: 'percent', markup: 18, baseSmall: 55000, baseMedium: 130000, baseLarge: 280000 });
  addVendor({ name: '전북판금절곡', process: 'sheetMetal', margin: 18, mode: 'fixed', markup: 600, baseSmall: 35000, baseMedium: 90000, baseLarge: 180000, bendUnit: 3200 });
  addVendor({ name: '프로토3D랩', process: 'printing3d', margin: 28, mode: 'percent', markup: 30, printVolume: 420 });
  addVendor({ name: '프로파일프레임', process: 'profile', margin: 16, mode: 'percent', markup: 15, profileMeter: 13500, assemblyBase: 180000 });
  addVendor({ name: '사출금형파트너', process: 'injection', margin: 25, mode: 'percent', markup: 20, moldBase: 5500000 });
}

function switchView(id) {
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === id));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === id));
}

function addVendor(seed = {}) {
  const template = $('#vendorTemplate');
  const node = template.content.cloneNode(true);
  const card = node.querySelector('.vendor-card');
  card.querySelector('.vendor-name').value = seed.name || `제조사 ${state.vendors.length + 1}`;
  card.querySelector('.vendor-process').value = seed.process || 'cnc';
  card.querySelector('.vendor-margin').value = seed.margin ?? 20;
  card.querySelector('.material-mode').value = seed.mode || 'percent';
  card.querySelector('.material-markup').value = seed.markup ?? 20;
  card.querySelector('.base-small').value = seed.baseSmall ?? 50000;
  card.querySelector('.base-medium').value = seed.baseMedium ?? 120000;
  card.querySelector('.base-large').value = seed.baseLarge ?? 250000;
  card.querySelector('.bend-unit').value = seed.bendUnit ?? 3000;
  card.querySelector('.hole-unit').value = seed.holeUnit ?? 700;
  card.querySelector('.tap-unit').value = seed.tapUnit ?? 1800;
  card.querySelector('.print-volume').value = seed.printVolume ?? 350;
  card.querySelector('.mold-base').value = seed.moldBase ?? 5000000;
  card.querySelector('.profile-meter').value = seed.profileMeter ?? 12000;
  card.querySelector('.assembly-base').value = seed.assemblyBase ?? 150000;
  card.querySelector('.remove-vendor').addEventListener('click', () => card.remove());
  $('#vendorCards').appendChild(node);
}

function readVendors() {
  return $$('#vendorCards .vendor-card').map((card, idx) => ({
    id: idx + 1,
    name: card.querySelector('.vendor-name').value,
    process: card.querySelector('.vendor-process').value,
    margin: Number(card.querySelector('.vendor-margin').value) / 100,
    materialMode: card.querySelector('.material-mode').value,
    materialMarkup: Number(card.querySelector('.material-markup').value),
    baseSmall: Number(card.querySelector('.base-small').value),
    baseMedium: Number(card.querySelector('.base-medium').value),
    baseLarge: Number(card.querySelector('.base-large').value),
    complexMid: Number(card.querySelector('.complex-mid').value) / 100,
    complexHigh: Number(card.querySelector('.complex-high').value) / 100,
    bendUnit: Number(card.querySelector('.bend-unit').value),
    holeUnit: Number(card.querySelector('.hole-unit').value),
    tapUnit: Number(card.querySelector('.tap-unit').value),
    printVolume: Number(card.querySelector('.print-volume').value),
    moldBase: Number(card.querySelector('.mold-base').value),
    profileMeter: Number(card.querySelector('.profile-meter').value),
    assemblyBase: Number(card.querySelector('.assembly-base').value)
  }));
}

function runQuote() {
  const file = $('#stepFile').files[0];
  const qty = Math.max(1, Number($('#qty').value || 1));
  const material = materials.find(m => m.code === $('#materialSelect').value);
  const preferred = $('#preferredProcess').value;
  const includeAssembly = $('#assemblyIncluded').value === 'yes';
  const finish = $('#finish').value;
  const analysis = analyzeStepLike(file, qty, preferred, includeAssembly);
  const vendors = readVendors();
  const quotes = vendors.map(v => calculateVendorQuote(v, analysis, material, qty, finish, includeAssembly));
  const validQuotes = quotes.filter(q => Number.isFinite(q.customerPrice) && q.customerPrice > 0);
  const min = validQuotes.length ? Math.min(...validQuotes.map(q => q.customerPrice)) : 0;
  const max = validQuotes.length ? Math.max(...validQuotes.map(q => q.customerPrice)) : 0;
  state.lastQuote = { analysis, quotes, material, qty, min, max, includeAssembly };
  renderCustomerResult();
  renderAdmin();
}

function analyzeStepLike(file, qty, preferred, includeAssembly) {
  const fileSize = file ? file.size : 1_800_000;
  const seed = Math.max(1, Math.floor(fileSize / 1379) % 100000);
  const isAssembly = includeAssembly || fileSize > 900000;
  const totalParts = isAssembly ? clamp(Math.floor(seed % 36) + 12, 8, 60) : 1;
  const uniqueParts = isAssembly ? clamp(Math.floor(totalParts * 0.45), 4, totalParts) : 1;
  const x = clamp(60 + (seed % 800), 45, 900);
  const y = clamp(35 + ((seed * 7) % 520), 30, 620);
  const z = clamp(12 + ((seed * 11) % 300), 8, 360);
  const volumeCm3 = Math.max(8, (x * y * z) / 1000 * (isAssembly ? 0.08 : 0.32));
  const surfaceCm2 = Math.max(30, (2 * (x*y + y*z + x*z)) / 100 * (isAssembly ? 0.42 : 0.75));
  const holes = Math.floor((seed % 18) + (isAssembly ? totalParts * 0.6 : 2));
  const bends = Math.floor((seed % 10) + (isAssembly ? totalParts * 0.25 : 1));
  const complexityScore = clamp((surfaceCm2 / volumeCm3) * 0.9 + holes / 18 + bends / 14, 0.6, 4.5);
  const processMix = buildProcessMix(preferred, isAssembly, totalParts, x, y, z, complexityScore);
  return { fileName: file?.name || 'demo_assembly.step', fileSize, isAssembly, totalParts, uniqueParts, repeatedParts: totalParts - uniqueParts, x, y, z, volumeCm3, surfaceCm2, holes, bends, complexityScore, processMix };
}

function buildProcessMix(preferred, isAssembly, totalParts, x, y, z, complexityScore) {
  if (preferred !== 'auto') return { [preferred]: totalParts };
  if (!isAssembly) {
    if (z < 6 || (x / Math.max(z,1)) > 18) return { sheetMetal: 1 };
    if (x > 450 && z < 90) return { profile: 1 };
    if (complexityScore > 3.2) return { printing3d: 1 };
    return { cnc: 1 };
  }
  const cnc = Math.ceil(totalParts * 0.30);
  const sheet = Math.ceil(totalParts * 0.16);
  const profile = Math.ceil(totalParts * 0.18);
  const printing = Math.max(1, Math.floor(totalParts * 0.06));
  const purchased = Math.max(0, totalParts - cnc - sheet - profile - printing);
  return { cnc, sheetMetal: sheet, profile, printing3d: printing, purchased };
}

function materialUnitPrice(vendor, material) {
  if (vendor.materialMode === 'fixed') return material.marketPriceKg + vendor.materialMarkup;
  if (vendor.materialMode === 'direct') return vendor.materialMarkup;
  return material.marketPriceKg * (1 + vendor.materialMarkup / 100);
}

function calculateVendorQuote(vendor, analysis, material, qty, finish, includeAssembly) {
  const unitPriceKg = materialUnitPrice(vendor, material);
  const weightKg = analysis.volumeCm3 * material.density / 1000;
  const materialCost = weightKg * unitPriceKg * qty * 1.12;
  const targetCount = analysis.processMix[vendor.process] || 0;
  const processShare = targetCount / Math.max(1, analysis.totalParts);
  let processCost = 0;
  if (vendor.process === 'cnc') processCost = cncCost(vendor, analysis, qty, processShare);
  if (vendor.process === 'sheetMetal') processCost = sheetMetalCost(vendor, analysis, qty, processShare);
  if (vendor.process === 'printing3d') processCost = printingCost(vendor, analysis, qty, processShare);
  if (vendor.process === 'injection') processCost = injectionCost(vendor, analysis, qty, processShare);
  if (vendor.process === 'profile') processCost = profileCost(vendor, analysis, qty, processShare);
  if (vendor.process === 'assembly') processCost = assemblyCost(vendor, analysis, qty, includeAssembly);
  if (vendor.process !== 'assembly' && targetCount === 0) processCost *= 0.35;
  const finishCost = finishCostCalc(finish, analysis.surfaceCm2, qty, processShare);
  const preMargin = materialCost * Math.max(0.2, processShare) + processCost + finishCost;
  const marginAmount = preMargin * vendor.margin;
  const customerPrice = preMargin + marginAmount;
  return { vendor, materialCost, processCost, finishCost, preMargin, marginAmount, customerPrice, processCount: targetCount };
}

function sizeBase(vendor, analysis) {
  const maxDim = Math.max(analysis.x, analysis.y, analysis.z);
  if (maxDim < 120) return vendor.baseSmall;
  if (maxDim < 420) return vendor.baseMedium;
  return vendor.baseLarge;
}

function complexityRate(vendor, score) {
  if (score > 3.0) return vendor.complexHigh;
  if (score > 1.7) return vendor.complexMid;
  return 0;
}

function cncCost(v, a, qty, share) {
  const base = sizeBase(v, a) * Math.max(1, a.uniqueParts * share);
  const feature = (a.holes * v.holeUnit + Math.ceil(a.holes * 0.35) * v.tapUnit) * qty * Math.max(.3, share);
  return (base + feature) * (1 + complexityRate(v, a.complexityScore));
}

function sheetMetalCost(v, a, qty, share) {
  const base = sizeBase(v, a) * .55 * Math.max(1, a.uniqueParts * share);
  const bend = a.bends * v.bendUnit * qty * Math.max(.4, share);
  const holes = a.holes * v.holeUnit * qty * Math.max(.4, share);
  return (base + bend + holes) * (1 + complexityRate(v, a.complexityScore) * .6);
}

function printingCost(v, a, qty, share) {
  const volumeCost = a.volumeCm3 * v.printVolume * qty * Math.max(.5, share);
  const support = a.complexityScore > 2.2 ? 1.25 : 1.08;
  return volumeCost * support + sizeBase(v, a) * .35;
}

function injectionCost(v, a, qty, share) {
  const moldComplex = a.complexityScore > 3 ? 1.5 : a.complexityScore > 1.8 ? 1.2 : 1.0;
  const mold = v.moldBase * moldComplex * Math.max(.35, share);
  const shot = qty * Math.max(80, a.volumeCm3 * 2.4) * Math.max(.4, share);
  return mold + shot;
}

function profileCost(v, a, qty, share) {
  const totalMeter = ((a.x + a.y + a.z) / 1000) * Math.max(1, a.totalParts * share) * qty;
  const cuts = Math.ceil(Math.max(1, a.totalParts * share) * 2) * 1000;
  const taps = Math.ceil(a.holes * .45 * Math.max(.4, share)) * v.tapUnit;
  return totalMeter * v.profileMeter + cuts + taps;
}

function assemblyCost(v, a, qty, includeAssembly) {
  if (!includeAssembly) return 0;
  const level = a.totalParts > 35 ? 1.4 : a.totalParts > 18 ? 1.15 : 1.0;
  return (v.assemblyBase + a.totalParts * 3500 + a.holes * 600) * level * Math.max(1, Math.sqrt(qty) * .45);
}

function finishCostCalc(finish, surfaceCm2, qty, share) {
  const map = { none: 0, anodizing: 25, powder: 18, plating: 32, sanding: 12 };
  return surfaceCm2 * (map[finish] || 0) * qty * Math.max(.3, share);
}

function renderCustomerResult() {
  const { analysis, material, qty, min, max } = state.lastQuote;
  const topProcesses = Object.entries(analysis.processMix).filter(([,n]) => n > 0).map(([k,n]) => `<span class="badge">${PROCESS_LABELS[k]} ${n}개</span>`).join(' ');
  $('#customerResult').className = 'result-card';
  $('#customerResult').innerHTML = `
    <div class="price-box">
      <span>예상 견적</span>
      <strong>${fmt(min)} ~ ${fmt(max)}</strong>
      <small>플랫폼 이용료 0원 · 제조사 등록 단가 기준</small>
    </div>
    <div class="kpi-grid">
      <div class="kpi"><small>파일명</small><b>${analysis.fileName}</b></div>
      <div class="kpi"><small>수량</small><b>${qty}개</b></div>
      <div class="kpi"><small>재질</small><b>${material.name}</b></div>
      <div class="kpi"><small>부품 수</small><b>${analysis.totalParts}개</b></div>
      <div class="kpi"><small>크기</small><b>${Math.round(analysis.x)}×${Math.round(analysis.y)}×${Math.round(analysis.z)}mm</b></div>
      <div class="kpi"><small>정확도</small><b>${analysis.isAssembly ? 'B' : 'A-'}</b></div>
    </div>
    <div><strong>추천 공정</strong><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${topProcesses}</div></div>
    <p class="empty">예상 시간, 시간당 단가, 업체 원가는 고객 화면에 표시하지 않습니다. 최종 금액은 업체 단가표와 마진율 기준의 예상 범위입니다.</p>
  `;
}

function renderAdmin() {
  const { analysis, quotes, material } = state.lastQuote;
  const rows = quotes.sort((a,b) => a.customerPrice - b.customerPrice).map(q => `
    <tr>
      <td>${q.vendor.name}</td>
      <td>${PROCESS_LABELS[q.vendor.process]}</td>
      <td>${q.processCount}개</td>
      <td>${fmt(q.materialCost)}</td>
      <td>${fmt(q.processCost + q.finishCost)}</td>
      <td>${Math.round(q.vendor.margin * 100)}%</td>
      <td><b>${fmt(q.customerPrice)}</b></td>
    </tr>
  `).join('');
  $('#adminSummary').className = '';
  $('#adminSummary').innerHTML = `
    <table class="table">
      <tbody>
        <tr><th>파일</th><td>${analysis.fileName}</td></tr>
        <tr><th>전체 크기</th><td>${Math.round(analysis.x)} × ${Math.round(analysis.y)} × ${Math.round(analysis.z)}mm</td></tr>
        <tr><th>부품 수</th><td>총 ${analysis.totalParts}개 / 고유 ${analysis.uniqueParts}개 / 반복 ${analysis.repeatedParts}개</td></tr>
        <tr><th>부피/표면적</th><td>${analysis.volumeCm3.toFixed(1)}cm³ / ${analysis.surfaceCm2.toFixed(1)}cm²</td></tr>
        <tr><th>홀/절곡 후보</th><td>홀 ${analysis.holes}개 / 절곡 후보 ${analysis.bends}개</td></tr>
        <tr><th>재료 시세</th><td>${material.name} ${material.marketPriceKg.toLocaleString()}원/kg</td></tr>
      </tbody>
    </table>
  `;
  $('#vendorComparison').className = '';
  $('#vendorComparison').innerHTML = `
    <table class="table">
      <thead><tr><th>업체</th><th>공정</th><th>대상</th><th>재료비</th><th>공정/후처리</th><th>마진</th><th>고객가</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

init();

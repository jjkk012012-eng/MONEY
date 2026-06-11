/* Factory STEP Quote SaaS - real viewer architecture
   - Uses occt-import-js + Three.js when CDN is available.
   - Quotes only leaf geometry meshes returned by OCCT; assembly containers with no mesh are not charged.
   - Part row click isolates the actual mesh in the viewer.
*/
const CDN = {
  three: 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  orbit: 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js',
  occt: 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.js',
  occtWasmBase: 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/'
};

const state = {
  parts: [],
  selectedId: null,
  parserReady: false,
  viewer: null,
  rates: null,
  THREE: null,
  OrbitControls: null,
};

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const won = n => `${Math.round(Number(n)||0).toLocaleString('ko-KR')}원`;
const clamp = (v,min,max) => Math.min(max, Math.max(min, v));
const normalizeName = s => String(s||'PART').replace(/^['"]|['"]$/g,'').trim() || 'PART';

class Rates {
  constructor(){ this.refresh(); }
  refresh(){
    this.defaultMargin = +$('#rDefaultMargin').value || 20;
    this.buyMargin = +$('#rBuyMargin').value || 10;
    this.materialMarkup = (+$('#rMarkup').value || 0) / 100;
    this.material = {
      AL6061: +$('#rAl').value || 5200,
      SUS304: +$('#rSus').value || 4800,
      SS400: +$('#rSteel').value || 1600,
      POM: 8500, ABS: 4200, PLA: 3200, '구매품': 0
    };
    this.density = { AL6061: 2.70, SUS304: 7.93, SS400: 7.85, POM: 1.41, ABS: 1.04, PLA: 1.24, '구매품': 0 };
    this.cncBase = { small:+$('#rCncS').value||45000, medium:+$('#rCncM').value||90000, large:+$('#rCncL').value||180000 };
    this.bendEach = +$('#rBend').value || 2500;
    this.tapM6 = +$('#rTap').value || 2500;
    this.assemblyBase = +$('#rAssembly').value || 50000;
  }
  materialUnit(mat){ return (this.material[mat] ?? 0) * (1 + this.materialMarkup); }
  densityOf(mat){ return this.density[mat] ?? 1; }
}

class GeometryTools {
  static bboxFromPositions(pos){
    let min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<pos.length;i+=3){
      const x=pos[i], y=pos[i+1], z=pos[i+2];
      if(x<min[0])min[0]=x;if(y<min[1])min[1]=y;if(z<min[2])min[2]=z;
      if(x>max[0])max[0]=x;if(y>max[1])max[1]=y;if(z>max[2])max[2]=z;
    }
    const dims=[max[0]-min[0], max[1]-min[1], max[2]-min[2]].map(v=>Number.isFinite(v)?Math.abs(v):0);
    return {min,max,dims,volume:dims[0]*dims[1]*dims[2]};
  }
  static surfaceArea(pos, idx){
    let area=0;
    const triCount = idx ? idx.length/3 : pos.length/9;
    const get = (k) => idx ? [pos[idx[k]*3],pos[idx[k]*3+1],pos[idx[k]*3+2]] : [pos[k*3],pos[k*3+1],pos[k*3+2]];
    for(let t=0;t<triCount;t++){
      const a=get(t*3), b=get(t*3+1), c=get(t*3+2);
      const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
      const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
      area += 0.5*Math.hypot(...cross);
    }
    return area;
  }
  static volume(pos, idx){
    let vol=0;
    const triCount = idx ? idx.length/3 : pos.length/9;
    const get = (k) => idx ? [pos[idx[k]*3],pos[idx[k]*3+1],pos[idx[k]*3+2]] : [pos[k*3],pos[k*3+1],pos[k*3+2]];
    for(let t=0;t<triCount;t++){
      const a=get(t*3), b=get(t*3+1), c=get(t*3+2);
      vol += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    }
    return Math.abs(vol);
  }
}

class FeatureEstimator {
  static estimate(part){
    const name = part.name.toUpperCase();
    const [x,y,z] = [...part.dims].sort((a,b)=>b-a);
    const minDim = Math.max(0.1, Math.min(...part.dims));
    const maxDim = Math.max(...part.dims);
    const midDim = [...part.dims].sort((a,b)=>a-b)[1] || 1;
    const thinness = minDim / Math.max(1, midDim);
    const fill = part.bboxVolume ? part.volume / part.bboxVolume : 0.5;

    // Name-based hard exclusions first.
    const isPipe = /PIPE|TUBE|파이프|튜브|각관|SQUARE[_ -]?TUBE|ROUND[_ -]?PIPE|배관|STS[_ -]?D\d+/.test(name);
    const isBuy = isPipe || /BOLT|NUT|WASHER|BEARING|SENSOR|MOTOR|CYLINDER|SCREW|VALVE|COUPLER|HINGE|CASTER|구매|표준품/.test(name);
    const isProfile = !isPipe && /PROFILE|AL[_ -]?FRAME|4040|3030|2020|4080|4545|5050|6060|8080|프로파일/.test(name);
    const isShaft = /SHAFT|PIN|BUSH|BUSHING|ROLLER|SPACER|COLLAR|축|샤프트/.test(name) || (maxDim > 3*midDim && /D\d+|Ø|PHI/.test(name));

    // Sheet/bend: constant-thickness sheet first. Real bend needs topology; mesh version treats as candidate and requires user confirmation.
    const hasBendName = /BEND|BENT|FOLD|FLANGE|L[_ -]?BRACKET|U[_ -]?BRACKET|절곡|접힘|플랜지/.test(name);
    const sheetName = /SHEET|PANEL|COVER|BRACKET|판금|커버|판넬/.test(name);
    const isThinSheet = minDim <= 6.2 && thinness < 0.16 && maxDim > 30;
    const bendCandidateCount = hasBendName && isThinSheet ? (name.includes('U_')||name.includes('U-')?2: name.includes('BOX')?4:1) : 0;

    // CNC: after removing buy/profile/lathe/sheet bend.
    const cncName = /BASE|BLOCK|JIG|FIXTURE|MOUNT|HOLDER|SUPPORT|ADAPTER|CLAMP|GUIDE|PLATE|가공/.test(name);
    const likelyPockets = Math.max(0, Math.round((1-fill)*6 + (/POCKET|SLOT|홈|자리|가공/.test(name)?2:0)));
    const tapCandidateCount = this.tapCandidatesFromName(name) || (cncName && maxDim>30 ? Math.min(8, Math.round(maxDim/80)) : 0);
    const counters = /COUNTER|CBORE|CSINK|자리/.test(name) ? 2 : 0;

    let process = '분류 필요', confidence = '낮음', reasons=[];
    if(isBuy){ process='구매품'; confidence='높음'; reasons.push(isPipe?'파이프/튜브/각관은 표준 구매재 우선':'표준 구매품 이름 감지'); }
    else if(isProfile){ process='프로파일/압출'; confidence='높음'; reasons.push('프로파일 규격/이름 감지'); }
    else if(isShaft){ process='선반'; confidence='보통'; reasons.push('축/핀/부싱류 또는 긴 원통형 이름'); }
    else if(isThinSheet && (hasBendName || sheetName)){
      process='판금/절곡'; confidence = hasBendName?'높음':'보통'; reasons.push('얇은 판재형', hasBendName?'절곡/플랜지 이름 힌트':'판금 이름 힌트');
    } else {
      let cncScore=0;
      if(cncName){cncScore+=18;reasons.push('가공품 이름 힌트');}
      if(thinness >= 0.16){cncScore+=20;reasons.push('판재보다 덩어리형 비율');}
      if(likelyPockets>0){cncScore+=18;reasons.push('포켓/홈/소재제거 후보');}
      if(tapCandidateCount>0){cncScore+=12;reasons.push('탭/홀 후보');}
      if(counters>0){cncScore+=10;reasons.push('카운터보어/자리파기 후보');}
      if(cncScore>=35){process='CNC/MCT';confidence=cncScore>=58?'높음':'보통';}
      else {process='3D프린팅';confidence='낮음';reasons.push('명확한 절삭/판금/구매품 신호 부족');}
    }
    const material = process==='구매품' ? '구매품' : process==='판금/절곡' ? (name.includes('SUS')||name.includes('STS')?'SUS304':'SS400') : process==='3D프린팅' ? 'ABS' : (name.includes('SUS')||name.includes('STS')?'SUS304':'AL6061');
    return {
      process, confidence, material, reasons,
      isPipe, isProfile, isThinSheet,
      thickness: isThinSheet ? Number(minDim.toFixed(2)) : 0,
      tapCandidateCount,
      bendCandidateCount,
      pocketCount: likelyPockets,
      counterboreCount: counters,
      fillRatio: fill,
      sizeClass: maxDim < 80 ? 'small' : maxDim < 250 ? 'medium' : 'large',
      buyPrice: isPipe ? Math.max(1000, maxDim*35) : isBuy ? 1000 : 0
    };
  }
  static tapCandidatesFromName(name){
    const m = name.match(/M(3|4|5|6|8|10|12)/);
    if(!m) return 0;
    return /BOLT|SCREW/.test(name) ? 0 : 1;
  }
}

class QuoteEngine {
  static quote(part, rates){
    if(part.process === '제외') return {total:0, base:0, margin:0, lines:['제외']};
    const qty = Math.max(0, +part.qty || 0);
    const marginRate = (+part.margin || 0) / 100;
    let base = 0, lines=[];
    const weightKg = Math.max(0.001, (part.volume/1000) * rates.densityOf(part.material) / 1000); // mm3 -> cm3 -> g -> kg approx
    const matCost = weightKg * rates.materialUnit(part.material) * qty;
    const sizeClass = part.features.sizeClass || 'small';

    if(part.process === '구매품'){
      base = (+part.buyPrice || part.features.buyPrice || 1000) * qty;
      lines.push(`구매품 ${won(base)}`);
    } else if(part.process === 'CNC/MCT'){
      const cncBase = rates.cncBase[sizeClass] || rates.cncBase.medium;
      const featureAdd = (part.features.pocketCount*6000 + part.features.counterboreCount*2500 + part.tapCount*rates.tapM6) * qty;
      base = matCost + cncBase*qty + featureAdd;
      lines.push(`재료 ${won(matCost)}`, `CNC 기본 ${won(cncBase*qty)}`, `탭/특징 ${won(featureAdd)}`);
    } else if(part.process === '선반'){
      const lathe = (sizeClass==='small'?35000:sizeClass==='medium'?70000:140000)*qty;
      base = matCost + lathe + part.tapCount*rates.tapM6*qty;
      lines.push(`재료 ${won(matCost)}`, `선반 ${won(lathe)}`);
    } else if(part.process === '판금/절곡'){
      const sheetBase = (sizeClass==='small'?25000:sizeClass==='medium'?55000:110000)*qty;
      const bendCost = part.bendCount * rates.bendEach * qty * (part.material==='SUS304'?1.3:1);
      const tapCost = part.tapCount * rates.tapM6 * qty;
      base = matCost + sheetBase + bendCost + tapCost;
      lines.push(`판재 ${won(matCost)}`, `판금 기본 ${won(sheetBase)}`, `절곡 ${won(bendCost)}`, `탭 ${won(tapCost)}`);
    } else if(part.process === '3D프린팅'){
      const cm3 = part.volume/1000;
      const print = cm3 * (part.material==='PLA'?220:part.material==='ABS'?320:450) * qty;
      base = print;
      lines.push(`부피기준 출력 ${won(print)}`);
    } else if(part.process === '사출'){
      const moldIncluded = false; // 초기 견적 튐 방지: 금형비 기본 미포함
      const shot = (part.volume/1000)*18*qty + (moldIncluded?3000000:0);
      base = matCost + shot;
      lines.push(`수지 ${won(matCost)}`, `개당 사출비 ${won(shot)}`, '금형비 기본 미포함');
    } else if(part.process === '프로파일/압출'){
      const lengthM = Math.max(...part.dims)/1000;
      const profile = lengthM * 15000 * qty;
      base = profile + part.tapCount*rates.tapM6*qty;
      lines.push(`프로파일 길이 ${won(profile)}`);
    } else if(part.process === '용접'){
      const weld = (sizeClass==='small'?30000:sizeClass==='medium'?90000:180000)*qty;
      base = matCost + weld;
      lines.push(`재료 ${won(matCost)}`, `용접/제관 ${won(weld)}`);
    }
    const finish = part.finish && part.finish!=='없음' ? Math.max(15000, part.surfaceArea*0.03)*qty : 0;
    if(finish){ base += finish; lines.push(`후처리 ${won(finish)}`); }
    const margin = base * marginRate;
    return {base, margin, total: base+margin, lines};
  }
}

class StepParserAdapter {
  static async parse(file){
    const bytes = new Uint8Array(await file.arrayBuffer());
    const textHead = new TextDecoder('utf-8', {fatal:false}).decode(bytes.slice(0, Math.min(bytes.length, 2_000_000)));
    try{
      const occt = await this.loadOcct();
      const result = occt.ReadStepFile(bytes, { linearDeflection: 0.12, angularDeflection: 0.5 });
      if(!result || !result.meshes || result.meshes.length===0) throw new Error('OCCT mesh 결과 없음');
      const parts = result.meshes.map((mesh, i) => this.meshToPart(mesh, i)).filter(p => p.positions.length >= 9);
      return this.mergeSameParts(parts, 'OCCT 실제 mesh 파싱');
    } catch(err){
      console.warn('OCCT parser failed, fallback parser used:', err);
      const parts = this.fallbackPartsFromStepText(textHead);
      return {parts, parser:'텍스트 기반 fallback - 실제 3D mesh 아님'};
    }
  }
  static async loadOcct(){
    if(window.__occt) return window.__occt;
    const mod = await import(CDN.occt);
    const factory = mod.default || window.occtimportjs || mod;
    window.__occt = await factory({ locateFile: f => CDN.occtWasmBase + f });
    return window.__occt;
  }
  static meshToPart(mesh, i){
    const pos = new Float32Array(mesh.vertices || []);
    const idx = mesh.triangles ? new Uint32Array(mesh.triangles) : null;
    const bbox = GeometryTools.bboxFromPositions(pos);
    const volume = GeometryTools.volume(pos, idx);
    const surfaceArea = GeometryTools.surfaceArea(pos, idx);
    const name = normalizeName(mesh.name || mesh.partName || mesh.label || `PART_${i+1}`);
    const part = {id:`p_${i}`, name, sourceName:name, qty:1, positions:pos, indices:idx, dims:bbox.dims, bboxVolume:bbox.volume, volume, surfaceArea};
    const f = FeatureEstimator.estimate(part);
    return Object.assign(part, {features:f, process:f.process, material:f.material, margin: f.process==='구매품'?10:20, tapCount:f.tapCandidateCount, bendCount:f.bendCandidateCount, buyPrice:f.buyPrice, finish:'없음'});
  }
  static mergeSameParts(parts, parser){
    const map = new Map();
    for(const p of parts){
      const key = p.name.toUpperCase().replace(/[_ -]?\d+$/,'');
      if(!map.has(key)){map.set(key,p);}
      else {map.get(key).qty += 1;}
    }
    return {parts:[...map.values()].map((p,i)=>({...p,id:`p_${i}`})), parser};
  }
  static fallbackPartsFromStepText(txt){
    const names = [];
    const re = /PRODUCT\s*\([^,]*,\s*'([^']+)'/gi;
    let m; while((m=re.exec(txt)) && names.length<80){ names.push(normalizeName(m[1])); }
    const filtered = names.filter(n => !/ASSEMBLY|ASSY|조립|SUB/i.test(n));
    const seed = filtered.length?filtered:['BASE_PLATE_20T','L_BRACKET_BENT_2T','PIPE_STS_D25_L500','PROFILE_4040_L800','SHAFT_D12_L180','BOLT_M6'];
    return seed.map((name,i)=>{
      const dims = /PIPE|SHAFT/.test(name.toUpperCase())?[500,25,25]:/PROFILE/.test(name.toUpperCase())?[800,40,40]:/BRACKET|COVER|PANEL/.test(name.toUpperCase())?[160,90,2]:/BOLT|NUT/.test(name.toUpperCase())?[20,8,8]:[220,160,20];
      const volume = dims[0]*dims[1]*dims[2]*(/BRACKET|COVER|PANEL/.test(name.toUpperCase())?0.18:0.72);
      const bboxVolume = dims[0]*dims[1]*dims[2];
      const surfaceArea = 2*(dims[0]*dims[1]+dims[1]*dims[2]+dims[0]*dims[2]);
      const part={id:`p_${i}`,name,sourceName:name,qty:1,positions:new Float32Array(),indices:null,dims,bboxVolume,volume,surfaceArea};
      const f=FeatureEstimator.estimate(part);
      return Object.assign(part,{features:f,process:f.process,material:f.material,margin:f.process==='구매품'?10:20,tapCount:f.tapCandidateCount,bendCount:f.bendCandidateCount,buyPrice:f.buyPrice,finish:'없음'});
    });
  }
}

class Viewer3D {
  async init(){
    const THREE = await import(CDN.three);
    const {OrbitControls} = await import(CDN.orbit);
    state.THREE = THREE; state.OrbitControls = OrbitControls;
    this.THREE = THREE;
    this.el = $('#viewer'); this.el.innerHTML='';
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x0b1020);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
    this.camera.position.set(250,250,250);
    this.renderer = new THREE.WebGLRenderer({antialias:true});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    this.el.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping=true;
    this.scene.add(new THREE.AmbientLight(0xffffff, .75));
    const d = new THREE.DirectionalLight(0xffffff, 1.2); d.position.set(300,400,500); this.scene.add(d);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.resize(); window.addEventListener('resize',()=>this.resize());
    this.animate();
  }
  resize(){ const r=this.el.getBoundingClientRect(); this.camera.aspect = Math.max(1,r.width)/Math.max(1,r.height); this.camera.updateProjectionMatrix(); this.renderer.setSize(r.width,r.height,false); }
  animate(){ requestAnimationFrame(()=>this.animate()); this.controls?.update(); this.renderer.render(this.scene,this.camera); }
  clear(){ while(this.group.children.length) this.group.remove(this.group.children[0]); }
  showParts(parts, selectedId=null){
    if(!this.THREE) return;
    this.clear();
    const THREE=this.THREE;
    const realParts = parts.filter(p => p.positions && p.positions.length>=9);
    if(realParts.length===0){ this.showFallbackBox(parts.find(p=>p.id===selectedId)||parts[0]); return; }
    for(const p of realParts){
      if(selectedId && p.id!==selectedId) continue;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(p.positions,3));
      if(p.indices) geom.setIndex(new THREE.BufferAttribute(p.indices,1));
      geom.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({color: p.id===selectedId?0x60a5fa:0xcbd5e1, roughness:.55, metalness:.1});
      const mesh = new THREE.Mesh(geom, mat); mesh.userData.partId=p.id;
      this.group.add(mesh);
    }
    this.fitCamera();
  }
  showFallbackBox(part){
    if(!part) return;
    const THREE=this.THREE; this.clear();
    const [x,y,z]=part.dims.map(v=>Math.max(2,v));
    const geom=new THREE.BoxGeometry(x,y,z);
    const mat=new THREE.MeshStandardMaterial({color:0x60a5fa,roughness:.6});
    const mesh=new THREE.Mesh(geom,mat); this.group.add(mesh); this.fitCamera();
  }
  fitCamera(){
    const THREE=this.THREE; const box=new THREE.Box3().setFromObject(this.group); if(box.isEmpty()) return;
    const center=box.getCenter(new THREE.Vector3()); const size=box.getSize(new THREE.Vector3());
    const max=Math.max(size.x,size.y,size.z,10); const dist=max*2.2;
    this.camera.position.set(center.x+dist,center.y+dist,center.z+dist); this.camera.near=max/1000; this.camera.far=max*100; this.camera.lookAt(center); this.camera.updateProjectionMatrix();
    this.controls.target.copy(center); this.controls.update();
  }
}

function render(){
  const rates = state.rates; rates.refresh();
  const tbody = $('#partsTable tbody'); tbody.innerHTML='';
  let total=0,totalQty=0;
  for(const p of state.parts){
    const q = QuoteEngine.quote(p, rates); p.quote=q; total+=q.total; totalQty+=p.qty;
    const tr=document.createElement('tr'); tr.dataset.id=p.id; if(p.id===state.selectedId) tr.classList.add('selected');
    tr.innerHTML=`
      <td><input type="checkbox" class="rowcheck" data-id="${p.id}" /></td>
      <td><b>${escapeHtml(p.name)}</b><div class="sub">${p.dims.map(v=>Math.round(v)).join('×')}mm</div></td>
      <td><input class="mini" data-id="${p.id}" data-field="qty" type="number" value="${p.qty}" min="0" /></td>
      <td><span class="pill">${p.features.process}</span><div class="sub">${p.features.confidence}</div></td>
      <td>${selectHtml(p.id,'process',p.process,['CNC/MCT','선반','판금/절곡','3D프린팅','사출','프로파일/압출','용접','구매품','제외'])}</td>
      <td>${selectHtml(p.id,'material',p.material,['AL6061','SUS304','SS400','POM','ABS','PLA','구매품'])}</td>
      <td><input class="mini" data-id="${p.id}" data-field="tapCount" type="number" value="${p.tapCount}" min="0" /></td>
      <td><input class="mini" data-id="${p.id}" data-field="bendCount" type="number" value="${p.bendCount}" min="0" /></td>
      <td><input class="mini" data-id="${p.id}" data-field="margin" type="number" value="${p.margin}" /></td>
      <td class="price">${won(q.total)}</td>`;
    tbody.appendChild(tr);
  }
  $('#mPartCount').textContent=state.parts.length;
  $('#mTotalQty').textContent=totalQty;
  $('#mTotalPrice').textContent=won(total);
  bindTableEvents(); renderEditor();
}
function selectHtml(id,field,value,opts){ return `<select class="mini" data-id="${id}" data-field="${field}">${opts.map(o=>`<option ${o===value?'selected':''}>${o}</option>`).join('')}</select>`; }
function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function bindTableEvents(){
  $$('#partsTable tbody tr').forEach(tr=>tr.addEventListener('click',e=>{ if(e.target.matches('input,select')) return; selectPart(tr.dataset.id); }));
  $$('#partsTable .mini').forEach(el=>el.addEventListener('change',e=>{ const p=state.parts.find(x=>x.id===el.dataset.id); if(!p)return; const val=el.type==='number'?+el.value:el.value; p[el.dataset.field]=val; if(el.dataset.field==='process' && val==='구매품') p.material='구매품'; render(); }));
}
function selectPart(id){ state.selectedId=id; const p=state.parts.find(x=>x.id===id); $('#selectedTitle').textContent=p?.name||'3D 파트 뷰어'; $('#selectedMeta').textContent=p?`${p.process} · ${p.material} · ${p.dims.map(v=>Math.round(v)).join('×')}mm`:''; state.viewer?.showParts(state.parts,id); render(); }
function renderEditor(){
  const p=state.parts.find(x=>x.id===state.selectedId); const box=$('#partEditor');
  if(!p){ box.className='editor-empty'; box.textContent='파트 행을 클릭하면 수정 항목이 열립니다.'; return; }
  box.className=''; const tpl=$('#editorTpl').content.cloneNode(true); box.innerHTML=''; box.appendChild(tpl);
  $$('[data-field]',box).forEach(el=>{el.value=p[el.dataset.field] ?? ''; el.addEventListener('change',()=>{p[el.dataset.field]=el.type==='number'?+el.value:el.value; render(); state.viewer?.showParts(state.parts,p.id);});});
  $('[data-analysis]',box).innerHTML=`
    <b>자동추천 근거</b><br>${p.features.reasons.map(r=>'· '+escapeHtml(r)).join('<br>')}<br><br>
    부피: ${Math.round(p.volume).toLocaleString()} mm³ / 표면적: ${Math.round(p.surfaceArea).toLocaleString()} mm²<br>
    두께 후보: ${p.features.thickness||'-'}T / 탭 후보: ${p.features.tapCandidateCount} / 절곡 후보: ${p.features.bendCandidateCount}<br>
    내부 산출: ${p.quote.lines.map(escapeHtml).join(' · ')}<br>
    마진 전 ${won(p.quote.base)} + 마진 ${won(p.quote.margin)} = <b>${won(p.quote.total)}</b>`;
}

async function onFile(file){
  $('#mParser').textContent='파싱 중...';
  if(!state.viewer){ state.viewer = new Viewer3D(); await state.viewer.init(); }
  const result = await StepParserAdapter.parse(file);
  state.parts = result.parts;
  state.selectedId = state.parts[0]?.id || null;
  $('#mParser').textContent=result.parser;
  state.viewer.showParts(state.parts,state.selectedId);
  render();
}
function loadSample(){
  const names=['BASE_PLATE_20T','L_BRACKET_BENT_2T','U_BRACKET_BENT_2T','PIPE_STS_D25_L500','SQUARE_TUBE_40X40_L800','PROFILE_4040_L600','SHAFT_D12_L180','BOLT_M6','COVER_PANEL_1.5T','JIG_BLOCK_POCKET'];
  state.parts = StepParserAdapter.fallbackPartsFromStepText('').filter((_,i)=>i<0);
  state.parts = names.map((name,i)=>StepParserAdapter.fallbackPartsFromStepText(`PRODUCT('', '${name}'`)[0]).map((p,i)=>({...p,id:`p_${i}`,name:names[i],sourceName:names[i]}));
  $('#mParser').textContent='샘플 데이터'; state.selectedId=state.parts[0].id;
  if(state.viewer) state.viewer.showParts(state.parts,state.selectedId); render();
}
function init(){
  state.rates = new Rates();
  $('#stepFile').addEventListener('change',e=>{ const f=e.target.files[0]; if(f) onFile(f); });
  $('#sampleBtn').addEventListener('click',loadSample);
  $('#recalcBtn').addEventListener('click',render);
  $('#showAllBtn').addEventListener('click',()=>state.viewer?.showParts(state.parts,null));
  $('#applyBulk').addEventListener('click',()=>{ const v=$('#bulkProcess').value; if(!v)return; $$('.rowcheck:checked').forEach(c=>{const p=state.parts.find(x=>x.id===c.dataset.id); if(p)p.process=v;}); render(); });
  $('#checkAll').addEventListener('change',e=>$$('.rowcheck').forEach(c=>c.checked=e.target.checked));
  // Start viewer lazily but ready.
  state.viewer = new Viewer3D(); state.viewer.init().catch(()=>{$('#viewer').innerHTML='<div class="viewer-empty">3D 라이브러리 로드 실패</div>';});
}
init();

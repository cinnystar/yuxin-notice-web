/* 通報整合管理系統：通報總覽、年度總表、通報內容、AI 對話查詢、新增／匯入。
   資料來源：data/notices.js（由 tools/build-data.ps1 從 通報/ 資料夾產生）＋本機瀏覽器新增的通報。 */
(function(){
'use strict';

// ---------- helpers ----------
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el=h=>{const t=document.createElement('template');t.innerHTML=h.trim();return t.content.firstElementChild};
const fmtSize=b=>!b?'':b<1024?b+' B':b<1048576?(b/1024).toFixed(0)+' KB':(b/1048576).toFixed(1)+' MB';
const roc=y=>y-1911;
const rocDate=d=>d?`${roc(+d.slice(0,4))}/${d.slice(5,7)}/${d.slice(8,10)}`:'—';
const TODAY=new Date();
const TODAY_S=new Date(TODAY.getTime()-TODAY.getTimezoneOffset()*60000).toISOString().slice(0,10);
const CUR_Y=TODAY.getFullYear();
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const fileUrl=p=>{const b=window.FILE_BASE;if(b)p=b+p.replace(/^通報\//,'');return p.split('/').map(encodeURIComponent).join('/')};
function toast(msg){const t=el(`<div class="toast" role="status">${esc(msg)}</div>`);document.body.append(t);setTimeout(()=>t.remove(),2400)}
const store={
  get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){toast('瀏覽器無法儲存資料');return false}}
};

// ---------- 上傳檔（IndexedDB，僅限在此瀏覽器新增的通報） ----------
const idb={
  db:null,
  open(){if(this.db)return Promise.resolve(this.db);return new Promise((res,rej)=>{let r;try{r=indexedDB.open('notice-files',1)}catch(e){return rej(e)}r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>{this.db=r.result;res(this.db)};r.onerror=()=>rej(r.error)})},
  async put(k,blob){const db=await this.open();return new Promise((res,rej)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(blob,k);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})},
  async get(k){const db=await this.open();return new Promise((res,rej)=>{const q=db.transaction('files').objectStore('files').get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})},
  async del(k){const db=await this.open();return new Promise(res=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(k);tx.oncomplete=res;tx.onerror=res})}
};

// ---------- data ----------
let NOTICES=[];
const CAT_RE=/^\s*[\[【［〔(（]([^\]】］〕)）]{1,10})[\]】］〕)）]/;
function norm(n){
  const files=(n.f||[]).map(([path,size])=>({name:path.split('/').pop(),path,size}));
  const m=CAT_RE.exec(n.s||'');
  return {id:n.id,date:n.d||'',unit:n.u||'未填',sender:n.p||'',subject:n.s||'',no:n.no||'',year:n.y||+String(n.d).slice(0,4),
    month:n.d?+n.d.slice(5,7):0,actStart:n.as||'',actEnd:n.ae||'',note:n.nt||'',body:n.b||'',files,noFolder:!!n.nf,cat:m?m[1].trim():''};
}
function load(){
  const user=store.get('notices.user',[]).map(n=>({...n,year:+n.date.slice(0,4),month:+n.date.slice(5,7),cat:(CAT_RE.exec(n.subject)||[])[1]||''}));
  NOTICES=[...(window.NOTICE_DATA||[]).map(norm),...user];
  NOTICES.forEach(n=>{n._hay=[n.subject,n.unit,n.sender,n.no,n.id,n.note,n.body,n.files.map(f=>f.name).join(' ')].join('\n').toLowerCase()});
  NOTICES.sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
}
const years=()=>[...new Set(NOTICES.map(n=>n.year))].sort((a,b)=>b-a);
const unitsOf=list=>[...new Set(list.map(n=>n.unit))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
const byId=id=>NOTICES.find(n=>n.id===id);
let YEAR=CUR_Y;
const inYear=()=>YEAR==='all'?NOTICES:NOTICES.filter(n=>n.year===YEAR);
const yearLabel=y=>y==='all'?'全部年度':`${roc(y)} 年度（${y}）`;
// 只有起始日、沒有結束日者，視為起始日後 30 天內進行中
const plusDays=(d,k)=>{const t=new Date(d+'T00:00:00');t.setDate(t.getDate()+k);return new Date(t.getTime()-t.getTimezoneOffset()*60000).toISOString().slice(0,10)};
const activeNow=n=>!!n.actStart&&n.actStart<=TODAY_S&&(n.actEnd||plusDays(n.actStart,30))>=TODAY_S;

// ---------- routes ----------
const ROUTES=[
  {g:'通報'},
  {id:'board',t:'通報總覽',r:renderBoard},
  {id:'list',t:'年度總表',r:renderList},
  {g:'查詢'},
  {id:'ai',t:'專案小幫手',r:renderAI},
  {id:'search',t:'組合條件查詢',r:renderSearch},
  {g:'管理'},
  {id:'new',t:'新增／匯入通報',r:renderNew}
];
function initShell(){
  let n=0;
  $('#nav').innerHTML=ROUTES.map(r=>r.g?`<div class="nav-g">${r.g}</div>`:`<a class="nav-a" href="#/${r.id}" data-id="${r.id}"><span class="no">${++n}</span>${r.t}</a>`).join('');
  const side=$('#side');
  $('#menuBtn').onclick=()=>side.classList.toggle('open');
  $('#askBtn').onclick=()=>go('#/ai');
  $('#nav').addEventListener('click',e=>{if(e.target.closest('.nav-a'))side.classList.remove('open')});
  if(!years().includes(YEAR))YEAR=years()[0]||CUR_Y;
  fillYears();
  $('#yrSel').onchange=e=>{YEAR=e.target.value==='all'?'all':+e.target.value;route()};
  window.addEventListener('hashchange',route);
}
function fillYears(){
  $('#yrSel').innerHTML=years().map(y=>`<option value="${y}">${roc(y)} 年（${y}）</option>`).join('')+'<option value="all">全部年度</option>';
  $('#yrSel').value=String(YEAR);
}
function setYear(y){YEAR=y;fillYears()}
function route(){
  const h=location.hash.replace(/^#\/?/,'');
  const [path,qs]=h.split('?');
  const parts=path.split('/');
  const params=new URLSearchParams(qs||'');
  const main=$('#main');main.innerHTML='';tip(null);
  if(parts[0]==='notice'){renderNotice(main,decodeURIComponent(parts[1]||''));setNav('list')}
  else{const r=ROUTES.find(x=>x.id===parts[0])||ROUTES[1];$('#topTitle').textContent=r.t;r.r(main,params);setNav(r.id)}
  $('#topMeta').textContent=`${yearLabel(YEAR)} · ${inYear().length} 筆通報`;
  $('#sideFoot').textContent=`${years().length} 個年度 · 共 ${NOTICES.length.toLocaleString()} 筆通報`;
  window.scrollTo(0,0);
}
function setNav(id){document.querySelectorAll('.nav-a').forEach(a=>{if(a.dataset.id===id)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')})}
const go=h=>{location.hash=h};
const openNotice=id=>go('#/notice/'+encodeURIComponent(id));

// ---------- shared UI ----------
function pageH(t,p,actions){return el(`<div class="page-h"><div><h1>${t}</h1>${p?`<p>${p}</p>`:''}</div>${actions?`<div class="btn-row">${actions}</div>`:''}</div>`)}
function cards(items){
  const w=el('<div class="cards"></div>');
  items.forEach(c=>{const b=el(`<${c.go?'button type="button"':'div'} class="card ${c.cls||''}"><span class="lbl">${c.l}</span><span class="val num">${c.val}</span><span class="sub">${c.sub||''}</span></${c.go?'button':'div'}>`);if(c.go)b.onclick=c.go;w.append(b)});
  return w;
}
function fileExt(name){const m=/\.([a-z0-9]+)$/i.exec(name||'');const e=m?m[1].toLowerCase():'';return /^(png|jpe?g|gif|webp|bmp)$/.test(e)?'img':e}
function tip(e,html){const t=$('#tip');if(!e||!html){t.hidden=true;return}t.innerHTML=html;t.hidden=false;const x=Math.min(e.clientX+14,innerWidth-t.offsetWidth-8);t.style.left=x+'px';t.style.top=(e.clientY+14)+'px'}
function hlText(s,kw){s=esc(s);const terms=(kw||[]).filter(Boolean).map(t=>reEsc(esc(t)));if(!terms.length)return s;return s.replace(new RegExp('('+terms.join('|')+')','gi'),'<mark>$1</mark>')}

// 直條圖：items=[{label,value,key}]，onPick(key)
function barChart(items,{onPick,tipFn,hiKey}={}){
  const mx=Math.max(1,...items.map(x=>x.value));
  const W=560,H=220,P={l:34,r:8,t:12,b:24},bw=(W-P.l-P.r)/items.length;
  const yv=v=>P.t+(H-P.t-P.b)*(1-v/mx);
  const step=Math.max(1,Math.ceil(mx/4/(mx>40?10:1))*(mx>40?10:1));
  let svg=`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">`;
  for(let v=0;v<=mx;v+=step)svg+=`<line x1="${P.l}" x2="${W-P.r}" y1="${yv(v)}" y2="${yv(v)}" stroke="var(--line)"/><text x="${P.l-6}" y="${yv(v)+4}" text-anchor="end">${v}</text>`;
  items.forEach((x,i)=>{const x0=P.l+i*bw+bw*.18,w=bw*.64,y=yv(x.value);
    svg+=`<rect x="${x0}" y="${y}" width="${w}" height="${Math.max(0,yv(0)-y)}" fill="${x.key===hiKey?'var(--s2)':'var(--s1)'}" rx="2"/>`;
    if(x.value)svg+=`<text x="${x0+w/2}" y="${y-4}" text-anchor="middle" style="fill:var(--ink-2)">${x.value}</text>`;
    svg+=`<rect class="hb-hit" data-i="${i}" x="${P.l+i*bw}" y="${P.t}" width="${bw}" height="${H-P.t-P.b}" fill="transparent" style="cursor:${onPick?'pointer':'default'}"/><text x="${P.l+i*bw+bw/2}" y="${H-6}" text-anchor="middle">${esc(x.label)}</text>`});
  const box=el(`<div class="chart">${svg}</svg></div>`);
  box.querySelectorAll('.hb-hit').forEach(r=>{const x=items[+r.dataset.i];
    r.onmousemove=e=>tip(e,tipFn?tipFn(x):`<b>${esc(x.label)}</b>　${x.value} 筆`);r.onmouseleave=()=>tip(null);
    if(onPick)r.onclick=()=>{tip(null);onPick(x.key)}});
  return box;
}

// ---------- 通報總覽 ----------
function renderBoard(main){
  const list=inYear();
  const isCur=YEAR===CUR_Y,curM=TODAY.getMonth()+1;
  main.append(pageH(`${yearLabel(YEAR)} 通報總覽`,'點卡片、長條或主旨可進入對應清單或通報內容；右上角可切換年度。','<a class="btn" href="#/list">開啟年度總表 →</a>'));
  const act=list.filter(activeNow);
  main.append(cards([
    {l:'通報總數',val:list.length.toLocaleString(),sub:YEAR==='all'?`${years().length} 個年度`:'本年度發文',cls:'info',go:()=>go('#/list')},
    isCur?{l:`${curM} 月通報`,val:list.filter(n=>n.month===curM).length,sub:'本月新增',cls:'good',go:()=>go('#/list?month='+curM)}:null,
    {l:'活動進行中',val:act.length,sub:'今日在活動期間內',cls:'warn',go:()=>go('#/list?active=1')},
    {l:'發文單位',val:unitsOf(list).length,sub:'個單位'},
    {l:'附件檔案',val:list.reduce((s,n)=>s+n.files.length,0).toLocaleString(),sub:'份'}
  ].filter(Boolean)));

  const g=el('<div class="grid2"></div>');
  if(YEAR!=='all'){
    const mp=el('<section class="panel"><div class="panel-h"><h2>每月通報件數</h2><p>點長條看該月清單</p></div></section>');
    mp.append(barChart(Array.from({length:12},(_,i)=>({label:(i+1)+'月',key:i+1,value:list.filter(n=>n.month===i+1).length})),{onPick:m=>go('#/list?month='+m),hiKey:isCur?curM:null}));
    g.append(mp);
  }
  const yp=el(`<section class="panel"><div class="panel-h"><h2>歷年通報件數</h2><p>民國年 · 點長條切換年度</p></div></section>`);
  yp.append(barChart(years().slice().reverse().map(y=>({label:String(roc(y)),key:y,value:NOTICES.filter(n=>n.year===y).length})),{onPick:y=>{setYear(y);route()},hiKey:YEAR,tipFn:x=>`<b>${x.label} 年（${x.key}）</b>　${x.value} 筆`}));
  g.append(yp);

  const g2=el('<div class="grid2"></div>');
  const up=el('<section class="panel"><div class="panel-h"><h2>發文單位排行</h2><p>前 12 名 · 點單位看清單</p></div><div class="hbars"></div></section>');
  const uc=unitsOf(list).map(u=>({u,n:list.filter(x=>x.unit===u).length})).sort((a,b)=>b.n-a.n).slice(0,12);
  const umx=Math.max(1,...uc.map(x=>x.n));
  uc.forEach(x=>{const r=el(`<div class="hb click" role="button" tabindex="0"><span title="${esc(x.u)}">${esc(x.u)}</span><span class="t"><i style="width:${x.n/umx*100}%"></i></span><span class="n num">${x.n} 筆</span></div>`);r.onclick=()=>go('#/list?unit='+encodeURIComponent(x.u));r.onkeydown=e=>{if(e.key==='Enter')r.onclick()};up.querySelector('.hbars').append(r)});
  if(!uc.length)up.querySelector('.hbars').innerHTML='<div class="empty">本年度尚無通報</div>';
  g2.append(up);
  const ap=el('<section class="panel"><div class="panel-h"><h2>活動進行中</h2><p>今日在活動起訖期間內的通報</p></div><div class="alerts"></div></section>');
  const actAll=NOTICES.filter(activeNow).sort((a,b)=>(a.actEnd||'9').localeCompare(b.actEnd||'9')).slice(0,8);
  actAll.forEach(n=>{const a=el(`<button type="button" class="alert sev-warn"><span class="tag">${n.actEnd?'至 '+rocDate(n.actEnd):'進行中'}</span><span><b>${esc(n.subject)}</b><br><span class="note">${rocDate(n.date)} · ${esc(n.unit)} · ${esc(n.sender)}</span></span><span class="go">查看 →</span></button>`);a.onclick=()=>openNotice(n.id);ap.querySelector('.alerts').append(a)});
  if(!actAll.length)ap.querySelector('.alerts').innerHTML='<div class="empty">目前沒有進行中的活動</div>';
  g2.append(ap);
  main.append(g2);

  const lp=el('<section class="panel"><div class="panel-h"><h2>最新通報</h2><p>最近 10 筆</p></div></section>');
  lp.append(noticeTable(list.slice(0,10)));
  main.append(lp);
  main.append(g);   // 每月／歷年通報件數放在最新通報下方
}

// ---------- 年度總表 ----------
function noticeTable(rows,hl,showYear){
  const w=el(`<div class="tbl-wrap"><table><thead><tr><th class="l" data-k="date">發送日期</th><th class="l" data-k="no">通報編號</th><th class="l" data-k="unit">發文單位</th><th class="l" data-k="sender">發文者</th><th class="l" data-k="subject">主旨</th></tr></thead><tbody></tbody></table></div>`);
  const tb=w.querySelector('tbody');
  if(!rows.length){tb.innerHTML='<tr><td colspan="5" class="empty">沒有符合條件的通報</td></tr>';return w}
  const frag=document.createDocumentFragment();
  rows.forEach(n=>{
    const tr=el(`<tr class="click"><td class="num">${rocDate(n.date)}</td><td class="l num note">${esc(n.no||n.id)}</td><td class="l">${hlText(n.unit,hl)}</td><td class="l">${hlText(n.sender,hl)}</td><td class="l subj"><button type="button" class="subj-a">${hlText(n.subject,hl)}</button>${n.files.length?`<span class="clip" title="${n.files.length} 個附件">📎${n.files.length}</span>`:''}${activeNow(n)?'<span class="pill y">活動中</span>':''}</td></tr>`);
    tr.onclick=()=>openNotice(n.id);frag.append(tr)});
  tb.append(frag);
  return w;
}
function renderList(main,params){
  if(params.get('all'))setYear('all');
  const st={q:params.get('q')||'',unit:params.get('unit')||'',month:params.get('month')||'',active:!!params.get('active'),sort:'date',dir:-1,page:0};
  const PER=100;
  main.append(pageH(`${yearLabel(YEAR)} 通報總表`,'點主旨開啟通報內容與附件；欄位標題可排序。','<button type="button" class="btn" id="csvBtn">匯出 CSV</button><a class="btn" href="#/new">＋ 新增通報</a>'));
  const list=inYear();
  const p=el(`<section class="panel"><div class="tbl-tools"><div class="btn-row">
    <input type="search" id="fq" placeholder="搜尋主旨、單位、發文者、編號、內文、附件檔名" value="${esc(st.q)}" style="width:300px">
    <select id="fu"><option value="">全部單位</option>${unitsOf(list).map(u=>`<option ${u===st.unit?'selected':''}>${esc(u)}</option>`).join('')}</select>
    ${YEAR==='all'?'':`<select id="fm"><option value="">全部月份</option>${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${String(i+1)===st.month?'selected':''}>${i+1} 月</option>`).join('')}</select>`}
    <label class="note" style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="fa" ${st.active?'checked':''}>只看活動進行中</label>
    <button type="button" class="btn btn-xs" id="fclr">清除條件</button></div><span class="note" id="fcount"></span></div><div id="tblBox"></div>
    <div class="pager"><button type="button" class="btn btn-xs" id="pp">上一頁</button><span class="note" id="pinfo"></span><button type="button" class="btn btn-xs" id="pn">下一頁</button></div></section>`);
  main.append(p);
  let rows=[];
  const draw=()=>{
    const q=st.q.trim().toLowerCase();
    rows=list.filter(n=>(!st.unit||n.unit===st.unit)&&(!st.month||n.month===+st.month)&&(!st.active||activeNow(n))&&(!q||n._hay.includes(q)));
    rows.sort((a,b)=>String(a[st.sort]).localeCompare(String(b[st.sort]),'zh-Hant')*st.dir||b.date.localeCompare(a.date));
    const pages=Math.max(1,Math.ceil(rows.length/PER));st.page=Math.min(st.page,pages-1);
    const box=p.querySelector('#tblBox');box.innerHTML='';
    const t=noticeTable(rows.slice(st.page*PER,(st.page+1)*PER),q?[st.q.trim()]:null);box.append(t);
    t.querySelectorAll('th').forEach(th=>{if(th.dataset.k===st.sort)th.setAttribute('aria-sort',st.dir>0?'ascending':'descending');th.onclick=()=>{if(st.sort===th.dataset.k)st.dir*=-1;else{st.sort=th.dataset.k;st.dir=th.dataset.k==='date'?-1:1}draw()}});
    p.querySelector('#fcount').textContent=`顯示 ${rows.length.toLocaleString()} / ${list.length.toLocaleString()} 筆`;
    p.querySelector('#pinfo').textContent=`第 ${st.page+1} / ${pages} 頁`;
    p.querySelector('#pp').disabled=st.page===0;p.querySelector('#pn').disabled=st.page>=pages-1;
    p.querySelector('.pager').hidden=pages<2;
  };
  const re=()=>{st.page=0;draw()};
  p.querySelector('#fq').oninput=e=>{st.q=e.target.value;re()};
  p.querySelector('#fu').onchange=e=>{st.unit=e.target.value;re()};
  if(p.querySelector('#fm'))p.querySelector('#fm').onchange=e=>{st.month=e.target.value;re()};
  p.querySelector('#fa').onchange=e=>{st.active=e.target.checked;re()};
  p.querySelector('#fclr').onclick=()=>{if(location.hash==='#/list')route();else go('#/list')};
  p.querySelector('#pp').onclick=()=>{st.page--;draw();p.scrollIntoView()};
  p.querySelector('#pn').onclick=()=>{st.page++;draw();p.scrollIntoView()};
  main.querySelector('#csvBtn').onclick=()=>{
    const head=['發送日期','通報編號','ES編號','發文單位','發文者','主旨','活動起始日','活動結束日','備註','附件數'];
    const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
    const csv='\ufeff'+[head,...rows.map(n=>[n.date,n.no,n.id,n.unit,n.sender,n.subject,n.actStart,n.actEnd,n.note,n.files.length])].map(r=>r.map(q).join(',')).join('\r\n');
    downloadBlob(new Blob([csv],{type:'text/csv'}),`通報總表_${YEAR==='all'?'全部':roc(YEAR)}.csv`);
  };
  draw();
}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000)}

// ---------- 通報內容 ----------
function renderNotice(main,id){
  const n=byId(id);
  $('#topTitle').textContent='通報內容';
  if(!n){main.append(el('<section class="panel empty">找不到這筆通報。<br><a href="#/list">回年度總表</a></section>'));return}
  if(YEAR!=='all'&&n.year!==YEAR)setYear(n.year);
  const scope=inYear(),idx=scope.indexOf(n),prev=scope[idx-1],next=scope[idx+1];
  const crumbs=el(`<div class="crumbs"><button type="button">${YEAR==='all'?'全部年度':roc(n.year)+' 年度'}總表</button><span>›</span><span class="cur">${esc(n.subject)}</span></div>`);
  crumbs.querySelector('button').onclick=()=>go('#/list');
  main.append(crumbs);
  const kv=[['發送日期',`${rocDate(n.date)}<span class="note">（${n.date}）</span>`],['通報編號',esc(n.no||'—')],['ES 編號',esc(n.id)],['發文單位',esc(n.unit)],['發文者',esc(n.sender||'—')]];
  if(n.actStart||n.actEnd)kv.push(['活動期間',`${rocDate(n.actStart)} ～ ${n.actEnd?rocDate(n.actEnd):''}${activeNow(n)?'<span class="pill y">進行中</span>':''}`]);
  if(n.note)kv.push(['備註',esc(n.note)]);
  const doc=el(`<div class="doc"><article class="doc-paper">
      <div class="doc-no">${esc(n.no||n.id)}</div>
      <h1>${esc(n.subject)}</h1>
      <div class="note">${rocDate(n.date)}　${esc(n.unit)}　${esc(n.sender)}</div>
      ${n.body?`<div class="doc-body">${esc(n.body)}</div><p class="note" style="margin-top:12px">↑ 內文由附件 Word 檔擷取，完整內容請開啟附件。</p>`:'<p class="note" style="margin-top:16px">此通報無可擷取的文字內文，請開啟右側附件檔案。</p>'}
      <div id="viewer"></div>
    </article>
    <aside class="doc-side">
      <section class="panel"><div class="panel-h"><h2>通報資訊</h2></div><div class="kv">${kv.map(([k,v])=>`<div>${k}</div><div>${v}</div>`).join('')}</div></section>
      <section class="panel"><div class="panel-h"><h2>通報檔案</h2><p>${n.files.length} 份</p></div><div class="files" id="files"></div></section>
      <div class="btn-row">${prev?'<button type="button" class="btn" id="pv">← 較新一筆</button>':''}${next?'<button type="button" class="btn" id="nx">較舊一筆 →</button>':''}${n.userAdded?'<button type="button" class="btn" id="delN">刪除</button>':''}</div>
    </aside></div>`);
  main.append(doc);
  if(prev)doc.querySelector('#pv').onclick=()=>openNotice(prev.id);
  if(next)doc.querySelector('#nx').onclick=()=>openNotice(next.id);
  const fl=doc.querySelector('#files');
  if(!n.files.length)fl.innerHTML=`<div class="note">${n.noFolder?'找不到對應的 ES 附件資料夾。':'此通報沒有附件。'}</div>`;
  // 公開網站版：附件不在網站上，顯示共用資料夾位置並可複製
  const SHARE=window.SHARE_PATH;
  if(SHARE&&n.files.length&&!n.userAdded){
    const dir=SHARE+'\\'+n.files[0].path.replace(/^通報\//,'').split('/').slice(0,-1).join('\\');
    fl.append(el(`<div class="note" style="margin-bottom:8px">附件請到公司共用資料夾開啟：<br><code style="word-break:break-all">${esc(dir)}</code></div>`));
    const cp=el('<button type="button" class="btn btn-xs" style="margin-bottom:8px">複製資料夾位置</button>');
    cp.onclick=()=>{(navigator.clipboard?navigator.clipboard.writeText(dir):Promise.reject()).then(()=>toast('已複製，請貼到檔案總管的網址列')).catch(()=>prompt('請複製以下位置，貼到檔案總管的網址列：',dir))};
    fl.append(cp);
    n.files.forEach(f=>{const ext=fileExt(f.name);fl.append(el(`<div class="file"><span class="ic ${ext}">${ext==='img'?'IMG':esc((ext||'FILE').toUpperCase().slice(0,4))}</span><span style="min-width:0"><div class="fn" title="${esc(f.name)}">${esc(f.name)}</div><div class="fs">${fmtSize(f.size)}</div></span></div>`))});
    return;
  }
  n.files.forEach(f=>{
    const ext=fileExt(f.name),canView=/^(pdf|img|txt)$/.test(ext);
    const href=f.path?fileUrl(f.path):'#';
    const row=el(`<div class="file"><span class="ic ${ext}">${ext==='img'?'IMG':esc((ext||'FILE').toUpperCase().slice(0,4))}</span><span style="min-width:0"><div class="fn" title="${esc(f.name)}">${esc(f.name)}</div><div class="fs">${fmtSize(f.size)}</div></span><span class="btn-row" style="flex-wrap:nowrap">${canView?'<button type="button" class="btn btn-xs" data-a="v">預覽</button>':''}<a class="btn btn-xs" ${f.path?`href="${href}" target="_blank" rel="noopener"`:'href="#" data-a="o"'}>開啟</a></span></div>`);
    const v=row.querySelector('[data-a="v"]');if(v)v.onclick=()=>showFile(f);
    const o=row.querySelector('[data-a="o"]');if(o)o.onclick=e=>{e.preventDefault();showFile(f,false,true)};
    fl.append(row);
  });
  const first=n.files.find(f=>/^(pdf|img)$/.test(fileExt(f.name)));
  if(first)showFile(first,true);
  if(n.userAdded)doc.querySelector('#delN').onclick=async()=>{
    if(!confirm(`確定刪除「${n.subject}」？此動作無法復原。`))return;
    store.set('notices.user',store.get('notices.user',[]).filter(x=>x.id!==n.id));
    for(const f of n.files)if(f.key)await idb.del(f.key).catch(()=>{});
    load();fillYears();toast('已刪除');go('#/list');
  };
}
async function showFile(f,quiet,download){
  let url;
  if(f.path)url=fileUrl(f.path);
  else{let blob;try{blob=await idb.get(f.key)}catch(e){}if(!blob){if(!quiet)toast('找不到檔案（可能已清除瀏覽器資料）');return}if(download){downloadBlob(blob,f.name);return}url=URL.createObjectURL(blob)}
  const ext=fileExt(f.name),v=$('#viewer');if(!v)return;
  v.innerHTML=`<div class="viewer">${ext==='img'?`<img src="${url}" alt="${esc(f.name)}">`:`<iframe src="${url}" title="${esc(f.name)}"></iframe>`}</div><p class="note" style="margin-top:6px">預覽：${esc(f.name)}</p>`;
  if(!quiet)v.scrollIntoView({behavior:'smooth'});
}

// ---------- 組合條件查詢 ----------
// 每個條件一個獨立方格，條件之間為「且」；條件保留在記憶體，切換頁面回來仍在。
const FTYPES=[['pdf','PDF',/\.pdf$/i],['word','Word',/\.docx?$/i],['excel','Excel',/\.(xlsx?|csv)$/i],['ppt','簡報',/\.pptx?$/i],['img','圖片',/\.(jpe?g|png|gif|bmp|webp)$/i]];
const SQ_EMPTY={y1:'',y2:'',month:'',unit:'',sender:'',kw:'',scope:'all',no:'',ftype:'',status:''};
let SQ={...SQ_EMPTY};
function renderSearch(main){
  const ys=years().slice().reverse();
  const yOpt=sel=>`<option value="">不限</option>`+ys.map(y=>`<option value="${y}" ${String(y)===sel?'selected':''}>${roc(y)} 年（${y}）</option>`).join('');
  main.append(pageH('組合條件查詢','每個方格是一個條件，可任意組合（同時符合）；結果即時更新，不受右上角年度限制。','<button type="button" class="btn" id="sqClr">清除全部條件</button><button type="button" class="btn" id="sqCsv">匯出結果 CSV</button>'));
  const g=el(`<div class="qgrid">
    <section class="qbox"><h3><span class="qn">1</span>年度範圍</h3><div class="qrow"><select id="sqY1">${yOpt(SQ.y1)}</select><span>～</span><select id="sqY2">${yOpt(SQ.y2)}</select></div></section>
    <section class="qbox"><h3><span class="qn">2</span>月份</h3><select id="sqM"><option value="">不限</option>${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${String(i+1)===SQ.month?'selected':''}>${i+1} 月</option>`).join('')}</select></section>
    <section class="qbox"><h3><span class="qn">3</span>發文單位</h3><select id="sqU"><option value="">不限</option>${unitsOf(NOTICES).map(u=>`<option ${u===SQ.unit?'selected':''}>${esc(u)}</option>`).join('')}</select></section>
    <section class="qbox"><h3><span class="qn">4</span>發文者</h3><input id="sqP" list="sqPl" placeholder="姓名，可部分輸入" value="${esc(SQ.sender)}"><datalist id="sqPl">${[...new Set(NOTICES.map(n=>n.sender).filter(Boolean))].sort().map(s=>`<option value="${esc(s)}">`).join('')}</datalist></section>
    <section class="qbox qwide"><h3><span class="qn">5</span>關鍵字</h3><input id="sqK" placeholder="多個關鍵字以空白分隔，需全部符合；例：代步車 補助" value="${esc(SQ.kw)}">
      <div class="qseg" id="sqS">${[['all','主旨＋內文＋附件檔名'],['subject','只找主旨']].map(([v,t])=>`<label><input type="radio" name="sqs" value="${v}" ${SQ.scope===v?'checked':''}>${t}</label>`).join('')}</div></section>
    <section class="qbox"><h3><span class="qn">6</span>通報編號</h3><input id="sqN" placeholder="例：YNC0Q-23 或 ES1120001" value="${esc(SQ.no)}"></section>
    <section class="qbox"><h3><span class="qn">7</span>附件類型</h3><select id="sqF"><option value="">不限</option>${FTYPES.map(([v,t])=>`<option value="${v}" ${v===SQ.ftype?'selected':''}>含 ${t}</option>`).join('')}<option value="none" ${SQ.ftype==='none'?'selected':''}>無附件</option></select></section>
    <section class="qbox"><h3><span class="qn">8</span>活動狀態</h3><select id="sqA"><option value="">不限</option><option value="active" ${SQ.status==='active'?'selected':''}>今日進行中</option><option value="has" ${SQ.status==='has'?'selected':''}>有活動期間</option></select></section>
  </div>`);
  main.append(g);
  const res=el('<section class="panel"><div class="panel-h"><h2 id="sqTitle">查詢結果</h2><p id="sqDesc"></p></div><div id="sqBox"></div><div class="pager"><button type="button" class="btn btn-xs" id="sqPp">上一頁</button><span class="note" id="sqPi"></span><button type="button" class="btn btn-xs" id="sqPn">下一頁</button></div></section>');
  main.append(res);
  const PER=50;let page=0,rows=[];
  const draw=()=>{
    let a=+SQ.y1||0,b=+SQ.y2||9999;if(a>b)[a,b]=[b,a];
    const kws=SQ.kw.trim().split(/\s+/).filter(Boolean).map(expand);
    const no=SQ.no.trim().toLowerCase(),sender=SQ.sender.trim();
    const ft=FTYPES.find(x=>x[0]===SQ.ftype);
    rows=NOTICES.filter(n=>n.year>=a&&n.year<=b&&(!SQ.month||n.month===+SQ.month)&&(!SQ.unit||n.unit===SQ.unit)&&(!sender||n.sender.includes(sender))
      &&(!no||(n.no+' '+n.id).toLowerCase().includes(no))
      &&(!SQ.ftype||(SQ.ftype==='none'?!n.files.length:n.files.some(f=>ft[2].test(f.name))))
      &&(!SQ.status||(SQ.status==='active'?activeNow(n):!!n.actStart))
      &&kws.every(g=>g.some(t=>(SQ.scope==='subject'?n.subject.toLowerCase():n._hay).includes(t.toLowerCase()))));
    const conds=g.querySelectorAll('.qbox');
    const on=[SQ.y1||SQ.y2,SQ.month,SQ.unit,sender,SQ.kw.trim(),no,SQ.ftype,SQ.status];
    conds.forEach((c,i)=>c.classList.toggle('on',!!on[i]));
    const nOn=on.filter(Boolean).length;
    res.querySelector('#sqTitle').innerHTML=`查詢結果 <span class="num" style="color:var(--accent)">${rows.length.toLocaleString()}</span> 筆`;
    res.querySelector('#sqDesc').textContent=nOn?`已套用 ${nOn} 個條件`:'尚未設定條件，顯示全部通報';
    const pages=Math.max(1,Math.ceil(rows.length/PER));page=Math.min(page,pages-1);
    const box=res.querySelector('#sqBox');box.innerHTML='';
    box.append(noticeTable(rows.slice(page*PER,(page+1)*PER),kws.flat()));
    res.querySelector('#sqPi').textContent=`第 ${page+1} / ${pages} 頁`;
    res.querySelector('#sqPp').disabled=page===0;res.querySelector('#sqPn').disabled=page>=pages-1;
    res.querySelector('.pager').hidden=pages<2;
  };
  const bind=(id,key,ev='change')=>g.querySelector(id).addEventListener(ev,e=>{SQ[key]=e.target.value;page=0;draw()});
  bind('#sqY1','y1');bind('#sqY2','y2');bind('#sqM','month');bind('#sqU','unit');bind('#sqP','sender','input');bind('#sqK','kw','input');bind('#sqN','no','input');bind('#sqF','ftype');bind('#sqA','status');
  g.querySelectorAll('input[name=sqs]').forEach(r=>r.onchange=()=>{SQ.scope=r.value;page=0;draw()});
  res.querySelector('#sqPp').onclick=()=>{page--;draw();res.scrollIntoView()};
  res.querySelector('#sqPn').onclick=()=>{page++;draw();res.scrollIntoView()};
  main.querySelector('#sqClr').onclick=()=>{SQ={...SQ_EMPTY};route()};
  main.querySelector('#sqCsv').onclick=()=>{
    const head=['發送日期','通報編號','ES編號','發文單位','發文者','主旨','活動起始日','活動結束日','附件數'];
    const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
    downloadBlob(new Blob(['﻿'+[head,...rows.map(n=>[n.date,n.no,n.id,n.unit,n.sender,n.subject,n.actStart,n.actEnd,n.files.length])].map(r=>r.map(q).join(',')).join('\r\n')],{type:'text/csv'}),'組合條件查詢結果.csv');
  };
  draw();
}

// ---------- 專案小幫手 ----------
// 在瀏覽器內執行的查詢引擎：解析年度（西元／民國）、月份、發文單位、發文者，其餘當關鍵字並以同義詞擴充，
// 比對主旨、附件檔名、內文、編號後評分排序。
const SYN=[
  ['代步車','替代車','借用車','代用車'],
  ['證照','證書','證號','技術士','執照','檢定'],
  ['召回','改正作業','回收'],
  ['保固','保修','索賠'],
  ['訓練','課程','教育訓練','研習','講習'],
  ['會議','研討會','交流會'],
  ['颱風','泡水','水災'],
  ['電動車','e-POWER','高壓電','EV'],
  ['個資','個人資料'],
  ['資安','資訊安全','釣魚'],
  ['滿意度','CSI','NPS'],
  ['促銷','優惠','銷售辦法'],
  ['APP','App','app'],
  ['5S','五S']
];
const STOP=['請問','請','幫我','幫忙','麻煩','查詢','查一下','查','找出','找一下','找','搜尋','搜','列出','顯示','給我','看看','我想','想要','有沒有','有哪些','哪些','是否','有關','關於','相關的','相關','的','通報','公文','專案','文件','資料','嗎','呢','吧','一下','所有','全部','發的','發文','年度','了','是','在'];
const CHAT=[];let PENDING_Q='';
function askGo(q){PENDING_Q=q;if(location.hash==='#/ai')route();else go('#/ai')}

let UNIT_KEYS=null,SENDERS=null;
function lookupTables(){
  if(UNIT_KEYS)return;
  UNIT_KEYS=[];
  unitsOf(NOTICES).forEach(u=>{UNIT_KEYS.push([u,u]);const short=u.replace(/(科|部|室|中心|課|處)$/,'');if(short.length>=3&&short!==u)UNIT_KEYS.push([short,u])});
  UNIT_KEYS.sort((a,b)=>b[0].length-a[0].length);
  SENDERS=[...new Set(NOTICES.map(n=>n.sender).filter(s=>s&&s.length>=2&&s.length<=4))].sort((a,b)=>b.length-a.length);
}
function parseQ(q){
  lookupTables();
  let s=' '+q+' ';const c={years:[],month:null,units:[],senders:[],kw:[]};
  s=s.replace(/(20\d{2})\s*年?度?/g,(m,y)=>{c.years.push(+y);return ' '});
  s=s.replace(/(?:民國)?\s*(\d{2,3})\s*年度?/g,(m,y)=>{if(+y>=90&&+y<=130){c.years.push(+y+1911);return ' '}return m});
  if(/今年|本年/.test(s)){c.years.push(CUR_Y);s=s.replace(/今年度?|本年度?/g,' ')}
  if(/去年/.test(s)){c.years.push(CUR_Y-1);s=s.replace(/去年度?/g,' ')}
  if(/最近|近期/.test(s)&&!c.years.length){c.years.push(CUR_Y);s=s.replace(/最近|近期/g,' ')}
  s=s.replace(/(\d{1,2})\s*月份?/g,(m,x)=>{if(+x>=1&&+x<=12){c.month=+x;return ' '}return m});
  if(/本月|這個月/.test(s)){c.month=TODAY.getMonth()+1;if(!c.years.length)c.years.push(CUR_Y);s=s.replace(/本月|這個月/g,' ')}
  for(const [k,u] of UNIT_KEYS)if(s.includes(k)){if(!c.units.includes(u))c.units.push(u);s=s.split(k).join(' ')}
  for(const nm of SENDERS)if(s.includes(nm)){c.senders.push(nm);s=s.split(nm).join(' ')}
  STOP.slice().sort((a,b)=>b.length-a.length).forEach(w=>{s=s.split(w).join(' ')});
  c.kw=[...new Set(s.split(/[\s,，、。？?！!：:;；「」『』"'()（）]+|和|與|或|及|跟/).map(x=>x.trim()).filter(x=>x.length>=2||/^[A-Za-z0-9]$/.test(x)))];
  return c;
}
function expand(k){const kl=k.toLowerCase();for(const g of SYN)if(g.some(x=>x.toLowerCase()===kl))return g;return [k]}
function runQuery(c){
  const pool=NOTICES.filter(n=>(!c.years.length||c.years.includes(n.year))&&(!c.month||n.month===c.month)&&(!c.units.length||c.units.includes(n.unit))&&(!c.senders.length||c.senders.includes(n.sender)));
  const groups=c.kw.map(expand);
  if(!groups.length)return pool.map(n=>({n,score:0,matched:0,terms:[]}));
  return pool.map(n=>{
    let score=0,matched=0;const terms=[];
    const sub=n.subject.toLowerCase(),files=n.files.map(f=>f.name).join(' ').toLowerCase(),bd=n.body.toLowerCase(),meta=(n.no+' '+n.id+' '+n.note).toLowerCase();
    // 同義詞只比對主旨、檔名、編號；內文只比對使用者輸入的原詞，避免泛用詞造成過多結果
    groups.forEach((g,gi)=>{let gs=0;g.forEach(t=>{const tl=t.toLowerCase(),orig=tl===c.kw[gi].toLowerCase();let s=0;if(sub.includes(tl))s+=orig?10:7;if(files.includes(tl))s+=orig?4:3;if(meta.includes(tl))s+=3;if(orig&&bd.includes(tl))s+=Math.min(bd.split(tl).length-1,4)*1.5;if(s){terms.push(t);gs+=s}});if(gs){matched++;score+=gs}});
    return {n,score,matched,terms};
  }).filter(r=>r.matched>0).sort((a,b)=>b.matched-a.matched||b.score-a.score||b.n.date.localeCompare(a.n.date));
}
function snippet(n,terms){
  const b=n.body||'';
  for(const t of terms){const pos=b.toLowerCase().indexOf(t.toLowerCase());if(pos>=0){const st=Math.max(0,pos-24),en=Math.min(b.length,pos+50);return (st?'…':'')+hlText(b.slice(st,en).replace(/\n/g,' '),terms)+(en<b.length?'…':'')}}
  const f=n.files.find(f=>terms.some(t=>f.name.toLowerCase().includes(t.toLowerCase())));
  if(f)return '📎 '+hlText(f.name,terms);
  return n.files.length?`📎 ${esc(n.files.slice(0,2).map(f=>f.name).join('、'))}${n.files.length>2?' 等':''}`:'';
}
function describe(c){
  const p=[];
  if(c.years.length)p.push(c.years.map(y=>`${roc(y)} 年`).join('、'));
  if(c.month)p.push(`${c.month} 月`);
  if(c.units.length)p.push(c.units.join('、'));
  if(c.senders.length)p.push(c.senders.join('、')+' 發文');
  if(c.kw.length)p.push('「'+c.kw.join('」「')+'」');
  return p.join('、');
}
function answer(q){
  const c=parseQ(q);
  if(!(c.years.length||c.month||c.units.length||c.senders.length||c.kw.length))
    return {html:'<p>我可以幫你找通報。輸入關鍵字、年度、發文單位或發文者都可以，例如：</p>',chips:['代步車','證照','112年 代步車','顧客服務中心 檢定','今年 召回']};
  const res=runQuery(c);
  const desc=describe(c);
  if(!res.length)return {html:`<p>找不到符合 <b>${esc(desc)}</b> 的通報。</p><p class="note">可以換個說法、拿掉年度或單位條件再試一次。</p>`,chips:c.kw.length&&(c.years.length||c.units.length||c.month)?[c.kw.join(' ')]:['代步車','證照','召回']};
  const byYear={};res.forEach(r=>byYear[r.n.year]=(byYear[r.n.year]||0)+1);
  const ys=Object.keys(byYear).map(Number).sort((a,b)=>b-a);
  const yrTxt=ys.length>4?`分布於 ${roc(ys[ys.length-1])}–${roc(ys[0])} 年，最多是 ${roc(+Object.entries(byYear).sort((a,b)=>b[1]-a[1])[0][0])} 年`:ys.map(y=>`${roc(y)} 年 ${byYear[y]} 筆`).join('、');
  const uc={};res.forEach(r=>uc[r.n.unit]=(uc[r.n.unit]||0)+1);
  const topU=Object.entries(uc).sort((a,b)=>b[1]-a[1])[0];
  const latest=res.reduce((a,b)=>b.n.date>a.n.date?b:a).n;
  const syn=c.kw.map(expand).filter(g=>g.length>1);
  const act=res.filter(r=>activeNow(r.n)).length;
  let html=`<p>找到 <b class="num">${res.length}</b> 筆符合 <b>${esc(desc)}</b> 的通報（${yrTxt}）。</p>`;
  html+=`<p>最新一筆是 ${rocDate(latest.date)} ${esc(latest.unit)}的「${esc(latest.subject)}」${res.length>1?`；最常發文的單位是 ${esc(topU[0])}（${topU[1]} 筆）`:''}${act?`，目前有 <b>${act}</b> 筆在活動期間內`:''}。</p>`;
  if(syn.length)html+=`<p class="note">已一併比對同義詞：${syn.map(g=>g.join('／')).join('；')}</p>`;
  const show=res.slice(0,8);
  html+='<div class="hits">'+show.map(r=>`<button type="button" class="hit" data-id="${esc(r.n.id)}"><span class="h-t">${hlText(r.n.subject,r.terms)}</span><span class="h-m">${rocDate(r.n.date)} · ${esc(r.n.unit)} · ${esc(r.n.sender)}${r.n.files.length?` · 📎${r.n.files.length}`:''}</span><span class="h-s">${snippet(r.n,r.terms)}</span></button>`).join('')+'</div>';
  const chips=[];
  if(res.length>show.length&&c.kw.length)html+=`<p style="margin-top:8px"><a href="#/list?all=1&q=${encodeURIComponent(c.kw[0])}">在總表查看全部 ${res.length} 筆 →</a></p>`;
  if(!c.years.length&&ys.length>1)ys.slice(0,3).forEach(y=>chips.push(`${roc(y)}年 ${q}`));
  return {html,chips};
}
function renderAI(main){
  main.append(pageH('專案小幫手','用一般說法查詢：關鍵字、年度（民國或西元）、月份、發文單位、發文者都能組合，例如「112年 顧客服務中心 代步車」。'));
  const p=el(`<section class="panel chat"><div class="chat-log" id="log" aria-live="polite"></div>
    <form class="chat-in" id="chatF" role="search">
      <label class="chat-in-h" for="chatIn">要找特定專案？輸入關鍵字</label>
      <div class="chat-in-box"><input id="chatIn" type="search" placeholder="例如：代步車" autocomplete="off"><button type="submit">查詢</button></div>
      <div class="chat-in-foot"><span class="chat-in-chips">${['代步車','證照','今年 召回'].map(q=>`<button type="button" data-q="${q}">${q}</button>`).join('')}</span><span class="note">可組合年度、單位、發文者，例：112年 顧客服務中心 檢定</span></div>
    </form></section>`);
  main.append(p);
  main.append(el(`<p class="note">專案小幫手在瀏覽器內執行，比對 ${NOTICES.length.toLocaleString()} 筆通報的主旨、附件檔名、Word 內文與編號，資料不會傳出。PDF 內文目前不在搜尋範圍；日後可串接 Claude API 做全文語意問答與摘要。</p>`));
  const log=p.querySelector('#log');
  const push=(who,html,chips)=>{
    const m=el(`<div class="msg ${who}">${who==='bot'?'<span class="av">幫</span>':''}<div class="bubble">${html}${chips&&chips.length?`<div class="chips">${chips.map(c=>`<button type="button" class="chip">${esc(c)}</button>`).join('')}</div>`:''}</div>${who==='me'?'<span class="av">我</span>':''}</div>`);
    m.querySelectorAll('.hit').forEach(b=>b.onclick=()=>openNotice(b.dataset.id));
    m.querySelectorAll('.chip').forEach(b=>b.onclick=()=>ask(b.textContent));
    log.append(m);log.scrollTop=log.scrollHeight;
  };
  const ask=q=>{q=q.trim();if(!q)return;const a=answer(q);CHAT.push({q,a});push('me',esc(q));push('bot',a.html,a.chips)};
  push('bot',`<p>您好，我是專案小幫手 👋 目前收錄 ${roc(years()[years().length-1])}–${roc(years()[0])} 年共 ${NOTICES.length.toLocaleString()} 筆通報。</p><p>輸入關鍵字就能找出相關通報，例如：</p>`,['代步車','證照','112年 代步車','顧客服務中心 檢定','今年 召回']);
  CHAT.forEach(x=>{push('me',esc(x.q));push('bot',x.a.html,x.a.chips)});
  p.querySelector('#chatF').onsubmit=e=>{e.preventDefault();const i=p.querySelector('#chatIn');ask(i.value);i.value=''};
  p.querySelectorAll('.chat-in-chips button').forEach(b=>b.onclick=()=>ask(b.dataset.q));
  if(PENDING_Q){const q=PENDING_Q;PENDING_Q='';ask(q)}
  setTimeout(()=>p.querySelector('#chatIn').focus(),0);
}

// ---------- 新增／匯入 ----------
function renderNew(main){
  main.append(pageH('新增／匯入通報','正式資料請依「通報／民國年／ES 資料夾」放置後重跑 tools\\build-data.ps1；此頁新增的通報只存在本瀏覽器，適合臨時登錄。'));
  const f=el(`<section class="panel"><div class="panel-h"><h2>單筆新增</h2></div><form class="form" id="nf">
    <label>發送日期<input type="date" name="date" value="${TODAY_S}" required></label>
    <label>通報編號<input name="no" placeholder="例如：YNC0Q-26-0100"></label>
    <label>發文單位<input name="unit" list="ulist" required><datalist id="ulist">${unitsOf(NOTICES).map(u=>`<option value="${esc(u)}">`).join('')}</datalist></label>
    <label>發文者<input name="sender" required></label>
    <label>活動起始日<input type="date" name="as"></label>
    <label>活動結束日<input type="date" name="ae"></label>
    <label class="wide">主旨<input name="subject" required></label>
    <label class="wide">內容（供專案小幫手搜尋，可貼上通報全文）<textarea name="body"></textarea></label>
    <div class="wide drop" id="drop">拖曳通報檔到這裡，或 <label style="display:inline;color:var(--accent);cursor:pointer;text-decoration:underline">選擇檔案<input type="file" id="nfFiles" multiple hidden></label><div id="dropList" class="note" style="margin-top:6px"></div></div>
    <div class="wide btn-row"><button class="btn btn-pri" type="submit">儲存通報</button><button class="btn" type="reset">清除</button></div>
  </form></section>`);
  main.append(f);
  let picked=[];
  const showPicked=()=>{f.querySelector('#dropList').textContent=picked.map(x=>x.name).join('、')};
  f.querySelector('#nfFiles').onchange=e=>{picked=[...picked,...e.target.files];showPicked()};
  const dz=f.querySelector('#drop');
  dz.ondragover=e=>{e.preventDefault();dz.classList.add('on')};dz.ondragleave=()=>dz.classList.remove('on');
  dz.ondrop=e=>{e.preventDefault();dz.classList.remove('on');picked=[...picked,...e.dataTransfer.files];showPicked()};
  f.querySelector('#nf').onreset=()=>{picked=[];showPicked()};
  f.querySelector('#nf').onsubmit=async e=>{
    e.preventDefault();const fd=new FormData(e.target);
    const id='U'+Date.now().toString(36).toUpperCase();
    const files=[];
    try{for(const x of picked){const key=id+'/'+files.length+'-'+x.name;await idb.put(key,x);files.push({name:x.name,size:x.size,key})}}
    catch(err){toast('檔案儲存失敗：'+err.message);return}
    const n={id,date:fd.get('date'),no:fd.get('no').trim(),unit:fd.get('unit').trim(),sender:fd.get('sender').trim(),subject:fd.get('subject').trim(),body:fd.get('body'),actStart:fd.get('as'),actEnd:fd.get('ae'),note:'',files,userAdded:true};
    const user=store.get('notices.user',[]);user.push(n);if(!store.set('notices.user',user))return;
    load();UNIT_KEYS=null;setYear(+n.date.slice(0,4));toast('已新增通報');openNotice(id);
  };
  main.append(el(`<section class="panel howto"><b>正式更新資料的方式</b><ol>
    <li>把新的通報資料夾放進 <code>app\\通報\\</code>（例如 <code>116年\\116通報.xlsx</code> 與各 ES 資料夾）。</li>
    <li>在 <code>C:\\Projects\\yuxin-notice</code> 執行：<code>powershell -ExecutionPolicy Bypass -File tools\\build-data.ps1</code></li>
    <li>重新整理此頁面即可看到新資料。</li></ol></section>`));
}

// ---------- start ----------
load();
initShell();
if(!location.hash)location.hash='#/board';else route();
})();

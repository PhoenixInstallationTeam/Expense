/* Settled — static GitHub Pages frontend + Google Sheets backend.
   1) Deploy backend/Code.gs as a Google Apps Script web app.
   2) Paste the /exec URL into CONFIG.apiUrl below.
*/
const CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbwMuYn-kOWunepVpugCnZJzwL8m9YKoBG1OHfjfKTHIEekFhB4AsRdCcL7nCAKsTPOYCw/exec",
  currency: "₹",
  exportFileName: "settled-expense-report.xls"
};

const state = {
  user: null,
  groups: [],
  expenses: [],
  activeGroupId: null,
  view: "dashboard",
  loading: false
};

const fallbackUsers = [
  {id:"gobinath",name:"Gobinath",role:"admin"},
  {id:"prashandh",name:"Prashandh",role:"user"},
  {id:"sundarram",name:"Sundarram",role:"user"},
  {id:"karthikeyan",name:"Karthikeyan",role:"user"},
  {id:"thanis",name:"Thanis",role:"user"}
];

const $ = (s, root=document) => root.querySelector(s);
const esc = (v="") => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const money = n => `${CONFIG.currency}${Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const today = () => new Date().toISOString().slice(0,10);
const uid = p => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

function toast(msg, kind="") {
  const t=$("#toast"); t.textContent=msg; t.className=`toast show ${kind}`;
  clearTimeout(window.__toast); window.__toast=setTimeout(()=>t.className="toast",2600);
}

/* JSONP reads avoid cross-origin read restrictions on a GitHub Pages -> Apps Script call. */
function apiGet(params) {
  return new Promise((resolve,reject) => {
    if (!CONFIG.apiUrl || CONFIG.apiUrl.includes("PASTE_GOOGLE")) {
      reject(new Error("Backend URL is not configured."));
      return;
    }
    const cb = `settled_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const q = new URLSearchParams({...params, callback:cb, _:Date.now()});
    const timer = setTimeout(()=>{cleanup();reject(new Error("Backend request timed out."));},12000);
    function cleanup(){clearTimeout(timer);delete window[cb];script.remove();}
    window[cb] = data => {cleanup();resolve(data);};
    script.onerror = ()=>{cleanup();reject(new Error("Unable to reach the shared backend."));};
    script.src = `${CONFIG.apiUrl}?${q.toString()}`;
    document.body.appendChild(script);
  });
}

/* Writes are simple text POSTs. The browser cannot read the cross-origin response,
   so we re-read the authoritative sheet after a short delay. */
async function apiPost(payload) {
  if (!CONFIG.apiUrl || CONFIG.apiUrl.includes("PASTE_GOOGLE")) throw new Error("Backend URL is not configured.");
  await fetch(CONFIG.apiUrl, {
    method:"POST",
    mode:"no-cors",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify(payload)
  });
  await new Promise(r=>setTimeout(r,650));
}

function loadSession() {
  try { return JSON.parse(localStorage.getItem("settled_session")||"null"); } catch { return null; }
}
function saveSession(u){ localStorage.setItem("settled_session", JSON.stringify(u)); }
function clearSession(){ localStorage.removeItem("settled_session"); state.user=null; }

async function login(username,password) {
  state.loading=true; renderLogin();
  try {
    const data = await apiGet({action:"login",username,password});
    if (!data.ok) throw new Error(data.error||"Invalid username or password.");
    state.user=data.user; saveSession(state.user);
    await refreshData(); state.view="dashboard"; render();
    toast("Welcome back.");
  } catch(e) {
    toast(e.message,"error"); renderLogin();
  } finally { state.loading=false; }
}

async function refreshData() {
  state.loading=true;
  const data = await apiGet({action:"snapshot"});
  if (!data.ok) throw new Error(data.error||"Unable to load shared data.");
  state.groups=data.groups||[];
  state.expenses=data.expenses||[];
  if (!state.activeGroupId || !state.groups.some(g=>g.id===state.activeGroupId))
    state.activeGroupId=state.groups[0]?.id||null;
  state.loading=false;
}
function activeGroup(){ return state.groups.find(g=>g.id===state.activeGroupId) || state.groups[0] || null; }
function userName(id){ return state.users?.find(u=>u.id===id)?.name || fallbackUsers.find(u=>u.id===id)?.name || id; }
function members(g){ return (g?.memberIds||[]).map(id=>({id,name:userName(id)})); }
function groupExpenses(gid){ return state.expenses.filter(e=>e.groupId===gid); }

function balances(g) {
  const net={}; (g?.memberIds||[]).forEach(id=>net[id]=0);
  groupExpenses(g?.id).forEach(e=>{
    const payers=e.paidBy||[];
    payers.forEach(id=>net[id]=(net[id]||0)+Number(e.amount)/Math.max(payers.length,1));
    (e.splits||[]).forEach(s=>net[s.userId]=(net[s.userId]||0)-Number(s.amount));
  });
  return net;
}
function settlementPlan(net) {
  const debtors=Object.entries(net).filter(([,v])=>v<-.009).map(([id,v])=>({id,amount:-v}));
  const creditors=Object.entries(net).filter(([,v])=>v>.009).map(([id,v])=>({id,amount:v}));
  const result=[]; let i=0,j=0;
  while(i<debtors.length && j<creditors.length){
    const amount=Math.min(debtors[i].amount,creditors[j].amount);
    result.push({from:debtors[i].id,to:creditors[j].id,amount});
    debtors[i].amount-=amount; creditors[j].amount-=amount;
    if(debtors[i].amount<.01)i++; if(creditors[j].amount<.01)j++;
  }
  return result;
}

function render() {
  if (!state.user) return renderLogin();
  const g=activeGroup(), net=g?balances(g):{};
  document.getElementById("app").innerHTML=`
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><div class="brand-mark">S</div><div><strong>Settled</strong><small>Shared Expense Manager</small></div></div>
        <nav>
          ${navItem("dashboard","◈","Dashboard")}
          ${navItem("groups","◉","Groups")}
          ${navItem("expenses","▤","Expenses")}
          ${navItem("settlements","⇄","Settlements")}
        </nav>
        <div class="side-bottom">
          <div class="user-card"><div class="avatar">${esc(state.user.name[0])}</div><div><strong>${esc(state.user.name)}</strong><small>${esc(state.user.role)}</small></div></div>
          <button class="ghost full" id="logoutBtn">⇥ Sign out</button>
        </div>
      </aside>
      <div class="mobile-shade" id="mobileShade"></div>
      <main class="main">
        <header class="topbar">
          <div class="title-row"><button class="hamb" id="hamb">☰</button><div><small>SHARED WORKSPACE</small><h1>${esc(g?.name||"Settled")}</h1></div></div>
          <div class="header-actions">
            ${g?`<button class="secondary" id="openSheet">↗ Shared Sheet</button><button class="secondary" id="exportBtn">⇩ Excel</button>`:""}
            <button class="primary" id="topAdd">＋ Expense</button>
          </div>
        </header>
        <section id="content"></section>
      </main>
    </div>`;
  bindShell();
  renderView();
}
function navItem(view,icon,label){
  return `<button class="nav ${state.view===view?"active":""}" data-view="${view}"><span>${icon}</span>${label}</button>`;
}

function bindShell(){
  $("#logoutBtn").onclick=()=>{clearSession();renderLogin();};
  document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{state.view=b.dataset.view;closeMobile();renderView();});
  $("#topAdd").onclick=()=>{state.view="expenses";renderView();setTimeout(()=>openExpenseModal(),0)};
  $("#exportBtn")?.addEventListener("click",()=>exportExcel(activeGroup()));
  $("#openSheet")?.addEventListener("click",()=>{
    if (window.__sheetUrl) window.open(window.__sheetUrl,"_blank");
    else toast("Shared sheet link will appear after backend configuration.","error");
  });
  $("#hamb").onclick=()=>{$("#sidebar").classList.add("open");$("#mobileShade").classList.add("show")};
  $("#mobileShade").onclick=closeMobile;
}
function closeMobile(){$("#sidebar")?.classList.remove("open");$("#mobileShade")?.classList.remove("show");}

function renderView(){
  const c=$("#content"); const g=activeGroup();
  if(state.view==="dashboard") c.innerHTML=dashboardHTML(g);
  else if(state.view==="groups") c.innerHTML=groupsHTML();
  else if(state.view==="expenses") c.innerHTML=expensesHTML(g);
  else c.innerHTML=settlementsHTML(g);
  bindView();
}
function dashboardHTML(g){
  const all=state.expenses, total=all.reduce((a,e)=>a+Number(e.amount),0), memberCount=new Set(state.groups.flatMap(x=>x.memberIds)).size;
  return `<div class="content">
    <section class="hero"><div><span class="pill">LIVE SHARED LEDGER</span><h2>Know what was spent.<br><em>Know what is owed.</em></h2><p>Every member sees the same expense ledger from the shared spreadsheet backend.</p></div><button class="primary" id="heroAdd">＋ Add expense</button></section>
    <div class="stats">
      ${stat("◫","Total expenses",money(total))}
      ${stat("▤","Transactions",all.length)}
      ${stat("◎","Members",memberCount)}
      ${stat("◈","Groups",state.groups.length)}
    </div>
    <div class="section-head"><div><small>WORKSPACES</small><h3>Groups</h3></div><button class="text-btn" id="goGroups">Manage groups →</button></div>
    <div class="cards">${state.groups.map(g=>`<button class="group-card" data-group="${g.id}"><b>${esc(g.name[0])}</b><span><strong>${esc(g.name)}</strong><small>${g.memberIds.length} members · ${money(groupExpenses(g.id).reduce((a,e)=>a+Number(e.amount),0))}</small></span><span>↗</span></button>`).join("")}</div>
    <div class="section-head"><div><small>RECENT ACTIVITY</small><h3>Latest expenses</h3></div></div>
    <div class="table-card">${expenseTable(all.slice(0,8),g)}</div>
  </div>`;
}
function stat(icon,label,value){return `<div class="stat"><b>${icon}</b><span><small>${label}</small><strong>${value}</strong></span></div>`}
function groupsHTML(){
 return `<div class="content">
   <div class="page-head"><div><small>WORKSPACES</small><h2>Your groups</h2><p>Family, trips, roommates, projects — each group has its own shared ledger.</p></div><button class="primary" id="newGroup">＋ New group</button></div>
   <div class="cards group-grid">${state.groups.map(g=>`<button class="large-group group-card" data-group="${g.id}"><b>${esc(g.name[0])}</b><span><strong>${esc(g.name)}</strong><small>${esc(g.description||"Shared expenses")}</small><i>${g.memberIds.map(userName).map(esc).join(" · ")}</i></span><label>${g.memberIds.length} people</label></button>`).join("")}</div>
 </div>`;
}
function expensesHTML(g){
 const rows=groupExpenses(g?.id);
 return `<div class="content">
   <div class="page-head"><div><small>LEDGER</small><h2>Expenses</h2><p>Add who paid, who shares it, and let Settled calculate the balances automatically.</p></div><div class="actions"><select id="groupSelect">${state.groups.map(x=>`<option value="${x.id}" ${x.id===g?.id?"selected":""}>${esc(x.name)}</option>`).join("")}</select><button class="primary" id="addExpense">＋ Add expense</button></div></div>
   <div class="table-card">${expenseTable(rows,g,true)}</div>
 </div>`;
}
function expenseTable(rows,g,showDelete=false){
 if(!rows.length) return `<div class="empty">No expenses in this group yet.</div>`;
 return `<table><thead><tr><th>Date</th><th>Description</th><th>Paid by</th><th>Split</th><th>Amount</th>${showDelete?"<th></th>":""}</tr></thead><tbody>
 ${rows.map(e=>`<tr><td>${esc(e.date)}</td><td><strong>${esc(e.description)}</strong><small>${esc(e.category||"Other")}</small></td><td>${(e.paidBy||[]).map(userName).map(esc).join(", ")}</td><td>${money(Number(e.amount)/(e.splits?.length||1))} each</td><td><strong>${money(e.amount)}</strong></td>${showDelete?`<td><button class="delete" data-delete="${e.id}">✕</button></td>`:""}</tr>`).join("")}</tbody></table>`;
}
function settlementsHTML(g){
 if(!g) return `<div class="content"><div class="empty">Create a group first.</div></div>`;
 const net=balances(g), plan=settlementPlan(net);
 return `<div class="content">
   <div class="page-head"><div><small>FINAL BALANCES · ${esc(g.name)}</small><h2>Settlements</h2><p>The minimum practical transfers needed to close the shared ledger.</p></div><button class="secondary" id="settleExcel">⇩ Download Excel</button></div>
   <div class="balances">${g.memberIds.map(id=>`<div class="balance"><b>${esc(userName(id)[0])}</b><span>${esc(userName(id))}</span><strong class="${net[id]>=0?"pos":"neg"}">${net[id]>=0?"+":"−"}${money(Math.abs(net[id]))}</strong><small>${net[id]>=0?"should receive":"owes"}</small></div>`).join("")}</div>
   <div class="section-head"><div><small>SETTLEMENT PLAN</small><h3>${plan.length} payment${plan.length===1?"":"s"} to settle</h3></div></div>
   <div class="settlement-list">${plan.length?plan.map(s=>`<div class="settlement"><b>${esc(userName(s.from)[0])}</b><strong>${esc(userName(s.from))}</strong><span>→</span><b>${esc(userName(s.to)[0])}</b><strong>${esc(userName(s.to))}</strong><em>${money(s.amount)}</em></div>`).join(""):`<div class="success">✓ Everything is settled.</div>`}</div>
   <div class="report-note">The Excel download contains the synchronized expense ledger, member balances, and settlement payment plan.</div>
 </div>`;
}

function bindView(){
 $("#heroAdd")?.addEventListener("click",openExpenseModal);
 $("#goGroups")?.addEventListener("click",()=>{state.view="groups";renderView()});
 document.querySelectorAll("[data-group]").forEach(b=>b.onclick=()=>{state.activeGroupId=b.dataset.group;state.view="expenses";renderView()});
 $("#newGroup")?.addEventListener("click",openGroupModal);
 $("#addExpense")?.addEventListener("click",openExpenseModal);
 $("#settleExcel")?.addEventListener("click",()=>exportExcel(activeGroup()));
 $("#groupSelect")?.addEventListener("change",e=>{state.activeGroupId=e.target.value;renderView()});
 document.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>deleteExpense(b.dataset.delete));
}
async function deleteExpense(id){
 if(!confirm("Delete this expense from the shared ledger?")) return;
 try { toast("Deleting…"); await apiPost({action:"deleteExpense",id,userId:state.user.id}); await refreshData(); renderView(); toast("Expense deleted."); }
 catch(e){toast(e.message,"error")}
}

function overlay(html){ document.body.insertAdjacentHTML("beforeend",`<div class="modal-backdrop" id="modalBackdrop">${html}</div>`); $("#modalBackdrop").onclick=e=>{if(e.target.id==="modalBackdrop")$("#modalBackdrop").remove()}; }
function openGroupModal(){
 overlay(`<div class="modal"><div class="modal-title"><div><small>NEW WORKSPACE</small><h3>Create group</h3></div><button onclick="document.getElementById('modalBackdrop').remove()">×</button></div>
 <label>Group name<input id="mGroupName" placeholder="e.g. Goa Trip"></label>
 <label>Description<input id="mGroupDesc" placeholder="Optional"></label>
 <label>Members</label><div class="checks">${fallbackUsers.map(u=>`<label><input type="checkbox" name="member" value="${u.id}" checked>${esc(u.name)}</label>`).join("")}</div>
 <button class="primary full" id="saveGroup">Create group</button></div>`);
 $("#saveGroup").onclick=async()=>{
   const name=$("#mGroupName").value.trim(), desc=$("#mGroupDesc").value.trim();
   const memberIds=[...document.querySelectorAll('input[name="member"]:checked')].map(x=>x.value);
   if(!name || memberIds.length<2) return toast("Enter a name and select at least two members.","error");
   try{await apiPost({action:"addGroup",group:{id:uid("g"),name,description:desc,memberIds},userId:state.user.id});await refreshData();$("#modalBackdrop").remove();state.view="groups";renderView();toast("Group created.");}catch(e){toast(e.message,"error")}
 };
}
function openExpenseModal(){
 const g=activeGroup(); if(!g) return toast("Create a group first.","error");
 overlay(`<div class="modal wide"><div class="modal-title"><div><small>NEW TRANSACTION · ${esc(g.name)}</small><h3>Add expense</h3></div><button onclick="document.getElementById('modalBackdrop').remove()">×</button></div>
 <div class="formgrid"><label>Description<input id="mDesc" placeholder="Dinner, hotel, fuel…"></label><label>Amount (₹)<input id="mAmount" type="number" min="0" step="0.01" placeholder="0.00"></label>
 <label>Category<select id="mCat"><option>Food</option><option>Travel</option><option>Accommodation</option><option>Shopping</option><option>Bills</option><option>Other</option></select></label>
 <label>Date<input id="mDate" type="date" value="${today()}"></label></div>
 <label>Paid by — select one or more people</label><div class="checks">${g.memberIds.map(id=>`<label><input type="checkbox" name="payer" value="${id}" ${id===state.user.id?"checked":""}>${esc(userName(id))}</label>`).join("")}</div>
 <label>Split between</label><div class="checks">${g.memberIds.map(id=>`<label><input type="checkbox" name="split" value="${id}" checked>${esc(userName(id))}</label>`).join("")}</div>
 <div class="preview" id="splitPreview">Select split members to preview the per-person share.</div>
 <label>Notes<input id="mNotes" placeholder="Optional note"></label>
 <button class="primary full" id="saveExpense">Save expense to shared ledger</button></div>`);
 const update=()=>{const a=Number($("#mAmount").value||0),n=document.querySelectorAll('input[name="split"]:checked').length;$("#splitPreview").textContent=n&&a?`Equal split · ${n} people · ${money(a/n)} each`:"Select amount and split members to preview."};
 $("#mAmount").oninput=update;document.querySelectorAll('input[name="split"]').forEach(x=>x.onchange=update);
 $("#saveExpense").onclick=async()=>{
   const description=$("#mDesc").value.trim(), amount=Number($("#mAmount").value), paidBy=[...document.querySelectorAll('input[name="payer"]:checked')].map(x=>x.value), splitIds=[...document.querySelectorAll('input[name="split"]:checked')].map(x=>x.value);
   if(!description||amount<=0||!paidBy.length||!splitIds.length)return toast("Complete description, amount, payer and split members.","error");
   const each=amount/splitIds.length;
   const expense={id:uid("e"),groupId:g.id,description,amount,category:$("#mCat").value,date:$("#mDate").value,notes:$("#mNotes").value.trim(),paidBy,splits:splitIds.map(userId=>({userId,amount:each})),createdAt:new Date().toISOString()};
   try{toast("Saving…");await apiPost({action:"addExpense",expense,userId:state.user.id});await refreshData();$("#modalBackdrop").remove();state.view="expenses";renderView();toast("Expense saved to shared ledger.");}catch(e){toast(e.message,"error")}
 };
}

function renderLogin(){
 document.getElementById("app").innerHTML=`<div class="login"><div class="login-card">
   <div class="login-brand"><div class="brand-mark">S</div><div><strong>Quintet</strong><small>Shared Expense Manager</small></div></div>
   <h1>Split expenses.<br><span>Settle simply.</span></h1>
   <p>One shared ledger for your group. Add an expense from any device and everyone sees the same data.</p>
   <form id="loginForm"><label>Username<input id="loginUser" autocomplete="username" placeholder="Gobinath"></label><label>Password<input id="loginPass" type="password" autocomplete="current-password" placeholder="Password"></label>
   <div class="login-error" id="loginError"></div><button class="primary full" type="submit">${state.loading?"Connecting…":"Sign in"}</button></form>
   <small class="secure">▣ Preconfigured users · shared cloud spreadsheet backend</small>
 </div></div>`;
 $("#loginForm").onsubmit=e=>{e.preventDefault();login($("#loginUser").value,$("#loginPass").value);};
}
function exportExcel(g){
 if(!g)return;
 const es=groupExpenses(g.id), net=balances(g), plan=settlementPlan(net);
 const rows=es.map(e=>`<tr><td>${esc(e.date)}</td><td>${esc(e.description)}</td><td>${esc(e.category||"Other")}</td><td>${Number(e.amount).toFixed(2)}</td><td>${(e.paidBy||[]).map(userName).map(esc).join(", ")}</td><td>${(e.splits||[]).map(s=>`${esc(userName(s.userId))}: ${Number(s.amount).toFixed(2)}`).join(" | ")}</td><td>${esc(e.notes||"")}</td></tr>`).join("");
 const bal=g.memberIds.map(id=>{const paid=es.reduce((a,e)=>a+(e.paidBy||[]).includes(id)?Number(e.amount)/(e.paidBy?.length||1):0,0);const share=es.reduce((a,e)=>a+(e.splits||[]).find(s=>s.userId===id)?.amount||0,0);return `<tr><td>${esc(userName(id))}</td><td>${paid.toFixed(2)}</td><td>${share.toFixed(2)}</td><td>${Number(net[id]).toFixed(2)}</td></tr>`}).join("");
 const sett=plan.map(s=>`<tr><td>${esc(userName(s.from))}</td><td>${esc(userName(s.to))}</td><td>${s.amount.toFixed(2)}</td></tr>`).join("");
 const html=`<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse}td,th{border:1px solid #999;padding:6px}h2{margin-top:24px}</style></head><body><h1>Quintet — ${esc(g.name)}</h1><h2>Expenses</h2><table><tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th><th>Paid By</th><th>Split</th><th>Notes</th></tr>${rows||"<tr><td colspan='7'>No expenses</td></tr>"}</table><h2>Balances</h2><table><tr><th>Member</th><th>Paid</th><th>Share</th><th>Net</th></tr>${bal}</table><h2>Settlements</h2><table><tr><th>From</th><th>To</th><th>Amount</th></tr>${sett||"<tr><td colspan='3'>Everything is settled</td></tr>"}</table></body></html>`;
 const blob=new Blob([html],{type:"application/vnd.ms-excel"});
 const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${g.name.replace(/[^a-z0-9]+/gi,"-").toLowerCase()}-settlement.xls`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 toast("Excel report downloaded.");
}

async function start(){
 const session=loadSession();
 if(!session){renderLogin();return;}
 state.user=session;
 try{await refreshData();render();}catch(e){clearSession();renderLogin();toast(e.message,"error");}
}
start();

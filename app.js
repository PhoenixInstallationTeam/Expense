/*
 Quntet Friends Expense Manager — GitHub Pages frontend
 Existing infrastructure:
   GitHub Pages -> Google Apps Script Web App -> Google Sheet

 REQUIRED:
   1) Deploy backend/Code.gs as a Google Apps Script Web App.
   2) Put the resulting /exec URL below.
*/
const CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbwMuYn-kOWunepVpugCnZJzwL8m9YKoBG1OHfjfKTHIEekFhB4AsRdCcL7nCAKsTPOYCw/exec",
  currency: "₹",
  defaultCategory: "Food",
  pollMsAfterWrite: 900
};

const CATEGORY_LIST = [
  "Food","Dining","Party","Treat","Gift","Movie","Snacks","Travel","Transport",
  "Fuel","Hotel","Tickets","Entertainment","Shopping","Groceries","Bills",
  "Electricity","Internet","Rent","Parking","Recharge","Sports","Games",
  "Birthday","Celebration","Medical","Education","Office","Utilities","Other"
];

const fallbackUsers = [
  {id:"gobinath",name:"Gobinath",role:"admin"},
  {id:"prashandh",name:"Prashandh",role:"user"},
  {id:"sundarram",name:"Sundarram",role:"user"},
  {id:"karthikeyan",name:"Karthikeyan",role:"user"},
  {id:"thanis",name:"Thanis",role:"user"}
];

const state = {
  user: null,
  users: fallbackUsers.slice(),
  groups: [],
  expenses: [],
  settlements: [],
  activeGroupId: null,
  view: "dashboard",
  loading: false,
  sheetUrl: "",
  adminOnly: false
};

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = (v="") => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const money = n => `${CONFIG.currency}${Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const today = () => new Date().toISOString().slice(0,10);
const uid = p => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const delay = ms => new Promise(r=>setTimeout(r,ms));

function toast(msg, kind="") {
  const t=$("#toast");
  t.textContent=msg; t.className=`toast show ${kind}`;
  clearTimeout(window.__toast); window.__toast=setTimeout(()=>t.className="toast",2800);
}

function apiGet(params) {
  return new Promise((resolve,reject)=>{
    if (!CONFIG.apiUrl || CONFIG.apiUrl.includes("PASTE_GOOGLE")) {
      reject(new Error("Backend URL is not configured in app.js."));
      return;
    }
    const cb=`quntet_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script=document.createElement("script");
    const q=new URLSearchParams({...params,callback:cb,_:Date.now()});
    let done=false;
    const timer=setTimeout(()=>finish(new Error("Backend request timed out.")),15000);
    function finish(err,data){
      if(done) return; done=true; clearTimeout(timer); delete window[cb]; script.remove();
      err ? reject(err) : resolve(data);
    }
    window[cb]=data=>finish(null,data);
    script.onerror=()=>finish(new Error("Cannot reach the Google Apps Script backend."));
    script.src=`${CONFIG.apiUrl}?${q.toString()}`;
    document.body.appendChild(script);
  });
}

async function apiPost(payload) {
  if (!CONFIG.apiUrl || CONFIG.apiUrl.includes("PASTE_GOOGLE")) throw new Error("Backend URL is not configured in app.js.");
  await fetch(CONFIG.apiUrl,{
    method:"POST",mode:"no-cors",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify(payload)
  });
  await delay(CONFIG.pollMsAfterWrite);
}

async function refreshData() {
  const data=await apiGet({action:"snapshot",userId:state.user?.id||""});
  if(!data.ok) throw new Error(data.error||"Unable to load shared data.");
  state.users=data.users?.length?data.users:fallbackUsers.slice();
  state.groups=(data.groups||[]).map(g=>({...g,memberIds:Array.isArray(g.memberIds)?g.memberIds:[]}));
  state.expenses=data.expenses||[];
  state.settlements=data.settlements||[];
  state.sheetUrl=data.sheetUrl||"";
  if(!state.activeGroupId || !state.groups.some(g=>g.id===state.activeGroupId))
    state.activeGroupId=state.groups[0]?.id||null;
}

function userName(id){return state.users.find(u=>u.id===id)?.name||fallbackUsers.find(u=>u.id===id)?.name||id;}
function activeGroup(){return state.groups.find(g=>g.id===state.activeGroupId)||state.groups[0]||null;}
function groupExpenses(gid){return state.expenses.filter(e=>e.groupId===gid);}
function groupSettlements(gid){return state.settlements.filter(s=>s.groupId===gid);}
function isAdmin(){return state.user?.role==="admin";}

function balances(g){
  const net={};
  (g?.memberIds||[]).forEach(id=>net[id]=0);
  groupExpenses(g?.id).forEach(e=>{
    const payers=e.paidBy||[];
    payers.forEach(id=>net[id]=(net[id]||0)+Number(e.amount)/Math.max(1,payers.length));
    (e.splits||[]).forEach(s=>net[s.userId]=(net[s.userId]||0)-Number(s.amount));
  });
  /* Apply confirmed payments. A completed payment moves both parties toward zero. */
  groupSettlements(g?.id).filter(s=>s.status==="PAID"||s.status==="RECEIVED").forEach(s=>{
    const a=Number(s.amount)||0;
    net[s.from]=(net[s.from]||0)+a;
    net[s.to]=(net[s.to]||0)-a;
  });
  return net;
}

function outstandingPlan(net){
  const d=Object.entries(net).filter(([,v])=>v<-.009).map(([id,v])=>({id,amount:-v}));
  const c=Object.entries(net).filter(([,v])=>v>.009).map(([id,v])=>({id,amount:v}));
  const result=[]; let i=0,j=0;
  while(i<d.length&&j<c.length){
    const amount=Math.min(d[i].amount,c[j].amount);
    result.push({from:d[i].id,to:c[j].id,amount});
    d[i].amount-=amount; c[j].amount-=amount;
    if(d[i].amount<.01)i++;
    if(c[j].amount<.01)j++;
  }
  return result;
}

function historicalExpenseShares(e){
  const out={};
  (e.splits||[]).forEach(s=>out[s.userId]=Number(s.amount)||0);
  return out;
}

function render(){
  if(!state.user) return renderLogin();
  const g=activeGroup();
  document.getElementById("app").innerHTML=`
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="brand-mark">Q</div><div><strong>Quntet</strong><small>Friends Expense Manager</small></div></div>
      <nav>
        ${navButton("dashboard","⌂","Dashboard")}
        ${navButton("groups","◉","Friends Group")}
        ${navButton("expenses","▤","Expenses")}
        ${navButton("settlements","⇄","Settlements")}
      </nav>
      <div class="side-bottom">
        <div class="user-card"><div class="avatar">${esc(state.user.name[0])}</div><div><strong>${esc(state.user.name)}</strong><small>${esc(state.user.role)}</small></div></div>
        <button class="ghost full" id="logoutBtn">⇥ Sign out</button>
      </div>
    </aside>
    <div class="mobile-shade" id="mobileShade"></div>
    <main class="main">
      <header class="topbar">
        <div class="title-row"><button class="hamb" id="hamb">☰</button><div><small>FRIENDS GROUP</small><h1>${esc(g?.name||"Quntet")}</h1></div></div>
        <div class="header-actions">
          ${state.sheetUrl?`<button class="secondary" id="openSheet">↗ Shared Sheet</button>`:""}
          ${g?`<button class="secondary" id="exportBtn">⇩ Excel</button>`:""}
          <button class="primary" id="topAdd">＋ Expense</button>
        </div>
      </header>
      <section id="content"></section>
    </main>
  </div>`;
  bindShell();
  renderView();
}

function navButton(view,icon,label){return `<button class="nav ${state.view===view?"active":""}" data-view="${view}"><span>${icon}</span>${label}</button>`;}

function bindShell(){
  $("#logoutBtn").onclick=()=>{state.user=null;localStorage.removeItem("quntet_session");renderLogin();};
  $$("[data-view]").forEach(b=>b.onclick=()=>{state.view=b.dataset.view;closeMobile();renderView();});
  $("#topAdd").onclick=()=>{state.view="expenses";renderView();setTimeout(openExpenseModal,0)};
  $("#exportBtn")?.addEventListener("click",()=>exportExcel(activeGroup()));
  $("#openSheet")?.addEventListener("click",()=>state.sheetUrl?window.open(state.sheetUrl,"_blank"):toast("Shared sheet URL not configured.","error"));
  $("#hamb").onclick=()=>{$("#sidebar").classList.add("open");$("#mobileShade").classList.add("show")};
  $("#mobileShade").onclick=closeMobile;
}
function closeMobile(){$("#sidebar")?.classList.remove("open");$("#mobileShade")?.classList.remove("show");}

function renderView(){
  const c=$("#content");
  const g=activeGroup();
  if(state.view==="dashboard") c.innerHTML=dashboardHTML(g);
  else if(state.view==="groups") c.innerHTML=groupsHTML();
  else if(state.view==="expenses") c.innerHTML=expensesHTML(g);
  else c.innerHTML=settlementsHTML(g);
  bindView();
}

function dashboardHTML(g){
  const all=state.expenses,total=all.reduce((a,e)=>a+Number(e.amount),0),members=new Set(state.groups.flatMap(x=>x.memberIds)).size;
  const pending=groupSettlements(g?.id).filter(s=>s.status==="PENDING").length;
  return `<div class="content">
    <section class="hero"><div><span class="pill">LIVE FRIENDS LEDGER</span><h2>Track every spend.<br><em>Settle every rupee.</em></h2><p>All members work against one shared ledger. Expenses, balances, settlement status and Excel reporting stay synchronized through the shared Google Sheet.</p></div><button class="primary" id="heroAdd">＋ Add expense</button></section>
    <div class="stats">${stat("◫","Total expenses",money(total))}${stat("▤","Transactions",all.length)}${stat("◎","Members",members)}${stat("⇄","Pending settlements",pending)}</div>
    <div class="section-head"><div><small>FRIENDS GROUPS</small><h3>Groups</h3></div><button class="text-btn" id="goGroups">Manage groups →</button></div>
    <div class="cards">${state.groups.map(x=>`<button class="group-card" data-group="${x.id}"><b>${esc(x.name[0])}</b><span><strong>${esc(x.name)}</strong><small>${x.memberIds.length} members · ${money(groupExpenses(x.id).reduce((a,e)=>a+Number(e.amount),0))}</small></span><span>↗</span></button>`).join("")}</div>
    <div class="section-head"><div><small>RECENT ACTIVITY</small><h3>Latest expenses</h3></div></div>
    <div class="table-card">${expenseTable(all.slice(0,10),g,false)}</div>
  </div>`;
}
function stat(i,t,v){return `<div class="stat"><b>${i}</b><span><small>${t}</small><strong>${v}</strong></span></div>`;}

function groupsHTML(){
 return `<div class="content">
   <div class="page-head"><div><small>FRIENDS GROUPS</small><h2>Groups</h2><p>Create group ledgers for your friends, occasions, celebrations and shared spending.</p></div><button class="primary" id="newGroup">＋ New group</button></div>
   <div class="cards group-grid">${state.groups.map(g=>`<button class="large-group group-card" data-group="${g.id}"><b>${esc(g.name[0])}</b><span><strong>${esc(g.name)}</strong><small>${esc(g.description||"Friends shared expenses")}</small><i>${g.memberIds.map(userName).map(esc).join(" · ")}</i></span><label>${g.memberIds.length} people</label></button>`).join("")}</div>
 </div>`;
}

function categoryOptions(selected){
 return CATEGORY_LIST.map(c=>`<option value="${esc(c)}" ${c===selected?"selected":""}>${esc(c)}</option>`).join("");
}

function expensesHTML(g){
 const rows=groupExpenses(g?.id);
 return `<div class="content">
   <div class="page-head"><div><small>FRIENDS LEDGER</small><h2>Expenses</h2><p>Record payers, participants, custom splits, category and notes. Admin can edit or delete any entry.</p></div>
   <div class="actions"><select id="groupSelect">${state.groups.map(x=>`<option value="${x.id}" ${x.id===g?.id?"selected":""}>${esc(x.name)}</option>`).join("")}</select><button class="primary" id="addExpense">＋ Add expense</button></div></div>
   <div class="table-card">${expenseTable(rows,g,true)}</div>
 </div>`;
}

function expenseTable(rows,g,showActions=false){
 if(!rows.length)return `<div class="empty">No expenses in this group yet.</div>`;
 const admin=isAdmin();
 return `<table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Created by</th><th>Paid by</th><th>Split</th><th>Amount</th>${showActions?"<th>Actions</th>":""}</tr></thead><tbody>
 ${rows.map(e=>`<tr>
 <td>${esc(e.date)}</td>
 <td><strong>${esc(e.description)}</strong><small>${esc(e.notes||"")}</small></td>
 <td><span class="tag">${esc(e.category||"Other")}</span></td>
 <td>${esc(userName(e.createdBy||""))}</td>
 <td>${(e.paidBy||[]).map(userName).map(esc).join(", ")}</td>
 <td>${splitSummary(e)}</td>
 <td><strong>${money(e.amount)}</strong></td>
 ${showActions?`<td class="row-actions">${admin?`<button class="mini" data-edit-expense="${e.id}">Edit</button><button class="mini danger" data-delete-expense="${e.id}">Delete</button>`:`<span class="muted">View</span>`}</td>`:""}
 </tr>`).join("")}</tbody></table>`;
}
function splitSummary(e){return (e.splits||[]).map(s=>`${esc(userName(s.userId))}: ${money(s.amount)}`).join(" · ");}

function settlementsHTML(g){
 if(!g)return `<div class="content"><div class="empty">Create a group first.</div></div>`;
 const net=balances(g),plan=outstandingPlan(net), hist=groupSettlements(g.id);
 const pending=hist.filter(s=>s.status==="PENDING"),completed=hist.filter(s=>s.status!=="PENDING");
 return `<div class="content">
   <div class="page-head"><div><small>ADVANCED SETTLEMENTS · ${esc(g.name)}</small><h2>Settlements</h2><p>Outstanding balances now account for completed payments. Recipients can confirm money received; admins can mark, reverse or audit settlement entries.</p></div><button class="secondary" id="settleExcel">⇩ Download Excel</button></div>
   <div class="balances">${g.memberIds.map(id=>`<div class="balance"><b>${esc(userName(id)[0])}</b><span>${esc(userName(id))}</span><strong class="${net[id]>=0?"pos":"neg"}">${net[id]>=0?"+":"−"}${money(Math.abs(net[id]))}</strong><small>${net[id]>=0?"should receive":"owes"}</small></div>`).join("")}</div>
   <div class="settlement-toolbar"><span class="chip">${pending.length} pending</span><span class="chip success-chip">${completed.length} completed</span><button class="primary" id="createPlan" ${plan.length?"":"disabled"}>Create settlement records</button></div>
   <div class="section-head"><div><small>OUTSTANDING PLAN</small><h3>${plan.length} payment${plan.length===1?"":"s"} remaining</h3></div></div>
   <div class="settlement-list">${plan.length?plan.map(s=>`<div class="settlement"><div class="person-dot">${esc(userName(s.from)[0])}</div><div><strong>${esc(userName(s.from))}</strong><small>pays</small></div><span class="arrow">→</span><div class="person-dot">${esc(userName(s.to)[0])}</div><div><strong>${esc(userName(s.to))}</strong><small>receives</small></div><em>${money(s.amount)}</em></div>`).join(""):`<div class="success">✓ No outstanding settlement. All balances are currently settled.</div>`}</div>
   <div class="section-head"><div><small>SETTLEMENT HISTORY</small><h3>Payment records</h3></div></div>
   <div class="table-card">${settlementTable(hist)}</div>
   <div class="report-note">Created-by information stays with every expense. When a recipient receives money, the settlement record can be marked completed, which reduces the outstanding balances.</div>
 </div>`;
}

function settlementTable(rows){
 if(!rows.length)return `<div class="empty">No settlement records yet. Create records from the outstanding plan.</div>`;
 return `<table><thead><tr><th>From</th><th>To</th><th>Amount</th><th>Status</th><th>Created</th><th>Completed</th><th>Actions</th></tr></thead><tbody>
 ${rows.map(s=>`<tr><td>${esc(userName(s.from))}</td><td>${esc(userName(s.to))}</td><td><strong>${money(s.amount)}</strong></td><td><span class="status ${s.status==="PENDING"?"pending":"paid"}">${esc(s.status)}</span></td><td>${esc(s.createdAt||"")}</td><td>${esc(s.paidAt||"—")}</td><td class="row-actions">${s.status==="PENDING"?`<button class="mini" data-paid="${s.id}">Mark Paid</button><button class="mini" data-received="${s.id}">Received</button>`:`${isAdmin()?`<button class="mini danger" data-reverse="${s.id}">Reverse</button>`:""}`}</td></tr>`).join("")}</tbody></table>`;
}

function bindView(){
 $("#heroAdd")?.addEventListener("click",openExpenseModal);
 $("#goGroups")?.addEventListener("click",()=>{state.view="groups";renderView()});
 $$("[data-group]").forEach(b=>b.onclick=()=>{state.activeGroupId=b.dataset.group;state.view="expenses";renderView()});
 $("#newGroup")?.addEventListener("click",openGroupModal);
 $("#addExpense")?.addEventListener("click",()=>openExpenseModal());
 $("#groupSelect")?.addEventListener("change",e=>{state.activeGroupId=e.target.value;renderView()});
 $("#settleExcel")?.addEventListener("click",()=>exportExcel(activeGroup()));
 $("#createPlan")?.addEventListener("click",createSettlementRecords);
 $$("[data-edit-expense]").forEach(b=>b.onclick=()=>openExpenseModal(state.expenses.find(e=>e.id===b.dataset.editExpense)));
 $$("[data-delete-expense]").forEach(b=>b.onclick=()=>deleteExpense(b.dataset.deleteExpense));
 $$("[data-paid]").forEach(b=>markSettlement(b.dataset.paid,"PAID"));
 $$("[data-received]").forEach(b=>markSettlement(b.dataset.received,"RECEIVED"));
 $$("[data-reverse]").forEach(b=>reverseSettlement(b.dataset.reverse));
}

function overlay(html){
 document.body.insertAdjacentHTML("beforeend",`<div class="modal-backdrop" id="modalBackdrop">${html}</div>`);
 $("#modalBackdrop").onclick=e=>{if(e.target.id==="modalBackdrop")$("#modalBackdrop").remove()};
}

function openGroupModal(){
 overlay(`<div class="modal"><div class="modal-title"><div><small>NEW FRIENDS GROUP</small><h3>Create group</h3></div><button onclick="document.getElementById('modalBackdrop').remove()">×</button></div>
 <label>Group name<input id="mGroupName" value="Friends Group" placeholder="Friends Group"></label>
 <label>Description<input id="mGroupDesc" placeholder="Friends shared expenses"></label>
 <label>Members</label><div class="checks">${state.users.map(u=>`<label><input type="checkbox" name="member" value="${u.id}" checked>${esc(u.name)}</label>`).join("")}</div>
 <button class="primary full" id="saveGroup">Create group</button></div>`);
 $("#saveGroup").onclick=async()=>{
   const name=$("#mGroupName").value.trim(),desc=$("#mGroupDesc").value.trim();
   const memberIds=$$("input[name='member']:checked").map(x=>x.value);
   if(!name||memberIds.length<2)return toast("Enter a name and select at least two members.","error");
   try{await apiPost({action:"addGroup",userId:state.user.id,group:{id:uid("g"),name,description:desc,memberIds}});await delay(350);await refreshData();$("#modalBackdrop").remove();state.view="groups";renderView();toast("Group created.");}catch(e){toast(e.message,"error")}
 };
}

function openExpenseModal(existing=null){
 const g=activeGroup(); if(!g)return toast("Create a group first.","error");
 const editing=!!existing;
 const payerIds=existing?.paidBy||[state.user.id];
 const splitIds=existing?.splits?.map(s=>s.userId)||g.memberIds.slice();
 const values={description:existing?.description||"",amount:existing?.amount||"",category:existing?.category||CONFIG.defaultCategory,date:existing?.date||today(),notes:existing?.notes||""};
 overlay(`<div class="modal extra-wide"><div class="modal-title"><div><small>${editing?"EDIT EXPENSE":"NEW EXPENSE"} · ${esc(g.name)}</small><h3>${editing?"Edit expense":"Add expense"}</h3></div><button onclick="document.getElementById('modalBackdrop').remove()">×</button></div>
 <div class="formgrid">
  <label>Description<input id="mDesc" value="${esc(values.description)}" placeholder="Dinner, party, movie, gift…"></label>
  <label>Amount (₹)<input id="mAmount" type="number" min="0" step="0.01" value="${esc(values.amount)}" placeholder="0.00"></label>
  <label>Category<select id="mCat">${categoryOptions(values.category)}</select></label>
  <label>Date<input id="mDate" type="date" value="${esc(values.date)}"></label>
 </div>
 <label>Paid by — select one or more</label><div class="checks">${g.memberIds.map(id=>`<label><input type="checkbox" name="payer" value="${id}" ${payerIds.includes(id)?"checked":""}>${esc(userName(id))}</label>`).join("")}</div>
 <div class="split-head"><label>Split between</label><select id="splitMode"><option value="equal">Equal split</option><option value="custom">Custom split</option></select></div>
 <div class="checks">${g.memberIds.map(id=>`<label><input type="checkbox" name="split" value="${id}" ${splitIds.includes(id)?"checked":""}>${esc(userName(id))}</label>`).join("")}</div>
 <div id="customSplits" class="custom-splits"></div>
 <div class="preview" id="splitPreview">Choose the amount and participants.</div>
 <label>Notes<input id="mNotes" value="${esc(values.notes)}" placeholder="Optional note"></label>
 <button class="primary full" id="saveExpense">${editing?"Update shared expense":"Save expense to shared ledger"}</button></div>`);
 const updateSplitUI=()=>{
   const amount=Number($("#mAmount").value||0),ids=$$("input[name='split']:checked").map(x=>x.value);
   const custom=$("#splitMode").value==="custom",box=$("#customSplits");
   box.innerHTML=custom?ids.map(id=>`<label class="custom-row">${esc(userName(id))}<input type="number" min="0" step="0.01" data-custom="${id}" value="${existing?.splits?.find(s=>s.userId===id)?.amount??(ids.length?amount/ids.length:0)}"></label>`).join(""):"";
   const each=ids.length?amount/ids.length:0;
   $("#splitPreview").textContent=custom?`Custom split · ${ids.length} participants`:`Equal split · ${ids.length} participants · ${money(each)} each`;
 };
 $("#mAmount").oninput=updateSplitUI;$("#splitMode").onchange=updateSplitUI;$$("input[name='split']").forEach(x=>x.onchange=updateSplitUI);updateSplitUI();
 $("#saveExpense").onclick=async()=>{
   const description=$("#mDesc").value.trim(),amount=Number($("#mAmount").value),paidBy=$$("input[name='payer']:checked").map(x=>x.value),ids=$$("input[name='split']:checked").map(x=>x.value);
   if(!description||amount<=0||!paidBy.length||!ids.length)return toast("Complete description, amount, payer and split members.","error");
   let splits;
   if($("#splitMode").value==="custom"){
     splits=$$("[data-custom]").map(x=>({userId:x.dataset.custom,amount:Number(x.value||0)}));
     const total=splits.reduce((a,s)=>a+s.amount,0);
     if(Math.abs(total-amount)>0.01)return toast(`Custom split must equal ${money(amount)}. Current total is ${money(total)}.`,"error");
   } else {
     const each=amount/ids.length;splits=ids.map(userId=>({userId,amount:each}));
   }
   const expense={id:existing?.id||uid("e"),groupId:g.id,description,amount,category:$("#mCat").value,date:$("#mDate").value,notes:$("#mNotes").value.trim(),paidBy,splits,createdBy:existing?.createdBy||state.user.id,createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
   try{toast(editing?"Updating…":"Saving…");await apiPost({action:editing?"updateExpense":"addExpense",userId:state.user.id,expense});await delay(450);await refreshData();$("#modalBackdrop").remove();state.view="expenses";renderView();toast(editing?"Expense updated.":"Expense saved to shared ledger.");}catch(e){toast(e.message,"error")}
 };
}

function exportExcel(g){
 if(!g)return;
 const es=groupExpenses(g.id),net=balances(g),plan=outstandingPlan(net),ss=groupSettlements(g.id);
 const sheet=(title,headers,rows)=>`<h2>${esc(title)}</h2><table><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr>${rows.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</table>`;
 const expRows=es.map(e=>[e.date,e.description,e.category||"Other",e.createdBy?userName(e.createdBy):"",Number(e.amount).toFixed(2),(e.paidBy||[]).map(userName).join(", "),(e.splits||[]).map(s=>`${userName(s.userId)}: ${Number(s.amount).toFixed(2)}`).join(" | "),e.notes||""]);
 const balRows=g.memberIds.map(id=>{const paid=es.reduce((a,e)=>a+((e.paidBy||[]).includes(id)?Number(e.amount)/(e.paidBy.length||1):0),0);const share=es.reduce((a,e)=>a+((e.splits||[]).find(s=>s.userId===id)?.amount||0),0);return [userName(id),paid.toFixed(2),share.toFixed(2),Number(net[id]).toFixed(2)];});
 const planRows=plan.map(s=>[userName(s.from),userName(s.to),s.amount.toFixed(2),"OUTSTANDING"]);
 const histRows=ss.map(s=>[userName(s.from),userName(s.to),Number(s.amount).toFixed(2),s.status,s.createdAt||"",s.paidAt||""]);
 const html=`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial}table{border-collapse:collapse;margin-bottom:22px}td,th{border:1px solid #999;padding:6px}th{background:#ddd}</style></head><body><h1>Quntet — ${esc(g.name)}</h1>${sheet("Expenses",["Date","Description","Category","Created By","Amount","Paid By","Split","Notes"],expRows)}${sheet("Balances",["Member","Paid","Share","Net"],balRows)}${sheet("Outstanding Settlements",["From","To","Amount","Status"],planRows)}${sheet("Settlement History",["From","To","Amount","Status","Created","Completed"],histRows)}</body></html>`;
 const blob=new Blob([html],{type:"application/vnd.ms-excel"});
 const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`quntet-${g.name.replace(/[^a-z0-9]+/gi,"-").toLowerCase()}-report.xls`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 toast("Excel report downloaded.");
}

async function createSettlementRecords(){
 const g=activeGroup();if(!g||!isAdmin())return toast("Only the admin can create settlement records.","error");
 const plan=outstandingPlan(balances(g));if(!plan.length)return toast("Nothing is outstanding.","error");
 try{
   toast("Creating settlement records…");
   for(const s of plan){await apiPost({action:"addSettlement",userId:state.user.id,settlement:{id:uid("s"),groupId:g.id,from:s.from,to:s.to,amount:Number(s.amount).toFixed(2)}});}
   await refreshData();renderView();toast("Settlement records created.");
 }catch(e){toast(e.message,"error")}
}

async function markSettlement(id,status){
 const s=state.settlements.find(x=>x.id===id);if(!s)return;
 const allowed=isAdmin()||state.user.id===s.from||state.user.id===s.to;
 if(!allowed)return toast("Only the payer, recipient or admin can update this settlement.","error");
 try{
   await apiPost({action:"completeSettlement",userId:state.user.id,id,status});await refreshData();renderView();toast(status==="RECEIVED"?"Payment received and balances updated.":"Payment marked as paid.");
 }catch(e){toast(e.message,"error")}
}
async function reverseSettlement(id){
 if(!isAdmin())return toast("Only admin can reverse a completed settlement.","error");
 if(!confirm("Reverse this completed settlement?"))return;
 try{await apiPost({action:"reverseSettlement",userId:state.user.id,id});await refreshData();renderView();toast("Settlement reversed.");}catch(e){toast(e.message,"error")}
}
async function deleteExpense(id){
 if(!isAdmin())return toast("Only admin can delete expenses.","error");
 if(!confirm("Delete this expense from the shared ledger?"))return;
 try{await apiPost({action:"deleteExpense",userId:state.user.id,id});await refreshData();renderView();toast("Expense deleted.");}catch(e){toast(e.message,"error")}
}

function renderLogin(){
 document.getElementById("app").innerHTML=`<div class="login"><div class="login-card">
   <div class="login-brand"><div class="brand-mark">Q</div><div><strong>Quntet</strong><small>Friends Expense Manager</small></div></div>
   <span class="pill">PRIVATE FRIENDS GROUP</span>
   <h1>Every spend.<br><span>One shared ledger.</span></h1>
   <p>Shared expenses, advanced settlement tracking and Excel reporting — all synchronized through the existing Google Sheet backend.</p>
   <form id="loginForm"><label>Username<input id="loginUser" autocomplete="username" placeholder="Gobinath"></label><label>Password<input id="loginPass" type="password" autocomplete="current-password" placeholder="Password"></label>
   <div class="login-error" id="loginError"></div><button class="primary full" type="submit">${state.loading?"Connecting…":"Sign in"}</button></form>
   <small class="secure">Preconfigured access · no public signup · shared backend</small>
 </div></div>`;
 $("#loginForm").onsubmit=async e=>{e.preventDefault();await login($("#loginUser").value,$("#loginPass").value);};
}

async function login(username,password){
 state.loading=true;renderLogin();
 try{
   const d=await apiGet({action:"login",username:String(username||"").trim(),password:String(password||"")});
   if(!d.ok)throw new Error(d.error||"Invalid username or password.");
   state.user=d.user;localStorage.setItem("quntet_session",JSON.stringify(state.user));
   await refreshData();state.view="dashboard";state.loading=false;render();toast(`Welcome, ${state.user.name}.`);
 }catch(e){state.loading=false;renderLogin();$("#loginError").textContent=e.message;}
}

function bootstrap(){
 try{state.user=JSON.parse(localStorage.getItem("quntet_session")||"null");}catch{state.user=null;}
 if(!state.user){renderLogin();return;}
 refreshData().then(()=>render()).catch(e=>{state.user=null;localStorage.removeItem("quntet_session");renderLogin();toast(e.message,"error");});
}
bootstrap();
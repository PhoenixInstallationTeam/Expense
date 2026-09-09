/*
  Settled shared backend.
  Create a Google Sheet first, then:
  Extensions -> Apps Script -> paste this file.
  Run setup() once and authorize.
  Deploy -> New deployment -> Web app
    Execute as: Me
    Who has access: Anyone
  Copy the /exec URL into CONFIG.apiUrl in app.js.

  Sheets created:
  Users, Groups, Expenses, Splits
*/
const APP = {
  spreadsheetId: "", // optional: leave blank if this script is bound to the Google Sheet
  appKey: "CHANGE_ME_SETTLED_KEY"
};

function ss_() {
  return APP.spreadsheetId ? SpreadsheetApp.openById(APP.spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
}
function json_(obj, callback) {
  const text = JSON.stringify(obj);
  if (callback) return ContentService.createTextOutput(`${callback}(${text});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
function readSheet_(name) {
  const sh=ss_().getSheetByName(name); if (!sh || sh.getLastRow()<2) return [];
  const values=sh.getDataRange().getDisplayValues(), heads=values.shift();
  return values.filter(r=>r.some(x=>String(x).trim()!=="")).map(r=>Object.fromEntries(heads.map((h,i)=>[h,r[i]??""])));
}
function writeRows_(name, headers, rows) {
  const ss=ss_(); let sh=ss.getSheetByName(name); if(!sh) sh=ss.insertSheet(name);
  sh.clear(); sh.getRange(1,1,1,headers.length).setValues([headers]);
  if(rows.length) sh.getRange(2,1,rows.length,headers.length).setValues(rows);
  sh.setFrozenRows(1);
}
function setup() {
  const ss=ss_();
  writeRows_("Users",["id","name","username","password","role"],[
    ["gobinath","Gobinath","Gobinath","Ins@12345","admin"],
    ["prashandh","Prashandh","Prashandh","Ins@12345","user"],
    ["sundarram","Sundarram","Sundarram","Ins@12345","user"],
    ["karthikeyan","Karthikeyan","Karthikeyan","Ins@12345","user"],
    ["thanis","Thanis","Thanis","Ins@12345","user"]
  ]);
  writeRows_("Groups",["id","name","description","memberIds","createdAt"],[
    ["family","Family","Shared family expenses",JSON.stringify(["gobinath","prashandh","sundarram","karthikeyan","thanis"]),new Date().toISOString()]
  ]);
  writeRows_("Expenses",["id","groupId","description","amount","category","date","notes","paidBy","createdAt"],[]);
  writeRows_("Splits",["expenseId","userId","amount"],[]);
  PropertiesService.getScriptProperties().setProperty("SETTLED_SHEET_ID",ss.getId());
}
function auth_(id) {
  // Backend authorization is intentionally simple for a small private/family app.
  // For stronger security use Supabase/Auth or a server-side identity provider.
  return readSheet_("Users").some(u=>u.id===id);
}
function doGet(e) {
  try {
    const p=e.parameter||{}, action=p.action||"snapshot";
    if(action==="login"){
      const users=readSheet_("Users");
      const u=users.find(x=>x.username.toLowerCase()===String(p.username||"").trim().toLowerCase() && x.password===String(p.password||""));
      return json_(u?{ok:true,user:{id:u.id,name:u.name,role:u.role}}:{ok:false,error:"Invalid username or password."},p.callback);
    }
    if(action==="snapshot") return json_(snapshot_(),p.callback);
    return json_({ok:false,error:"Unknown action"},p.callback);
  } catch(err) { return json_({ok:false,error:String(err)},e.parameter?.callback); }
}
function snapshot_() {
  const groups=readSheet_("Groups").map(g=>({...g,memberIds:JSON.parse(g.memberIds||"[]")}));
  const expenses=readSheet_("Expenses").map(e=>({...e,amount:Number(e.amount||0),paidBy:JSON.parse(e.paidBy||"[]")}));
  const splits=readSheet_("Splits");
  expenses.forEach(e=>e.splits=splits.filter(s=>s.expenseId===e.id).map(s=>({userId:s.userId,amount:Number(s.amount||0)})));
  return {ok:true,groups,expenses,sheetUrl:`https://docs.google.com/spreadsheets/d/${ss_().getId()}/edit`};
}
function doPost(e) {
  try {
    const p=JSON.parse(e.postData.contents||"{}");
    const action=p.action, userId=p.userId;
    if(!auth_(userId)) throw new Error("Unauthorized user.");
    if(action==="addGroup") addGroup_(p.group);
    else if(action==="addExpense") addExpense_(p.expense);
    else if(action==="deleteExpense") deleteExpense_(p.id);
    else throw new Error("Unknown action.");
    return json_({ok:true});
  } catch(err) { return json_({ok:false,error:String(err)}); }
}
function addGroup_(g) {
  const rows=readSheet_("Groups");
  rows.push({id:g.id,name:g.name,description:g.description||"",memberIds:JSON.stringify(g.memberIds),createdAt:g.createdAt||new Date().toISOString()});
  writeRows_("Groups",["id","name","description","memberIds","createdAt"],rows.map(x=>[x.id,x.name,x.description,x.memberIds,x.createdAt]));
}
function addExpense_(e) {
  const es=readSheet_("Expenses"); if(es.some(x=>x.id===e.id)) return;
  es.push({id:e.id,groupId:e.groupId,description:e.description,amount:Number(e.amount),category:e.category||"Other",date:e.date||"",notes:e.notes||"",paidBy:JSON.stringify(e.paidBy||[]),createdAt:e.createdAt||new Date().toISOString()});
  writeRows_("Expenses",["id","groupId","description","amount","category","date","notes","paidBy","createdAt"],es.map(x=>[x.id,x.groupId,x.description,x.amount,x.category,x.date,x.notes,x.paidBy,x.createdAt]));
  const ss=ss_(), sh=ss.getSheetByName("Splits"); const existing=readSheet_("Splits");
  (e.splits||[]).forEach(s=>existing.push({expenseId:e.id,userId:s.userId,amount:Number(s.amount)}));
  writeRows_("Splits",["expenseId","userId","amount"],existing.map(x=>[x.expenseId,x.userId,x.amount]));
}
function deleteExpense_(id) {
  const es=readSheet_("Expenses").filter(x=>x.id!==id);
  writeRows_("Expenses",["id","groupId","description","amount","category","date","notes","paidBy","createdAt"],es.map(x=>[x.id,x.groupId,x.description,x.amount,x.category,x.date,x.notes,x.paidBy,x.createdAt]));
  const ss=ss_(), existing=readSheet_("Splits").filter(x=>x.expenseId!==id);
  writeRows_("Splits",["expenseId","userId","amount"],existing.map(x=>[x.expenseId,x.userId,x.amount]));
}
/*
 Quntet Friends Expense Manager — Google Apps Script backend
 Existing infrastructure preserved:
   Google Sheet <- Apps Script Web App <- GitHub Pages

 FIRST-TIME SETUP:
   1. Create/open the shared Google Sheet.
   2. Extensions -> Apps Script.
   3. Paste this file and save.
   4. Run setup() once and authorize.
   5. Deploy -> New deployment -> Web app.
      Execute as: Me
      Who has access: Anyone
   6. Copy the /exec URL into app.js.

 Sheets used:
   Users, Groups, Expenses, Splits, Settlements
*/

const APP = {
  spreadsheetId: "", // Leave blank when this script is bound to the target Google Sheet.
  appKey: "CHANGE_ME_QUNTET_KEY"
};

const HEADERS = {
  Users:["id","name","username","passwordHash","role","active"],
  Groups:["id","name","description","memberIds","createdAt","active"],
  Expenses:["id","groupId","description","amount","category","date","notes","paidBy","createdBy","createdAt","updatedAt","active"],
  Splits:["expenseId","userId","amount"],
  Settlements:["id","groupId","from","to","amount","status","createdAt","paidAt","updatedAt","createdBy"]
};

const SEED_USERS = [
  ["gobinath","Gobinath","Gobinath","Ins@12345","admin","TRUE"],
  ["prashandh","Prashandh","Prashandh","Ins@12345","user","TRUE"],
  ["sundarram","Sundarram","Sundarram","Ins@12345","user","TRUE"],
  ["karthikeyan","Karthikeyan","Karthikeyan","Ins@12345","user","TRUE"],
  ["thanis","Thanis","Thanis","Ins@12345","user","TRUE"]
];

function ss_(){
  return APP.spreadsheetId ? SpreadsheetApp.openById(APP.spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
}

function hash_(text){
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(text));
  return bytes.map(b=>((b<0?b+256:b).toString(16).padStart(2,"0"))).join("");
}

function json_(obj, callback){
  const body=JSON.stringify(obj);
  if(callback){
    return ContentService.createTextOutput(`${callback}(${body});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function ensureSheet_(name, headers){
  const ss=ss_();
  let sh=ss.getSheetByName(name);
  if(!sh) sh=ss.insertSheet(name);
  if(sh.getLastRow()===0) sh.getRange(1,1,1,headers.length).setValues([headers]);
  else {
    const current=sh.getRange(1,1,1,headers.length).getValues()[0];
    if(current.join("|")!==headers.join("|")) sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  sh.setFrozenRows(1);
  return sh;
}

function rows_(name){
  const sh=ss_().getSheetByName(name);
  if(!sh || sh.getLastRow()<2) return [];
  const values=sh.getDataRange().getDisplayValues();
  const headers=values.shift();
  return values.filter(r=>r.some(v=>String(v).trim()!==""))
    .map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??""])));
}

function setup(){
  const lock=LockService.getScriptLock();lock.waitLock(15000);
  try{
    Object.keys(HEADERS).forEach(n=>ensureSheet_(n,HEADERS[n]));
    const us=rows_("Users");
    if(!us.length){
      const sh=ss_().getSheetByName("Users");
      sh.getRange(2,1,SEED_USERS.length,6).setValues(SEED_USERS.map(u=>[u[0],u[1],u[2],hash_(u[3]),u[4],u[5]]));
    }
    const gs=rows_("Groups");
    if(!gs.length){
      ss_().getSheetByName("Groups").appendRow([
        "friends_group","Friends Group","Friends shared expenses",
        JSON.stringify(SEED_USERS.map(u=>u[0])),new Date().toISOString(),"TRUE"
      ]);
    }
    PropertiesService.getScriptProperties().setProperty("QUNTET_SHEET_ID",ss_().getId());
    return "Quntet setup complete";
  } finally { lock.releaseLock(); }
}

function sanitizeUser_(u){
  return {id:u.id,name:u.name,username:u.username,role:u.role,active:u.active!=="FALSE"};
}

function authUser_(id){
  if(!id) return null;
  const u=rows_("Users").find(x=>x.id===String(id) && x.active!=="FALSE");
  return u ? sanitizeUser_(u) : null;
}

function requireAdmin_(id){
  const u=authUser_(id);
  if(!u || u.role!=="admin") throw new Error("Admin permission required.");
  return u;
}

function requireMember_(userId, groupId){
  const u=authUser_(userId);
  if(!u) throw new Error("Unauthorized user.");
  const g=rows_("Groups").find(x=>x.id===groupId && x.active!=="FALSE");
  if(!g) throw new Error("Group not found.");
  const ids=JSON.parse(g.memberIds||"[]");
  if(u.role!=="admin" && !ids.includes(u.id)) throw new Error("You are not a member of this group.");
  return u;
}

function snapshot_(){
  const users=rows_("Users").filter(u=>u.active!=="FALSE").map(sanitizeUser_);
  const groups=rows_("Groups").filter(g=>g.active!=="FALSE").map(g=>({
    id:g.id,name:g.name,description:g.description||"",memberIds:JSON.parse(g.memberIds||"[]"),createdAt:g.createdAt
  }));
  const expenses=rows_("Expenses").filter(e=>e.active!=="FALSE").map(e=>({
    id:e.id,groupId:e.groupId,description:e.description,amount:Number(e.amount||0),
    category:e.category||"Other",date:e.date||"",notes:e.notes||"",
    paidBy:JSON.parse(e.paidBy||"[]"),createdBy:e.createdBy||"",createdAt:e.createdAt||"",updatedAt:e.updatedAt||""
  }));
  const splitRows=rows_("Splits");
  expenses.forEach(e=>e.splits=splitRows.filter(s=>s.expenseId===e.id).map(s=>({userId:s.userId,amount:Number(s.amount||0)})));
  const settlements=rows_("Settlements").map(s=>({
    id:s.id,groupId:s.groupId,from:s.from,to:s.to,amount:Number(s.amount||0),
    status:s.status||"PENDING",createdAt:s.createdAt||"",paidAt:s.paidAt||"",updatedAt:s.updatedAt||"",createdBy:s.createdBy||""
  }));
  return {ok:true,users,groups,expenses,settlements,sheetUrl:`https://docs.google.com/spreadsheets/d/${ss_().getId()}/edit`};
}

function doGet(e){
  try{
    const p=e.parameter||{},action=p.action||"snapshot";
    if(action==="login"){
      const u=rows_("Users").find(x=>x.active!=="FALSE" &&
        x.username.toLowerCase()===String(p.username||"").trim().toLowerCase() &&
        x.passwordHash===hash_(String(p.password||"")));
      return json_(u?{ok:true,user:sanitizeUser_(u)}:{ok:false,error:"Invalid username or password."},p.callback);
    }
    if(action==="snapshot"){
      const u=p.userId?authUser_(p.userId):null;
      if(p.userId && !u) return json_({ok:false,error:"Session user is no longer valid."},p.callback);
      return json_(snapshot_(),p.callback);
    }
    return json_({ok:false,error:"Unknown action."},p.callback);
  }catch(err){
    return json_({ok:false,error:String(err.message||err)},e.parameter?.callback);
  }
}

function setRows_(name,headers,rows){
  const sh=ensureSheet_(name,headers);
  if(sh.getLastRow()>1) sh.getRange(2,1,sh.getLastRow()-1,headers.length).clearContent();
  if(rows.length) sh.getRange(2,1,rows.length,headers.length).setValues(rows);
}

function findRow_(name,id,headerId){
  const sh=ss_().getSheetByName(name);if(!sh||sh.getLastRow()<2)return -1;
  const headers=HEADERS[name], idx=headers.indexOf(headerId||"id")+1;
  const vals=sh.getRange(2,idx,sh.getLastRow()-1,1).getValues();
  for(let i=0;i<vals.length;i++)if(String(vals[i][0])===String(id))return i+2;
  return -1;
}

function updateRow_(name,id,object){
  const sh=ensureSheet_(name,HEADERS[name]), row=findRow_(name,id);
  if(row<0) throw new Error(`${name} record not found.`);
  const values=HEADERS[name].map(h=>object[h]!==undefined?object[h]:sh.getRange(row,HEADERS[name].indexOf(h)+1).getValue());
  sh.getRange(row,1,1,HEADERS[name].length).setValues([values]);
}

function addExpense_(e,userId){
  requireMember_(userId,e.groupId);
  if(!e.description || Number(e.amount)<=0) throw new Error("Invalid expense.");
  const splits=e.splits||[];
  const splitTotal=splits.reduce((a,s)=>a+Number(s.amount||0),0);
  if(Math.abs(splitTotal-Number(e.amount))>0.01) throw new Error("Expense split must equal total amount.");
  const sh=ensureSheet_("Expenses",HEADERS.Expenses),shs=ensureSheet_("Splits",HEADERS.Splits);
  const expenseId=e.id||Utilities.getUuid(),now=new Date().toISOString();
  sh.appendRow([expenseId,e.groupId,e.description,Number(e.amount),e.category||"Other",e.date||"",e.notes||"",JSON.stringify(e.paidBy||[]),e.createdBy||userId,e.createdAt||now,now,"TRUE"]);
  (splits||[]).forEach(s=>shs.appendRow([expenseId,s.userId,Number(s.amount||0)]));
}

function updateExpense_(e,userId){
  requireMember_(userId,e.groupId);
  requireAdmin_(userId);
  const splits=e.splits||[],total=splits.reduce((a,s)=>a+Number(s.amount||0),0);
  if(Math.abs(total-Number(e.amount))>0.01) throw new Error("Expense split must equal total amount.");
  const row=findRow_("Expenses",e.id);if(row<0)throw new Error("Expense not found.");
  const sh=ensureSheet_("Expenses",HEADERS.Expenses), old=sh.getRange(row,1,1,HEADERS.Expenses.length).getValues()[0],obj={};
  HEADERS.Expenses.forEach((h,i)=>obj[h]=old[i]);
  Object.assign(obj,{description:e.description,amount:Number(e.amount),category:e.category||"Other",date:e.date||"",notes:e.notes||"",paidBy:JSON.stringify(e.paidBy||[]),updatedAt:new Date().toISOString()});
  updateRow_("Expenses",e.id,obj);
  const ss=ss_(), shs=ensureSheet_("Splits",HEADERS.Splits);
  const all=rows_("Splits").filter(x=>x.expenseId!==e.id).map(x=>[x.expenseId,x.userId,Number(x.amount||0)]);
  (splits||[]).forEach(s=>all.push([e.id,s.userId,Number(s.amount||0)]));
  setRows_("Splits",HEADERS.Splits,all);
}

function deleteExpense_(id,userId){
  requireAdmin_(userId);
  const row=findRow_("Expenses",id);if(row<0)return;
  ss_().getSheetByName("Expenses").getRange(row,HEADERS.Expenses.indexOf("active")+1).setValue("FALSE");
}

function addGroup_(g,userId){
  requireAdmin_(userId);
  if(!g.name)throw new Error("Group name is required.");
  ensureSheet_("Groups",HEADERS.Groups).appendRow([g.id||Utilities.getUuid(),g.name,g.description||"",JSON.stringify(g.memberIds||[]),new Date().toISOString(),"TRUE"]);
}

function addSettlement_(s,userId){
  requireAdmin_(userId);
  requireMember_(userId,s.groupId);
  if(!s.from||!s.to||Number(s.amount)<=0)throw new Error("Invalid settlement.");
  ensureSheet_("Settlements",HEADERS.Settlements).appendRow([s.id||Utilities.getUuid(),s.groupId,s.from,s.to,Number(s.amount),"PENDING",new Date().toISOString(),"","",userId]);
}

function completeSettlement_(id,userId,status){
  const current=rows_("Settlements").find(s=>s.id===id);if(!current)throw new Error("Settlement not found.");
  const u=authUser_(userId);if(!u)throw new Error("Unauthorized user.");
  if(u.role!=="admin" && u.id!==current.from && u.id!==current.to)throw new Error("Only payer, recipient or admin can update this settlement.");
  if(current.status!=="PENDING")throw new Error("Settlement is already completed.");
  const row=findRow_("Settlements",id);const sh=ss_().getSheetByName("Settlements");
  sh.getRange(row,HEADERS.Settlements.indexOf("status")+1).setValue(status==="RECEIVED"?"RECEIVED":"PAID");
  sh.getRange(row,HEADERS.Settlements.indexOf("paidAt")+1).setValue(new Date().toISOString());
  sh.getRange(row,HEADERS.Settlements.indexOf("updatedAt")+1).setValue(new Date().toISOString());
}

function reverseSettlement_(id,userId){
  requireAdmin_(userId);
  const current=rows_("Settlements").find(s=>s.id===id);if(!current)throw new Error("Settlement not found.");
  const row=findRow_("Settlements",id);const sh=ss_().getSheetByName("Settlements");
  sh.getRange(row,HEADERS.Settlements.indexOf("status")+1).setValue("PENDING");
  sh.getRange(row,HEADERS.Settlements.indexOf("paidAt")+1).clearContent();
  sh.getRange(row,HEADERS.Settlements.indexOf("updatedAt")+1).setValue(new Date().toISOString());
}

function doPost(e){
  const lock=LockService.getScriptLock();lock.waitLock(15000);
  try{
    const p=JSON.parse(e.postData.contents||"{}"),action=p.action,userId=p.userId;
    if(action==="addExpense")addExpense_(p.expense,userId);
    else if(action==="updateExpense")updateExpense_(p.expense,userId);
    else if(action==="deleteExpense")deleteExpense_(p.id,userId);
    else if(action==="addGroup")addGroup_(p.group,userId);
    else if(action==="addSettlement")addSettlement_(p.settlement,userId);
    else if(action==="completeSettlement")completeSettlement_(p.id,userId,p.status);
    else if(action==="reverseSettlement")reverseSettlement_(p.id,userId);
    else throw new Error("Unknown action.");
    return json_({ok:true});
  }catch(err){
    return json_({ok:false,error:String(err.message||err)});
  }finally{lock.releaseLock();}
}
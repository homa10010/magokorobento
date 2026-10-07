/* config.js（window.FIREBASE_CONFIG / window.ADMIN_CODE）から設定を読み込む。
   無ければデモ体験版（FIREBASE_CONFIG=null）で動作。 */
/* URLに ?demo を付けると、config.js があってもデモ体験版で動く（店長への見せ用・動作確認用） */
const FORCE_DEMO = /[?&]demo\b/.test(location.search);
const FIREBASE_CONFIG = (!FORCE_DEMO && typeof window!=='undefined' && window.FIREBASE_CONFIG) ? window.FIREBASE_CONFIG : null;
const icon = id => `<svg class="i"><use href="#ic-${id}"/></svg>`;
const ADMIN_CODE = (typeof window!=='undefined' && window.ADMIN_CODE) ? String(window.ADMIN_CODE) : '1234';
/* ---------------- 基本ヘルパー ---------------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad2 = n => String(n).padStart(2,'0');
const dateKey = ts => { const d=new Date(ts);
  return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); };
const fmtTime = ts => { const d=new Date(ts); return pad2(d.getHours())+':'+pad2(d.getMinutes()); };
const WDAYS = ['日','月','火','水','木','金','土'];
const fmtDateLabel = key => { const [y,m,d]=key.split('-').map(Number);
  const dt=new Date(y,m-1,d);
  const today=dateKey(Date.now());
  const suffix = key===today?'（今日）':'（'+WDAYS[dt.getDay()]+'）';
  return m+'月'+d+'日'+suffix; };

/* localStorage が使えない環境でも動くように */
const safeStorage = {
  mem:{},
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return this.mem[k] ?? null; } },
  set(k,v){ try{ localStorage.setItem(k,v); }catch(e){ this.mem[k]=v; } },
  del(k){ try{ localStorage.removeItem(k); }catch(e){ delete this.mem[k]; } }
};

/* 暗証番号は平文で保存せず、簡易ハッシュ化して保存する */
function hashPin(name,pin){
  let h=5381; const s=name+'::'+pin+'::mgk2026';
  for(const c of s){ h=(Math.imul(h,33)^c.codePointAt(0))>>>0; }
  return 'h'+h.toString(36);
}

let toastTimer=null;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),2200); }

/* ---------------- 定義 ---------------- */
const ROUTES = ['1','2','3','4','厨房'];
const ROUTE_COLORS = {'1':'#2f7dd1','2':'#1f9d55','3':'#e08a00','4':'#7a49c9','厨房':'#6f6a63'};
const routeLabel = r => r==='厨房' ? '厨房' : 'ルート'+r;
const CATS = {
  absent:{label:'不在・保冷箱', icon:'📦', color:'var(--blue)',   action:false},
  cancel:{label:'キャンセル・中止', icon:'🚫', color:'var(--red)', action:true},
  change:{label:'変更・依頼',   icon:'✏️', color:'var(--orange)', action:true},
  money: {label:'集金・支払い', icon:'💰', color:'var(--purple)', action:true},
  trial: {label:'試食・新規',   icon:'🌱', color:'var(--green)',  action:true},
  done:  {label:'配達完了',     icon:'✅', color:'var(--dgreen)', action:false},
  other: {label:'その他・トラブル', icon:'⚠️', color:'var(--grey)', action:true},
};

/* ---------------- 状態 ---------------- */
const MODE = FIREBASE_CONFIG ? 'online' : 'demo';
/* シフトは「毎月8日締切で、21日〜翌月20日分」を提出する。
   初期表示は「これから始まる期間」（今日が21日以降なら翌月21日〜） */
function initPeriod(){
  const t=new Date();
  if(t.getDate()>=21){
    const m=t.getMonth()+1;
    return m>11 ? {y:t.getFullYear()+1,m:0} : {y:t.getFullYear(),m};
  }
  return {y:t.getFullYear(), m:t.getMonth()};
}
/* 打刻の集計は「今日を含む期間」（21日以降=今月始まり、20日以前=先月始まり） */
function initTcPeriod(){
  const t=new Date();
  if(t.getDate()>=21) return {y:t.getFullYear(), m:t.getMonth()};
  const m=t.getMonth()-1;
  return m<0 ? {y:t.getFullYear()-1, m:11} : {y:t.getFullYear(), m};
}
/* 業務区分。人数は1日あたりの目安（研修日は配達が5人） */
const DUTIES = {
  '配達':{n:4, trainN:5, color:'#2F6FB5', cls:'deli'},
  '厨房':{n:1, trainN:1, color:'#C8415B', cls:'kit'},
  '管理':{n:0, trainN:0, color:'#C27A12', cls:'adm'},   // 人数に余裕がある場合のみ
};
const DUTY_LIST = Object.keys(DUTIES);
const SLOTS = ['終日','午前','午後'];   // 仮仕様: シフトは日単位。まれに午前のみ・午後のみ
const dutyNeed = (duty, training) => training ? DUTIES[duty].trainN : DUTIES[duty].n;
function datesOfPeriod({y,m}){
  const ny=m===11?y+1:y, nm=(m+1)%12, out=[];
  const last=new Date(y,m+1,0).getDate();
  for(let d=21;d<=last;d++) out.push(`${y}-${pad2(m+1)}-${pad2(d)}`);
  for(let d=1;d<=20;d++) out.push(`${ny}-${pad2(nm+1)}-${pad2(d)}`);
  return out;
}
const labelOfPeriod = ({m}) => `${m+1}/21 〜 ${(m+1)%12+1}/20`;
const shiftPeriod = (p,delta) => { let m=p.m+delta, y=p.y; if(m<0){m=11;y--;} if(m>11){m=0;y++;} return {y,m}; };
function periodOfDate(key){ const [y,m,d]=key.split('-').map(Number);
  if(d>=21) return {y,m:m-1}; return m===1?{y:y-1,m:11}:{y,m:m-2}; }
const avaClass = name => 'c'+(1+[...String(name)].reduce((a,c)=>a+c.codePointAt(0),0)%5);
const avatar = (name,sm) => `<span class="ava ${avaClass(name)}${sm?' sm':''}">${esc(String(name).slice(0,1))}</span>`;

const state = {
  user:null,
  accounts:{},          // {名前:{name,role,createdAt}}  メンバー一覧（pinHashは持たない）
  confirmed:{},         // {'2026-10-21': [{name,duty,slot},...]}  管理者が登録した確定シフト
  days:{},              // {'2026-10-21': {training:true}}
  csMode:'me',          // 確定シフトの表示：me / day / person
  csPeriod:null,        // 確定シフトの表示期間（今日を含む期間）
  shiftTop:'confirmed', // confirmed=確定シフト / avail=希望提出
  moreBack:'more',
  reports:[],           // {id,ts,author,route,cat,customer,detail,memo,needsAction,done,doneBy,doneAt}
  shifts:{},            // {'2026-07-21': {名前:true,...}}
  timecards:{},         // {'2026-08-04': {名前:{inTime,outTime}}}
  comments:{},          // {reportId: [{id,author,text,ts},...]}
  announcements:[],     // [{id,author,text,ts},...]
  messages:[],          // [{id,channel,from,text,ts},...]  channel='全体' or dmChannel(a,b)
  chatChannel:null,     // 現在開いているチャットのchannel（null=一覧）
  lastRead:{},          // {channel: ts}  この端末での既読位置
  lastMsgSeenTs:0,      // 通知の重複防止（この時刻より新しいものだけ通知）
  openComments:null,    // 現在コメント欄を開いている報告ID
  fRoute:'all', fCat:'all', fSearch:'', fPerson:'all', fDate:'',
  todoTab:'open',
  period:initPeriod(),  // {y,m} → m月21日〜翌月20日
  selDate:null,
  shiftMode:'edit',     // edit=自分の提出 / view=みんなの提出（管理者のみ）
  shiftSel:null,        // 選択中の日付Set
  shiftSelPeriod:null,
  tcPeriod:initTcPeriod(),// 打刻の集計期間（今日を含む21日〜翌月20日）
  tcMode:'me',          // me=自分 / all=みんな（管理者のみ）
  composeCat:null,
};
const isAdmin = () => state.user && state.user.role==='admin';

/* ---------------- デモ用サンプルデータ ---------------- */
function seedReports(){
  const today = new Date(); today.setSeconds(0,0);
  const at = (h,m)=>{ const d=new Date(today); d.setHours(h,m); return d.getTime(); };
  let i=0; const mk = o => ({ id:'demo'+(++i), done:false, needsAction:false, memo:'', customer:'',
    photoThumb:'', photoId:'', ...o });
  return [
    mk({ts:at(9,34),  author:'Homa',   route:'4', cat:'absent', customer:'笠松様', detail:'保冷箱対応', memo:'施錠・不在のため', needsAction:true, done:true, doneBy:'原田', doneAt:at(10,0)}),
    mk({ts:at(10,12), author:'Homa',   route:'4', cat:'change', customer:'細川真理枝様', detail:'小町小おかずのみ＋元気旬菜プラス → 小町小おかずのみだけに変更希望', needsAction:true}),
    mk({ts:at(10,20), author:'細川',   route:'1', cat:'trial',  customer:'宮地様', detail:'ナビ通りでOK／表札あり', memo:'手渡し済み。今後のことは電話するそうです', needsAction:true}),
    mk({ts:at(10,22), author:'Homa',   route:'4', cat:'cancel', customer:'池田琴美様', detail:'明日で終了（昼夜）', memo:'明日お金を払いたいとのこと', needsAction:true}),
    mk({ts:at(11,21), author:'マサカズ', route:'2', cat:'done', detail:'配達完了'}),
    mk({ts:at(11,35), author:'70',     route:'3', cat:'done', detail:'配達完了'}),
    mk({ts:at(12,10), author:'細川',   route:'1', cat:'other', detail:'車両の不具合', memo:'ソリオ停車中はオイルランプ点きっぱなし。明日から三連休ですが本日中の対応は必要ですか？', needsAction:true}),
    mk({ts:at(13,12), author:'原田',   route:'2', cat:'cancel', customer:'斎田様', detail:'来週から中止', needsAction:true, done:true, doneBy:'原田', doneAt:at(13,20)}),
    mk({ts:at(13,36), author:'細川',   route:'1', cat:'money',  customer:'宍戸様・斎藤様', detail:'集金済み（消し込み済み）', needsAction:true}),
    mk({ts:at(15,27), author:'70',     route:'3', cat:'change', customer:'畝行様', detail:'来週月曜：帰りが遅いので保冷箱希望', needsAction:true}),
    mk({ts:at(15,59), author:'Homa',   route:'4', cat:'money',  customer:'栗田様', detail:'手渡し済み・QR送信お願いします', needsAction:true}),
    mk({ts:at(16,15), author:'Homa',   route:'4', cat:'done',  detail:'配達完了', memo:'このあと前田自動車に行きます'}),
  ];
}
function seedShifts(){
  const s={}; const base=new Date();
  const add=(offset,names)=>{ const d=new Date(base); d.setDate(d.getDate()+offset);
    s[dateKey(d.getTime())]=Object.fromEntries(names.map(n=>[n,true])); };
  // シフト提出のデフォルト表示（次の期間＝21日以降）にサンプルが乗るように
  add(18,['細川','マサカズ']); add(19,['細川','70','Homa']); add(21,['マサカズ','Homa']); add(24,['細川','70']);
  return s;
}
function seedTimecards(){
  // 直近の平日っぽい日に、数人の打刻サンプルを入れておく（デモ表示用）
  const tc={}; const base=new Date(); base.setSeconds(0,0);
  const put=(offset,name,ih,im,oh,om)=>{
    const d=new Date(base); d.setDate(d.getDate()+offset);
    const key=dateKey(d.getTime());
    const at=(h,m)=>{ const x=new Date(d); x.setHours(h,m,0,0); return x.getTime(); };
    (tc[key]=tc[key]||{})[name]={inTime:at(ih,im), outTime:oh==null?0:at(oh,om)};
  };
  put(-2,'細川',8,55,16,20); put(-2,'マサカズ',9,0,16,40); put(-2,'Homa',8,50,16,10);
  put(-1,'細川',8,58,16,30); put(-1,'70',9,5,16,50);
  put(0,'細川',8,52,null);   // 今日：出勤中（退勤まだ）
  return tc;
}
function seedComments(){
  // デモ用：報告へのコメント（reportId → コメント配列）
  const now=Date.now();
  return {
    'demo7':[ {id:'sc1', author:'原田', text:'三連休前なので、本日中に前田自動車で見てもらってください。', ts:now-3600000} ],
    'demo3':[ {id:'sc2', author:'原田', text:'宮地様、電話あったら内容を共有お願いします。', ts:now-3000000} ],
  };
}
function seedAnnouncements(){
  const now=Date.now();
  return [ {id:'sa1', author:'原田', text:'明日は雨予報です。保冷箱のフタ・玄関先の足元に注意してください。', ts:now-7200000} ];
}
function dmChannel(a,b){ return 'dm:'+[a,b].sort().join(''); }
/* デモ用メンバー（暗証番号はすべて 1234） */
const DEMO_MEMBERS = [['原田','admin'],['Homa','staff'],['細川','staff'],['マサカズ','staff'],['70','staff'],['田中','staff']];
function seedAccounts(){
  const a={}; DEMO_MEMBERS.forEach(([name,role])=>{ a[name]={name, role, pinHash:hashPin(name,'1234'), createdAt:Date.now()}; });
  return a;
}
/* デモ用の確定シフト：今日を含む期間に、配達4人＋厨房1人を回す（5人から毎日1人が休み）。研修日は配達5人 */
function seedConfirmed(){
  const staff=['Homa','細川','マサカズ','70','田中'], map={}, days={};
  datesOfPeriod(initTcPeriod()).forEach((k,i)=>{
    const order=[0,1,2,3,4].map(j=>staff[(i+j)%5]);
    const list=order.slice(0,4).map(n=>({name:n,duty:'配達',slot:'終日'}));
    if(i%9===4){   // 研修日は配達5人。厨房は管理者が入る
      days[k]={training:true};
      list.push({name:order[4],duty:'配達',slot:'終日'}, {name:'原田',duty:'厨房',slot:'終日'});
    }else{
      list.push({name:order[4],duty:'厨房',slot:'終日'});
      if(i%11===6) list.push({name:'原田',duty:'管理',slot:'午後'});   // 余裕がある日だけ管理業務（午後のみ）
    }
    map[k]=list;
  });
  return {map,days};
}
function seedMessages(){
  const now=Date.now();
  return [
    {id:'sm1', channel:'全体', from:'原田', text:'お疲れさまです。今日もよろしくお願いします🍱', ts:now-9000000},
    {id:'sm2', channel:'全体', from:'マサカズ', text:'了解です！', ts:now-8800000},
    {id:'sm3', channel:dmChannel('原田','Homa'), from:'原田', text:'Homaさん、ルート4の栗田様、QR送信お願いできますか？', ts:now-4200000},
  ];
}

/* ---------------- データ層（デモ / Firebase 共通インターフェース） ---------------- */
class DemoStore{
  constructor(){ this.reports=seedReports(); this.shifts=seedShifts(); this.accounts=seedAccounts();
    this.images={}; this.timecards=seedTimecards(); this.comments=seedComments();
    this.announcements=seedAnnouncements(); this.messages=seedMessages();
    this._id=0; this._imgId=0; this._cId=0; this._aId=0; this._mId=0; }
  async addImage(data){ const id='img'+(++this._imgId); this.images[id]=data; return id; }
  async getImage(id){ return this.images[id]||null; }
  deleteImage(id){ delete this.images[id]; }
  async init(cb){
    this.cb=cb; this.onR=cb.reports; this.onS=cb.shifts; this.onT=cb.timecards; this.onC=cb.comments;
    this.onA=cb.announcements; this.onM=cb.messages;
    const seed=seedConfirmed(); this.confirmed=seed.map; this.days=seed.days;
    cb.reports(this.reports); cb.shifts(this.shifts); cb.timecards(this.timecards);
    cb.comments(this.comments); cb.announcements(this.announcements); cb.messages(this.messages);
    this._pushAccounts(); this._pushConfirmed(); }
  _pushAccounts(){ this.cb.accounts(this.accounts); }
  _pushConfirmed(){ this.cb.confirmed(this.confirmed, this.days); }
  addMessage(m){ m.id='m'+(++this._mId); this.messages.push(m); this.onM(this.messages); }
  markMessagesRead(ids,name){ this.messages.forEach(m=>{ if(ids.includes(m.id)){
      m.readBy=m.readBy||[]; if(!m.readBy.includes(name)) m.readBy.push(name); } });
    this.onM(this.messages); }
  addAssignment(date,a){ const l=this.confirmed[date]||(this.confirmed[date]=[]);
    l.push({name:a.name,duty:a.duty,slot:a.slot}); this._pushConfirmed(); }
  removeAssignment(date,name,duty,slot){ this.confirmed[date]=(this.confirmed[date]||[])
      .filter(x=>!(x.name===name && x.duty===duty && x.slot===slot)); this._pushConfirmed(); }
  setTraining(date,on){ if(on) this.days[date]={training:true}; else delete this.days[date]; this._pushConfirmed(); }
  deleteAccount(name){ delete this.accounts[name]; this._pushAccounts(); }
  setPunch(date,name,patch){ const d=this.timecards[date]||(this.timecards[date]={});
    d[name]=Object.assign({}, d[name], patch); this.onT(this.timecards); }
  addComment(reportId,c){ c.id='c'+(++this._cId);
    (this.comments[reportId]=this.comments[reportId]||[]).push(c); this.onC(this.comments); }
  addAnnouncement(a){ a.id='a'+(++this._aId); this.announcements.push(a); this.onA(this.announcements); }
  deleteAnnouncement(id){ this.announcements=this.announcements.filter(x=>x.id!==id); this.onA(this.announcements); }
  async getAccount(name){ return this.accounts[name]||null; }
  async createAccount(a){
    if(this.accounts[a.name]) throw new Error('その名前はすでに登録されています');
    this.accounts[a.name]=a; this._pushAccounts(); }
  addReport(r){ r.id='d'+(++this._id); this.reports.push(r); this.onR(this.reports); }
  updateReport(id,patch){ const r=this.reports.find(x=>x.id===id);
    if(r){ Object.assign(r,patch); this.onR(this.reports); } }
  deleteReport(id){ this.reports=this.reports.filter(x=>x.id!==id); this.onR(this.reports); }
  setShift(date,name,val){ const d=this.shifts[date]||(this.shifts[date]={});
    if(val) d[name]=true; else delete d[name]; this.onS(this.shifts); }
}

function loadScript(src){ return new Promise((res,rej)=>{
  const s=document.createElement('script'); s.src=src; s.onload=res;
  s.onerror=()=>rej(new Error('読み込み失敗: '+src)); document.head.appendChild(s); }); }

class FirebaseStore{
  async init(cb){
    const onReports=cb.reports, onShifts=cb.shifts, onTimecards=cb.timecards, onComments=cb.comments,
      onAnnouncements=cb.announcements, onMessages=cb.messages;
    const V='10.12.2';
    await loadScript(`https://www.gstatic.com/firebasejs/${V}/firebase-app-compat.js`);
    await loadScript(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore-compat.js`);
    firebase.initializeApp(FIREBASE_CONFIG);
    this.db = firebase.firestore();
    this.db.collection('reports').orderBy('ts','asc').limitToLast(400)
      .onSnapshot(snap=>{ onReports(snap.docs.map(d=>({id:d.id, ...d.data()}))); },
        err=>toast('通信エラー：'+err.message));
    this.db.collection('shifts')
      .onSnapshot(snap=>{ const m={};
        snap.docs.forEach(d=>{ const v=d.data();
          if(v.available){ (m[v.date]=m[v.date]||{})[v.name]=true; } });
        onShifts(m); }, err=>toast('通信エラー：'+err.message));
    this.db.collection('timecards')
      .onSnapshot(snap=>{ const m={};
        snap.docs.forEach(d=>{ const v=d.data();
          (m[v.date]=m[v.date]||{})[v.name]={inTime:v.inTime||0, outTime:v.outTime||0}; });
        onTimecards(m); }, err=>toast('通信エラー：'+err.message));
    this.db.collection('comments').orderBy('ts','asc').limitToLast(1000)
      .onSnapshot(snap=>{ const m={};
        snap.docs.forEach(d=>{ const v=d.data();
          (m[v.reportId]=m[v.reportId]||[]).push({id:d.id, ...v}); });
        onComments(m); }, err=>toast('通信エラー：'+err.message));
    this.db.collection('announcements').orderBy('ts','asc').limitToLast(50)
      .onSnapshot(snap=>{ onAnnouncements(snap.docs.map(d=>({id:d.id, ...d.data()}))); },
        err=>toast('通信エラー：'+err.message));
    this.db.collection('messages').orderBy('ts','asc').limitToLast(1000)
      .onSnapshot(snap=>{ onMessages(snap.docs.map(d=>({id:d.id, ...d.data()}))); },
        err=>toast('通信エラー：'+err.message));
    // メンバー一覧（pinHash は画面側に渡さない）
    this.db.collection('accounts')
      .onSnapshot(snap=>{ const m={};
        snap.docs.forEach(d=>{ const v=d.data(); m[d.id]={name:v.name||d.id, role:v.role, createdAt:v.createdAt}; });
        cb.accounts(m); }, err=>toast('通信エラー：'+err.message));
    // 確定シフト（管理者が登録）と研修日
    this._confirmed={}; this._days={};
    const push=()=>cb.confirmed(this._confirmed, this._days);
    this.db.collection('confirmedShifts')
      .onSnapshot(snap=>{ const m={};
        snap.docs.forEach(d=>{ const v=d.data(); (m[v.date]=m[v.date]||[]).push({name:v.name,duty:v.duty,slot:v.slot}); });
        this._confirmed=m; push(); }, err=>toast('通信エラー：'+err.message));
    this.db.collection('shiftDays')
      .onSnapshot(snap=>{ const m={};
        snap.docs.forEach(d=>{ if(d.data().training) m[d.id]={training:true}; });
        this._days=m; push(); }, err=>toast('通信エラー：'+err.message));
  }
  markMessagesRead(ids,name){ ids.forEach(id=>this.db.collection('messages').doc(id)
    .update({readBy:firebase.firestore.FieldValue.arrayUnion(name)}).catch(()=>{})); }
  addAssignment(date,a){ this.db.collection('confirmedShifts').doc(`${date}_${a.name}_${a.duty}_${a.slot}`)
    .set({date,name:a.name,duty:a.duty,slot:a.slot}).catch(e=>toast('シフト登録エラー：'+e.message)); }
  removeAssignment(date,name,duty,slot){ this.db.collection('confirmedShifts').doc(`${date}_${name}_${duty}_${slot}`)
    .delete().catch(e=>toast('削除エラー：'+e.message)); }
  setTraining(date,on){ const ref=this.db.collection('shiftDays').doc(date);
    (on ? ref.set({training:true}) : ref.delete()).catch(e=>toast('更新エラー：'+e.message)); }
  deleteAccount(name){ this.db.collection('accounts').doc(name).delete().catch(e=>toast('削除エラー：'+e.message)); }
  addMessage(m){ this.db.collection('messages').add(m)
    .catch(e=>toast('メッセージ送信エラー：'+e.message)); }
  addComment(reportId,c){ this.db.collection('comments').add(Object.assign({reportId},c))
    .catch(e=>toast('コメント送信エラー：'+e.message)); }
  addAnnouncement(a){ this.db.collection('announcements').add(a)
    .catch(e=>toast('お知らせ送信エラー：'+e.message)); }
  deleteAnnouncement(id){ this.db.collection('announcements').doc(id).delete()
    .catch(e=>toast('削除エラー：'+e.message)); }
  setPunch(date,name,patch){ const ref=this.db.collection('timecards').doc(date+'_'+name);
    ref.set(Object.assign({date,name}, patch), {merge:true})
      .catch(e=>toast('打刻エラー：'+e.message)); }
  addReport(r){ this.db.collection('reports').add(r).catch(e=>toast('送信エラー：'+e.message)); }
  updateReport(id,patch){ this.db.collection('reports').doc(id).update(patch)
    .catch(e=>toast('更新エラー：'+e.message)); }
  deleteReport(id){ this.db.collection('reports').doc(id).delete()
    .catch(e=>toast('削除エラー：'+e.message)); }
  async addImage(data){
    const ref=await this.db.collection('images').add({data, ts:Date.now()});
    return ref.id; }
  async getImage(id){
    const d=await this.db.collection('images').doc(id).get();
    return d.exists ? d.data().data : null; }
  deleteImage(id){ this.db.collection('images').doc(id).delete().catch(()=>{}); }
  async getAccount(name){
    const d=await this.db.collection('accounts').doc(name).get();
    return d.exists ? d.data() : null; }
  async createAccount(a){
    const ref=this.db.collection('accounts').doc(a.name);
    const d=await ref.get();
    if(d.exists) throw new Error('その名前はすでに登録されています');
    await ref.set(a); }
  setShift(date,name,val){ const ref=this.db.collection('shifts').doc(date+'_'+name);
    (val ? ref.set({date,name,available:true}) : ref.delete())
      .catch(e=>toast('更新エラー：'+e.message)); }
}

const store = MODE==='online' ? new FirebaseStore() : new DemoStore();
/* ---------------- タイムライン ---------------- */
function buildFilterChips(){
  const r=$('#chips-route');
  r.innerHTML = ['all',...ROUTES].map(v=>
    `<button class="chip${state.fRoute===v?' on':''}" data-v="${v}">${v==='all'?'全ルート':routeLabel(v)}</button>`).join('');
  r.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{ state.fRoute=b.dataset.v; buildFilterChips(); renderTimeline(); });
  const c=$('#chips-cat');
  c.innerHTML = ['all',...Object.keys(CATS)].map(v=>
    `<button class="chip${state.fCat===v?' on':''}" data-v="${v}">${v==='all'?'すべて':CATS[v].icon+' '+CATS[v].label}</button>`).join('');
  c.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{ state.fCat=b.dataset.v; buildFilterChips(); renderTimeline(); });
}

function reportCard(r, forTodo){
  const cat = CATS[r.cat] || CATS.other;
  const rc = ROUTE_COLORS[r.route] || 'var(--grey)';
  const status = r.needsAction
    ? (r.done
        ? `<span class="st st-done">処理済み ✓ ${esc(r.doneBy||'')}</span>`
        : `<span class="st st-open">未処理</span>`)
    : '';
  // 送信取り消し：自分の報告（管理者は全員の報告）に表示
  const canRetract = state.user && (r.author===state.user.name || isAdmin());
  const retract = canRetract ? `<button class="retract" data-id="${r.id}">取消</button>` : '';
  // コメント
  const cList = state.comments[r.id] || [];
  const open = state.openComments===r.id;
  const commentBtn = `<button class="comment-btn${cList.length?' has':''}" data-cid="${r.id}">💬 ${cList.length?('コメント '+cList.length):'コメント'}</button>`;
  const thread = open ? `
    <div class="comment-thread">
      ${cList.map(c=>`<div class="comment"><span class="c-author">${esc(c.author)}</span>${esc(c.text)}<span class="c-time">${fmtTime(c.ts)}</span></div>`).join('') || '<div class="note" style="padding:2px 0 6px">まだコメントはありません</div>'}
      <div class="comment-input">
        <input class="c-text" data-cid="${r.id}" placeholder="コメントを書く…" autocomplete="off" maxlength="200">
        <button class="c-send" data-cid="${r.id}">送信</button>
      </div>
    </div>` : '';
  return `
    <div class="card" style="border-left-color:${cat.color}">
      <div class="card-top">
        <span class="badge-route" style="background:${rc}">${esc(routeLabel(r.route))}</span>
        <span class="badge-cat" style="color:${cat.color}">${cat.icon} ${cat.label}</span>
        <span class="card-time">${fmtTime(r.ts)}</span>
      </div>
      <div class="card-main">${r.customer?`<b>${esc(r.customer)}</b>　`:''}${esc(r.detail||'')}</div>
      ${r.memo?`<div class="card-memo">${esc(r.memo)}</div>`:''}
      ${r.photoThumb?`<img class="card-photo" src="${r.photoThumb}" data-photo="${esc(r.photoId||'')}" alt="写真">`:''}
      <div class="card-foot"><span class="card-author">👤 ${esc(r.author)}</span>${commentBtn}${retract}${status}</div>
      ${thread}
    </div>`;
}

/* 報告カードのコメント操作を配線 */
function attachCommentHandlers(root){
  root.querySelectorAll('.comment-btn').forEach(b=>b.onclick=()=>{
    state.openComments = (state.openComments===b.dataset.cid) ? null : b.dataset.cid;
    renderTimeline();
  });
  root.querySelectorAll('.c-send').forEach(b=>b.onclick=()=>{
    const inp=root.querySelector(`.c-text[data-cid="${b.dataset.cid}"]`);
    const text=(inp?inp.value:'').trim();
    if(!text){ toast('コメントを入力してください'); return; }
    store.addComment(b.dataset.cid, {author:state.user.name, text, ts:Date.now()});
    toast('コメントを送信しました');
  });
  root.querySelectorAll('.c-text').forEach(inp=>inp.onkeydown=e=>{
    if(e.key==='Enter'){ e.preventDefault();
      root.querySelector(`.c-send[data-cid="${inp.dataset.cid}"]`).click(); }
  });
}

/* 写真タップ → 拡大表示（拡大用の画像は必要になったときだけ読み込む） */
function attachPhotoHandlers(root){
  root.querySelectorAll('.card-photo').forEach(im=>im.onclick=async ()=>{
    const v=$('#photo-viewer'), big=v.querySelector('img');
    big.src=im.src;            // まずサムネを表示
    v.hidden=false;
    const id=im.dataset.photo;
    if(id){ try{ const data=await store.getImage(id); if(data) big.src=data; }catch(e){} }
  });
}

/* ---------------- CSV書き出し ---------------- */
function csvCell(v){ return '"'+String(v==null?'':v).replace(/"/g,'""')+'"'; }
function todayStamp(){ const d=new Date();
  return d.getFullYear()+pad2(d.getMonth()+1)+pad2(d.getDate()); }
function downloadCSV(filename, rows){
  const csv='﻿'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function filteredReports(){
  const q=state.fSearch.trim().toLowerCase();
  return state.reports.filter(r=>
    (state.fRoute==='all'  || r.route===state.fRoute) &&
    (state.fCat==='all'    || r.cat===state.fCat) &&
    (state.fPerson==='all' || r.author===state.fPerson) &&
    (!state.fDate          || dateKey(r.ts)===state.fDate) &&
    (!q || [r.customer,r.detail,r.memo,r.author,routeLabel(r.route),(CATS[r.cat]||{}).label]
            .join(' ').toLowerCase().includes(q)));
}
function exportReportsCSV(){
  const rows=[['日付','時刻','ルート','種類','お客様','内容','メモ','報告者','要対応','処理状況','処理者']];
  for(const r of filteredReports())
    rows.push([dateKey(r.ts), fmtTime(r.ts), routeLabel(r.route), (CATS[r.cat]||{}).label||r.cat,
      r.customer||'', r.detail||'', r.memo||'', r.author,
      r.needsAction?'要対応':'', r.needsAction?(r.done?'処理済み':'未処理'):'', r.done?(r.doneBy||''):'']);
  downloadCSV(`報告_${todayStamp()}.csv`, rows);
  toast('報告をCSVに書き出しました');
}
function exportTimecardsCSV(){
  const rows=[['名前','日付','出勤','退勤','勤務時間(分)','勤務時間']];
  const names=new Set();
  for(const k of tcPeriodDates()) for(const n of Object.keys(state.timecards[k]||{})) names.add(n);
  for(const n of [...names].sort()){
    let totMin=0;
    for(const k of tcPeriodDates()){
      const r=(state.timecards[k]||{})[n]; if(!r||!r.inTime) continue;
      const mm=workedMin(r); totMin+=mm;
      rows.push([n, k, fmtTime(r.inTime), r.outTime?fmtTime(r.outTime):'', mm||'', mm?fmtDur(mm):'']);
    }
    rows.push([n, '（'+tcPeriodInfo().label+' 合計）', '', '', totMin, fmtDur(totMin)]);
  }
  downloadCSV(`勤怠_${tcPeriodInfo().label.replace(/[ 〜\/]/g,'')}.csv`, rows);
  toast('勤怠をCSVに書き出しました');
}
function exportShiftsCSV(){
  const rows=[['日付','曜日','人数','出勤できる人']];
  for(const key of periodDates()){
    const [yy,mm,dd]=key.split('-').map(Number);
    const wd=WDAYS[new Date(yy,mm-1,dd).getDay()];
    const members=Object.keys(state.shifts[key]||{});
    rows.push([key, wd, members.length, members.join('、')]);
  }
  downloadCSV(`シフト_${periodInfo().label.replace(/[ 〜\/]/g,'')}.csv`, rows);
  toast('シフトをCSVに書き出しました');
}

/* ---------------- お知らせ掲示 ---------------- */
function announcementsHTML(){
  let html='<div class="ann-area">';
  for(const a of state.announcements)
    html+=`<div class="ann"><span class="ann-ico">📢</span>
      <div class="ann-body"><div class="ann-text">${esc(a.text)}</div>
      <div class="ann-meta">${esc(a.author)}・${fmtDateLabel(dateKey(a.ts))} ${fmtTime(a.ts)}</div></div>
      ${isAdmin()?`<button class="ann-del" data-aid="${a.id}" aria-label="削除">×</button>`:''}</div>`;
  if(isAdmin())
    html+=`<div class="ann-post"><input id="ann-input" placeholder="お知らせを書く（全員に固定表示）" maxlength="200" autocomplete="off"><button id="ann-send">📢 出す</button></div>`;
  return html+'</div>';
}
function attachAnnHandlers(root){
  root.querySelectorAll('.ann-del').forEach(b=>b.onclick=()=>{
    if(!b.dataset.arm){ b.dataset.arm='1'; b.textContent='消す？';
      setTimeout(()=>{ if(b.isConnected){ delete b.dataset.arm; b.textContent='×'; } },3000); return; }
    store.deleteAnnouncement(b.dataset.aid); toast('お知らせを消しました');
  });
  const send=root.querySelector('#ann-send'), inp=root.querySelector('#ann-input');
  if(send) send.onclick=()=>{ const t=(inp.value||'').trim();
    if(!t){ toast('お知らせの内容を入力してください'); return; }
    store.addAnnouncement({author:state.user.name, text:t, ts:Date.now()});
    toast('お知らせを出しました'); };
  if(inp) inp.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); send.click(); } };
}

function buildPersonOptions(){
  const sel=$('#f-person');
  const names=[...new Set(state.reports.map(r=>r.author))].sort();
  sel.innerHTML = `<option value="all">すべての人</option>`
    + names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
  sel.value = names.includes(state.fPerson) ? state.fPerson : 'all';
  if(sel.value==='all') state.fPerson='all';
}
function anyAdvActive(){ return state.fPerson!=='all' || !!state.fDate; }
function updateAdvUI(){
  $('#adv-btn').classList.toggle('on', anyAdvActive());
  $('#adv-clear').hidden = !anyAdvActive();
  $('#f-date-input').value = state.fDate || '';
}

function renderTimeline(){
  const el=$('#timeline');
  const q=state.fSearch.trim().toLowerCase();
  buildPersonOptions(); updateAdvUI();
  const list = filteredReports();
  // 絞り込み中の表示（キーワード・人・日付のいずれか）
  const parts=[];
  if(q) parts.push(`「${state.fSearch.trim()}」`);
  if(state.fPerson!=='all') parts.push(`${state.fPerson}さん`);
  if(state.fDate){ const [ ,mm,dd]=state.fDate.split('-').map(Number); parts.push(`${mm}月${dd}日`); }
  const scEl=$('#search-count');
  if(parts.length){ scEl.hidden=false; scEl.textContent=`${parts.join(' / ')} で絞り込み中：${list.length}件`; }
  else scEl.hidden=true;
  // 先頭：お知らせ掲示（＋管理者の書き出しバー）
  const topHTML = announcementsHTML()
    + (isAdmin() && list.length ? `<div class="export-bar"><button id="export-reports">📥 表示中の報告をCSVで書き出し（${list.length}件）</button></div>` : '');
  if(!list.length){
    el.innerHTML = topHTML + ((q||anyAdvActive())
      ? '<div class="empty">条件に合う報告が見つかりませんでした。<br>絞り込みを変えて試してみてください。</div>'
      : '<div class="empty">まだ報告がありません。<br>「➕ 報告する」から送ってみてください。</div>');
    attachAnnHandlers(el);
    return;
  }
  let html=topHTML, lastDay='';
  for(const r of list){
    const dk=dateKey(r.ts);
    if(dk!==lastDay){ html+=`<div class="date-sep"><span>${fmtDateLabel(dk)}</span></div>`; lastDay=dk; }
    html+=reportCard(r);
  }
  el.innerHTML=html;
  attachAnnHandlers(el);
  attachCommentHandlers(el);
  const exp=$('#export-reports'); if(exp) exp.onclick=exportReportsCSV;
  // 送信取り消し（押し間違い防止のため2回タップ）
  el.querySelectorAll('.retract').forEach(b=>b.onclick=()=>{
    if(!b.dataset.arm){
      b.dataset.arm='1'; b.textContent='本当に取消？'; b.classList.add('arm');
      setTimeout(()=>{ if(b.isConnected){ delete b.dataset.arm; b.textContent='取消'; b.classList.remove('arm'); } },3000);
      return;
    }
    const rep=state.reports.find(x=>x.id===b.dataset.id);
    store.deleteReport(b.dataset.id);
    if(rep && rep.photoId) store.deleteImage(rep.photoId);
    toast('送信を取り消しました');
  });
  attachPhotoHandlers(el);
  // コメント欄を開いているときはそこに入力できるようフォーカス
  if(state.openComments){
    const ci=el.querySelector(`.c-text[data-cid="${state.openComments}"]`);
    if(ci) ci.focus();
  }
  // タイムライン表示中で、検索・絞り込み・コメント展開のいずれもないときだけ最新までスクロール
  else if(!$('#view-timeline').hidden && !q && !anyAdvActive() && state.fRoute==='all' && state.fCat==='all')
    requestAnimationFrame(()=>window.scrollTo(0,document.body.scrollHeight));
}

/* ---------------- 要対応リスト ---------------- */
function renderTodo(){
  const listEl=$('#todo-list');
  const open = state.todoTab==='open';
  const items = state.reports.filter(r=>r.needsAction && (open? !r.done : r.done));
  const sorted=[...items].sort((a,b)=> open ? a.ts-b.ts : (b.doneAt||b.ts)-(a.doneAt||a.ts));
  if(!sorted.length){
    listEl.innerHTML=`<div class="empty">${open?'未処理の項目はありません 🎉':'処理済みの項目はまだありません'}</div>`;
    return;
  }
  listEl.innerHTML = sorted.map(r=>{
    const cat=CATS[r.cat]||CATS.other;
    const doneNote = r.done
      ? `<div class="todo-donenote">✓ ${esc(r.doneBy||'')} が処理（${fmtTime(r.doneAt||r.ts)}）</div>` : '';
    return `
      <div class="todo-card${r.done?' is-done':''}">
        <div class="todo-body">
          <div class="card-top">
            <span class="badge-route" style="background:${ROUTE_COLORS[r.route]||'var(--grey)'}">${esc(routeLabel(r.route))}</span>
            <span class="badge-cat" style="color:${cat.color}">${cat.icon} ${cat.label}</span>
            <span class="card-time">${fmtDateLabel(dateKey(r.ts))} ${fmtTime(r.ts)}</span>
          </div>
          <div class="card-main">${r.customer?`<b>${esc(r.customer)}</b>　`:''}${esc(r.detail||'')}</div>
          ${r.memo?`<div class="card-memo">${esc(r.memo)}</div>`:''}
          ${r.photoThumb?`<img class="card-photo" src="${r.photoThumb}" data-photo="${esc(r.photoId||'')}" alt="写真">`:''}
          <div class="card-author" style="margin-top:4px">👤 ${esc(r.author)}</div>
          ${doneNote}
        </div>
        ${!isAdmin() ? '' : r.done
          ? `<div class="todo-actions">
               <button class="todo-check undo" data-id="${r.id}">戻す</button>
               <button class="todo-del" data-id="${r.id}">削除</button>
             </div>`
          : `<button class="todo-check" data-id="${r.id}">済</button>`}
      </div>`;
  }).join('');
  listEl.querySelectorAll('.todo-check').forEach(b=>b.onclick=()=>{
    const r=state.reports.find(x=>x.id===b.dataset.id); if(!r) return;
    if(r.done){ store.updateReport(r.id,{done:false,doneBy:'',doneAt:0}); toast('未処理に戻しました'); }
    else{ store.updateReport(r.id,{done:true,doneBy:state.user.name,doneAt:Date.now()}); toast('処理済みにしました ✓'); }
  });
  // 削除は押し間違い防止のため2回タップ
  listEl.querySelectorAll('.todo-del').forEach(b=>b.onclick=()=>{
    if(!b.dataset.arm){
      b.dataset.arm='1'; b.textContent='本当に削除？';
      setTimeout(()=>{ if(b.isConnected){ delete b.dataset.arm; b.textContent='削除'; } },3000);
      return;
    }
    const rep=state.reports.find(x=>x.id===b.dataset.id);
    store.deleteReport(b.dataset.id);
    if(rep && rep.photoId) store.deleteImage(rep.photoId);
    toast('削除しました（タイムラインからも消えます）');
  });
  attachPhotoHandlers(listEl);
}

function updateBadge(){
  const n=state.reports.filter(r=>r.needsAction && !r.done).length;
  const b=$('#todo-badge'); b.hidden=(n===0); b.textContent=n;
}

/* ---------------- シフトカレンダー（21日〜翌月20日の期間制） ---------------- */
function periodInfo(){
  const {y,m}=state.period;
  const ny = m===11 ? y+1 : y, nm = (m+1)%12;
  return { y, m, ny, nm,
    label:`${m+1}/21 〜 ${nm+1}/20 分`,
    deadline:new Date(y,m,8) };
}
function periodDates(){
  const p=periodInfo(); const out=[];
  const lastDay=new Date(p.y,p.m+1,0).getDate();
  for(let d=21;d<=lastDay;d++) out.push(`${p.y}-${pad2(p.m+1)}-${pad2(d)}`);
  for(let d=1;d<=20;d++) out.push(`${p.ny}-${pad2(p.nm+1)}-${pad2(d)}`);
  return out;
}
function myCurrentDates(){
  return periodDates().filter(k=>(state.shifts[k]||{})[state.user.name]);
}
/* 期間が変わったら、選択状態を「自分の提出済みの日」で初期化 */
function ensureShiftSel(){
  const pk=state.period.y+'-'+state.period.m+'-'+state.user.name;
  if(state.shiftSelPeriod!==pk){
    state.shiftSelPeriod=pk;
    state.shiftSel=new Set(myCurrentDates());
  }
}
const adminView = () => isAdmin() && state.shiftMode==='view';

function monthGridHTML(y,m,from,to){
  const todayK=dateKey(Date.now());
  const av=adminView();
  let html=`<div class="cal-month-title">${y}年${m+1}月</div><div class="cal-grid">`;
  html+=WDAYS.map((w,i)=>`<div class="cal-wd${i===0?' sun':i===6?' sat':''}">${w}</div>`).join('');
  const off=new Date(y,m,from).getDay();
  for(let i=0;i<off;i++) html+='<div class="cal-cell blank"></div>';
  for(let d=from;d<=to;d++){
    const key=`${y}-${pad2(m+1)}-${pad2(d)}`;
    const cnt=Object.keys(state.shifts[key]||{}).length;
    const selected=state.shiftSel && state.shiftSel.has(key);
    const cls=(key===todayK?' today':'')
      +(av && key===state.selDate?' sel':'')
      +(!av && selected?' mysel':'');
    html+=`<button class="cal-cell${cls}" data-key="${key}">
      <span class="dnum">${d}</span>
      ${!av && selected?'<span class="cal-mine">出勤◯</span>':''}
      ${av && cnt?`<span class="cal-cnt">${cnt}人</span>`:''}
    </button>`;
  }
  return html+'</div>';
}

function renderShift(){
  ensureShiftSel();
  const p=periodInfo();
  $('#cal-label').textContent=p.label;
  const today=new Date(); today.setHours(0,0,0,0);
  const diff=Math.round((p.deadline-today)/86400000);
  const dlText=`${p.deadline.getMonth()+1}月8日`;
  const note=$('#deadline-note');
  if(diff>0){ note.textContent=`⏰ 提出締切：${dlText}（あと${diff}日）`; note.className='deadline ok'; }
  else if(diff===0){ note.textContent=`⏰ 提出締切：${dlText}（今日まで！）`; note.className='deadline warn'; }
  else{ note.textContent=`⏰ 提出締切：${dlText}（締切を過ぎています。追加・変更はお早めに）`; note.className='deadline warn'; }
  const av=adminView();
  $('#shift-help').textContent = av
    ? '提出されたシフトを1日ずつ並べています。各日に出勤できる人が一目で分かります。'
    : '出勤できる日をタップして選択（複数OK）→ 最後に「希望を送信」を押してください。毎月8日までに「21日〜翌月20日」の分を提出します。';
  if(av){
    // 管理者：1日単位の一覧
    const todayK=dateKey(Date.now());
    let html='<div class="export-bar"><button id="export-shifts">📥 このシフトをCSVで書き出し</button></div><div class="daylist">';
    for(const key of periodDates()){
      const [yy,mm,dd]=key.split('-').map(Number);
      const wd=WDAYS[new Date(yy,mm-1,dd).getDay()];
      const g=new Date(yy,mm-1,dd).getDay();
      const members=Object.keys(state.shifts[key]||{});
      html+=`<div class="daylist-row${members.length?' has':''}${key===todayK?' today':''}">
        <div class="daylist-date">${mm}/${dd}<span class="wd${g===0?' sun':g===6?' sat':''}">${wd}</span></div>
        <div class="daylist-members">${members.length
          ? members.map(n=>`<span class="member-tag">${esc(n)}</span>`).join('')
          : '<span class="note">提出なし</span>'}</div>
        <div class="daylist-cnt${members.length?'':' zero'}">${members.length}人</div>
      </div>`;
    }
    $('#cal-container').innerHTML = html+'</div>';
    const es=$('#export-shifts'); if(es) es.onclick=exportShiftsCSV;
  }else{
    const lastDay=new Date(p.y,p.m+1,0).getDate();
    $('#cal-container').innerHTML =
      monthGridHTML(p.y,p.m,21,lastDay) + monthGridHTML(p.ny,p.nm,1,20);
    $('#cal-container').querySelectorAll('.cal-cell:not(.blank)').forEach(c=>c.onclick=()=>{
      const key=c.dataset.key;
      state.shiftSel.has(key) ? state.shiftSel.delete(key) : state.shiftSel.add(key);
      renderShift();
    });
  }
  $('#shift-submit-bar').hidden=av;
  if(!av) $('#shift-sel-count').textContent=`選択中：${state.shiftSel.size}日（出勤できる日）`;
}

function sendShift(){
  ensureShiftSel();
  const cur=new Set(myCurrentDates());
  let changed=0;
  for(const k of state.shiftSel) if(!cur.has(k)){ store.setShift(k,state.user.name,true); changed++; }
  for(const k of cur) if(!state.shiftSel.has(k)){ store.setShift(k,state.user.name,false); changed++; }
  toast(changed ? `シフトを送信しました（出勤可 ${state.shiftSel.size}日）` : '変更はありません');
}
/* ---------------- タイムカード（打刻・集計は21日〜翌月20日） ---------------- */
function tcPeriodInfo(){
  const {y,m}=state.tcPeriod;
  const ny=m===11?y+1:y, nm=(m+1)%12;
  return {y,m,ny,nm, label:`${m+1}/21 〜 ${nm+1}/20`};
}
function tcPeriodDates(){
  const {y,m,ny,nm}=tcPeriodInfo(); const out=[];
  const lastDay=new Date(y,m+1,0).getDate();
  for(let d=21;d<=lastDay;d++) out.push(`${y}-${pad2(m+1)}-${pad2(d)}`);
  for(let d=1;d<=20;d++) out.push(`${ny}-${pad2(nm+1)}-${pad2(d)}`);
  return out;
}
function workedMin(rec){
  if(!rec || !rec.inTime || !rec.outTime) return 0;
  const m=Math.round((rec.outTime-rec.inTime)/60000);
  return m>0 ? m : 0;
}
function fmtDur(min){
  if(!min) return '0分';
  const h=Math.floor(min/60), m=min%60;
  return (h?`${h}時間`:'')+(m?`${m}分`:(h?'':'0分'));
}
function periodTotalFor(name){
  let sum=0; for(const k of tcPeriodDates()) sum+=workedMin((state.timecards[k]||{})[name]);
  return sum;
}

function renderTimecard(){
  const admin=isAdmin();
  $('#tc-mode').hidden=!admin;
  const showAll = admin && state.tcMode==='all';
  $('#tc-me').hidden=showAll;
  $('#tc-all').hidden=!showAll;
  if(showAll) renderTimecardAll(); else renderTimecardMe();
}

function renderTimecardMe(){
  const name=state.user.name;
  const todayK=dateKey(Date.now());
  const rec=(state.timecards[todayK]||{})[name]||{};
  const hasIn=!!rec.inTime, hasOut=!!rec.outTime;
  let statusCls, statusTxt, times='';
  if(!hasIn){ statusCls='none'; statusTxt='まだ出勤していません'; }
  else if(!hasOut){ statusCls='working'; statusTxt='🟢 勤務中'; times=`出勤 ${fmtTime(rec.inTime)}`; }
  else{ statusCls='done'; statusTxt='退勤済み・お疲れさまでした';
    times=`出勤 ${fmtTime(rec.inTime)} 〜 退勤 ${fmtTime(rec.outTime)}`; }
  const worked = hasOut ? `<div class="tc-worked">本日の勤務：${fmtDur(workedMin(rec))}</div>` : '';
  $('#tc-me').innerHTML = `
    <div class="tc-card">
      <div class="tc-date">${fmtDateLabel(todayK)}</div>
      <div class="tc-status ${statusCls}">${statusTxt}</div>
      ${times?`<div class="tc-times">${times}</div>`:''}
      ${worked}
      <div class="tc-btns">
        <button class="tc-btn tc-in" id="btn-punch-in" ${hasIn?'disabled':''}>出勤</button>
        <button class="tc-btn tc-out" id="btn-punch-out" ${(!hasIn||hasOut)?'disabled':''}>退勤</button>
      </div>
    </div>
    <div class="tc-total">
      <span class="lbl">この期間の合計（${tcPeriodInfo().label}）</span>
      <span class="val">${fmtDur(periodTotalFor(name))}</span>
    </div>
    <div class="tc-hist" id="tc-hist"></div>`;
  const rows=[];
  for(const k of tcPeriodDates()){
    const r=(state.timecards[k]||{})[name];
    if(r&&r.inTime){ const p=k.split('-').map(Number);
      rows.push(`<div class="tc-hist-row">
        <span class="d">${p[1]}/${p[2]}</span>
        <span class="t">${fmtTime(r.inTime)}〜${r.outTime?fmtTime(r.outTime):'（勤務中）'}</span>
        <span class="w">${r.outTime?fmtDur(workedMin(r)):''}</span></div>`);
    }
  }
  $('#tc-hist').innerHTML = rows.length ? rows.reverse().join('')
    : '<div class="note" style="text-align:center;padding:10px">この期間の打刻はまだありません</div>';
  $('#btn-punch-in').onclick=()=>{ store.setPunch(todayK,name,{inTime:Date.now(),outTime:0});
    toast('出勤しました。いってらっしゃい！'); };
  $('#btn-punch-out').onclick=()=>{ store.setPunch(todayK,name,{outTime:Date.now()});
    toast('退勤しました。お疲れさまでした！'); };
}

function renderTimecardAll(){
  $('#tc-label').textContent=tcPeriodInfo().label+' 分';
  const names=new Set();
  for(const k of tcPeriodDates()) for(const n of Object.keys(state.timecards[k]||{})) names.add(n);
  const body=$('#tc-all-body');
  if(!names.size){ body.innerHTML='<div class="empty">この期間の打刻はまだありません</div>'; return; }
  let html='<div class="export-bar"><button id="export-timecards">📥 この期間の勤怠をCSVで書き出し</button></div>';
  for(const n of [...names].sort()){
    let days='';
    for(const k of tcPeriodDates()){
      const r=(state.timecards[k]||{})[n];
      if(r&&r.inTime){ const p=k.split('-').map(Number);
        days+=`${p[1]}/${p[2]} ${fmtTime(r.inTime)}〜${r.outTime?fmtTime(r.outTime):'勤務中'}${r.outTime?`（${fmtDur(workedMin(r))}）`:''}<br>`; }
    }
    html+=`<div class="tc-person">
      <div class="tc-person-head"><span>👤 ${esc(n)}</span>
        <span class="tc-person-total">合計 ${fmtDur(periodTotalFor(n))}</span></div>
      <div class="tc-person-days">${days||'<span class="note">打刻なし</span>'}</div></div>`;
  }
  body.innerHTML=html;
  const et=$('#export-timecards'); if(et) et.onclick=exportTimecardsCSV;
}
/* ---------------- トーク（全体グループ＋1:1） ---------------- */
const CH_ALL='全体';
const US=String.fromCharCode(31);   // dmChannel() が名前をつなぐ区切り文字
function channelInvolves(ch, me){ return ch===CH_ALL || (ch.startsWith('dm:') && ch.slice(3).split(US).includes(me)); }
function channelOther(ch, me){ if(ch===CH_ALL) return null; const ns=ch.slice(3).split(US); return ns[0]===me?ns[1]:ns[0]; }
/* トークできる相手 = 登録メンバー（管理者が管理）。メンバー情報がまだ無いときだけ、過去の発言者から補う */
function knownUsers(){
  const s=new Set(Object.keys(state.accounts));
  if(!s.size){
    state.reports.forEach(r=>s.add(r.author));
    state.messages.forEach(m=>s.add(m.from));
  }
  if(state.user) s.delete(state.user.name);
  return [...s].filter(Boolean).sort();
}
/* 管理者・スタッフ全員（シフト登録の選択肢に使う）。自分も含む */
function allMembers(){ const s=new Set(Object.keys(state.accounts)); if(state.user) s.add(state.user.name); return [...s].sort(); }
function channelMessages(ch){ return state.messages.filter(m=>m.channel===ch).sort((a,b)=>a.ts-b.ts); }
function unreadCount(ch){ const me=state.user.name, last=state.lastRead[ch]||0;
  return state.messages.filter(m=>m.channel===ch && m.from!==me && m.ts>last).length; }
function totalUnread(){ const me=state.user.name; const chans=new Set([CH_ALL]);
  state.messages.forEach(m=>{ if(channelInvolves(m.channel,me)) chans.add(m.channel); });
  let n=0; chans.forEach(ch=>n+=unreadCount(ch)); return n; }
function loadLastRead(){ try{ state.lastRead=JSON.parse(safeStorage.get('mgk_read_'+state.user.name)||'{}'); }catch(e){ state.lastRead={}; } }
function saveLastRead(){ safeStorage.set('mgk_read_'+state.user.name, JSON.stringify(state.lastRead)); }
/* 開いたトークを既読にする（未読数は端末ごと、「既読◯人」は各メッセージの readBy に記録） */
function markRead(ch){ const me=state.user.name, msgs=channelMessages(ch);
  state.lastRead[ch]=msgs.length?msgs[msgs.length-1].ts:Date.now(); saveLastRead();
  if(document.hidden) return;
  const ids=msgs.filter(m=>m.from!==me && !(m.readBy||[]).includes(me)).map(m=>m.id);
  if(ids.length) store.markMessagesRead(ids, me); }
function updateChatBadge(){ if(!state.user) return;
  const n=totalUnread(); const b=$('#chat-badge'); b.hidden=(n===0); b.textContent=n>99?'99+':n; }
function convTime(ts){
  const k=dateKey(ts); if(k===dateKey(Date.now())) return fmtTime(ts);
  const y=new Date(); y.setDate(y.getDate()-1); if(k===dateKey(y.getTime())) return '昨日';
  const d=new Date(ts); return (d.getMonth()+1)+'/'+d.getDate(); }
const msgPreview = m => m.photoId ? '写真を送信しました' : m.fileId ? 'ファイルを送信しました' : (m.text||'');

function openChat(){ showView('chat'); }
function renderChat(){
  const inThread=!!state.chatChannel;
  $('#chat-list-wrap').hidden=inThread;
  $('#chat-thread-wrap').hidden=!inThread;
  document.body.classList.toggle('thread', inThread && !$('#view-chat').hidden);
  updateNotifyBar();
  if(inThread) renderChatThread(); else renderChatList();
}
function renderChatList(){
  const me=state.user.name;
  const rowFor=(ch,name,ava)=>{
    const msgs=channelMessages(ch), last=msgs[msgs.length-1], un=unreadCount(ch);
    const preview=last?((last.from===me?'自分: ':(ch===CH_ALL?last.from+': ':''))+msgPreview(last)):'メッセージはまだありません';
    return `<button class="conv" data-ch="${esc(ch)}">
      ${ava}
      <span class="conv-body"><span class="conv-name">${esc(name)}</span>
        <span class="conv-last">${esc(preview)}</span></span>
      <span class="conv-meta">${last?`<span class="conv-time">${convTime(last.ts)}</span>`:''}${un?`<span class="conv-unread" aria-label="未読${un}件">${un}</span>`:''}</span>
    </button>`;
  };
  // 新しいメッセージの順。まだ会話がない相手は下にまとめる
  const rows=[{ch:CH_ALL, name:'全体（みんな）', ava:`<span class="ava all">${icon('users')}</span>`}];
  knownUsers().forEach(u=>rows.push({ch:dmChannel(me,u), name:u, ava:avatar(u)}));
  rows.forEach(r=>{ const m=channelMessages(r.ch); r.last=m.length?m[m.length-1].ts:0; });
  const withMsg=rows.filter(r=>r.last).sort((a,b)=>b.last-a.last), without=rows.filter(r=>!r.last);
  let html=withMsg.map(r=>rowFor(r.ch,r.name,r.ava)).join('');
  if(without.length) html+='<div class="chat-sec">まだトークしていないメンバー</div>'+without.map(r=>rowFor(r.ch,r.name,r.ava)).join('');
  if(!knownUsers().length) html+='<div class="note" style="padding:6px 2px">まだ他のメンバーがいません。管理者がメンバーを追加すると、ここから1対1でトークできます。</div>';
  const el=$('#chat-list'); el.innerHTML=html;
  el.querySelectorAll('.conv').forEach(b=>b.onclick=()=>openChannel(b.dataset.ch));
}
function openChannel(ch){ state.chatChannel=ch; markRead(ch); updateChatBadge(); renderChat();
  window.scrollTo(0,document.body.scrollHeight); }
function closeChannel(){ state.chatChannel=null; $('#attach-menu').hidden=true; renderChat(); window.scrollTo(0,0); }

function bubbleHTML(m){
  if(m.photoId) return `<div class="bubble media"><img src="${m.photoThumb||''}" data-photo="${esc(m.photoId)}" alt="送信された写真"></div>`;
  if(m.fileId) return `<button class="bubble file" data-file="${esc(m.fileId)}" data-name="${esc(m.fileName||'ファイル')}">
      ${icon('file')}<span><span class="fn">${esc(m.fileName||'ファイル')}</span><br><span class="fs">${esc(fmtSize(m.fileSize))}　タップで保存</span></span></button>`;
  return `<div class="bubble">${esc(m.text)}</div>`;
}
const fmtSize = n => !n ? '' : n>=1048576 ? (n/1048576).toFixed(1)+'MB' : Math.max(1,Math.round(n/1024))+'KB';

function renderChatThread(){
  const me=state.user.name, ch=state.chatChannel;
  $('#chat-title').textContent = ch===CH_ALL ? '全体（みんな）' : channelOther(ch,me);
  const msgs=channelMessages(ch);
  let html='', lastDay='';
  for(const m of msgs){
    const dk=dateKey(m.ts);
    if(dk!==lastDay){ html+=`<div class="msg-day">${fmtDateLabel(dk)}</div>`; lastDay=dk; }
    const mine=m.from===me;
    if(mine){
      // 既読：個人は「既読」、グループは「既読3」のように人数
      const n=(m.readBy||[]).filter(x=>x!==me).length;
      const rd=n ? (ch===CH_ALL ? '既読'+n : '既読') : '';
      html+=`<div class="msg-row me"><div class="msg-col">${bubbleHTML(m)}</div>
        <div class="msg-meta">${rd?`<span class="rd">${rd}</span>`:''}<span>${fmtTime(m.ts)}</span></div></div>`;
    }else{
      html+=`<div class="msg-row them">${avatar(m.from,true)}<div class="msg-col">
        ${ch===CH_ALL?`<span class="m-name">${esc(m.from)}</span>`:''}${bubbleHTML(m)}</div>
        <div class="msg-meta"><span>${fmtTime(m.ts)}</span></div></div>`;
    }
  }
  const box=$('#chat-msgs');
  box.innerHTML = html || '<div class="empty">まだメッセージはありません。<br>下の欄から送ってみましょう。</div>';
  attachPhotoHandlers(box);
  box.querySelectorAll('.bubble.file').forEach(b=>b.onclick=()=>downloadChatFile(b.dataset.file,b.dataset.name));
  markRead(ch); updateChatBadge();
  requestAnimationFrame(()=>window.scrollTo(0,document.body.scrollHeight));
}
async function downloadChatFile(id,name){
  try{ const data=await store.getImage(id);
    if(!data){ toast('ファイルが見つかりません。送った人に送り直してもらってください'); return; }
    const a=document.createElement('a'); a.href=data; a.download=name;
    document.body.appendChild(a); a.click(); a.remove();
  }catch(e){ toast('ファイルを保存できませんでした。通信を確認してもう一度お試しください'); }
}
function sendChatMessage(extra){
  const inp=$('#chat-text'); const text=extra?'':inp.value.trim();
  if(!extra && !text) return;
  store.addMessage(Object.assign({channel:state.chatChannel, from:state.user.name, text, ts:Date.now(),
    readBy:[state.user.name]}, extra||{}));
  if(!extra){ inp.value=''; autosizeChatInput(); inp.focus(); }
}
function autosizeChatInput(){ const t=$('#chat-text'); t.style.height='auto';
  t.style.height=Math.min(t.scrollHeight,110)+'px'; $('#chat-send').disabled=!t.value.trim(); }

/* 写真・ファイルの送信
   仮仕様: 画像・ファイルは Firestore の images に base64 で保存する（Firebase Storage は使わない）。
   1ドキュメント1MBの制限があるため、ファイルは600KBまで。 */
const CHAT_FILE_MAX=600*1024;
async function sendChatPhoto(file){
  try{
    const p=await processPhoto(file);
    const id=await store.addImage(p.full);
    sendChatMessage({photoId:id, photoThumb:p.thumb});
  }catch(e){ toast('写真を送れませんでした。別の写真で試すか、通信を確認してください'); }
}
async function sendChatFile(file){
  if(file.size>CHAT_FILE_MAX){ toast('ファイルが大きすぎます（'+fmtSize(CHAT_FILE_MAX)+'まで）。小さくしてから送ってください'); return; }
  try{
    const data=await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); });
    const id=await store.addImage(data);
    sendChatMessage({fileId:id, fileName:file.name, fileSize:file.size});
  }catch(e){ toast('ファイルを送れませんでした。通信を確認してもう一度お試しください'); }
}

/* ---------------- 通知（かんたん版・追加費用なし） ---------------- */
function notifySupported(){ return 'Notification' in window; }
function updateNotifyBar(){ const bar=$('#notify-bar');
  bar.hidden = !(notifySupported() && Notification.permission==='default'); }
function requestNotify(){
  if(!notifySupported()){ toast('この端末は通知に対応していません'); return; }
  Notification.requestPermission().then(p=>{ updateNotifyBar();
    toast(p==='granted'?'通知をオンにしました 🔔':'通知は許可されませんでした'); });
}
let audioCtx=null;
function beep(){ try{ audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
  const o=audioCtx.createOscillator(), g=audioCtx.createGain(); o.connect(g); g.connect(audioCtx.destination);
  o.type='sine'; o.frequency.value=880;
  g.gain.setValueAtTime(.0001,audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(.18,audioCtx.currentTime+.02);
  g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+.35);
  o.start(); o.stop(audioCtx.currentTime+.37); }catch(e){} }
function fireNotification(title, body){
  beep();
  try{
    if(notifySupported() && Notification.permission==='granted' && document.hidden)
      new Notification(title,{body, icon:'icon-192.png', tag:'mgk-chat'});
    else toast('💬 '+title+'：'+body);
  }catch(e){ toast('💬 '+title); }
}
function messagesUpdated(list){
  const me = state.user && state.user.name;
  state.messages=[...list].sort((a,b)=>a.ts-b.ts);
  if(!me){ return; }
  const fresh=state.messages.filter(m=> m.ts>state.lastMsgSeenTs && m.from!==me && channelInvolves(m.channel,me));
  if(fresh.length){
    state.lastMsgSeenTs=Math.max(state.lastMsgSeenTs, ...fresh.map(m=>m.ts));
    // いま見ているスレッド（かつ画面が見えている）以外の新着だけ通知
    const notes=fresh.filter(m=> !(!$('#view-chat').hidden && state.chatChannel===m.channel && !document.hidden));
    if(notes.length){ const m=notes[notes.length-1];
      fireNotification(m.channel===CH_ALL?m.from+'（全体）':m.from, m.text); }
  }
  updateChatBadge();
  if(!$('#view-chat').hidden) renderChat();
}
/* ---------------- 報告フォーム ---------------- */
const FORM_DEFS = {
  absent:{ customer:true,
    selects:[{id:'f-d1',label:'対応',opts:['保冷箱対応','持ち戻り','再配達します']}],
    memoPh:'例：施錠・声かけしたが応答なし　など' },
  cancel:{ customer:true,
    selects:[{id:'f-d1',label:'期間',opts:['明日のみキャンセル','指定日のみキャンセル','本日で終了','来週から中止','しばらく中止']},
             {id:'f-d2',label:'対象',opts:['昼夜','昼のみ','夜のみ']}],
    date:true,
    memoPh:'例：明日お金を払いたいとのこと　など' },
  change:{ customer:true,
    text:{id:'f-d1',label:'変更・依頼の内容',ph:'例：来週月曜は帰りが遅いので保冷箱でお願いしたい'},
    memoPh:'補足があれば' },
  money:{ customer:true,
    selects:[{id:'f-d1',label:'状況',opts:['集金済み（消し込み済み）','集金済み（未消し込み）','お客様が支払い希望','請求書渡し済み','QR送信お願いします']}],
    memoPh:'補足があれば' },
  trial:{ customer:true,
    selects:[{id:'f-d1',label:'ナビ',opts:['ナビ通りでOK','ナビと違う（メモに記入）']},
             {id:'f-d2',label:'表札',opts:['表札あり','表札なし']}],
    memoPh:'在宅時間・今後の予定など' },
  done:{ customer:false, memoPh:'補足があれば（例：このあと給油に行きます）' },
  other:{ customer:false,
    text:{id:'f-d1',label:'件名',ph:'例：弁当が足りない／オイルランプ点灯'},
    memoPh:'詳しい内容（何個足りない・どの車両など）', memoReq:true },
};

function buildCatGrid(){
  $('#cat-grid').innerHTML = Object.entries(CATS).map(([k,c])=>
    `<button type="button" class="cat-btn${state.composeCat===k?' on':''}" data-v="${k}"
       style="border-top-color:${c.color}"><span class="ci">${c.icon}</span>${c.label}</button>`).join('');
  $$('#cat-grid .cat-btn').forEach(b=>b.onclick=()=>selectCat(b.dataset.v));
}

function selectCat(cat){
  state.composeCat=cat; buildCatGrid();
  const def=FORM_DEFS[cat], c=CATS[cat];
  $('#form-cat-label').textContent=c.icon+' '+c.label;
  let html=`<label>ルート</label><select id="f-route">${
    ROUTES.map(r=>`<option value="${r}"${r===state.user.route?' selected':''}>${routeLabel(r)}</option>`).join('')}</select>`;
  if(def.customer) html+=`<label>お客様のお名前</label><input id="f-customer" autocomplete="off">`;
  (def.selects||[]).forEach(s=>{
    html+=`<label>${s.label}</label><select id="${s.id}">${s.opts.map(o=>`<option>${o}</option>`).join('')}</select>`; });
  if(def.date) html+=`<label>対象日・開始日（わかれば）</label><input type="date" id="f-date">`;
  if(def.text) html+=`<label>${def.text.label}</label><input id="${def.text.id}" placeholder="${def.text.ph}" autocomplete="off">`;
  html+=`<label>メモ${def.memoReq?'':'（任意）'}</label><textarea id="f-memo" rows="2" placeholder="${def.memoPh}"></textarea>`;
  html+=`<label>写真（任意）</label><input type="file" id="f-photo" accept="image/*">
    <div id="photo-preview" hidden></div>`;
  $('#form-fields').innerHTML=html;
  state.pendingPhoto=null;
  $('#f-photo').onchange=async e=>{
    const f=e.target.files && e.target.files[0];
    if(!f) return;
    try{
      state.pendingPhoto=await processPhoto(f);
      const pv=$('#photo-preview');
      pv.hidden=false;
      pv.innerHTML=`<img src="${state.pendingPhoto.thumb}" alt="プレビュー">
        <button type="button" id="photo-remove">✕ 削除</button>`;
      $('#photo-remove').onclick=()=>{ state.pendingPhoto=null; pv.hidden=true; pv.innerHTML=''; $('#f-photo').value=''; };
    }catch(err){ toast('画像を読み込めませんでした'); $('#f-photo').value=''; }
  };
  $('#form-action-note').textContent = cat==='done'
    ? '' : '※ この報告は自動で「要対応リスト」に入ります';
  $('#report-form').hidden=false;
  $('#report-form').scrollIntoView({behavior:'smooth',block:'start'});
}

function fmtJPDate(v){ if(!v) return ''; const [y,m,d]=v.split('-'); return Number(m)+'/'+Number(d); }

/* 写真をスマホでも軽い形に自動圧縮（サムネ＋拡大用） */
async function processPhoto(file){
  const url=URL.createObjectURL(file);
  const img=new Image();
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=url; });
  const make=(maxW,q)=>{
    const sc=Math.min(1, maxW/Math.max(img.width,img.height));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(img.width*sc));
    c.height=Math.max(1,Math.round(img.height*sc));
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',q);
  };
  let full=make(1080,.6);
  if(full.length>700000) full=make(800,.5);
  if(full.length>700000) full=make(640,.4);
  const thumb=make(240,.6);
  URL.revokeObjectURL(url);
  return {thumb, full};
}

async function submitReport(e){
  e.preventDefault();
  const cat=state.composeCat; if(!cat) return;
  const def=FORM_DEFS[cat];
  const val=id=>{ const el=document.getElementById(id); return el?el.value.trim():''; };
  const customer=val('f-customer');
  if(def.customer && !customer){ toast('お客様のお名前を入力してください'); return; }
  if(def.text && def.memoReq===undefined && cat==='change' && !val('f-d1')){ toast('変更・依頼の内容を入力してください'); return; }
  if(cat==='other' && !val('f-d1')){ toast('件名を入力してください'); return; }
  const memo=val('f-memo');
  if(def.memoReq && !memo){ toast('内容を入力してください'); return; }
  let detail='';
  if(cat==='absent') detail=val('f-d1');
  else if(cat==='cancel'){
    detail=val('f-d1'); const d=fmtJPDate(val('f-date'));
    if(d) detail+=`（${d}〜）`; detail+=`（${val('f-d2')}）`;
  }
  else if(cat==='change') detail=val('f-d1');
  else if(cat==='money') detail=val('f-d1');
  else if(cat==='trial') detail=val('f-d1')+'／'+val('f-d2');
  else if(cat==='done') detail='配達完了';
  else if(cat==='other') detail=val('f-d1');
  let photoThumb='', photoId='';
  if(state.pendingPhoto){
    try{ photoId=await store.addImage(state.pendingPhoto.full);
      photoThumb=state.pendingPhoto.thumb; }
    catch(err){ toast('画像の送信に失敗しました：'+(err.message||'')); return; }
  }
  store.addReport({ ts:Date.now(), author:state.user.name, route:val('f-route'),
    cat, customer, detail, memo, photoThumb, photoId,
    needsAction:cat!=='done', done:false, doneBy:'', doneAt:0 });
  toast('報告を送信しました ✓');
  state.pendingPhoto=null;
  state.composeCat=null; $('#report-form').hidden=true; buildCatGrid();
  showView('timeline');
}

/* ---------------- 画面切り替え ---------------- */
const VIEWS=['chat','shift','timeline','compose','todo','timecard','members'];
const NAV_OF={compose:'timeline', members:'timecard'};   // 下のタブで強調する項目
function showView(name){
  // 要対応・メンバー管理は管理者だけ
  if((name==='todo'||name==='members') && !isAdmin()) name='chat';
  VIEWS.forEach(v=>$('#view-'+v).hidden=(v!==name));
  const navKey=NAV_OF[name]||name;
  $$('nav button').forEach(b=>b.classList.toggle('on',b.dataset.view===navKey));
  $('#attach-menu').hidden=true;
  if(name==='chat'){ state.chatChannel=null; renderChat(); }
  else document.body.classList.remove('thread');
  if(name==='timeline' && !state.fSearch && state.fRoute==='all' && state.fCat==='all')
    requestAnimationFrame(()=>window.scrollTo(0,document.body.scrollHeight));
  else window.scrollTo(0,0);
  if(name==='shift') renderShiftTab();
  if(name==='todo') renderTodo();
  if(name==='timecard') renderTimecard();
  if(name==='members') renderMembers();
}

/* ---------------- データ更新コールバック ---------------- */
function reportsUpdated(list){
  state.reports=[...list].sort((a,b)=>a.ts-b.ts);
  if(state.user){ renderTimeline(); renderTodo(); updateBadge(); }
}
function shiftsUpdated(map){ state.shifts=map;
  if(state.user && !$('#view-shift').hidden) renderShiftTab(); }
function confirmedUpdated(map,days){ state.confirmed=map; state.days=days||{};
  if(state.user && !$('#view-shift').hidden) renderShiftTab();
  if(state.user && $('#sheet-host').firstChild) refreshDaySheet(); }
function accountsUpdated(map){ state.accounts=map;
  if(!state.user) return;
  // 管理者にメンバーを削除されたら、この端末もログアウトする
  if(Object.keys(map).length && !map[state.user.name]){ logout('このアカウントは削除されました。管理者に確認してください'); return; }
  if(!$('#view-members').hidden) renderMembers();
  if(!$('#view-chat').hidden && !state.chatChannel) renderChatList(); }
function timecardsUpdated(map){ state.timecards=map;
  if(state.user && !$('#view-timecard').hidden) renderTimecard(); }
function commentsUpdated(map){ state.comments=map;
  if(state.user && !$('#view-timeline').hidden) renderTimeline(); }
function announcementsUpdated(list){ state.announcements=[...list].sort((a,b)=>a.ts-b.ts);
  if(state.user && !$('#view-timeline').hidden) renderTimeline(); }

/* ---------------- ログイン ---------------- */
function segInit(id){
  const seg=document.getElementById(id);
  seg.querySelectorAll('button').forEach(b=>b.onclick=()=>{
    seg.querySelectorAll('button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on'); });
}
const segVal = id => document.querySelector('#'+id+' button.on').dataset.v;

function showApp(){
  $('#login').hidden=true; $('#app').hidden=false;
  $('#btn-user').textContent=state.user.name+(isAdmin()?'（管理者）':'');
  $('#mode-badge').textContent = MODE==='online' ? '' : 'デモ';
  $('#menu-members').hidden=!isAdmin();
  $('#nav-todo').hidden=!isAdmin();   // 要対応タブは管理者だけ
  state.csMode='me'; state.csPeriod=initTcPeriod(); state.shiftTop='confirmed';
  $('#shift-mode').hidden=!isAdmin();
  state.shiftMode='edit'; state.shiftSelPeriod=null; state.selDate=null;
  $$('#shift-mode button').forEach(b=>b.classList.toggle('on',b.dataset.v==='edit'));
  state.tcMode='me'; state.tcPeriod=initTcPeriod();
  $$('#tc-mode button').forEach(b=>b.classList.toggle('on',b.dataset.v==='me'));
  $('#todo-note').textContent = isAdmin()
    ? '配達完了以外の報告は自動でここに入ります。エクセルに反映したら「済」を押してください。'
    : '配達完了以外の報告は自動でここに入ります。「済」の処理（消し込み）は管理者が行います。';
  state.fSearch=''; state.fPerson='all'; state.fDate=''; state.fRoute='all'; state.fCat='all'; state.openComments=null;
  $('#search-input').value=''; $('#search-wrap').classList.remove('active'); $('#adv-panel').hidden=true;
  buildFilterChips(); buildCatGrid();
  $('#todo-seg').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    $('#todo-seg').querySelectorAll('button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on'); state.todoTab=b.dataset.v; renderTodo(); });
  // トーク
  state.chatChannel=null; loadLastRead(); updateChatBadge();
  renderTimeline(); renderTodo(); updateBadge();
  showView('chat');
}
function logout(msg){
  state.user=null; safeStorage.del('mgk_user'); document.body.classList.remove('thread');
  $('#app').hidden=true; $('#login').hidden=false; $('#sheet-host').innerHTML='';
  toast(msg||'ログアウトしました');
}

function init(){
  state.lastMsgSeenTs=Date.now();  // これより新しいメッセージだけ通知（起動時の既存分は鳴らさない）
  segInit('mem-role'); segInit('login-route');
  $('#mode-note').textContent = MODE==='online'
    ? 'スタッフの登録は管理者が行います。名前と暗証番号は管理者から聞いてください。'
    : 'デモ体験版です。データはこの端末の中だけです。管理者は「原田」、スタッフは「Homa」など、暗証番号はどれも 1234 です。';
  // ログイン／新規登録タブ
  // 仮仕様: スタッフの追加は管理者が行う（メンバー管理）。この画面の新規登録は、最初の管理者を登録するためだけに残す。
  const loginTab = () => segVal('login-tab');
  const refreshLoginUI = () => {
    const reg = loginTab()==='register';
    $('#reg-wrap').hidden = !reg;
    $('#login-go').textContent = reg ? '管理者として登録' : 'ログイン';
  };
  segInit('login-tab');
  $$('#login-tab button').forEach(b=>b.addEventListener('click',refreshLoginUI));
  // 保存されたログイン状態があれば復元
  const saved=safeStorage.get('mgk_user');
  if(saved){ try{ state.user=JSON.parse(saved); }catch(e){} }
  if(state.user && state.user.route==='他') state.user.route='厨房';
  if(state.user && state.user.auth && state.user.name){
    $('#login-name').value=state.user.name; showApp();
  }else{
    state.user=null;   // 旧形式の保存データは無効化（アカウント登録が必要）
  }
  $('#login-go').onclick=async ()=>{
    const name=$('#login-name').value.trim();
    const pin=$('#login-pw').value.trim();
    if(!name){ toast('お名前を入力してください'); return; }
    if(!/^\d{4,8}$/.test(pin)){ toast('暗証番号は4〜8桁の数字にしてください'); return; }
    const route=segVal('login-route');
    try{
      if(loginTab()==='register'){
        const role='admin';
        if($('#login-pin').value!==ADMIN_CODE){
          toast('管理者コードが違います。管理者に確認してください'); return;
        }
        await store.createAccount({ name, pinHash:hashPin(name,pin), role, createdAt:Date.now() });
        state.user={ name, role, route, auth:true };
        toast('登録しました。ようこそ！');
      }else{
        const acc=await store.getAccount(name);
        if(!acc){ toast('この名前は登録されていません。管理者に追加してもらってください'); return; }
        if(acc.pinHash!==hashPin(name,pin)){ toast('暗証番号が違います'); return; }
        state.user={ name, role:acc.role, route, auth:true };
      }
      safeStorage.set('mgk_user', JSON.stringify(state.user));
      $('#login-pw').value='';
      showApp();
    }catch(e){ toast(e.message||'エラーが発生しました'); }
  };
  $('#btn-user').onclick=()=>{ if(confirm('ログアウトしますか？')) logout('ログアウトしました'); };
  // アプリ起動と同時にデータ接続（ログイン前でも接続だけ済ませておく）
  store.init({reports:reportsUpdated, shifts:shiftsUpdated, timecards:timecardsUpdated, comments:commentsUpdated,
      announcements:announcementsUpdated, messages:messagesUpdated, accounts:accountsUpdated, confirmed:confirmedUpdated})
    .catch(e=>toast('接続エラー：'+e.message));
  $$('nav button').forEach(b=>b.onclick=()=>showView(b.dataset.view));
  $$('[data-go]').forEach(b=>b.onclick=()=>showView(b.dataset.go));
  $('#btn-new-report').onclick=()=>showView('compose');
  $('#compose-back').onclick=()=>showView('timeline');
  // トーク
  $('#chat-back').onclick=closeChannel;
  $('#chat-send').onclick=()=>sendChatMessage();
  // 改行はそのまま入力、送信は送信ボタン（パソコンでは Ctrl+Enter でも送れる）
  $('#chat-text').oninput=autosizeChatInput;
  $('#chat-text').onkeydown=e=>{ if(e.key==='Enter' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); sendChatMessage(); } };
  $('#chat-attach').onclick=()=>{ const m=$('#attach-menu'); m.hidden=!m.hidden; };
  $('#attach-photo').onclick=()=>{ $('#attach-menu').hidden=true; $('#chat-photo').click(); };
  $('#attach-file').onclick=()=>{ $('#attach-menu').hidden=true; $('#chat-file').click(); };
  $('#chat-photo').onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if(f) sendChatPhoto(f); };
  $('#chat-file').onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if(f) sendChatFile(f); };
  $('#notify-on').onclick=requestNotify;
  // 確定シフト
  initShiftUI();
  initMembersUI();
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden && !$('#view-chat').hidden && state.chatChannel){ markRead(state.chatChannel); updateChatBadge(); } });
  // 検索
  const doSearch=()=>{ state.fSearch=$('#search-input').value;
    $('#search-wrap').classList.toggle('active', !!state.fSearch); renderTimeline(); };
  $('#search-input').oninput=doSearch;
  $('#search-clear').onclick=()=>{ $('#search-input').value=''; state.fSearch='';
    $('#search-wrap').classList.remove('active'); renderTimeline(); $('#search-input').focus(); };
  // 詳しく絞り込む（報告した人・日付）
  $('#adv-btn').onclick=()=>{ const p=$('#adv-panel'); p.hidden=!p.hidden; };
  $('#f-person').onchange=()=>{ state.fPerson=$('#f-person').value; renderTimeline(); };
  $('#f-date-input').onchange=()=>{ state.fDate=$('#f-date-input').value; renderTimeline(); };
  $$('#adv-panel .adv-date .chip').forEach(b=>b.onclick=()=>{
    const d=new Date(); if(b.dataset.quick==='yesterday') d.setDate(d.getDate()-1);
    state.fDate=dateKey(d.getTime()); renderTimeline(); });
  $('#adv-clear').onclick=()=>{ state.fPerson='all'; state.fDate=''; renderTimeline(); };
  // タイムカード
  $$('#tc-mode button').forEach(b=>b.onclick=()=>{
    $$('#tc-mode button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on'); state.tcMode=b.dataset.v; renderTimecard(); });
  $('#tc-prev').onclick=()=>{ const p=state.tcPeriod; p.m--; if(p.m<0){p.m=11;p.y--;} renderTimecard(); };
  $('#tc-next').onclick=()=>{ const p=state.tcPeriod; p.m++; if(p.m>11){p.m=0;p.y++;} renderTimecard(); };
  $('#tc-today').onclick=()=>{ state.tcPeriod=initTcPeriod(); renderTimecard(); };
  $('#cal-prev').onclick=()=>{ const p=state.period; p.m--; if(p.m<0){p.m=11;p.y--;}
    state.selDate=null; renderShift(); };
  $('#cal-next').onclick=()=>{ const p=state.period; p.m++; if(p.m>11){p.m=0;p.y++;}
    state.selDate=null; renderShift(); };
  $('#photo-viewer').onclick=()=>{ $('#photo-viewer').hidden=true; };
  $('#btn-cal-today').onclick=()=>{ state.period=initPeriod(); state.selDate=null; renderShift(); };
  $('#btn-shift-send').onclick=sendShift;
  $$('#shift-mode button').forEach(b=>b.onclick=()=>{
    $$('#shift-mode button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on'); state.shiftMode=b.dataset.v; state.selDate=null; renderShift(); });
  $('#report-form').onsubmit=submitReport;
  $('#btn-back-cat').onclick=()=>{ state.composeCat=null; state.pendingPhoto=null;
    $('#report-form').hidden=true; buildCatGrid(); };
  $('#photo-viewer').onclick=()=>{ $('#photo-viewer').hidden=true; };
}

/* ---------------- 確定シフト（見る）と管理者の登録 ----------------
   仮仕様: 確定シフトは管理者がこのアプリで手入力する（既存のシフトアプリからの取り込みは店長に要確認）。
   データは「日付・名前・業務（配達／厨房／管理）・区分（終日／午前／午後）」。 */
function renderShiftTab(){
  const avail = state.shiftTop==='avail';
  $$('#shift-top button').forEach(b=>b.classList.toggle('on', b.dataset.v===state.shiftTop));
  $('#pane-confirmed').hidden=avail; $('#pane-avail').hidden=!avail;
  if(avail) renderShift(); else renderConfirmed();
}
const assignmentsOf = key => state.confirmed[key]||[];
const slotTag = slot => slot==='終日' ? '' : `<span class="slot-tag">${slot}のみ</span>`;
const dutyTag = (duty,slot) => `<span class="duty-tag" style="--dc:${DUTIES[duty]?DUTIES[duty].color:'#66726D'}">${esc(duty)}</span>${slotTag(slot)}`;
function dayParts(key){ const [y,m,d]=key.split('-').map(Number); const g=new Date(y,m-1,d).getDay();
  return {m,d,wd:WDAYS[g],g}; }
const wdSpan = p => `<span class="wd${p.g===0?' sun':p.g===6?' sat':''}">${p.wd}</span>`;

function renderConfirmed(){
  const me=state.user.name, mode=state.csMode;
  $$('#cs-mode button').forEach(b=>b.classList.toggle('on', b.dataset.v===mode));
  $('#cs-label').textContent=labelOfPeriod(state.csPeriod)+' 分';
  const body=$('#cs-body');
  body.innerHTML = mode==='me' ? myShiftHTML(me) : mode==='day' ? dayShiftHTML(me) : personShiftHTML(me);
  if(isAdmin()) body.querySelectorAll('.bento[data-day]').forEach(b=>{
    b.onclick=()=>openDaySheet(b.dataset.day);
    b.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openDaySheet(b.dataset.day); } };
  });
  if(mode==='day' && state.csScroll){ state.csScroll=false;
    const t=body.querySelector('.bento.today'); if(t) requestAnimationFrame(()=>t.scrollIntoView({block:'center'})); }
}

/* 自分：次の出勤日を一番上に */
function myShiftHTML(me){
  const todayK=dateKey(Date.now());
  const upcoming=Object.keys(state.confirmed).filter(k=>k>=todayK && assignmentsOf(k).some(a=>a.name===me)).sort()[0];
  let hero;
  if(upcoming){ const p=dayParts(upcoming), mine=assignmentsOf(upcoming).filter(a=>a.name===me);
    hero=`<div class="next-card"><div class="nl">${upcoming===todayK?'今日の出勤':'次の出勤'}</div>
      <div class="nd">${p.m}月${p.d}日<small>${p.wd}曜日</small></div>
      <div>${mine.map(a=>dutyTag(a.duty,a.slot)).join(' ')}</div></div>`;
  }else hero=`<div class="next-card none"><div class="nl">次の出勤</div><div class="nd">登録されている出勤日はありません</div></div>`;
  const rows=[];
  datesOfPeriod(state.csPeriod).forEach(k=>{ const mine=assignmentsOf(k).filter(a=>a.name===me); if(mine.length) rows.push({k,mine}); });
  const rowHTML=r=>{ const p=dayParts(r.k);
    return `<div class="my-row${r.k<todayK?' past':''}${r.k===todayK?' today':''}"><div class="md">${p.m}/${p.d}${wdSpan(p)}</div>
      <div>${r.mine.map(a=>dutyTag(a.duty,a.slot)).join(' ')}</div></div>`; };
  const up=rows.filter(r=>r.k>=todayK), past=rows.filter(r=>r.k<todayK);
  let html=hero+`<div class="stat-line">この期間の出勤：${rows.length}日</div>`;
  if(!rows.length) return html+'<div class="empty">この期間のシフトはまだ登録されていません。<br>管理者が登録すると、ここに表示されます。</div>';
  html+=`<div class="my-list">${up.map(rowHTML).join('')}</div>`;
  if(past.length) html+=`<div class="chat-sec">過ぎた日</div><div class="my-list">${past.reverse().map(rowHTML).join('')}</div>`;
  return html;
}

/* 日ごと：お弁当箱のように、業務ごとの区画に分けて表示 */
function dayShiftHTML(me){
  const todayK=dateKey(Date.now()), admin=isAdmin();
  const noData=!datesOfPeriod(state.csPeriod).some(k=>assignmentsOf(k).length);
  let html='';
  if(noData) html+=`<div class="empty" style="padding:18px 10px">この期間のシフトはまだ登録されていません。${admin?'<br>日をタップして登録できます。':''}</div>`;
  html+='<div class="bento-list">';
  for(const k of datesOfPeriod(state.csPeriod)){
    const p=dayParts(k), training=!!(state.days[k]&&state.days[k].training), list=assignmentsOf(k);
    const cpt=duty=>{
      const d=DUTIES[duty], names=list.filter(a=>a.duty===duty), need=dutyNeed(duty,training);
      const filled=names.map(a=>`<span class="slot${a.name===me?' me':''}">${esc(a.name)}${slotTag(a.slot)}</span>`);
      const empties=[]; for(let i=names.length;i<need;i++) empties.push('<span class="slot empty">空き</span>');
      const short=need-names.length;
      const head=need ? `<span class="need">${names.length}/${need}人${short>0?` <span class="short">あと${short}人</span>`:''}</span>` : '';
      const inner = (filled.length||empties.length) ? filled.join('')+empties.join('') : '<span class="none">なし</span>';
      return `<div class="cpt ${d.cls}" style="--dc:${d.color}"><div class="cpt-title">${duty}${head}</div><div class="slots">${inner}</div></div>`;
    };
    html+=`<div class="bento${k===todayK?' today':''}" ${admin?`data-day="${k}" role="button" tabindex="0" aria-label="${p.m}月${p.d}日のシフトを編集"`:''}>
      <div class="bento-head"><span class="bd">${p.m}/${p.d}</span>${wdSpan(p)}${training?'<span class="train">研修日</span>':''}${admin?'<span class="bento-edit">編集</span>':''}</div>
      <div class="bento-body">${cpt('配達')}${cpt('厨房')}${cpt('管理')}</div></div>`;
  }
  return html+'</div>';
}

/* 人ごと */
function personShiftHTML(me){
  const keys=datesOfPeriod(state.csPeriod), by={};
  allMembers().forEach(n=>by[n]=[]);
  keys.forEach(k=>assignmentsOf(k).forEach(a=>{ (by[a.name]=by[a.name]||[]).push({k,...a}); }));
  const names=Object.keys(by).sort((a,b)=>(a===me?-1:b===me?1:a.localeCompare(b,'ja')));
  if(!names.length) return '<div class="empty">メンバーがいません</div>';
  return names.map(n=>{
    const items=by[n], days=new Set(items.map(x=>x.k)).size;
    const chips=items.map(x=>{ const p=dayParts(x.k);
      return `<span class="pday" style="--dc:${DUTIES[x.duty]?DUTIES[x.duty].color:'#66726D'}"><i></i>${p.m}/${p.d} ${esc(x.duty)}${x.slot==='終日'?'':'（'+x.slot+'）'}</span>`; }).join('');
    return `<div class="person-card${n===me?' me':''}"><div class="person-head">${avatar(n,true)}<span>${esc(n)}${n===me?'（自分）':''}</span><span class="cnt">${days}日</span></div>
      ${items.length?`<div class="person-days">${chips}</div>`:'<div class="note" style="margin-top:6px">この期間の出勤はありません</div>'}</div>`;
  }).join('');
}

/* 管理者：1日分のシフトを登録するシート */
state.sheetDay=null; state.sheetForm={name:'',duty:'配達',slot:'終日'};
function openDaySheet(key){ state.sheetDay=key; renderDaySheet(); }
function closeDaySheet(){ state.sheetDay=null; $('#sheet-host').innerHTML=''; }
function refreshDaySheet(){ if(state.sheetDay) renderDaySheet(); }
function renderDaySheet(){
  const key=state.sheetDay, p=dayParts(key), list=assignmentsOf(key), training=!!(state.days[key]&&state.days[key].training);
  const f=state.sheetForm; const members=allMembers(); if(!members.includes(f.name)) f.name=members[0]||'';
  const opts=(arr,sel)=>arr.map(v=>`<option${v===sel?' selected':''}>${esc(v)}</option>`).join('');
  const rows=[...list].sort((a,b)=>DUTY_LIST.indexOf(a.duty)-DUTY_LIST.indexOf(b.duty)||a.name.localeCompare(b.name,'ja'))
    .map(a=>`<div class="as-row">${avatar(a.name,true)}<span>${esc(a.name)}</span>${dutyTag(a.duty,a.slot)}
      <button class="rm" data-name="${esc(a.name)}" data-duty="${a.duty}" data-slot="${a.slot}">外す</button></div>`).join('');
  $('#sheet-host').innerHTML=`<div class="sheet-back" id="sheet-back"><div class="sheet" role="dialog" aria-label="${p.m}月${p.d}日のシフト">
    <h3>${p.m}月${p.d}日（${p.wd}）のシフト</h3>
    <label class="chk"><input type="checkbox" id="ds-train"${training?' checked':''}>研修日（配達が5人）</label>
    <div style="margin-top:8px">${rows||'<p class="note" style="padding:10px 0">まだ誰も入っていません</p>'}</div>
    <label for="ds-name">追加する人</label>
    <select id="ds-name">${opts(members,f.name)}</select>
    <div class="row"><div><label for="ds-duty">業務</label><select id="ds-duty">${opts(DUTY_LIST,f.duty)}</select></div>
      <div><label for="ds-slot">区分</label><select id="ds-slot">${opts(SLOTS,f.slot)}</select></div></div>
    <button class="primary add" id="ds-add">シフトに追加</button>
    <button class="close" id="ds-close">閉じる</button></div></div>`;
  $('#sheet-back').onclick=e=>{ if(e.target.id==='sheet-back') closeDaySheet(); };
  $('#ds-close').onclick=closeDaySheet;
  $('#ds-train').onchange=e=>{ store.setTraining(key,e.target.checked); toast(e.target.checked?'研修日にしました（配達5人）':'研修日を解除しました'); };
  ['name','duty','slot'].forEach(k=>$('#ds-'+k).onchange=e=>{ state.sheetForm[k]=e.target.value; });
  $('#ds-add').onclick=()=>{ const {name,duty,slot}=state.sheetForm; if(!name){ toast('追加する人を選んでください'); return; }
    // 同じ人の重なる区分（終日と午前/午後、同じ区分）は置き換える
    const clash=assignmentsOf(key).filter(a=>a.name===name && (a.slot==='終日'||slot==='終日'||a.slot===slot));
    clash.forEach(a=>store.removeAssignment(key,a.name,a.duty,a.slot));
    store.addAssignment(key,{name,duty,slot});
    toast(clash.length?`${name}さんの割り当てを置き換えました`:`${name}さんを${duty}に追加しました`); };
  $('#sheet-host').querySelectorAll('.rm').forEach(b=>b.onclick=()=>{
    if(!b.dataset.arm){ b.dataset.arm='1'; b.classList.add('arm'); b.textContent='本当に外す？';
      setTimeout(()=>{ if(b.isConnected){ delete b.dataset.arm; b.classList.remove('arm'); b.textContent='外す'; } },3000); return; }
    store.removeAssignment(key,b.dataset.name,b.dataset.duty,b.dataset.slot); toast(`${b.dataset.name}さんを外しました`); });
}
function initShiftUI(){
  $$('#shift-top button').forEach(b=>b.onclick=()=>{ state.shiftTop=b.dataset.v; renderShiftTab(); });
  $$('#cs-mode button').forEach(b=>b.onclick=()=>{ state.csMode=b.dataset.v; state.csScroll=true; renderConfirmed(); });
  $('#cs-prev').onclick=()=>{ state.csPeriod=shiftPeriod(state.csPeriod,-1); state.csScroll=true; renderConfirmed(); };
  $('#cs-next').onclick=()=>{ state.csPeriod=shiftPeriod(state.csPeriod,1); state.csScroll=true; renderConfirmed(); };
  $('#cs-today').onclick=()=>{ state.csPeriod=initTcPeriod(); state.csScroll=true; renderConfirmed(); };
}

/* ---------------- メンバー管理（管理者） ---------------- */
function renderMembers(){
  const me=state.user.name;
  const list=Object.values(state.accounts).sort((a,b)=>(a.role===b.role?0:a.role==='admin'?-1:1)||a.name.localeCompare(b.name,'ja'));
  $('#mem-list').innerHTML = list.length ? list.map(a=>`<div class="member-row">${avatar(a.name)}
      <div><div class="mn">${esc(a.name)}</div><div class="mr">${a.role==='admin'?'管理者':'スタッフ'}</div></div>
      ${a.name===me?'':`<button class="rm" data-name="${esc(a.name)}">削除</button>`}</div>`).join('')
    : '<div class="empty">メンバーがいません</div>';
  $('#mem-list').querySelectorAll('.rm').forEach(b=>b.onclick=()=>{
    if(!b.dataset.arm){ b.dataset.arm='1'; b.classList.add('arm'); b.textContent='本当に削除？';
      setTimeout(()=>{ if(b.isConnected){ delete b.dataset.arm; b.classList.remove('arm'); b.textContent='削除'; } },3000); return; }
    store.deleteAccount(b.dataset.name); toast(`${b.dataset.name}さんを削除しました`); });
}
function initMembersUI(){
  $('#mem-add').onclick=async ()=>{
    const name=$('#mem-name').value.trim(), pin=$('#mem-pin').value.trim();
    if(!name){ toast('お名前を入力してください'); return; }
    if(/[\/|]/.test(name)){ toast('お名前に「/」や「|」は使えません'); return; }
    if(!/^\d{4,8}$/.test(pin)){ toast('暗証番号は4〜8桁の数字にしてください'); return; }
    try{
      await store.createAccount({ name, pinHash:hashPin(name,pin), role:segVal('mem-role'), createdAt:Date.now() });
      toast(`${name}さんを追加しました`); $('#mem-name').value=''; $('#mem-pin').value='';
    }catch(e){ toast(e.message||'追加できませんでした。通信を確認してもう一度お試しください'); }
  };
}
init();

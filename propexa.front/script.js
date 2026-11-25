/* ---------- 1. DATA (loaded from the backend API) ---------- */
const API = "https://propexa-backend.onrender.com/api";
const db = {customers:[],properties:[],leads:[],followups:[]};

const getToken = () => { try{ return sessionStorage.getItem("propexa_token"); }catch(_){ return null; } };

// One helper for every request: adds the login token and handles errors
async function api(path, method="GET", body){
  const headers = {"Content-Type":"application/json"};
  if(getToken()) headers.Authorization = "Bearer " + getToken();
  const res = await fetch(API + path, {method, headers, body: body ? JSON.stringify(body) : undefined});
  const data = await res.json().catch(()=>({}));
  if(!res.ok){
    if(res.status===401 && path!=="/auth/login") logoutNow();
    throw new Error(data.message || "Request failed");
  }
  return data;
}

async function loadAll(){
  const [customers,properties,leads,followups] =
    await Promise.all(["customers","properties","leads","followups"].map(k=>api("/"+k)));
  Object.assign(db,{customers,properties,leads,followups});
}

/* ---------- 2. FORM FIELDS for "Add new" ---------- */
const forms = {
  customers:[["name","Full name"],["phone","Phone"],["email","Email"],["city","City"],["budget","Budget"],["looking","Looking for"]],
  properties:[["title","Title"],["location","Location"],["price","Price"],["type","Type"],["beds","Bedrooms"],["area","Area"],["image","Image URL"],["status","Status","select",["Available","Pending","Sold"]]],
  leads:[["customer","Customer","select",()=>db.customers.map(c=>c.name)],["property","Property","select",()=>db.properties.map(p=>p.title)],["source","Source"],["status","Status","select",["Hot","Warm","Cold","Converted"]],["date","Date","date"]],
  followups:[["customer","Customer","select",()=>db.customers.map(c=>c.name)],["note","Note"],["date","Date","date"],["status","Status","select",["Pending","Done"]]]
};
const titles = {overview:"Overview",customers:"Customers",properties:"Properties",leads:"Leads",followups:"Follow-ups",hub:"Property Hub"};
let current = "overview";
let selectedProp = null;   // property shown in the Property Hub
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ---------- 3. LOGIN ---------- */
async function login(){
  const btn = $("#loginBtn"), label = btn.textContent;
  const e = $("#email").value.trim(), p = $("#pass").value;
  if(!e || !p){ $("#loginErr").textContent = "Enter both email and password."; return; }

  btn.disabled = true; btn.textContent = "Signing in...";
  $("#loginErr").textContent = "";
  try{
    const data = await api("/auth/login","POST",{email:e,password:p});
    if(!data.token) throw new Error("Login token was not received.");
    sessionStorage.setItem("propexa_token",data.token);
    await showApp();
  }catch(err){
    console.error("Login error:",err);
    $("#loginErr").textContent = err.message==="Failed to fetch"
      ? "Cannot reach the server. If it is hosted on Render, wait a minute for it to wake up and try again."
      : (err.message || "Login failed.");
  }finally{
    btn.disabled = false; btn.textContent = label;
  }
}
async function showApp(){
  try{ await loadAll(); }
  catch(err){ logoutNow(); $("#loginErr").textContent = err.message; return; }
  $("#login").classList.add("hidden"); $("#app").classList.remove("hidden"); render();
}
function logoutNow(){
  try{ sessionStorage.removeItem("propexa_token"); }catch(_){}
  $("#app").classList.add("hidden"); $("#login").classList.remove("hidden"); $("#pass").value="";
}
$("#loginBtn").onclick = login;
$("#pass").addEventListener("keydown",e=>{ if(e.key==="Enter") login(); });
$("#logout").onclick = logoutNow;

/* ---------- 4. NAVIGATION ---------- */
document.querySelectorAll(".nav[data-view]").forEach(b=>b.onclick=()=>{
  current=b.dataset.view;
  document.querySelectorAll(".nav").forEach(n=>n.classList.toggle("active",n===b));
  render();
});

/* ---------- 5. RENDER VIEWS ---------- */
function table(cols,rows,kind){
  if(!rows.length) return '<p class="empty">Nothing here yet. Use “Add new” to create the first entry.</p>';
  return `<div class="tablewrap"><table><thead><tr>${cols.map(c=>`<th>${c[1]}</th>`).join("")}<th></th></tr></thead><tbody>${
    rows.map(r=>`<tr>${cols.map(c=>`<td>${c[2]?`<span class="tag ${esc(r[c[0]])}">${esc(r[c[0]])}</span>`:esc(r[c[0]]??"")}</td>`).join("")}<td><button class="btn ghost edit" onclick="editItem('${kind}','${r.id}')">Edit</button> <button class="btn ghost del" onclick="deleteItem('${kind}','${r.id}')">Delete</button></td></tr>`).join("")}</tbody></table></div>`;
}
const avg = p => p.reviews.length ? (p.reviews.reduce((a,r)=>a+r.rating,0)/p.reviews.length).toFixed(1) : "–";
const stars = n => "★".repeat(n)+"☆".repeat(5-n);

function propCard(p){
  return `<article class="prop">
    <div class="imgbox">
      <img src="${esc(p.image||"")}" alt="${esc(p.title)}" onerror="this.outerHTML='<div class=ph></div>'">
      <span class="badge ${esc(p.status)}">${esc(p.status)}</span>
      <span class="pricepill">${esc(p.price)}</span>
    </div>
    <div class="in">
      <h3>${esc(p.title)}</h3>
      <div class="meta">📍 ${esc(p.location)}</div>
      <div class="chips"><span>${esc(p.type||"–")}</span><span>${esc(p.beds||"–")} bed</span><span>${esc(p.area||"–")}</span></div>
      <div class="rating"><span class="star">★</span> <b>${avg(p)}</b> <small>(${p.reviews.length} reviews)</small></div>
      ${p.reviews.slice(0,2).map(r=>`<blockquote class="rv"><span class="star">${stars(r.rating)}</span> <b>${esc(r.user)}</b><p>${esc(r.text)}</p></blockquote>`).join("")}
      <div class="actions">
        <button class="btn ghost edit" onclick="openHub('${p.id}')">Details</button>
        <button class="btn ghost edit" onclick="editItem('properties','${p.id}')">Edit</button>
        <button class="btn ghost del" onclick="deleteItem('properties','${p.id}')">Delete</button>
      </div>
    </div></article>`;
}
function pipeline(){
  const total = db.leads.length || 1;
  return ["Hot","Warm","Cold","Converted"].map(st=>{
    const n = db.leads.filter(l=>l.status===st).length;
    return `<div class="bar-row"><span>${st}</span><div class="track"><i class="fill ${st}" style="width:${n/total*100}%"></i></div><b>${n}</b></div>`;
  }).join("");
}
function followList(items){
  if(!items.length) return '<p class="empty">No follow-ups scheduled.</p>';
  return items.map(f=>`<div class="fu"><div><b>${esc(f.customer)}</b><br><span class="meta">${esc(f.note)} · ${esc(f.date)}</span></div>
    <div><span class="tag ${esc(f.status)}">${esc(f.status)}</span> ${f.status==="Pending"?`<button class="btn ghost" onclick="markDone('${f.id}')">Mark done</button>`:""} <button class="btn ghost edit" onclick="editItem('followups','${f.id}')">Edit</button> <button class="btn ghost del" onclick="deleteItem('followups','${f.id}')">Delete</button></div></div>`).join("");
}


/* ---------- PROPERTY HUB: one property with its customers, leads, follow-ups and reviews ---------- */
function pickProp(id){ selectedProp = id; render(); }
function openHub(id){
  selectedProp = id; current = "hub";
  document.querySelectorAll(".nav").forEach(n=>n.classList.toggle("active", n.dataset.view==="hub"));
  render();
}
function propertyHub(){
  if(!db.properties.length) return '<p class="empty">Add a property first to see its full details here.</p>';
  let p = db.properties.find(x=>x.id===selectedProp);
  if(!p){ p = db.properties[0]; selectedProp = p.id; }

  // join the data: leads of this property -> customer record -> that customer's follow-ups
  const rows = db.leads.filter(l=>l.property===p.title).map(l=>({
    l,
    c: db.customers.find(c=>c.name===l.customer),
    fus: db.followups.filter(f=>f.customer===l.customer)
  }));
  const pending = rows.reduce((n,r)=>n+r.fus.filter(f=>f.status==="Pending").length,0);

  const picker = db.properties.map(x=>`<button class="pick ${x.id===p.id?"active":""}" onclick="pickProp('${x.id}')">
    <img src="${esc(x.image||"")}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(x.title)}</span></button>`).join("");

  const people = rows.length ? rows.map(({l,c,fus})=>`
    <div class="cust-card">
      <div class="cust-head"><h4>${esc(l.customer)}</h4><span class="tag ${esc(l.status)}">${esc(l.status)} lead</span></div>
      <div class="info-grid">
        <div><small>Phone</small>${esc(c?.phone||"–")}</div>
        <div><small>Email</small>${esc(c?.email||"–")}</div>
        <div><small>City</small>${esc(c?.city||"–")}</div>
        <div><small>Budget</small>${esc(c?.budget||"–")}</div>
        <div><small>Looking for</small>${esc(c?.looking||"–")}</div>
        <div><small>Lead source</small>${esc(l.source||"–")}</div>
        <div><small>Lead date</small>${esc(l.date||"–")}</div>
      </div>
      ${c ? "" : '<p class="meta">No customer record with this exact name was found.</p>'}
      <div class="sub-title">Follow-ups</div>
      ${followList(fus)}
    </div>`).join("")
    : '<p class="empty">No leads yet for this property. Add a lead and choose this property to see its customers here.</p>';

  const reviews = p.reviews.length
    ? p.reviews.map(r=>`<blockquote class="rv"><span class="star">${stars(r.rating)}</span> <b>${esc(r.user)}</b><p>${esc(r.text)}</p></blockquote>`).join("")
    : '<p class="empty">No reviews yet.</p>';

  return `
    <div class="picker">${picker}</div>
    <section class="hub-hero">
      ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" onerror="this.outerHTML='<div class=ph></div>'">` : '<div class="ph"></div>'}
      <div class="hub-body">
        <span class="tag ${esc(p.status)}">${esc(p.status)}</span>
        <h3>${esc(p.title)}</h3>
        <div class="meta">📍 ${esc(p.location)}</div>
        <div class="price-big">${esc(p.price)}</div>
        <div class="chips"><span>${esc(p.type||"–")}</span><span>${esc(p.beds||"–")} bed</span><span>${esc(p.area||"–")}</span>
          <span><span class="star">★</span> ${avg(p)} (${p.reviews.length})</span></div>
        <div class="counts">
          <div><b>${rows.length}</b><span>Customers / leads</span></div>
          <div><b>${pending}</b><span>Pending follow-ups</span></div>
          <div><b>${p.reviews.length}</b><span>Reviews</span></div>
        </div>
      </div>
    </section>
    <div class="two-col">
      <div class="panel"><h3>Interested customers, leads and follow-ups</h3>${people}</div>
      <div class="panel"><h3>Reviews</h3>${reviews}</div>
    </div>`;
}

function render(){
  $("#title").textContent = titles[current];
  const add = $("#addBtn");
  add.classList.toggle("hidden", current==="overview"||current==="hub");
  add.textContent = {customers:"Add customer",properties:"Add property",leads:"Add lead",followups:"Add follow-up"}[current]||"";
  const v = $("#view");
  if(current==="overview"){
    const pending = db.followups.filter(f=>f.status==="Pending");
    const hot = db.leads.filter(l=>l.status==="Hot").length;
    const today = new Date().toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long"});
    v.innerHTML = `
      <section class="banner">
        <div><small>${today}</small><h3>Welcome back, Admin</h3>
        <p>You have <b>${pending.length}</b> pending follow-ups and <b>${hot}</b> hot leads today.</p></div>
      </section>
      <div class="stats">
        <div class="stat"><div class="ico c1">👥</div><div><b>${db.customers.length}</b><span>Customers</span></div></div>
        <div class="stat"><div class="ico c2">🏢</div><div><b>${db.properties.length}</b><span>Properties</span></div></div>
        <div class="stat"><div class="ico c3">📈</div><div><b>${db.leads.length}</b><span>Leads</span></div></div>
        <div class="stat"><div class="ico c4">🔔</div><div><b>${pending.length}</b><span>Pending follow-ups</span></div></div>
      </div>
      <div class="two-col">
        <div class="panel"><h3>Upcoming follow-ups</h3>${followList(pending)}</div>
        <div class="panel"><h3>Lead pipeline</h3>${pipeline()}</div>
      </div>
      <div class="section-head"><h3>Featured properties</h3><span class="meta">Photos, ratings and reviews</span></div>
      <div class="grid">${db.properties.map(propCard).join("")}</div>`;
  } else if(current==="hub"){
    v.innerHTML = propertyHub();
  } else if(current==="customers"){
    v.innerHTML = `<div class="panel">${table([["name","Name"],["phone","Phone"],["email","Email"],["city","City"],["budget","Budget"],["looking","Looking for"]],db.customers,"customers")}</div>`;
  } else if(current==="properties"){
    v.innerHTML = db.properties.length ? `<div class="grid">${db.properties.map(propCard).join("")}</div>` : '<p class="empty">No properties yet.</p>';
  } else if(current==="leads"){
    v.innerHTML = `<div class="panel">${table([["customer","Customer"],["property","Property"],["source","Source"],["status","Status",1],["date","Date"]],db.leads,"leads")}</div>`;
  } else {
    v.innerHTML = `<div class="panel">${followList(db.followups)}</div>`;
  }
}

/* ---------- 6. ACTIONS ---------- */
async function markDone(id){
  try{
    const updated = await api("/followups/"+id,"PUT",{status:"Done"});
    const i = db.followups.findIndex(f=>f.id===id);
    db.followups[i] = updated; render();
  }catch(err){ alert(err.message); }
}

async function deleteItem(kind,id){
  if(!confirm("Delete this entry? This cannot be undone.")) return;
  try{
    await api("/"+kind+"/"+id,"DELETE");
    db[kind] = db[kind].filter(x=>x.id!==id);
    render();
  }catch(err){ alert(err.message); }
}

function fieldHTML(f,val){
  if(f[2]==="select"){
    const opts = typeof f[3]==="function" ? f[3]() : [...f[3]];
    if(val && !opts.includes(val)) opts.unshift(val);
    return `<label>${f[1]}</label><select data-k="${f[0]}">${opts.map(o=>`<option value="${esc(o)}" ${o===val?"selected":""}>${esc(o)}</option>`).join("")}</select>`;
  }
  return `<label>${f[1]}</label><input data-k="${f[0]}" type="${f[2]||"text"}" value="${esc(val ?? "")}">`;
}

// item = existing record when editing, nothing when adding
function openForm(item, kind=current){
  const editing = !!item;
  const fields = forms[kind];
  $("#modalRoot").innerHTML = `<div class="modal"><div class="box" role="dialog" aria-label="${editing?"Edit":"Add"} entry">
    <h2>${editing ? "Edit entry" : $("#addBtn").textContent}</h2>
    ${fields.map(f=>fieldHTML(f, item ? item[f[0]] : undefined)).join("")}
    <div class="row"><button class="btn" id="saveBtn">${editing?"Save changes":"Save"}</button><button class="btn ghost" id="cancelBtn">Cancel</button></div></div></div>`;
  $("#cancelBtn").onclick = ()=>$("#modalRoot").innerHTML="";
  $("#saveBtn").onclick = async ()=>{
    const data = {};
    document.querySelectorAll("#modalRoot [data-k]").forEach(i=>{
      const v = i.value.trim();
      if(v || editing) data[i.dataset.k] = v;
    });
    try{
      if(editing){
        const saved = await api("/"+kind+"/"+item.id,"PUT",data);
        const idx = db[kind].findIndex(x=>x.id===item.id);
        db[kind][idx] = saved;
      } else {
        const saved = await api("/"+kind,"POST",data);
        db[kind].unshift(saved);
      }
      $("#modalRoot").innerHTML=""; render();
    }catch(err){ alert(err.message); }
  };
}

function editItem(kind,id){ openForm(db[kind].find(x=>x.id===id), kind); }

$("#addBtn").onclick = ()=>openForm();

/* Stay signed in on refresh */
if(getToken()) showApp();
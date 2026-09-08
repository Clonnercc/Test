const $=id=>document.getElementById(id);
async function api(url,opt={}){let r=await fetch(url,{headers:{"Content-Type":"application/json"},...opt});let d=await r.json().catch(()=>({}));if(r.status===401){showLogin();throw Error("Sessão expirada")}if(!r.ok)throw Error(d.error||"Erro");return d}
function showLogin(){$("login").hidden=false;$("app").hidden=true}
function showApp(){$("login").hidden=true;$("app").hidden=false}
const parse=()=>$("numbers").value.split(/\r?\n|[,;]+/).map(x=>x.trim()).filter(Boolean);
function count(){$("count").textContent=parse().length+" contatos"}
$("loginForm").onsubmit=async e=>{e.preventDefault();$("err").textContent="";try{await api("/api/login",{method:"POST",body:JSON.stringify({username:$("user").value,password:$("pass").value})});showApp();load()}catch(x){$("err").textContent=x.message}};
$("logout").onclick=async()=>{await api("/api/logout",{method:"POST"});showLogin()};
$("connect").onclick=async()=>{try{await api("/api/connect",{method:"POST"});refresh()}catch(e){alert(e.message)}};
$("save").onclick=save;$("start").onclick=async()=>{try{await save();await api("/api/start",{method:"POST"});refresh()}catch(e){alert(e.message)}};
$("pause").onclick=async()=>{try{await api("/api/pause",{method:"POST"});refresh()}catch(e){alert(e.message)}};
$("stop").onclick=async()=>{try{await api("/api/stop",{method:"POST"});refresh()}catch(e){alert(e.message)}};
$("clean").onclick=()=>{$("numbers").value=[...new Set(parse())].join("\n");count()};
$("numbers").oninput=count;$("file").onchange=async e=>{let f=e.target.files[0];if(f){$("numbers").value+=($("numbers").value.trim()?"\n":"")+await f.text();count()}e.target.value=""};$("refresh").onclick=historyLoad;
async function save(){await api("/api/config",{method:"POST",body:JSON.stringify({campaignName:$("campaign").value,message:$("message").value,numbers:parse(),intervalSeconds:+$("interval").value,requireOptIn:$("opt").checked})});count()}
async function load(){let c=await api("/api/config");$("campaign").value=c.campaignName;$("message").value=c.message;$("numbers").value=c.numbers.join("\n");$("interval").value=c.intervalSeconds;$("opt").checked=c.requireOptIn!==false;count();refresh()}
async function refresh(){try{let s=await api("/api/state");$("conn").textContent=s.ready?"Conectado":"Offline";$("nums").textContent=s.numbers;$("sent").textContent=s.sent;$("fail").textContent=s.failed;$("current").textContent=s.current||"—";$("status").textContent=s.status;$("badge").textContent=s.ready?"WhatsApp conectado":s.status;$("badge").className=s.ready?"ok":"";if(s.qr)$("qr").innerHTML=`<img src="${s.qr}" alt="QR Code">`;historyLoad()}catch{}}
async function historyLoad(){try{let a=await api("/api/history");$("history").innerHTML=a.map(x=>`<tr><td>${new Date(x.time).toLocaleString("pt-BR")}</td><td>${esc(x.number)}</td><td class="${x.status==="enviado"?"oktxt":"errtxt"}">${x.status}</td><td>${esc(x.detail||"")}</td></tr>`).join("")||'<tr><td colspan="4">Nenhum registro.</td></tr>'}catch{}}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
(async()=>{try{await api("/api/state");showApp();await load()}catch{showLogin()}})();
setInterval(()=>{if(!$("app").hidden)refresh()},2000);

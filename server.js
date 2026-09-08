require("dotenv").config();
const express=require("express");
const session=require("express-session");
const QRCode=require("qrcode");
const path=require("path");
const fs=require("fs");
const {Client,LocalAuth}=require("whatsapp-web.js");

const app=express(), PORT=process.env.PORT||3000;
const DATA=path.join(__dirname,"data");
const read=(f,d)=>{try{return JSON.parse(fs.readFileSync(path.join(DATA,f),"utf8"))}catch{return d}};
const save=(f,d)=>fs.writeFileSync(path.join(DATA,f),JSON.stringify(d,null,2));

let config=read("config.json",{campaignName:"Minha campanha",message:"",numbers:[],intervalSeconds:30,requireOptIn:true});
let history=read("history.json",[]);
let state={ready:false,qr:null,status:"Desconectado",sending:false,paused:false,current:null,sent:0,failed:0};
let queue=[];

app.use(express.json({limit:"2mb"}));
app.use(session({secret:process.env.SESSION_SECRET||"change-me",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",maxAge:8*60*60*1000}}));
const auth=(req,res,next)=>req.session.ok?next():res.status(401).json({error:"Não autenticado."});

app.post("/api/login",(req,res)=>{
  const u=process.env.PAINEL_USUARIO||"admin", p=process.env.PAINEL_SENHA||"admin123";
  if(req.body.username===u&&req.body.password===p){req.session.ok=true;return res.json({ok:true})}
  res.status(401).json({error:"Usuário ou senha inválidos."});
});
app.post("/api/logout",auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/state",auth,(req,res)=>res.json({...state,numbers:config.numbers.length}));
app.get("/api/config",auth,(req,res)=>res.json(config));
app.get("/api/history",auth,(req,res)=>res.json(history.slice(-500).reverse()));

app.post("/api/config",auth,(req,res)=>{
  config={
    campaignName:String(req.body.campaignName||"Minha campanha").slice(0,100),
    message:String(req.body.message||""),
    numbers:Array.isArray(req.body.numbers)?req.body.numbers.map(String):[],
    intervalSeconds:Math.max(15,Math.min(3600,Number(req.body.intervalSeconds)||30)),
    requireOptIn:req.body.requireOptIn!==false
  };
  save("config.json",config); res.json({ok:true,config});
});
app.post("/api/connect",auth,async(req,res)=>{
  try{await client.initialize();res.json({ok:true})}
  catch(e){state.status="Erro: "+e.message;res.status(500).json({error:state.status})}
});
app.post("/api/start",auth,(req,res)=>{
  if(!state.ready)return res.status(400).json({error:"Conecte o WhatsApp primeiro."});
  if(!config.requireOptIn)return res.status(400).json({error:"Confirme o opt-in dos contatos."});
  if(!config.message.trim())return res.status(400).json({error:"Informe a mensagem."});
  if(!config.numbers.length)return res.status(400).json({error:"Adicione números."});
  if(state.sending)return res.status(400).json({error:"Já existe uma campanha em execução."});
  queue=[...config.numbers]; state={...state,sending:true,paused:false,current:null,sent:0,failed:0,status:"Campanha em execução"}; processQueue(); res.json({ok:true});
});
app.post("/api/pause",auth,(req,res)=>{if(state.sending){state.paused=!state.paused;state.status=state.paused?"Campanha pausada":"Campanha em execução"}res.json({ok:true})});
app.post("/api/stop",auth,(req,res)=>{queue=[];state.sending=false;state.paused=false;state.current=null;state.status="Campanha parada";res.json({ok:true})});

const normalize=x=>{let n=String(x).replace(/\D/g,"");if(n.length===10||n.length===11)n="55"+n;return n.length>=12?n+"@c.us":null};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function addHistory(x){history.push({id:Date.now()+Math.random(),time:new Date().toISOString(),...x});if(history.length>5000)history=history.slice(-5000);save("history.json",history)}
async function processQueue(){
  while(state.sending&&queue.length){
    if(state.paused){await sleep(1000);continue}
    const raw=queue.shift(), id=normalize(raw);state.current=raw;
    if(!id){state.failed++;addHistory({number:raw,status:"erro",detail:"Número inválido"});continue}
    try{
      if(!(await client.isRegisteredUser(id)))throw new Error("Número não registrado no WhatsApp.");
      await client.sendMessage(id,config.message.replaceAll("{numero}",raw));
      state.sent++;addHistory({number:raw,status:"enviado",detail:"Mensagem enviada"});
    }catch(e){state.failed++;addHistory({number:raw,status:"erro",detail:e.message})}
    if(queue.length&&state.sending)await sleep(config.intervalSeconds*1000);
  }
  if(state.sending){state.sending=false;state.current=null;state.status="Campanha concluída"}
}

const client=new Client({
  authStrategy:new LocalAuth({clientId:"wa-control"}),
  puppeteer:{headless:true,args:["--no-sandbox","--disable-setuid-sandbox"]}
});
client.on("qr",async qr=>{state.qr=await QRCode.toDataURL(qr);state.ready=false;state.status="Aguardando leitura do QR Code"});
client.on("authenticated",()=>{state.qr=null;state.status="WhatsApp autenticado"});
client.on("ready",()=>{state.qr=null;state.ready=true;state.status="WhatsApp conectado"});
client.on("auth_failure",m=>{state.ready=false;state.status="Falha de autenticação: "+m});
client.on("disconnected",()=>{state.ready=false;state.status="WhatsApp desconectado"});

app.use(express.static(path.join(__dirname,"public")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log("WA Control em http://localhost:"+PORT));

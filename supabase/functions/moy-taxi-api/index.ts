import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});const fail=(m:string,s=400)=>reply({ok:false,error:m},s);const enc=new TextEncoder();const hex=(b:ArrayBuffer|Uint8Array)=>Array.from(b instanceof Uint8Array?b:new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");const fromHex=(v:string)=>new Uint8Array((v.match(/.{1,2}/g)||[]).map(x=>parseInt(x,16)));
async function sha256(v:string){return hex(await crypto.subtle.digest("SHA-256",enc.encode(v)))}async function passwordHash(p:string,s:string){const k=await crypto.subtle.importKey("raw",enc.encode(p),"PBKDF2",false,["deriveBits"]);return hex(await crypto.subtle.deriveBits({name:"PBKDF2",salt:fromHex(s),iterations:120000,hash:"SHA-256"},k,256))}function equal(a:string,b:string){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}function phone(v:unknown){let d=String(v||"").replace(/\D/g,"");if(d.length===11&&d.startsWith("8"))d="7"+d.slice(1);return d.length>=10&&d.length<=15?"+"+d:""}
function pub(d:any){return {id:d.id,public_code:d.public_code,name:d.name,phone:d.phone,car_model:d.car_model||"",car_plate:d.car_plate||"",car_color:d.car_color||"",photo_url:d.photo_url||"",is_online:Boolean(d.is_online),current_lat:d.current_lat??null,current_lng:d.current_lng??null,location_updated_at:d.location_updated_at||null,documents_verified:Boolean(d.documents_verified)}}
async function db(){const u=Deno.env.get("SUPABASE_URL"),k=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!u||!k)throw new Error("Server configuration is incomplete");return createClient(u,k,{auth:{persistSession:false,autoRefreshToken:false}})}
async function sess(c:any,p:any){const id=String(p.driver_id||""),t=String(p.session_token||"");if(!id||t.length<20)return {error:"Сессия истекла. Войди снова.",status:401};const {data,error}=await c.from("drivers").select("*").eq("id",id).maybeSingle();if(error||!data)return {error:"Не удалось проверить вход. Войди снова.",status:401};const exp=data.session_expires_at?Date.parse(data.session_expires_at):0;if(!data.session_token_hash||!equal(await sha256(t),data.session_token_hash)||exp<Date.now())return {error:"Сессия истекла. Войди снова.",status:401};return {driver:data}}
async function newSession(c:any,id:string){const t=crypto.randomUUID()+crypto.randomUUID().replace(/-/g,"");const h=await sha256(t),exp=new Date(Date.now()+30*86400000).toISOString();const {error}=await c.from("drivers").update({session_token_hash:h,session_expires_at:exp,updated_at:new Date().toISOString()}).eq("id",id);if(error)throw error;return t}
function km(a:number,b:number,c:number,d:number){const R=6371,r=(x:number)=>x*Math.PI/180,da=r(c-a),db=r(d-b),x=Math.sin(da/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(db/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
function enrich(o:any,d:any){let distance=null;if([o.pickup_lat,o.pickup_lng,d?.current_lat,d?.current_lng].every(v=>typeof v==="number"))distance=km(o.pickup_lat,o.pickup_lng,d.current_lat,d.current_lng);return {...o,distance_km:distance,driver_lat:d?.current_lat??null,driver_lng:d?.current_lng??null,driver_location_updated_at:d?.location_updated_at??null}}

async function adminSession(c:any,p:any){
  const token=String(p.admin_token||"");
  if(token.length<20)return {error:"Нужен вход владельца.",status:401};
  const {data,error}=await c.from("platform_settings").select("*").eq("id",true).maybeSingle();
  if(error||!data)return {error:"Настройки кабинета владельца не найдены.",status:500};
  const exp=data.admin_session_expires_at?Date.parse(data.admin_session_expires_at):0;
  if(!data.admin_session_token_hash||!equal(await sha256(token),data.admin_session_token_hash)||exp<Date.now())return {error:"Сессия владельца истекла. Войди снова.",status:401};
  return {settings:data};
}
function amount(v:any){const n=Number(v);return Number.isFinite(n)&&n>0?n:0}
\nDeno.serve(async(req:Request)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});if(req.method!=="POST")return fail("Method not allowed",405);try{const c=await db(),p=await req.json(),a=String(p.action||"");

if(a==="admin_login"){
 const password=String(p.password||"");
 const {data:s,error}=await c.from("platform_settings").select("*").eq("id",true).maybeSingle();
 if(error||!s)return fail("Не удалось загрузить настройки владельца.",500);
 if(!equal(await passwordHash(password,s.owner_password_salt),s.owner_password_hash))return fail("Неверный пароль владельца.",401);
 const token=crypto.randomUUID()+crypto.randomUUID().replace(/-/g,"");
 const {error:ue}=await c.from("platform_settings").update({admin_session_token_hash:await sha256(token),admin_session_expires_at:new Date(Date.now()+12*60*60*1000).toISOString(),updated_at:new Date().toISOString()}).eq("id",true);
 if(ue)return fail("Не удалось открыть кабинет владельца.",500);
 return reply({ok:true,admin_token:token,commission_percent:Number(s.commission_percent)});
}
if(a.startsWith("admin_")){
 const auth=await adminSession(c,p);
 if(!auth.settings)return fail(auth.error||"Нет доступа.",auth.status||401);
 const settings=auth.settings;
 if(a==="admin_logout"){await c.from("platform_settings").update({admin_session_token_hash:null,admin_session_expires_at:null}).eq("id",true);return reply({ok:true})}
 if(a==="admin_change_password"){
  const next=String(p.new_password||"");if(next.length<12)return fail("Новый пароль должен быть не короче 12 символов.");
  const salt=hex(crypto.getRandomValues(new Uint8Array(16))),hash=await passwordHash(next,salt);
  const {error}=await c.from("platform_settings").update({owner_password_salt:salt,owner_password_hash:hash,updated_at:new Date().toISOString()}).eq("id",true);
  if(error)return fail("Не удалось сменить пароль.",500);return reply({ok:true});
 }
 if(a==="admin_update_commission_percent"){
  const percent=Number(p.commission_percent);if(!Number.isFinite(percent)||percent<0||percent>30)return fail("Комиссия должна быть от 0 до 30 процентов.");
  const {error}=await c.from("platform_settings").update({commission_percent:percent,updated_at:new Date().toISOString()}).eq("id",true);
  if(error)return fail("Не удалось сохранить комиссию.",500);return reply({ok:true,commission_percent:percent});
 }
 if(a==="admin_dashboard"){
  const [driversQ,onlineQ,ordersQ,doneQ,clientsQ,clientsRowsQ,commissionsQ]=await Promise.all([
   c.from("drivers").select("id",{count:"exact",head:true}),
   c.from("drivers").select("id",{count:"exact",head:true}).eq("is_online",true),
   c.from("orders").select("id",{count:"exact",head:true}),
   c.from("orders").select("id",{count:"exact",head:true}).eq("status","completed"),
   c.from("clients").select("id",{count:"exact",head:true}),
   c.from("clients").select("phone").limit(10000),
   c.from("platform_commissions").select("commission_amount,status").limit(10000)
  ]);
  if(driversQ.error||onlineQ.error||ordersQ.error||doneQ.error||clientsQ.error||commissionsQ.error)return fail("Не удалось загрузить статистику.",500);
  const commissionRows=commissionsQ.data||[];
  const totalCommission=commissionRows.reduce((sum:any,row:any)=>sum+Number(row.commission_amount||0),0);
  const dueCommission=commissionRows.filter((row:any)=>row.status==="due").reduce((sum:any,row:any)=>sum+Number(row.commission_amount||0),0);
  const paidCommission=commissionRows.filter((row:any)=>row.status==="paid").reduce((sum:any,row:any)=>sum+Number(row.commission_amount||0),0);
  const uniqueClients=new Set((clientsRowsQ.data||[]).map((x:any)=>String(x.phone||"").trim()).filter(Boolean)).size;
  return reply({ok:true,stats:{drivers:driversQ.count||0,online_drivers:onlineQ.count||0,orders:ordersQ.count||0,completed_orders:doneQ.count||0,client_order_records:clientsQ.count||0,unique_clients:uniqueClients,commission_total:totalCommission,commission_due:dueCommission,commission_paid:paidCommission,commission_percent:Number(settings.commission_percent)}});
 }
 if(a==="admin_drivers"){
  const {data,error}=await c.from("drivers").select("id,public_code,name,phone,is_online,car_model,car_plate,car_color,created_at").order("created_at",{ascending:false}).limit(500);
  if(error)return fail("Не удалось загрузить список водителей.",500);return reply({ok:true,drivers:data||[]});
 }
 if(a==="admin_orders"){
  const {data,error}=await c.from("orders").select("id,status,created_at,completed_at,client_price,driver_price,agreed_price,pickup_address,destination_address,clients(name,phone),drivers(name,phone)").order("created_at",{ascending:false}).limit(200);
  if(error)return fail("Не удалось загрузить заказы.",500);return reply({ok:true,orders:data||[]});
 }
 if(a==="admin_commissions"){
  const {data,error}=await c.from("platform_commissions").select("*,drivers(name,phone),orders(pickup_address,destination_address,completed_at)").order("created_at",{ascending:false}).limit(500);
  if(error)return fail("Не удалось загрузить начисления.",500);return reply({ok:true,commissions:data||[]});
 }
 if(a==="admin_mark_commission_paid"){
  const id=String(p.commission_id||""),note=String(p.note||"").trim().slice(0,300);
  const {data:current,error:ce}=await c.from("platform_commissions").select("id,status").eq("id",id).maybeSingle();
  if(ce||!current)return fail("Начисление не найдено.",404);if(current.status==="paid")return fail("Это начисление уже отмечено как полученное.");
  const {data,error}=await c.from("platform_commissions").update({status:"paid",paid_at:new Date().toISOString(),paid_note:note||null}).eq("id",id).select("*").single();
  if(error)return fail("Не удалось отметить получение комиссии.",500);return reply({ok:true,commission:data});
 }
 return fail("Неизвестное действие кабинета владельца.",400);
}
\nif(a==="register_driver"){const name=String(p.name||"").trim().slice(0,100),ph=phone(p.phone),pw=String(p.password||""),car=String(p.car_model||"").trim().slice(0,100),plate=String(p.car_plate||"").trim().slice(0,30),color=String(p.car_color||"").trim().slice(0,40);if(!name||!ph||pw.length<8)return fail("Укажи имя, телефон и пароль не короче 8 символов.");const {data:old}=await c.from("drivers").select("id").eq("phone",ph).maybeSingle();if(old)return fail("Этот номер уже зарегистрирован. Войди в приложение.");const salt=hex(crypto.getRandomValues(new Uint8Array(16))),hash=await passwordHash(pw,salt);const {data:d,error}=await c.from("drivers").insert({name,phone:ph,password_salt:salt,password_hash:hash,car_model:car||null,car_plate:plate||null,car_color:color||null,is_online:true}).select("*").single();if(error||!d)return fail("Не удалось создать аккаунт.",500);return reply({ok:true,driver:pub(d),session_token:await newSession(c,d.id)})}
if(a==="login_driver"){const ph=phone(p.phone),pw=String(p.password||"");const {data:d,error}=await c.from("drivers").select("*").eq("phone",ph).maybeSingle();if(error)return fail("Не удалось выполнить вход.",500);if(!d||!equal(await passwordHash(pw,d.password_salt),d.password_hash))return fail("Неверный номер телефона или пароль.",401);return reply({ok:true,driver:pub(d),session_token:await newSession(c,d.id)})}
if(a==="availability"){const code=String(p.driver_code||"").trim().toUpperCase();const {data:d,error}=await c.from("drivers").select("*").eq("public_code",code).maybeSingle();if(error||!d)return fail("Водитель не найден.",404);return reply({ok:true,driver:pub(d)})}
if(a==="create_order"){const code=String(p.driver_code||"").trim().toUpperCase(),name=String(p.name||"").trim().slice(0,100),ph=phone(p.phone),pickup=String(p.pickup_address||"").trim().slice(0,300),dest=String(p.destination_address||"").trim().slice(0,300),comment=String(p.comment||"").trim().slice(0,500),lat=Number(p.pickup_lat),lng=Number(p.pickup_lng),price=Number(p.client_price);if(!code||!name||!ph||!pickup||!dest)return fail("Заполни имя, телефон, адрес подачи и адрес назначения.");const {data:d}=await c.from("drivers").select("id,is_online").eq("public_code",code).maybeSingle();if(!d)return fail("Водитель не найден.",404);if(!d.is_online)return fail("Водитель сейчас не на линии.",409);const {data:cl,error:ce}=await c.from("clients").insert({name,phone:ph}).select("id").single();if(ce||!cl)return fail("Не удалось сохранить клиента.",500);const token=crypto.randomUUID();const {data:o,error:oe}=await c.from("orders").insert({client_id:cl.id,driver_id:d.id,pickup_address:pickup,pickup_lat:Number.isFinite(lat)?lat:null,pickup_lng:Number.isFinite(lng)?lng:null,destination_address:dest,destination_lat:Number.isFinite(Number(p.destination_lat))?Number(p.destination_lat):null,destination_lng:Number.isFinite(Number(p.destination_lng))?Number(p.destination_lng):null,comment:comment||null,client_token:token,status:"new",client_price:Number.isFinite(price)&&price>0?price:null,price_status:"pending"}).select("*").single();if(oe||!o)return fail("Не удалось отправить заказ.",500);return reply({ok:true,order:o})}
if(a==="order_status"){const id=String(p.order_id||""),token=String(p.client_token||"");const {data:o,error}=await c.from("orders").select("*,drivers(name,phone,car_model,car_plate,car_color,photo_url,is_online,current_lat,current_lng,location_updated_at,documents_verified)").eq("id",id).eq("client_token",token).maybeSingle();if(error||!o)return fail("Заказ не найден.",404);return reply({ok:true,order:enrich(o,o.drivers)})}
if(a==="client_accept_price"||a==="client_decline_price"){const id=String(p.order_id||""),token=String(p.client_token||"");if(!id||!token)return fail("Не хватает номера заказа.");const {data:o,error}=await c.from("orders").select("id,status,price_status,driver_price").eq("id",id).eq("client_token",token).maybeSingle();if(error||!o)return fail("Заказ не найден.",404);if(o.status!=="new"||o.price_status!=="driver_offered"||!Number(o.driver_price))return fail("Предложение цены уже недоступно.");const accept=a==="client_accept_price";const patch=accept?{price_status:"accepted",agreed_price:o.driver_price}:{price_status:"declined"};const {data:u,error:ue}=await c.from("orders").update(patch).eq("id",id).eq("client_token",token).select("*").single();if(ue||!u)return fail("Не удалось сохранить ответ на цену.",500);return reply({ok:true,order:u})}
if(a==="cancel_order"){const id=String(p.order_id||""),token=String(p.client_token||"");const {data:o}=await c.from("orders").select("id,status").eq("id",id).eq("client_token",token).maybeSingle();if(!o)return fail("Заказ не найден.",404);if(o.status!=="new")return fail("Этот заказ уже принят водителем.");const {data:u,error}=await c.from("orders").update({status:"cancelled"}).eq("id",id).select("id,status").single();if(error)return fail("Не удалось отменить заказ.",500);return reply({ok:true,order:u})}
if(["driver_me","driver_list","driver_history","driver_update","driver_toggle_online","driver_update_profile","driver_logout","driver_location","driver_offer_price"].includes(a)){const s=await sess(c,p);if(!s.driver)return fail(s.error||"Нужен вход.",s.status||401);const d=s.driver;if(a==="driver_me")return reply({ok:true,driver:pub(d)});if(a==="driver_logout"){await c.from("drivers").update({session_token_hash:null,session_expires_at:null}).eq("id",d.id);return reply({ok:true});}if(a==="driver_location"){const lat=Number(p.lat),lng=Number(p.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return fail("Некорректная геопозиция.");const {error}=await c.from("drivers").update({current_lat:lat,current_lng:lng,location_accuracy:Number(p.accuracy)||null,location_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",d.id);if(error)return fail("Не удалось обновить геопозицию.",500);return reply({ok:true})}if(a==="driver_offer_price"){const id=String(p.order_id||""),price=Number(p.price);if(!id||!Number.isFinite(price)||price<100||price>1000000)return fail("Укажи корректную цену от 100 до 1 000 000 ₸.");const {data:o,error:oe}=await c.from("orders").select("id,status,price_status").eq("id",id).eq("driver_id",d.id).maybeSingle();if(oe||!o)return fail("Заказ не найден.",404);if(o.status!=="new")return fail("Предложить другую цену можно только до принятия заказа.");if(o.price_status==="accepted")return fail("Цена уже согласована.");const {data:u,error:ue}=await c.from("orders").update({driver_price:Math.round(price),price_status:"driver_offered"}).eq("id",id).select("*").single();if(ue||!u)return fail("Не удалось отправить предложение цены.",500);return reply({ok:true,order:u})}if(a==="driver_toggle_online"){const {data:u,error}=await c.from("drivers").update({is_online:Boolean(p.is_online),updated_at:new Date().toISOString()}).eq("id",d.id).select("*").single();if(error)return fail("Не удалось изменить статус.",500);return reply({ok:true,is_online:u.is_online})}if(a==="driver_update_profile"){const name=String(p.name||"").trim().slice(0,100),car=String(p.car_model||"").trim().slice(0,100),plate=String(p.car_plate||"").trim().slice(0,30),color=String(p.car_color||"").trim().slice(0,40),photo=String(p.photo_url||"");if(!name)return fail("Имя не может быть пустым.");if(photo.length>250000)return fail("Фото слишком большое.");const {data:u,error}=await c.from("drivers").update({name,car_model:car||null,car_plate:plate||null,car_color:color||null,photo_url:photo||null,updated_at:new Date().toISOString()}).eq("id",d.id).select("*").single();if(error)return fail("Не удалось обновить профиль.",500);return reply({ok:true,driver:pub(u)})}if(a==="driver_list"){const {data:os,error}=await c.from("orders").select("*,clients(name,phone)").eq("driver_id",d.id).in("status",["new","accepted","arrived","started"]).order("created_at",{ascending:false});if(error)return fail("Не удалось загрузить заказы.",500);return reply({ok:true,orders:(os||[]).map(o=>enrich(o,d)),is_online:d.is_online})}if(a==="driver_history"){const {data:os,error}=await c.from("orders").select("*,clients(name,phone)").eq("driver_id",d.id).eq("status","completed").order("completed_at",{ascending:false}).limit(100);if(error)return fail("Не удалось загрузить историю.",500);return reply({ok:true,orders:os||[]})}if(a==="driver_update"){const id=String(p.order_id||""),status=String(p.status||"");if(!["accepted","arrived","started","completed","cancelled"].includes(status))return fail("Недопустимый статус.");const {data:o}=await c.from("orders").select("*").eq("id",id).eq("driver_id",d.id).maybeSingle();if(!o)return fail("Заказ не найден.",404);if(status==="accepted"&&o.price_status==="driver_offered")return fail("Сначала дождись ответа клиента на твою цену.");const patch:any={status};if(status==="accepted"){patch.accepted_at=new Date().toISOString();if(o.price_status!=="accepted"){if(Number(o.client_price)>0){patch.agreed_price=o.client_price;patch.price_status="accepted"}else{patch.agreed_price=null;patch.price_status="pending"}}}if(status==="completed")patch.completed_at=new Date().toISOString();const {data:u,error}=await c.from("orders").update(patch).eq("id",id).select("*").single();if(error)return fail("Не удалось изменить заказ.",500);
if(status==="completed"){
 const fare=amount(u.agreed_price)||amount(u.driver_price)||amount(u.client_price);
 if(fare>0){
  const {data:settingsRow,error:se}=await c.from("platform_settings").select("commission_percent").eq("id",true).maybeSingle();
  if(se||!settingsRow){console.error("commission settings unavailable",se)}
  else{
   const rate=Number(settingsRow.commission_percent||0),commission=Math.round((fare*rate/100)*100)/100;
   const {error:le}=await c.from("platform_commissions").upsert({order_id:u.id,driver_id:d.id,fare,commission_percent:rate,commission_amount:commission,status:"due"},{onConflict:"order_id",ignoreDuplicates:true});
   if(le)console.error("commission ledger insert failed",le);
  }
 }
}
return reply({ok:true,order:u})}}
return fail("Неизвестное действие.",400)}catch(e){console.error("moy-taxi-api",e);return fail("Внутренняя ошибка сервера.",500)}});

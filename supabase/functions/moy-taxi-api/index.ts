import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});const fail=(m:string,s=400)=>reply({ok:false,error:m},s);const enc=new TextEncoder();const hex=(b:ArrayBuffer|Uint8Array)=>Array.from(b instanceof Uint8Array?b:new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");const fromHex=(v:string)=>new Uint8Array((v.match(/.{1,2}/g)||[]).map(x=>parseInt(x,16)));
async function sha256(v:string){return hex(await crypto.subtle.digest("SHA-256",enc.encode(v)))}async function passwordHash(p:string,s:string){const k=await crypto.subtle.importKey("raw",enc.encode(p),"PBKDF2",false,["deriveBits"]);return hex(await crypto.subtle.deriveBits({name:"PBKDF2",salt:fromHex(s),iterations:120000,hash:"SHA-256"},k,256))}function equal(a:string,b:string){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}function phone(v:unknown){let d=String(v||"").replace(/\D/g,"");if(d.length===11&&d.startsWith("8"))d="7"+d.slice(1);return d.length>=10&&d.length<=15?"+"+d:""}
const VEHICLE_CLASSES=["economy","comfort","comfort_plus","business","minivan","premium"];
function vehicleClass(v:unknown){const x=String(v||"economy");return VEHICLE_CLASSES.includes(x)?x:"economy"}
function pub(d:any){return {id:d.id,public_code:d.public_code,name:d.name,phone:d.phone,car_model:d.car_model||"",car_plate:d.car_plate||"",car_color:d.car_color||"",vehicle_class:vehicleClass(d.vehicle_class),photo_url:d.photo_url||"",wallet_balance:Number(d.wallet_balance||0),is_online:Boolean(d.is_online),current_lat:d.current_lat??null,current_lng:d.current_lng??null,location_updated_at:d.location_updated_at||null,documents_verified:Boolean(d.documents_verified)}}
async function db(){const u=Deno.env.get("SUPABASE_URL"),k=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!u||!k)throw new Error("Server configuration is incomplete");return createClient(u,k,{auth:{persistSession:false,autoRefreshToken:false}})}
async function sess(c:any,p:any){const id=String(p.driver_id||""),t=String(p.session_token||"");if(!id||t.length<20)return {error:"Сессия истекла. Войди снова.",status:401};const {data,error}=await c.from("drivers").select("*").eq("id",id).maybeSingle();if(error||!data)return {error:"Не удалось проверить вход. Войди снова.",status:401};const exp=data.session_expires_at?Date.parse(data.session_expires_at):0;if(!data.session_token_hash||!equal(await sha256(t),data.session_token_hash)||exp<Date.now())return {error:"Сессия истекла. Войди снова.",status:401};return {driver:data}}
async function newSession(c:any,id:string){const t=crypto.randomUUID()+crypto.randomUUID().replace(/-/g,"");const h=await sha256(t),exp=new Date(Date.now()+30*86400000).toISOString();const {error}=await c.from("drivers").update({session_token_hash:h,session_expires_at:exp,updated_at:new Date().toISOString()}).eq("id",id);if(error)throw error;return t}
function km(a:number,b:number,c:number,d:number){const R=6371,r=(x:number)=>x*Math.PI/180,da=r(c-a),db=r(d-b),x=Math.sin(da/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(db/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
async function geocodePoint(address:string,nearPoint:{lat:number,lng:number}|null){
 const clean=String(address||"").trim();
 if(!clean)throw new Error("Введи адрес, улицу и дом.");
 if(/^(мо[её]\\s+)?местоположение$/i.test(clean)){
  if(nearPoint)return nearPoint;
  throw new Error("GPS не определился. Нажми «Определить моё местоположение» или выбери адрес подачи из подсказок.");
 }
 const hasCity=/(астан|алмат|тал[аә]пкер|костанай|караганда|шымкент|павлодар|кокшетау|темиртау|уральск|актоб|атырау|семей|петропавл|казахстан|қазақстан|kazakhstan)/i.test(clean);
 const queries=[clean];
 if(!hasCity){
  queries.push(clean+", Астана, Казахстан");
  queries.push(clean+", Талапкер, Акмолинская область, Казахстан");
  queries.push(clean+", Казахстан");
 }else if(!/казахстан|қазақстан|kazakhstan/i.test(clean)){
  queries.push(clean+", Казахстан");
 }
 const unique=[...new Set(queries)];
 for(const query of unique){
  try{
   const params=new URLSearchParams({q:query,limit:"6",lang:"ru"});
   if(nearPoint){params.set("lat",String(nearPoint.lat));params.set("lon",String(nearPoint.lng))}
   const response=await fetch("https://photon.komoot.io/api/?"+params.toString(),{headers:{"Accept":"application/json"}});
   if(response.ok){
    const data=await response.json();
    const features=(data?.features||[]).filter((item:any)=>Array.isArray(item?.geometry?.coordinates)&&item.geometry.coordinates.length>=2&&Number.isFinite(Number(item.geometry.coordinates[0]))&&Number.isFinite(Number(item.geometry.coordinates[1])));
    if(features.length){
     const selected=nearPoint?features.sort((x:any,y:any)=>km(nearPoint.lat,nearPoint.lng,Number(x.geometry.coordinates[1]),Number(x.geometry.coordinates[0]))-km(nearPoint.lat,nearPoint.lng,Number(y.geometry.coordinates[1]),Number(y.geometry.coordinates[0])))[0]:features[0];
     const coords=selected.geometry.coordinates;
     return {lat:Number(coords[1]),lng:Number(coords[0])};
    }
   }
  }catch(e){console.error("Photon address lookup failed",query,String(e))}
 }
 for(const query of unique){
  try{
   const params=new URLSearchParams({q:query,format:"jsonv2",limit:"6",countrycodes:"kz","accept-language":"ru","addressdetails":"1"});
   const response=await fetch("https://nominatim.openstreetmap.org/search?"+params.toString(),{headers:{"Accept":"application/json","User-Agent":"MoyTaxi/1.0 (route address lookup)"}});
   if(response.ok){
    const data=await response.json();
    const features=(data||[]).filter((item:any)=>Number.isFinite(Number(item.lat))&&Number.isFinite(Number(item.lon)));
    if(features.length){
     const selected=nearPoint?features.sort((x:any,y:any)=>km(nearPoint.lat,nearPoint.lng,Number(x.lat),Number(x.lon))-km(nearPoint.lat,nearPoint.lng,Number(y.lat),Number(y.lon)))[0]:features[0];
     return {lat:Number(selected.lat),lng:Number(selected.lon)};
    }
   }
  }catch(e){console.error("Nominatim address lookup failed",query,String(e))}
 }
 throw new Error("Не удалось найти адрес. Выбери адрес из подсказок и проверь город, улицу и номер дома. Подачу можно оставить по GPS.");
}
async function roadDistance(a:{lat:number,lng:number},b:{lat:number,lng:number}){
 const url="https://router.project-osrm.org/route/v1/driving/"+a.lng+","+a.lat+";"+b.lng+","+b.lat+"?overview=full&geometries=geojson&steps=false";
 let response:Response;
 try{response=await fetch(url)}catch{throw new Error("Сервис автомобильных маршрутов временно недоступен. Попробуй ещё раз.")}
 if(!response.ok)throw new Error("Сервис автомобильных маршрутов временно недоступен. Попробуй ещё раз.");
 const data=await response.json(),route=data?.routes?.[0];
 if(data?.code!=="Ok"||!Number.isFinite(route?.distance)||route.distance<=0)throw new Error("Не удалось построить маршрут между этими адресами. Укажи город, улицу и дом.");
 const distanceKm=route.distance/1000;
 if(distanceKm>2000)throw new Error("Маршрут получился слишком длинным. Проверь адреса.");
 return {distanceKm,durationMin:Math.max(1,Math.ceil(Number(route.duration||0)/60)),geometry:route.geometry?.coordinates||[]};
}
function quoteFor(rates:any,distanceKm:number){
 const quotes:any={};
 for(const cls of VEHICLE_CLASSES){const row=(rates||{})[cls];const rate=Number(row?.rate_per_km||0),minimum=Number(row?.minimum_fare||0);if(rate>0)quotes[cls]=Math.max(minimum,Math.ceil(distanceKm*rate/10)*10)}
 return quotes;
}
function addressLabel(props:any){
 const street=[props?.street,props?.housenumber].filter(Boolean).join(" ");
 return [props?.name && props.name!==street ? props.name : "",street,props?.district,props?.city||props?.town||props?.village,props?.state,props?.country].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(", ");
}
async function suggestionDistances(rows:any[],nearPoint:{lat:number,lng:number}|null){
 if(!nearPoint||!rows.length)return rows;
 const valid=rows.slice(0,6);
 try{
  const points=[nearPoint,...valid.map((x:any)=>({lat:x.lat,lng:x.lng}))];
  const coords=points.map((point:any)=>point.lng+","+point.lat).join(";");
  const params=new URLSearchParams({sources:"0",destinations:valid.map((_:any,index:number)=>String(index+1)).join(";"),annotations:"distance,duration"});
  const response=await fetch("https://router.project-osrm.org/table/v1/driving/"+coords+"?"+params.toString());
  if(!response.ok)return rows;
  const data=await response.json();const distances=data?.distances?.[0]||[];
  return valid.map((item:any,index:number)=>({...item,distance_km:Number.isFinite(distances[index])?Number((distances[index]/1000).toFixed(1)):null}));
 }catch(e){console.error("Suggestion route distances unavailable",String(e));return rows}
}
async function suggestAddresses(query:string,nearPoint:{lat:number,lng:number}|null){
 const clean=String(query||"").trim();
 if(clean.length<2)return [];
 const hasCity=/(астан|алмат|тал[аә]пкер|костанай|караганда|шымкент|павлодар|кокшетау|темиртау|уральск|актоб|атырау|семей|петропавл|казахстан|қазақстан|kazakhstan)/i.test(clean);
 const variants=[clean];
 if(!hasCity){variants.push(clean+", Астана, Казахстан");variants.push(clean+", Талапкер, Акмолинская область, Казахстан");variants.push(clean+", Казахстан")}
 else if(!/казахстан|қазақстан|kazakhstan/i.test(clean))variants.push(clean+", Казахстан");
 const queries=[...new Set(variants)];
 for(const q of queries){
  try{
   const params=new URLSearchParams({q,limit:"8",lang:"ru"});
   if(nearPoint){params.set("lat",String(nearPoint.lat));params.set("lon",String(nearPoint.lng))}
   const response=await fetch("https://photon.komoot.io/api/?"+params.toString(),{headers:{"Accept":"application/json"}});
   if(response.ok){
    const data=await response.json();const rows=(data?.features||[]).map((feature:any)=>{
     const coords=feature?.geometry?.coordinates,props=feature?.properties||{};
     return {label:addressLabel(props),name:props.name||props.street||"Адрес",city:props.city||props.town||props.village||props.state||"Казахстан",lat:Number(coords?.[1]),lng:Number(coords?.[0])};
    }).filter((x:any)=>x.label&&Number.isFinite(x.lat)&&Number.isFinite(x.lng));
    if(rows.length){
     let best=rows;
     if(nearPoint)best=rows.sort((x:any,y:any)=>km(nearPoint.lat,nearPoint.lng,x.lat,x.lng)-km(nearPoint.lat,nearPoint.lng,y.lat,y.lng));
     return await suggestionDistances(best.slice(0,6),nearPoint);
    }
   }
  }catch(e){console.error("Photon suggestions failed",q,String(e))}
 }
 for(const q of queries){
  try{
   const params=new URLSearchParams({q,format:"jsonv2",limit:"8",countrycodes:"kz","accept-language":"ru","addressdetails":"1"});
   const response=await fetch("https://nominatim.openstreetmap.org/search?"+params.toString(),{headers:{"Accept":"application/json","User-Agent":"MoyTaxi/1.0 (address suggestion search)"}});
   if(response.ok){
    const data=await response.json();const rows=(data||[]).map((item:any)=>{
     const addr=item.address||{},street=[addr.road||addr.pedestrian||addr.residential,addr.house_number].filter(Boolean).join(" ");
     const label=street?[street,addr.suburb||addr.city_district,addr.city||addr.town||addr.village,addr.state].filter(Boolean).join(", "):String(item.display_name||"").split(", ").slice(0,4).join(", ");
     return {label,name:street||addr.amenity||addr.shop||addr.building||"Адрес",city:addr.city||addr.town||addr.village||addr.state||"Казахстан",lat:Number(item.lat),lng:Number(item.lon)};
    }).filter((x:any)=>x.label&&Number.isFinite(x.lat)&&Number.isFinite(x.lng));
    if(rows.length){
     let best=rows;
     if(nearPoint)best=rows.sort((x:any,y:any)=>km(nearPoint.lat,nearPoint.lng,x.lat,x.lng)-km(nearPoint.lat,nearPoint.lng,y.lat,y.lng));
     return await suggestionDistances(best.slice(0,6),nearPoint);
    }
   }
  }catch(e){console.error("Nominatim suggestions failed",q,String(e))}
 }
 return [];
}
function enrich(o:any,d:any){
 let distance=null;
 const locationAge=d?.location_updated_at?Date.now()-Date.parse(d.location_updated_at):Infinity;
 if(locationAge>=0&&locationAge<=5*60*1000&&[o.pickup_lat,o.pickup_lng,d?.current_lat,d?.current_lng].every(v=>typeof v==="number")){
  const candidate=km(o.pickup_lat,o.pickup_lng,d.current_lat,d.current_lng);
  if(Number.isFinite(candidate)&&candidate<=300)distance=candidate;
 }
 return {...o,distance_km:distance,driver_lat:d?.current_lat??null,driver_lng:d?.current_lng??null,driver_location_updated_at:d?.location_updated_at??null}
}

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

Deno.serve(async(req:Request)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});if(req.method!=="POST")return fail("Method not allowed",405);try{const c=await db(),p=await req.json(),a=String(p.action||"");

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
 if(a==="admin_update_vehicle_rates"){
  if(!p.vehicle_rates||typeof p.vehicle_rates!=="object")return fail("Нет тарифов автомобилей.");
  const next:any={};
  for(const cls of VEHICLE_CLASSES){
   const row=p.vehicle_rates[cls];const rate=Number(row?.rate_per_km),minimum=Number(row?.minimum_fare);
   if(!Number.isFinite(rate)||rate<1||rate>10000||!Number.isFinite(minimum)||minimum<0||minimum>1000000)return fail("Проверь тарифы: цена за км должна быть от 1 до 10000 ₸, минимум — от 0 до 1000000 ₸.");
   next[cls]={rate_per_km:Math.round(rate*100)/100,minimum_fare:Math.round(minimum)};
  }
  const {error}=await c.from("platform_settings").update({vehicle_rates:next,updated_at:new Date().toISOString()}).eq("id",true);
  if(error)return fail("Не удалось сохранить тарифы.",500);return reply({ok:true,vehicle_rates:next});
 }
 if(a==="admin_set_test_mode"){
  const testMode=Boolean(p.test_mode);
  if(!testMode)return fail("Рабочий режим пока закрыт: перед запуском нужно подключить и проверить реальное пополнение кошелька. Тестовый режим остаётся бесплатным.",409);
  const {error}=await c.from("platform_settings").update({test_mode:true,updated_at:new Date().toISOString()}).eq("id",true);
  if(error)return fail("Не удалось включить тестовый режим.",500);
  return reply({ok:true,test_mode:true});
 }
 if(a==="admin_wallet_adjust"){
  const driverId=String(p.driver_id||""),amountToAdd=Number(p.amount),note=String(p.note||"").trim().slice(0,300);
  if(!driverId||!Number.isFinite(amountToAdd)||amountToAdd<=0||amountToAdd>1000000)return fail("Укажи сумму пополнения от 1 до 1 000 000 ₸.");
  const {data:result,error}=await c.rpc("admin_topup_driver_wallet",{p_driver_id:driverId,p_amount:amountToAdd,p_note:note||"Ручное пополнение после проверки перевода"});
  if(error||!result)return fail(error?.message||"Не удалось пополнить лицевой счёт.",500);
  return reply({ok:true,topup:result});
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
  return reply({ok:true,stats:{drivers:driversQ.count||0,online_drivers:onlineQ.count||0,orders:ordersQ.count||0,completed_orders:doneQ.count||0,client_order_records:clientsQ.count||0,unique_clients:uniqueClients,commission_total:totalCommission,commission_due:dueCommission,commission_paid:paidCommission,commission_percent:Number(settings.commission_percent),vehicle_rates:settings.vehicle_rates||{},test_mode:settings.test_mode!==false}});
 }
 if(a==="admin_drivers"){
  const {data,error}=await c.from("drivers").select("id,public_code,name,phone,is_online,car_model,car_plate,car_color,vehicle_class,wallet_balance,created_at").order("created_at",{ascending:false}).limit(500);
  if(error)return fail("Не удалось загрузить список водителей.",500);return reply({ok:true,drivers:data||[]});
 }
 if(a==="admin_orders"){
  const {data,error}=await c.from("orders").select("id,status,created_at,completed_at,client_price,driver_price,agreed_price,pickup_address,destination_address,vehicle_class,route_distance_km,trip_type,payment_method,clients(name,phone),drivers(name,phone)").order("created_at",{ascending:false}).limit(200);
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

if(a==="register_driver"){const name=String(p.name||"").trim().slice(0,100),ph=phone(p.phone),pw=String(p.password||""),car=String(p.car_model||"").trim().slice(0,100),plate=String(p.car_plate||"").trim().slice(0,30),color=String(p.car_color||"").trim().slice(0,40),vclass=vehicleClass(p.vehicle_class);if(!name||!ph||pw.length<8)return fail("Укажи имя, телефон и пароль не короче 8 символов.");const {data:old}=await c.from("drivers").select("id").eq("phone",ph).maybeSingle();if(old)return fail("Этот номер уже зарегистрирован. Войди в приложение.");const salt=hex(crypto.getRandomValues(new Uint8Array(16))),hash=await passwordHash(pw,salt);const {data:d,error}=await c.from("drivers").insert({name,phone:ph,password_salt:salt,password_hash:hash,car_model:car||null,car_plate:plate||null,car_color:color||null,vehicle_class:vclass,is_online:true}).select("*").single();if(error||!d)return fail("Не удалось создать аккаунт.",500);return reply({ok:true,driver:pub(d),session_token:await newSession(c,d.id)})}
if(a==="login_driver"){const ph=phone(p.phone),pw=String(p.password||"");const {data:d,error}=await c.from("drivers").select("*").eq("phone",ph).maybeSingle();if(error)return fail("Не удалось выполнить вход.",500);if(!d||!equal(await passwordHash(pw,d.password_salt),d.password_hash))return fail("Неверный номер телефона или пароль.",401);return reply({ok:true,driver:pub(d),session_token:await newSession(c,d.id)})}
if(a==="availability"){const code=String(p.driver_code||"").trim().toUpperCase();const {data:d,error}=await c.from("drivers").select("*").eq("public_code",code).maybeSingle();if(error||!d)return fail("Водитель не найден.",404);return reply({ok:true,driver:pub(d)})}
if(a==="address_suggest"){
 const query=String(p.query||"").trim();
 const nearLat=p.near_lat===null||p.near_lat===undefined||p.near_lat===""?NaN:Number(p.near_lat);
 const nearLng=p.near_lng===null||p.near_lng===undefined||p.near_lng===""?NaN:Number(p.near_lng);
 const nearPoint=Number.isFinite(nearLat)&&Number.isFinite(nearLng)&&nearLat>=-90&&nearLat<=90&&nearLng>=-180&&nearLng<=180?{lat:nearLat,lng:nearLng}:null;
 const suggestions=await suggestAddresses(query,nearPoint);
 return reply({ok:true,suggestions});
}
if(a==="address_reverse"){
 const lat=Number(p.lat),lng=Number(p.lng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat>90||lng < -180||lng>180)return fail("Некорректные координаты GPS.");
 try{
  const response=await fetch("https://photon.komoot.io/reverse?"+new URLSearchParams({lat:String(lat),lon:String(lng),lang:"ru"}).toString(),{headers:{"Accept":"application/json"}});
  if(response.ok){
   const data=await response.json(),props=data?.features?.[0]?.properties;
   if(props){
    const label=addressLabel(props);
    if(label)return reply({ok:true,label,city:props.city||props.town||props.village||props.state||"Казахстан"});
   }
  }
 }catch(e){console.error("Photon reverse geocode failed",String(e))}
 try{
  const params=new URLSearchParams({lat:String(lat),lon:String(lng),format:"jsonv2","accept-language":"ru","addressdetails":"1"});
  const response=await fetch("https://nominatim.openstreetmap.org/reverse?"+params.toString(),{headers:{"Accept":"application/json","User-Agent":"MoyTaxi/1.0 (GPS address display)"}});
  if(response.ok){
   const data=await response.json(),addr=data?.address||{};
   const street=[addr.road||addr.pedestrian||addr.residential,addr.house_number].filter(Boolean).join(" ");
   const label=[street,addr.suburb||addr.city_district,addr.city||addr.town||addr.village,addr.state].filter(Boolean).join(", ")||String(data?.display_name||"").split(", ").slice(0,4).join(", ");
   if(label)return reply({ok:true,label,city:addr.city||addr.town||addr.village||addr.state||"Казахстан"});
  }
 }catch(e){console.error("Nominatim reverse geocode failed",String(e))}
 return fail("GPS определён, но адрес не найден. Можно оставить «Моё местоположение».",422);
}
if(a==="public_tariffs"){
 const {data:settingsRow,error}=await c.from("platform_settings").select("vehicle_rates,test_mode").eq("id",true).maybeSingle();
 if(error||!settingsRow)return fail("Не удалось загрузить тарифы.",500);
 const {data:onlineRows}=await c.from("drivers").select("vehicle_class").eq("is_online",true).limit(1000);
 const onlineClasses=[...new Set((onlineRows||[]).map((r:any)=>vehicleClass(r.vehicle_class)))];
 return reply({ok:true,vehicle_rates:settingsRow.vehicle_rates||{},test_mode:settingsRow.test_mode!==false,online_classes:onlineClasses});
}
if(a==="calculate_route"){
 const pickupAddress=String(p.pickup_address||"").trim(),destinationAddress=String(p.destination_address||"").trim();
 const optionalNumber=(v:any)=>v===null||v===undefined||v===""?NaN:Number(v);
 const lat=optionalNumber(p.pickup_lat),lng=optionalNumber(p.pickup_lng),destLat=optionalNumber(p.destination_lat),destLng=optionalNumber(p.destination_lng);
 if(!pickupAddress||!destinationAddress)return fail("Укажи место подачи и адрес назначения.");
 if((Number.isFinite(destLat)&&(!Number.isFinite(destLng)||destLat < -90||destLat>90||destLng < -180||destLng>180))||(!Number.isFinite(destLat)&&Number.isFinite(destLng)))return fail("Некорректные координаты адреса назначения.");
 if((Number.isFinite(lat)&&(!Number.isFinite(lng)||lat < -90||lat>90||lng < -180||lng>180))||(!Number.isFinite(lat)&&Number.isFinite(lng)))return fail("Некорректные координаты подачи.");
 try{
  const pickupPoint=Number.isFinite(lat)?{lat,lng}:await geocodePoint(pickupAddress,null);
  const destinationPoint=Number.isFinite(destLat)?{lat:destLat,lng:destLng}:await geocodePoint(destinationAddress,pickupPoint);
  const route=await roadDistance(pickupPoint,destinationPoint);
  const {data:settingsRow,error}=await c.from("platform_settings").select("vehicle_rates,test_mode").eq("id",true).maybeSingle();
  if(error||!settingsRow)return fail("Не удалось загрузить тарифы.",500);
  const {data:onlineRows}=await c.from("drivers").select("vehicle_class").eq("is_online",true).limit(1000);
  const onlineClasses=[...new Set((onlineRows||[]).map((r:any)=>vehicleClass(r.vehicle_class)))];
  return reply({ok:true,pickup_point:pickupPoint,destination_point:destinationPoint,distance_km:Number(route.distanceKm.toFixed(2)),duration_minutes:route.durationMin,route_geometry:route.geometry,estimated_prices:quoteFor(settingsRow.vehicle_rates,route.distanceKm),online_classes:onlineClasses,test_mode:settingsRow.test_mode!==false});
 }catch(e){return fail(e instanceof Error?e.message:"Не удалось рассчитать маршрут.",422)}
}
if(a==="create_order"){
 const code=String(p.driver_code||"").trim().toUpperCase(),name=String(p.name||"").trim().slice(0,100),ph=phone(p.phone),pickup=String(p.pickup_address||"").trim().slice(0,300),dest=String(p.destination_address||"").trim().slice(0,300),comment=String(p.comment||"").trim().slice(0,500);
 const optionalNumber=(v:any)=>v===null||v===undefined||v===""?NaN:Number(v);
 const lat=optionalNumber(p.pickup_lat),lng=optionalNumber(p.pickup_lng),destLat=optionalNumber(p.destination_lat),destLng=optionalNumber(p.destination_lng),distance=optionalNumber(p.route_distance_km);
 const tripType=p.trip_type==="intercity"?"intercity":"city";
 let cls=vehicleClass(p.vehicle_class),d:any=null,price=Number(p.client_price),driverDistance=Infinity,finalDistance=distance;
 if(!name||!ph||!pickup||!dest)return fail("Заполни имя, телефон, адрес подачи и адрес назначения.");
 if(code==="AUTO"){
  if(![lat,lng,destLat,destLng,distance].every(Number.isFinite)||lat < -90||lat>90||lng < -180||lng>180||destLat < -90||destLat>90||destLng < -180||destLng>180||distance<=0||distance>2000)return fail("Не удалось определить автомобильный маршрут. Проверь адреса и попробуй ещё раз.");
  const {data:settingsRow,error:se}=await c.from("platform_settings").select("vehicle_rates,test_mode").eq("id",true).maybeSingle();
  if(se||!settingsRow)return fail("Не удалось загрузить тариф.",500);
  const routeResponse=await fetch("https://router.project-osrm.org/route/v1/driving/"+lng+","+lat+";"+destLng+","+destLat+"?overview=false&steps=false");
  if(!routeResponse.ok)return fail("Сервис расчёта дорожного маршрута временно недоступен.",503);
  const routeData=await routeResponse.json();
  const roadMeters=routeData?.routes?.[0]?.distance;
  if(routeData?.code!=="Ok"||!Number.isFinite(roadMeters)||roadMeters<=0)return fail("Не удалось найти автомобильный маршрут между адресами.",422);
  const serverDistance=roadMeters/1000;
  if(serverDistance>2000)return fail("Маршрут получился слишком длинным. Проверь адреса.",422);
  finalDistance=serverDistance;
  const rateRow=(settingsRow.vehicle_rates||{})[cls];const rate=Number(rateRow?.rate_per_km||0),minimum=Number(rateRow?.minimum_fare||0);
  if(rate<1)return fail("Для этого класса пока не настроен тариф.");
  price=Math.max(minimum,Math.ceil(serverDistance*rate/10)*10);
  const {data:available,error:de}=await c.from("drivers").select("id").eq("is_online",true).eq("vehicle_class",cls).limit(500);
  if(de)return fail("Не удалось найти свободных водителей.",500);
  if(!available?.length)return fail("Сейчас пока нет водителей класса «"+cls+"» на линии. Попробуй другой класс или немного позже.",409);
  // No driver is assigned yet. Every online driver in the selected class can review the request and send an offer.
  d=null;
 }else{
  const {data:direct,error:de}=await c.from("drivers").select("id,is_online,vehicle_class,current_lat,current_lng").eq("public_code",code).maybeSingle();
  if(de||!direct)return fail("Водитель не найден.",404);
  if(!direct.is_online)return fail("Водитель сейчас не на линии.",409);
  d=direct;cls=vehicleClass(d.vehicle_class);
 }
 const {data:clRow,error:ce}=await c.from("clients").insert({name,phone:ph}).select("id").single();
 if(ce||!clRow)return fail("Не удалось сохранить клиента.",500);
 const autoPrice=code==="AUTO";
 const paymentMethod=p.payment_method==="kaspi_gold"?"kaspi_gold":"cash";
 const token=crypto.randomUUID();
 const {data:o,error:oe}=await c.from("orders").insert({
  client_id:clRow.id,driver_id:autoPrice?null:d.id,payment_method:paymentMethod,pickup_address:pickup,pickup_lat:Number.isFinite(lat)?lat:null,pickup_lng:Number.isFinite(lng)?lng:null,
  destination_address:dest,destination_lat:Number.isFinite(destLat)?destLat:null,destination_lng:Number.isFinite(destLng)?destLng:null,
  route_distance_km:Number.isFinite(finalDistance)&&finalDistance>0?Number(finalDistance.toFixed(2)):null,trip_type:tripType,vehicle_class:cls,
  comment:comment||null,client_token:token,status:"new",client_price:autoPrice?price:(Number.isFinite(price)&&price>0?price:null),
  price_status:"pending",agreed_price:null
 }).select("*").single();
 if(oe||!o)return fail("Не удалось отправить заказ.",500);
 return reply({ok:true,order:o,assigned_driver:d?pub(d):null,searching:autoPrice,test_mode:true});
}
if(a==="order_status"){
 const id=String(p.order_id||""),token=String(p.client_token||"");
 const {data:o,error}=await c.from("orders").select("*,drivers(name,phone,car_model,car_plate,car_color,photo_url,is_online,current_lat,current_lng,location_updated_at,documents_verified,vehicle_class)").eq("id",id).eq("client_token",token).maybeSingle();
 if(error||!o)return fail("Заказ не найден.",404);
 const [offersQ,ratingQ]=await Promise.all([
  c.from("order_offers").select("id,order_id,driver_id,price,status,created_at,drivers(name,phone,car_model,car_plate,car_color,photo_url,vehicle_class,current_lat,current_lng,location_updated_at)").eq("order_id",id).order("created_at",{ascending:true}),
  c.from("driver_ratings").select("id,stars,comment,created_at").eq("order_id",id).maybeSingle()
 ]);
 if(offersQ.error)return fail("Не удалось загрузить предложения водителей.",500);
 if(ratingQ.error)return fail("Не удалось загрузить оценку поездки.",500);
 return reply({ok:true,order:enrich(o,o.drivers),rating:ratingQ.data||null,offers:(offersQ.data||[]).map((row:any)=>({...row,drivers:row.drivers?{...row.drivers,vehicle_class:vehicleClass(row.drivers.vehicle_class)}:null}))});
}
if(a==="client_mark_ready"){
 const id=String(p.order_id||""),token=String(p.client_token||"");
 if(!id||!token)return fail("Не хватает данных заказа.");
 const {data:o,error}=await c.from("orders").select("id,status").eq("id",id).eq("client_token",token).maybeSingle();
 if(error||!o)return fail("Заказ не найден.",404);
 if(o.status!=="arrived")return fail("Водитель ещё не отметил прибытие.");
 const {data:u,error:ue}=await c.from("orders").update({status:"client_ready"}).eq("id",id).eq("status","arrived").select("*").maybeSingle();
 if(ue||!u)return fail("Не удалось сообщить водителю, что ты выходишь.",500);
 return reply({ok:true,order:u});
}
if(a==="client_rate_driver"){
 const id=String(p.order_id||""),token=String(p.client_token||""),stars=Number(p.stars),comment=String(p.comment||"").trim().slice(0,500);
 if(!id||!token||!Number.isInteger(stars)||stars<1||stars>5)return fail("Выбери оценку от 1 до 5 звёзд.");
 const {data:o,error}=await c.from("orders").select("id,status,driver_id,client_id").eq("id",id).eq("client_token",token).maybeSingle();
 if(error||!o)return fail("Заказ не найден.",404);
 if(o.status!=="completed"||!o.driver_id)return fail("Оценку можно поставить после завершения поездки.");
 const {data:existing}=await c.from("driver_ratings").select("id").eq("order_id",id).maybeSingle();
 if(existing)return fail("Ты уже оценил эту поездку.");
 const {data:rating,error:re}=await c.from("driver_ratings").insert({order_id:id,driver_id:o.driver_id,client_id:o.client_id,stars,comment:comment||null}).select("*").single();
 if(re||!rating)return fail("Не удалось сохранить оценку.",500);
 return reply({ok:true,rating});
}
if(a==="client_accept_offer"||a==="client_decline_offer"){
 const id=String(p.order_id||""),token=String(p.client_token||""),offerId=String(p.offer_id||"");
 if(!id||!token||!offerId)return fail("Не хватает данных предложения.");
 const {data:o,error:oe}=await c.from("orders").select("id,status,driver_id,client_token").eq("id",id).eq("client_token",token).maybeSingle();
 if(oe||!o)return fail("Заказ не найден.",404);
 if(o.status!=="new"||o.driver_id)return fail("Этот заказ уже принят или отменён.",409);
 const {data:offer,error:ofe}=await c.from("order_offers").select("id,driver_id,price,status").eq("id",offerId).eq("order_id",id).maybeSingle();
 if(ofe||!offer)return fail("Предложение водителя не найдено.",404);
 if(offer.status!=="pending")return fail("Это предложение уже недоступно.",409);
 if(a==="client_decline_offer"){
  const {data:declined,error}=await c.from("order_offers").update({status:"declined",responded_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",offerId).eq("status","pending").select("id,status").maybeSingle();
  if(error||!declined)return fail("Не удалось отклонить предложение.",500);
  return reply({ok:true,offer:declined});
 }
 const {data:claimed,error:claimError}=await c.from("orders").update({driver_id:offer.driver_id,status:"accepted",accepted_at:new Date().toISOString(),agreed_price:offer.price,driver_price:offer.price,price_status:"accepted"}).eq("id",id).eq("client_token",token).eq("status","new").is("driver_id",null).select("*,drivers(name,phone,car_model,car_plate,car_color,photo_url,is_online,current_lat,current_lng,location_updated_at,documents_verified,vehicle_class)").maybeSingle();
 if(claimError||!claimed)return fail("Другой водитель уже получил заказ. Обнови экран.",409);
 await c.from("order_offers").update({status:"declined",responded_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("order_id",id).eq("status","pending").neq("id",offerId);
 const {data:selected,error:selectedError}=await c.from("order_offers").update({status:"accepted",responded_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",offerId).eq("status","pending").select("*").maybeSingle();
 if(selectedError||!selected)return fail("Заказ выбран, но не удалось обновить статус предложения.",500);
 return reply({ok:true,order:enrich(claimed,claimed.drivers),offer:selected});
}
if(a==="client_accept_price"||a==="client_decline_price"){const id=String(p.order_id||""),token=String(p.client_token||"");if(!id||!token)return fail("Не хватает номера заказа.");const {data:o,error}=await c.from("orders").select("id,status,price_status,driver_price").eq("id",id).eq("client_token",token).maybeSingle();if(error||!o)return fail("Заказ не найден.",404);if(o.status!=="new"||o.price_status!=="driver_offered"||!Number(o.driver_price))return fail("Предложение цены уже недоступно.");const accept=a==="client_accept_price";const patch=accept?{price_status:"accepted",agreed_price:o.driver_price}:{price_status:"declined"};const {data:u,error:ue}=await c.from("orders").update(patch).eq("id",id).eq("client_token",token).select("*").single();if(ue||!u)return fail("Не удалось сохранить ответ на цену.",500);return reply({ok:true,order:u})}
if(a==="cancel_order"){const id=String(p.order_id||""),token=String(p.client_token||"");const {data:o}=await c.from("orders").select("id,status").eq("id",id).eq("client_token",token).maybeSingle();if(!o)return fail("Заказ не найден.",404);if(o.status!=="new")return fail("Этот заказ уже принят водителем.");const {data:u,error}=await c.from("orders").update({status:"cancelled"}).eq("id",id).select("id,status").single();if(error)return fail("Не удалось отменить заказ.",500);return reply({ok:true,order:u})}
if(["driver_me","driver_list","driver_history","driver_update","driver_toggle_online","driver_update_profile","driver_logout","driver_location","driver_offer_price","driver_skip_order"].includes(a)){const s=await sess(c,p);if(!s.driver)return fail(s.error||"Нужен вход.",s.status||401);const d=s.driver;if(a==="driver_me"){
 const {data:ratingRows}=await c.from("driver_ratings").select("stars").eq("driver_id",d.id).limit(10000);
 const scores=(ratingRows||[]).map((x:any)=>Number(x.stars)).filter((x:number)=>x>=1&&x<=5);
 return reply({ok:true,driver:{...pub(d),rating_average:scores.length?Number((scores.reduce((a:number,b:number)=>a+b,0)/scores.length).toFixed(2)):null,rating_count:scores.length}});
}
if(a==="driver_wallet"){
 const {data:settingsRow}=await c.from("platform_settings").select("test_mode,minimum_wallet_balance").eq("id",true).maybeSingle();
 const {data:transactions,error}=await c.from("wallet_transactions").select("id,order_id,kind,amount,balance_before,balance_after,status,note,created_at").eq("driver_id",d.id).order("created_at",{ascending:false}).limit(50);
 if(error)return fail("Не удалось загрузить операции лицевого счёта.",500);
 return reply({ok:true,wallet_balance:Number(d.wallet_balance||0),test_mode:settingsRow?.test_mode!==false,minimum_wallet_balance:Number(settingsRow?.minimum_wallet_balance||500),transactions:transactions||[]});
}if(a==="driver_logout"){await c.from("drivers").update({session_token_hash:null,session_expires_at:null}).eq("id",d.id);return reply({ok:true});}if(a==="driver_location"){const lat=Number(p.lat),lng=Number(p.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return fail("Некорректная геопозиция.");const {error}=await c.from("drivers").update({current_lat:lat,current_lng:lng,location_accuracy:Number(p.accuracy)||null,location_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",d.id);if(error)return fail("Не удалось обновить геопозицию.",500);return reply({ok:true})}if(a==="driver_offer_price"){
 const id=String(p.order_id||""),price=Math.round(Number(p.price));
 if(!id||!Number.isFinite(price)||price<100||price>1000000)return fail("Укажи корректную цену от 100 до 1 000 000 ₸.");
 const {data:o,error:oe}=await c.from("orders").select("id,status,driver_id,vehicle_class,client_price").eq("id",id).maybeSingle();
 if(oe||!o)return fail("Заказ не найден.",404);
 if(o.status!=="new"||(o.driver_id&&o.driver_id!==d.id))return fail("Этот заказ уже недоступен.");
 if(!o.driver_id&&vehicleClass(o.vehicle_class)!==vehicleClass(d.vehicle_class))return fail("Этот заказ для другого класса автомобиля.");
 const {data:existing}=await c.from("order_offers").select("id,status").eq("order_id",id).eq("driver_id",d.id).maybeSingle();
 if(existing?.status==="skipped")return fail("Ты скрыл этот заказ у себя. Он недоступен для повторного отклика.");
 const {data:offer,error:offerError}=await c.from("order_offers").upsert({order_id:id,driver_id:d.id,price,status:"pending",responded_at:null,updated_at:new Date().toISOString()},{onConflict:"order_id,driver_id"}).select("*").single();
 if(offerError||!offer)return fail("Не удалось отправить предложение цены.",500);
 if(o.driver_id)await c.from("orders").update({driver_price:price,price_status:"driver_offered"}).eq("id",id).eq("status","new");
 return reply({ok:true,offer,order:o});
}
if(a==="driver_skip_order"){
 const id=String(p.order_id||"");
 const {data:o,error:oe}=await c.from("orders").select("id,status,driver_id,vehicle_class,client_price").eq("id",id).maybeSingle();
 if(oe||!o)return fail("Заказ не найден.",404);
 if(o.status!=="new"||o.driver_id)return fail("Этот заказ уже недоступен.");
 if(vehicleClass(o.vehicle_class)!==vehicleClass(d.vehicle_class))return fail("Этот заказ для другого класса автомобиля.");
 const {error}=await c.from("order_offers").upsert({order_id:id,driver_id:d.id,price:Math.max(100,Number(o.client_price)||100),status:"skipped",responded_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"order_id,driver_id"});
 if(error)return fail("Не удалось убрать заказ из списка.",500);
 return reply({ok:true});
}if(a==="driver_toggle_online"){
 const wantsOnline=Boolean(p.is_online);
 if(wantsOnline){
  const {data:settingsRow,error:se}=await c.from("platform_settings").select("test_mode,minimum_wallet_balance").eq("id",true).maybeSingle();
  if(se||!settingsRow)return fail("Не удалось проверить баланс перед выходом на линию.",500);
  if(settingsRow.test_mode!==true&&Number(d.wallet_balance||0)<Number(settingsRow.minimum_wallet_balance||500))return fail("Недостаточно средств на лицевом счёте. Пополни баланс перед выходом на линию.");
 }
 const {data:u,error}=await c.from("drivers").update({is_online:wantsOnline,updated_at:new Date().toISOString()}).eq("id",d.id).select("*").single();
 if(error)return fail("Не удалось изменить статус.",500);
 return reply({ok:true,is_online:u.is_online,driver:pub(u)});
}if(a==="driver_update_profile"){const name=String(p.name||"").trim().slice(0,100),car=String(p.car_model||"").trim().slice(0,100),plate=String(p.car_plate||"").trim().slice(0,30),color=String(p.car_color||"").trim().slice(0,40),photo=String(p.photo_url||""),vclass=vehicleClass(p.vehicle_class||d.vehicle_class);if(!name)return fail("Имя не может быть пустым.");if(photo.length>250000)return fail("Фото слишком большое.");const {data:u,error}=await c.from("drivers").update({name,car_model:car||null,car_plate:plate||null,car_color:color||null,vehicle_class:vclass,photo_url:photo||null,updated_at:new Date().toISOString()}).eq("id",d.id).select("*").single();if(error)return fail("Не удалось обновить профиль.",500);return reply({ok:true,driver:pub(u)})}if(a==="driver_list"){
 const [assignedQ,broadcastQ]=await Promise.all([
  c.from("orders").select("*,clients(name,phone)").eq("driver_id",d.id).in("status",["new","accepted","arrived","client_ready","started"]).order("created_at",{ascending:false}),
  c.from("orders").select("*,clients(name,phone)").is("driver_id",null).eq("vehicle_class",vehicleClass(d.vehicle_class)).eq("status","new").order("created_at",{ascending:false}).limit(100)
 ]);
 if(assignedQ.error||broadcastQ.error)return fail("Не удалось загрузить заказы.",500);
 const ids=new Set((assignedQ.data||[]).map((o:any)=>o.id));
 const all=[...(assignedQ.data||[]),...(broadcastQ.data||[]).filter((o:any)=>!ids.has(o.id))].sort((a:any,b:any)=>Date.parse(b.created_at)-Date.parse(a.created_at));
 const {data:myOffers}=await c.from("order_offers").select("order_id,status,price").eq("driver_id",d.id).in("status",["pending","accepted","declined","skipped"]).limit(1000);
 const declined=new Set((myOffers||[]).filter((x:any)=>x.status==="skipped").map((x:any)=>x.order_id));
 return reply({ok:true,orders:all.filter((o:any)=>o.driver_id||!declined.has(o.id)).map((o:any)=>({...enrich(o,d),my_offer:(myOffers||[]).find((x:any)=>x.order_id===o.id)||null})),is_online:d.is_online});
}if(a==="driver_history"){const {data:os,error}=await c.from("orders").select("*,clients(name,phone)").eq("driver_id",d.id).eq("status","completed").order("completed_at",{ascending:false}).limit(100);if(error)return fail("Не удалось загрузить историю.",500);return reply({ok:true,orders:os||[]})}if(a==="driver_update"){
 const id=String(p.order_id||""),status=String(p.status||"");
 if(!["accepted","arrived","started","completed","cancelled"].includes(status))return fail("Недопустимый статус.");
 const {data:o}=await c.from("orders").select("*").eq("id",id).eq("driver_id",d.id).maybeSingle();
 if(!o)return fail("Заказ не найден.",404);
 if(status==="completed"){
  const {data:settingsRow,error:se}=await c.from("platform_settings").select("commission_percent,test_mode").eq("id",true).maybeSingle();
  if(se||!settingsRow)return fail("Не удалось рассчитать комиссию за поездку.",500);
  const {data:finance,error:fe}=await c.rpc("complete_taxi_order",{
   p_order_id:id,p_driver_id:d.id,p_commission_percent:Number(settingsRow.commission_percent||0),p_test_mode:settingsRow.test_mode!==false
  });
  if(fe||!finance)return fail(fe?.message||"Не удалось завершить поездку и рассчитать заработок.",500);
  const {data:doneOrder,error:oe}=await c.from("orders").select("*,clients(name,phone)").eq("id",id).single();
  const {data:updatedDriver}=await c.from("drivers").select("*").eq("id",d.id).single();
  if(oe||!doneOrder)return fail("Поездка завершена, но не удалось загрузить итог.",500);
  return reply({ok:true,order:doneOrder,finance,driver:updatedDriver?pub(updatedDriver):pub(d)});
 }
 if(status==="accepted"&&o.price_status==="driver_offered")return fail("Сначала дождись ответа клиента на твою цену.");
 if(status==="arrived"&&o.status!=="accepted")return fail("Сначала нужно принять заказ.");
 if(status==="started"&&o.status!=="client_ready")return fail("Дождись, пока пассажир нажмёт «Я выхожу».");
 if(status==="cancelled"&&["completed","cancelled"].includes(o.status))return fail("Этот заказ уже закрыт.");
 const patch:any={status};
 if(status==="accepted"){
  patch.accepted_at=new Date().toISOString();
  if(o.price_status!=="accepted"){
   if(Number(o.client_price)>0){patch.agreed_price=o.client_price;patch.price_status="accepted"}
   else{patch.agreed_price=null;patch.price_status="pending"}
  }
 }
 const {data:u,error}=await c.from("orders").update(patch).eq("id",id).select("*").single();
 if(error)return fail("Не удалось изменить заказ.",500);
 return reply({ok:true,order:u})
}
return fail("Неизвестное действие.",400)}catch(e){console.error("moy-taxi-api",e);return fail("Внутренняя ошибка сервера.",500)}});

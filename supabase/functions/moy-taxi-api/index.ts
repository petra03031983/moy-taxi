import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});const fail=(m:string,s=400)=>reply({ok:false,error:m},s);const enc=new TextEncoder();const hex=(b:ArrayBuffer|Uint8Array)=>Array.from(b instanceof Uint8Array?b:new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");const fromHex=(v:string)=>new Uint8Array((v.match(/.{1,2}/g)||[]).map(x=>parseInt(x,16)));
async function sha256(v:string){return hex(await crypto.subtle.digest("SHA-256",enc.encode(v)))}async function passwordHash(p:string,s:string){const k=await crypto.subtle.importKey("raw",enc.encode(p),"PBKDF2",false,["deriveBits"]);return hex(await crypto.subtle.deriveBits({name:"PBKDF2",salt:fromHex(s),iterations:120000,hash:"SHA-256"},k,256))}function equal(a:string,b:string){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}function phone(v:unknown){let d=String(v||"").replace(/\D/g,"");if(d.length===11&&d.startsWith("8"))d="7"+d.slice(1);return d.length>=10&&d.length<=15?"+"+d:""}
const VEHICLE_CLASSES=["economy","comfort","comfort_plus","business","minivan","premium"];
function vehicleClass(v:unknown){const x=String(v||"economy");return VEHICLE_CLASSES.includes(x)?x:"economy"}
function pub(d:any){return {id:d.id,account_number:d.account_number||null,public_code:d.public_code,name:d.name,phone:d.phone,car_model:d.car_model||"",car_plate:d.car_plate||"",car_color:d.car_color||"",vehicle_class:vehicleClass(d.vehicle_class),photo_url:d.photo_url||"",wallet_balance:Number(d.wallet_balance||0),is_online:Boolean(d.is_online),current_lat:d.current_lat??null,current_lng:d.current_lng??null,location_updated_at:d.location_updated_at||null,documents_verified:Boolean(d.documents_verified)}}
async function db(){const u=Deno.env.get("SUPABASE_URL"),k=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!u||!k)throw new Error("Server configuration is incomplete");return createClient(u,k,{auth:{persistSession:false,autoRefreshToken:false}})}
async function sess(c:any,p:any){const id=String(p.driver_id||""),t=String(p.session_token||"");if(!id||t.length<20)return {error:"Сессия истекла. Войди снова.",status:401};const {data,error}=await c.from("drivers").select("*").eq("id",id).maybeSingle();if(error||!data)return {error:"Не удалось проверить вход. Войди снова.",status:401};const exp=data.session_expires_at?Date.parse(data.session_expires_at):0;if(!data.session_token_hash||!equal(await sha256(t),data.session_token_hash)||exp<Date.now())return {error:"Сессия истекла. Войди снова.",status:401};return {driver:data}}
async function newSession(c:any,id:string){const t=crypto.randomUUID()+crypto.randomUUID().replace(/-/g,"");const h=await sha256(t),exp=new Date(Date.now()+30*86400000).toISOString();const {error}=await c.from("drivers").update({session_token_hash:h,session_expires_at:exp,updated_at:new Date().toISOString()}).eq("id",id);if(error)throw error;return t}
function km(a:number,b:number,c:number,d:number){const R=6371,r=(x:number)=>x*Math.PI/180,da=r(c-a),db=r(d-b),x=Math.sin(da/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(db/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
async function geocodePoint(address:string,nearPoint:{lat:number,lng:number}|null,key:string){
 const clean=String(address||"").trim();
 if(!clean)throw new Error("Введи конечный адрес.");
 if(/^(мо[её]\s+)?местоположение$/i.test(clean)){
  if(nearPoint)return nearPoint;
  throw new Error("Не удалось получить GPS клиента.");
 }
 const hasCity=/(астан|алмат|тал[аә]пкер|костанай|караганда|шымкент|павлодар|кокшетау|темиртау|уральск|актоб|атырау|семей|петропавл|казахстан|қазақстан|kazakhstan)/i.test(clean);
 const queries:string[]=[];
 if(!hasCity&&nearPoint&&nearPoint.lat>50&&nearPoint.lat<52&&nearPoint.lng>69&&nearPoint.lng<73)queries.push(clean+", Астана, Казахстан");
 queries.push(clean);
 if(!/казахстан|қазақстан|kazakhstan/i.test(clean))queries.push(clean+", Казахстан");
 for(const query of [...new Set(queries)]){
  const params=new URLSearchParams({q:query,fields:"items.point,items.full_address_name,items.address,items.geometry.centroid",locale:"ru_KZ",key});
  if(nearPoint)params.set("sort_point",nearPoint.lng+","+nearPoint.lat);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7500);
  try{
   const response=await fetch("https://catalog.api.2gis.com/3.0/items/geocode?"+params.toString(),{headers:{"Accept":"application/json"},signal:controller.signal});
   if(response.status===401||response.status===403)throw new Error("2ГИС отклонил ключ Geocoder API. Проверь доступ к геокодеру.");
   if(!response.ok)continue;
   const data=await response.json();
   const items=data?.result?.items||[];
   const points=items.map((item:any)=>pointFrom2gis(item)).filter((point:any)=>point!==null);
   if(points.length){
    if(nearPoint)points.sort((a:any,b:any)=>km(nearPoint.lat,nearPoint.lng,a.lat,a.lng)-km(nearPoint.lat,nearPoint.lng,b.lat,b.lng));
    return points[0];
   }
  }catch(e){
   if(e instanceof Error&&e.message.includes("2ГИС отклонил ключ"))throw e;
   if((e as any)?.name!=="AbortError")console.error("2GIS geocoder failed",query,String(e));
  }finally{clearTimeout(timer)}
 }
 throw new Error("2ГИС не нашёл этот адрес. Добавь город или выбери точный вариант из подсказок.");
}
async function reverseGeocodePoint2gis(point:{lat:number,lng:number},key:string){
 try{
  const params=new URLSearchParams({lon:String(point.lng),lat:String(point.lat),fields:"items.full_address_name,items.address,items.adm_div",locale:"ru_KZ",key});
  const response=await fetch("https://catalog.api.2gis.com/3.0/items/geocode?"+params.toString(),{headers:{"Accept":"application/json"}});
  if(!response.ok)return null;
  const data=await response.json(),item=data?.result?.items?.[0];
  if(!item)return null;
  const label=String(item.full_address_name||(typeof item.address==="string"?item.address:"")||item.address?.full_address_name||item.address?.name||item.address_name||item.name||"");
  const divisions=(item.adm_div||[]).map((x:any)=>x.name||x.caption).filter(Boolean);
  const city=divisions.find((v:string)=>/астана|алматы|тал[аә]пкер|город/i.test(v))||divisions[0]||"Казахстан";
  return label?{label,city}:null;
 }catch(e){console.error("2GIS reverse geocoder fallback failed",String(e));return null}
}

function wktLinePoints(wkt:string){
 const match=/LINESTRING(?:\s+Z)?\s*\(([^)]+)\)/i.exec(String(wkt||""));
 if(!match)return [];
 return match[1].split(",").map(part=>{
  const nums=part.trim().split(/\s+/).map(Number);
  return nums.length>=2&&Number.isFinite(nums[0])&&Number.isFinite(nums[1])?[nums[0],nums[1]]:null;
 }).filter((v:any)=>v!==null);
}

function get2gisRouteGeometry(route:any){
 const points:number[][]=[];
 const add=(wkt:string)=>{for(const point of wktLinePoints(wkt)){const last=points[points.length-1];if(!last||last[0]!==point[0]||last[1]!==point[1])points.push(point)}};
 add(route?.begin_pedestrian_path?.geometry?.selection||"");
 const maneuvers=route?.maneuvers||{};
 for(const maneuver of Object.values(maneuvers) as any[]){
  const geometries=maneuver?.outcoming_path?.geometry||{};
  for(const geometry of Object.values(geometries) as any[])add(geometry?.selection||"");
 }
 add(route?.end_pedestrian_path?.geometry?.selection||"");
 return points;
}
async function roadDistance(a:{lat:number,lng:number},b:{lat:number,lng:number},key:string){
 const url="https://routing.api.2gis.com/routing/7.0.0/global?key="+encodeURIComponent(key);
 let response:Response;
 try{
  response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({
   points:[{type:"stop",lon:a.lng,lat:a.lat,start:true},{type:"stop",lon:b.lng,lat:b.lat}],
   transport:"driving",output:"detailed",locale:"ru",route_mode:"fastest",traffic_mode:"jam"
  })});
 }catch{throw new Error("Сервис маршрутов 2ГИС временно недоступен. Попробуй ещё раз.")}
 if(!response.ok){
  const body=await response.text().catch(()=> "");
  console.error("2GIS Routing API error",response.status,body.slice(0,500));
  throw new Error(response.status===401||response.status===403?"2ГИС отклонил API-ключ или у ключа нет доступа к Routing API. Проверь права ключа в кабинете 2ГИС.":"2ГИС не смог построить маршрут. Попробуй уточнить адрес.");
 }
 const data=await response.json(),route=data?.result?.[0];
 if(data?.status!=="OK"||!Number.isFinite(Number(route?.total_distance))||Number(route.total_distance)<=0){
  console.error("2GIS route not found",data?.status,data?.message);
  throw new Error("2ГИС не нашёл автомобильный маршрут между этими точками. Проверь адрес назначения.");
 }
 const distanceKm=Number(route.total_distance)/1000;
 if(distanceKm>2000)throw new Error("Маршрут получился слишком длинным. Проверь адрес.");
 return {distanceKm,durationMin:Math.max(1,Math.ceil(Number(route.total_duration||0)/60)),geometry:get2gisRouteGeometry(route)};
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
async function suggestAddresses(query:string,nearPoint:{lat:number,lng:number}|null,key:string){
 const clean=String(query||"").trim();
 if(clean.length<2)return [];
 const nearAstana=Boolean(nearPoint&&nearPoint.lat>50&&nearPoint.lat<52&&nearPoint.lng>69&&nearPoint.lng<73);
 const hasCity=/(астан|алмат|тал[аә]пкер|костанай|караганда|шымкент|павлодар|кокшетау|темиртау|уральск|актоб|атырау|семей|петропавл|казахстан|қазақстан|kazakhstan)/i.test(clean);
 const addressLike=/(улица|ул\\.?|проспект|пр-т|переулок|мкр|микрорайон|дом|д\\.?|степ|street|st\\.?|avenue|ave\\.?|\\d)/i.test(clean);
 const modes=addressLike?["address","route_endpoint","object"]:["route_endpoint","object","address"];
 const queries=[clean];
 if(nearAstana&&!hasCity)queries.push(clean+", Астана, Казахстан");
 if(!/казахстан|қазақстан|kazakhstan/i.test(clean)&&!hasCity)queries.push(clean+", Казахстан");
 const uniqueQueries=[...new Set(queries)];
 const errors:string[]=[];
 for(const q of uniqueQueries){
  for(const mode of modes){
   const params=new URLSearchParams({
    q,
    suggest_type:mode,
    fields:"items.point,items.full_address_name,items.full_name,items.address,items.adm_div,items.name,items.type,items.id",
    locale:"ru_KZ",
    page_size:"8",
    key
   });
   if(nearPoint)params.set("location",nearPoint.lng+","+nearPoint.lat);
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
   try{
    const response=await fetch("https://catalog.api.2gis.com/3.0/suggests?"+params.toString(),{
     headers:{"Accept":"application/json"},
     signal:controller.signal
    });
    if(response.status===401||response.status===403){
     const body=await response.text().catch(()=>"");
     console.error("2GIS Suggest API access denied",response.status,body.slice(0,300));
     throw new Error("2ГИС отклонил ключ. Проверь доступ к Suggest API.");
    }
    if(!response.ok){errors.push(mode+":"+response.status);continue}
    const data=await response.json();
    if(data?.meta?.code&&Number(data.meta.code)!==200){
     errors.push(mode+":"+String(data.meta.code));
     continue;
    }
    const items=data?.result?.items||[];
    if(!items.length)continue;
    const rows:any[]=[];
    // Address suggests can contain textual completions without coordinates. Resolve those through the official 2GIS geocoder.
    for(const item of items){
     const point=pointFrom2gis(item);
     const address=typeof item.full_address_name==="string"?item.full_address_name:
       typeof item.full_name==="string"?item.full_name:
       typeof item.address_name==="string"?item.address_name:
       typeof item.address==="string"?item.address:
       String(item.address?.full_address_name||item.address?.name||item.address?.address_name||item.suggested_text||item.name||"");
     const suggested=String(item.search_attributes?.suggested_text||item.suggested_text||"");
     const name=String(item.name||item.address?.building_name||item.address_name||item.title||suggested||address||"Адрес");
     const label=address||suggested||name;
     if(!label)continue;
     const divisions=(item.adm_div||[]).map((division:any)=>division.name||division.caption).filter(Boolean);
     const city=divisions.find((value:string)=>/астана|алматы|тал[аә]пкер|город/i.test(value))||divisions[0]||"Казахстан";
     let resolvedPoint=point;
     if(!resolvedPoint&&rows.length<3&&mode!=="object"){
      try{resolvedPoint=await geocodePoint(label,nearPoint,key)}catch{}
     }
     if(!resolvedPoint)continue;
     rows.push({name,label,city,lat:resolvedPoint.lat,lng:resolvedPoint.lng,provider:"2gis",suggest_type:mode});
    }
    if(rows.length){
     const deduped=rows.filter((item:any,index:number,all:any[])=>
      all.findIndex((other:any)=>other.label===item.label&&other.lat===item.lat&&other.lng===item.lng)===index
     );
     const withDistance=await suggestionDistances(deduped.slice(0,8),nearPoint);
     return withDistance;
    }
   }catch(e){
    if(e instanceof Error&&e.message.includes("2ГИС отклонил"))throw e;
    if((e as any)?.name!=="AbortError")console.error("2GIS suggestion mode failed",q,mode,String(e));
   }finally{clearTimeout(timer)}
  }
 }
 if(errors.length)console.error("2GIS suggestion providers returned errors",errors.slice(0,10));
 // Final fallback: even if Suggest returns no coordinate-bearing item, resolve the typed address through the official 2GIS Geocoder.
 try{
  const point=await geocodePoint(clean,nearPoint,key);
  const canonical=await reverseGeocodePoint2gis(point,key);
  const label=canonical?.label||(nearAstana&&!hasCity?clean+", Астана, Казахстан":clean);
  const city=canonical?.city||(nearAstana?"Астана":"Казахстан");
  return [{name:label.split(",")[0]||clean,label,city,lat:point.lat,lng:point.lng,provider:"2gis",suggest_type:"geocoder"}];
 }catch(e){
  if(e instanceof Error&&e.message.includes("2ГИС отклонил ключ"))throw e;
  console.error("2GIS fallback geocoding failed",clean,String(e));
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
  const exp=data.admin_session_expires_at?Date.parse(data.admin_session_expires_at):null;
  if(!data.admin_session_token_hash||!equal(await sha256(token),data.admin_session_token_hash)||(exp!==null&&exp<Date.now()))return {error:"Сессия владельца истекла. Войди снова.",status:401};
  return {settings:data};
}
async function getDgisApiKey(c:any){
 const {data,error}=await c.from("platform_settings").select("dgis_api_key").eq("id",true).maybeSingle();
 if(error)throw new Error("Не удалось проверить настройки 2ГИС.");
 const key=String(data?.dgis_api_key||Deno.env.get("DGIS_API_KEY")||"").trim();
 if(!key)throw new Error("Ключ API 2ГИС не настроен. Открой кабинет владельца → Настройки → 2ГИС API и сохрани ключ для поиска и маршрутов.");
 return key;
}
function pointFrom2gis(item:any){
 const point=item?.point||{};
 let lat=Number(point.lat),lng=Number(point.lon??point.lng);
 if((!Number.isFinite(lat)||!Number.isFinite(lng))&&typeof item?.geometry?.centroid==="string"){
  const match=/POINT\s*\(\s*(-?[0-9.]+)\s+(-?[0-9.]+)/i.exec(item.geometry.centroid);
  if(match){lng=Number(match[1]);lat=Number(match[2])}
 }
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat>90||lng < -180||lng>180)return null;
 return {lat,lng};
}

function amount(v:any){const n=Number(v);return Number.isFinite(n)&&n>0?n:0}
function almatyDayKey(value:unknown){
 const date=value instanceof Date?value:new Date(String(value||""));
 if(!Number.isFinite(date.getTime()))return "";
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Almaty",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
 const get=(type:string)=>parts.find(part=>part.type===type)?.value||"";
 return get("year")+"-"+get("month")+"-"+get("day");
}

Deno.serve(async(req:Request)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});if(req.method!=="POST")return fail("Method not allowed",405);try{const c=await db(),p=await req.json(),a=String(p.action||"");

if(a==="admin_login"){
 const password=String(p.password||"");
 const {data:s,error}=await c.from("platform_settings").select("*").eq("id",true).maybeSingle();
 if(error||!s)return fail("Не удалось загрузить настройки владельца.",500);
 if(!equal(await passwordHash(password,s.owner_password_salt),s.owner_password_hash))return fail("Неверный пароль владельца.",401);
 const token=crypto.randomUUID()+crypto.randomUUID().replace(/-/g,"");
 const {error:ue}=await c.from("platform_settings").update({admin_session_token_hash:await sha256(token),admin_session_expires_at:null,updated_at:new Date().toISOString()}).eq("id",true);
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
 if(a==="admin_set_2gis_api_key"){
  const key=String(p.api_key||"").trim();
  if(key.length<8||key.length>500)return fail("Вставь корректный API-ключ 2ГИС.");
  const {error}=await c.from("platform_settings").update({dgis_api_key:key,updated_at:new Date().toISOString()}).eq("id",true);
  if(error)return fail("Не удалось сохранить ключ 2ГИС. Проверь миграцию базы данных.",500);
  return reply({ok:true,configured:true});
 }
 if(a==="admin_test_2gis"){
  const key=String(settings.dgis_api_key||Deno.env.get("DGIS_API_KEY")||"").trim();
  if(!key)return fail("Сначала сохрани API-ключ 2ГИС.");
  const checks:any={suggest:{ok:false,detail:"не проверен"},geocoder:{ok:false,detail:"не проверен"},routing:{ok:false,detail:"не проверен"}};
  try{
   const params=new URLSearchParams({q:"Астана",suggest_type:"object",fields:"items.point,items.full_address_name",locale:"ru_KZ",page_size:"3",key});
   const response=await fetch("https://catalog.api.2gis.com/3.0/suggests?"+params.toString(),{headers:{"Accept":"application/json"}});
   const data=await response.json().catch(()=>({}));
   const items=data?.result?.items||[];
   if(response.ok&&(!data?.meta?.code||Number(data.meta.code)===200)&&items.length){
    checks.suggest={ok:true,detail:"работает ("+items.length+" подсказки)"};
   }else{
    checks.suggest={ok:false,detail:(response.status===401||response.status===403)?"ключ отклонён (Suggest API)":("ошибка "+String(data?.meta?.error?.message||data?.message||response.status))};
   }
  }catch(e){checks.suggest={ok:false,detail:"нет ответа ("+(e instanceof Error?e.message:"ошибка сети")+")"}}
  let fromPoint:any=null,toPoint:any=null;
  try{
   fromPoint=await geocodePoint("Астана",null,key);
   checks.geocoder={ok:true,detail:"работает"};
  }catch(e){
   checks.geocoder={ok:false,detail:e instanceof Error?e.message:"ошибка геокодера"};
  }
  if(fromPoint){
   try{
    toPoint=await geocodePoint("Байтерек, Астана",fromPoint,key);
    if(km(fromPoint.lat,fromPoint.lng,toPoint.lat,toPoint.lng)<0.15){
     toPoint=await geocodePoint("Хан Шатыр, Астана",fromPoint,key);
    }
    const route=await roadDistance(fromPoint,toPoint,key);
    checks.routing={ok:true,detail:"работает ("+route.distanceKm.toFixed(1)+" км, около "+route.durationMin+" мин.)"};
   }catch(e){
    checks.routing={ok:false,detail:e instanceof Error?e.message:"ошибка маршрутизации"};
   }
  }else{
   checks.routing={ok:false,detail:"не проверен: сначала должен ответить Geocoder API"};
  }
  const message="2ГИС — результаты проверки:\n"+
   "Поиск адресов (Suggest): "+(checks.suggest.ok?"✅ ":"❌ ")+checks.suggest.detail+"\n"+
   "Координаты адресов (Geocoder): "+(checks.geocoder.ok?"✅ ":"❌ ")+checks.geocoder.detail+"\n"+
   "Автомобильный маршрут (Routing): "+(checks.routing.ok?"✅ ":"❌ ")+checks.routing.detail;
  const allOk=checks.suggest.ok&&checks.geocoder.ok&&checks.routing.ok;
  return reply({ok:true,configured:true,search_works:checks.suggest.ok,geocoder_works:checks.geocoder.ok,routing_works:checks.routing.ok,checks,message:allOk?message+"\nВсе три сервиса отвечают. Теперь можно проверять цены на странице пассажира.":message+"\nИсправь доступ к сервису, отмеченному крестиком, в кабинете 2ГИС."});
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
  const [driversQ,onlineQ,ordersQ,doneQ,clientsQ,clientsRowsQ,commissionsQ,withdrawalsQ]=await Promise.all([
   c.from("drivers").select("id",{count:"exact",head:true}),
   c.from("drivers").select("id",{count:"exact",head:true}).eq("is_online",true),
   c.from("orders").select("id",{count:"exact",head:true}),
   c.from("orders").select("id",{count:"exact",head:true}).eq("status","completed"),
   c.from("clients").select("id",{count:"exact",head:true}),
   c.from("clients").select("phone").limit(10000),
   c.from("platform_commissions").select("commission_amount,status,created_at,paid_at").limit(10000),
   c.from("owner_withdrawals").select("amount").limit(10000)
  ]);
  if(driversQ.error||onlineQ.error||ordersQ.error||doneQ.error||clientsQ.error||commissionsQ.error||withdrawalsQ.error)return fail("Не удалось загрузить статистику.",500);
  const commissionRows=commissionsQ.data||[];
  const totalCommission=commissionRows.reduce((sum:any,row:any)=>sum+Number(row.commission_amount||0),0);
  const dueCommission=commissionRows.filter((row:any)=>row.status==="due").reduce((sum:any,row:any)=>sum+Number(row.commission_amount||0),0);
  const paidRows=commissionRows.filter((row:any)=>row.status==="paid");
  const paidCommission=paidRows.reduce((sum:any,row:any)=>sum+Number(row.commission_amount||0),0);
  const totalWithdrawn=(withdrawalsQ.data||[]).reduce((sum:any,row:any)=>sum+Number(row.amount||0),0);
  const todayKey=almatyDayKey(new Date());
  const ownerTodayEarnings=paidRows.filter((row:any)=>almatyDayKey(row.paid_at||row.created_at)===todayKey).reduce((sum:any,row:any)=>sum+Number(row.commission_amount||0),0);
  const ownerBalance=Math.round((paidCommission-totalWithdrawn)*100)/100;
  const uniqueClients=new Set((clientsRowsQ.data||[]).map((x:any)=>String(x.phone||"").trim()).filter(Boolean)).size;
  return reply({ok:true,stats:{drivers:driversQ.count||0,online_drivers:onlineQ.count||0,orders:ordersQ.count||0,completed_orders:doneQ.count||0,client_order_records:clientsQ.count||0,unique_clients:uniqueClients,commission_total:totalCommission,commission_due:dueCommission,commission_paid:paidCommission,owner_balance:ownerBalance,owner_today_earnings:ownerTodayEarnings,owner_total_withdrawn:totalWithdrawn,commission_percent:Number(settings.commission_percent),vehicle_rates:settings.vehicle_rates||{},test_mode:settings.test_mode!==false,dgis_api_configured:Boolean(settings.dgis_api_key||Deno.env.get("DGIS_API_KEY"))}});
 }
 if(a==="admin_drivers"){
  const {data,error}=await c.from("drivers").select("id,account_number,public_code,name,phone,is_online,car_model,car_plate,car_color,vehicle_class,wallet_balance,created_at").order("created_at",{ascending:false}).limit(500);
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
 if(a==="admin_owner_withdrawals"){
  const {data,error}=await c.from("owner_withdrawals").select("id,amount,method,note,created_at").order("created_at",{ascending:false}).limit(100);
  if(error)return fail("Не удалось загрузить историю переводов владельца.",500);
  return reply({ok:true,withdrawals:data||[]});
 }
 if(a==="admin_record_owner_withdrawal"){
  const amountToWithdraw=Number(p.amount),note=String(p.note||"").trim().slice(0,300);
  if(!Number.isFinite(amountToWithdraw)||amountToWithdraw<=0||amountToWithdraw>1000000000)return fail("Укажи сумму перевода больше нуля.");
  const {data:result,error}=await c.rpc("record_owner_withdrawal",{p_amount:amountToWithdraw,p_note:note||"Ручной перевод на Kaspi владельцем"});
  if(error||!result)return fail(error?.message||"Не удалось зафиксировать перевод на Kaspi.",400);
  return reply({ok:true,withdrawal:result});
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
 try{
  const key=await getDgisApiKey(c);
  const suggestions=await suggestAddresses(query,nearPoint,key);
  return reply({ok:true,suggestions,provider:"2gis"});
 }catch(e){return fail(e instanceof Error?e.message:"Поиск адресов через 2ГИС не удался.",422)}
}
if(a==="address_reverse"){
 const lat=Number(p.lat),lng=Number(p.lng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat>90||lng < -180||lng>180)return fail("Некорректные координаты GPS.");
 try{
  const key=await getDgisApiKey(c);
  const params=new URLSearchParams({lon:String(lng),lat:String(lat),fields:"items.full_address_name,items.address,items.adm_div",locale:"ru_KZ",key});
  const response=await fetch("https://catalog.api.2gis.com/3.0/items/geocode?"+params.toString(),{headers:{"Accept":"application/json"}});
  if(!response.ok)return fail("2ГИС не смог определить адрес по GPS.",422);
  const data=await response.json(),item=data?.result?.items?.[0];
  const label=String(item?.full_address_name||(typeof item?.address==="string"?item.address:"")||item?.address?.full_address_name||item?.address?.name||item?.address_name||item?.name||"Моё местоположение");
  return reply({ok:true,label,city:(item?.adm_div||[]).map((x:any)=>x.name).find((x:string)=>Boolean(x))||"Казахстан",provider:"2gis"});
 }catch(e){return fail(e instanceof Error?e.message:"Не удалось определить адрес через 2ГИС.",422)}
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
  const key=await getDgisApiKey(c);
  const pickupPoint=Number.isFinite(lat)?{lat,lng}:await geocodePoint(pickupAddress,null,key);
  const destinationPoint=Number.isFinite(destLat)?{lat:destLat,lng:destLng}:await geocodePoint(destinationAddress,pickupPoint,key);
  const route=await roadDistance(pickupPoint,destinationPoint,key);
  const {data:settingsRow,error}=await c.from("platform_settings").select("vehicle_rates,test_mode").eq("id",true).maybeSingle();
  if(error||!settingsRow)return fail("Не удалось загрузить тарифы.",500);
  const {data:onlineRows}=await c.from("drivers").select("vehicle_class").eq("is_online",true).limit(1000);
  const onlineClasses=[...new Set((onlineRows||[]).map((r:any)=>vehicleClass(r.vehicle_class)))];
  return reply({ok:true,pickup_point:pickupPoint,destination_point:destinationPoint,distance_km:Number(route.distanceKm.toFixed(2)),duration_minutes:route.durationMin,route_geometry:route.geometry,route_provider:"2gis",estimated_prices:quoteFor(settingsRow.vehicle_rates,route.distanceKm),online_classes:onlineClasses,test_mode:settingsRow.test_mode!==false});
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
  // Accept the request even when no driver is online; it stays in the open-order queue for this class.
  // No driver is assigned yet. Every online driver in the selected class can review the request and send an offer.
  d=null;
 }else{
  const {data:direct,error:de}=await c.from("drivers").select("id,is_online,vehicle_class,current_lat,current_lng").eq("public_code",code).maybeSingle();
  if(de||!direct)return fail("Водитель не найден.",404);
  if(!direct.is_online)return fail("Водитель сейчас не на линии.",409);
  d=direct;cls=vehicleClass(p.vehicle_class||d.vehicle_class);
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
if(a==="cancel_order"){
 const id=String(p.order_id||""),token=String(p.client_token||"");
 const {data:o,error:oe}=await c.from("orders").select("id,status,driver_id").eq("id",id).eq("client_token",token).maybeSingle();
 if(oe||!o)return fail("Заказ не найден.",404);
 if(!["new","accepted","arrived","client_ready"].includes(o.status))return fail(o.status==="started"?"Поездка уже началась. Отменить её в приложении нельзя.":"Этот заказ уже завершён или недоступен.");
 const cancelledAt=new Date().toISOString();
 const {data:u,error}=await c.from("orders").update({status:"cancelled",cancelled_at:cancelledAt,cancellation_reason:"client_cancelled"}).eq("id",id).eq("client_token",token).eq("status",o.status).select("id,status,driver_id,cancelled_at,cancellation_reason").maybeSingle();
 if(error||!u)return fail("Не удалось отменить заказ. Обнови статус и попробуй ещё раз.",409);
 return reply({ok:true,order:u})
}
if(["driver_me","driver_wallet","driver_list","driver_history","driver_update","driver_toggle_online","driver_update_profile","driver_logout","driver_location","driver_offer_price","driver_accept_broadcast","driver_skip_order","driver_cancel_no_show"].includes(a)){const s=await sess(c,p);if(!s.driver)return fail(s.error||"Нужен вход.",s.status||401);const d=s.driver;if(a==="driver_me"){
 const {data:ratingRows}=await c.from("driver_ratings").select("stars").eq("driver_id",d.id).limit(10000);
 const scores=(ratingRows||[]).map((x:any)=>Number(x.stars)).filter((x:number)=>x>=1&&x<=5);
 return reply({ok:true,driver:{...pub(d),rating_average:scores.length?Number((scores.reduce((a:number,b:number)=>a+b,0)/scores.length).toFixed(2)):null,rating_count:scores.length}});
}
if(a==="driver_wallet"){
 const {data:settingsRow}=await c.from("platform_settings").select("test_mode,minimum_wallet_balance").eq("id",true).maybeSingle();
 const {data:transactions,error}=await c.from("wallet_transactions").select("id,order_id,kind,amount,balance_before,balance_after,status,note,created_at").eq("driver_id",d.id).order("created_at",{ascending:false}).limit(50);
 if(error)return fail("Не удалось загрузить операции лицевого счёта.",500);
 return reply({ok:true,wallet_balance:Number(d.wallet_balance||0),test_mode:settingsRow?.test_mode!==false,minimum_wallet_balance:Number(settingsRow?.minimum_wallet_balance||500),transactions:transactions||[]});
}if(a==="driver_logout"){await c.from("drivers").update({session_token_hash:null,session_expires_at:null}).eq("id",d.id);return reply({ok:true});}if(a==="driver_location"){const lat=Number(p.lat),lng=Number(p.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return fail("Некорректная геопозиция.");const {error}=await c.from("drivers").update({current_lat:lat,current_lng:lng,location_accuracy:Number(p.accuracy)||null,location_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",d.id);if(error)return fail("Не удалось обновить геопозицию.",500);return reply({ok:true})}if(a==="driver_accept_broadcast"){
 const id=String(p.order_id||"");
 if(!id)return fail("Не указан заказ.");
 if(!d.is_online)return fail("Сначала выйди на линию.");
 const {data:o,error:oe}=await c.from("orders").select("*").eq("id",id).maybeSingle();
 if(oe||!o)return fail("Заказ не найден.",404);
 if(o.status!=="new"||o.driver_id)return fail("Этот заказ уже принят другим водителем.");
 if(vehicleClass(o.vehicle_class)!==vehicleClass(d.vehicle_class))return fail("Заказ относится к другому классу автомобиля.");
 const {data:settingsRow,error:se}=await c.from("platform_settings").select("test_mode,minimum_wallet_balance").eq("id",true).maybeSingle();
 if(se||!settingsRow)return fail("Не удалось проверить настройки кошелька.",500);
 if(settingsRow.test_mode!==true&&Number(d.wallet_balance||0)<Number(settingsRow.minimum_wallet_balance||500))return fail("Недостаточно денег на лицевом счёте. Пополни баланс перед принятием заказов.");
 const fare=amount(o.client_price);
 if(!fare)return fail("У заказа нет рассчитанной цены. Пассажир должен пересчитать маршрут.");
 const {data:claimed,error:claimError}=await c.from("orders").update({
  driver_id:d.id,status:"accepted",accepted_at:new Date().toISOString(),
  agreed_price:fare,driver_price:fare,price_status:"accepted"
 }).eq("id",id).eq("status","new").is("driver_id",null).select("*,clients(name,phone)").maybeSingle();
 if(claimError||!claimed)return fail("Другой водитель уже принял заказ. Обнови список.",409);
 const {data:selected,error:selectedError}=await c.from("order_offers").upsert({
  order_id:id,driver_id:d.id,price:fare,status:"accepted",responded_at:new Date().toISOString(),updated_at:new Date().toISOString()
 },{onConflict:"order_id,driver_id"}).select("*").single();
 if(selectedError)console.error("accept order offer ledger failed",selectedError);
 await c.from("order_offers").update({status:"declined",responded_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("order_id",id).eq("status","pending").neq("driver_id",d.id);
 return reply({ok:true,order:{...enrich(claimed,d),drivers:pub(d)},fare});
}
if(a==="driver_offer_price"){
 if(!d.is_online)return fail("Сначала выйди на линию, чтобы отвечать на заказы.");
 const id=String(p.order_id||""),price=Math.round(Number(p.price));
 if(!id||!Number.isFinite(price)||price<100||price>1000000)return fail("Укажи корректную цену.");
 const {data:o,error:oe}=await c.from("orders").select("id,status,driver_id,vehicle_class,client_price").eq("id",id).maybeSingle();
 if(oe||!o)return fail("Заказ не найден.",404);
 if(o.status!=="new"||(o.driver_id&&o.driver_id!==d.id))return fail("Этот заказ уже недоступен.");
 if(!o.driver_id&&vehicleClass(o.vehicle_class)!==vehicleClass(d.vehicle_class))return fail("Этот заказ для другого класса автомобиля.");
 const base=amount(o.client_price);
 const maxOffer=base>0?Math.floor(base*1.3/50)*50:0;
 if(base>0&&price<base)return fail("Предложение должно быть не ниже цены пассажира: "+base.toLocaleString("ru-RU")+" ₸.");
 if(base>0&&price>maxOffer)return fail("Максимальная цена предложения — "+maxOffer.toLocaleString("ru-RU")+" ₸ (не более 30% выше цены пассажира).");
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
 const cancellationCutoff=new Date(Date.now()-10*60*1000).toISOString();
 const [assignedQ,broadcastQ,cancelledQ]=await Promise.all([
  c.from("orders").select("*,clients(name,phone)").eq("driver_id",d.id).in("status",["new","accepted","arrived","client_ready","started"]).order("created_at",{ascending:false}),
  c.from("orders").select("*,clients(name,phone)").is("driver_id",null).eq("status","new").order("created_at",{ascending:false}).limit(100),
  c.from("orders").select("id,status,driver_id,cancelled_at,cancellation_reason,created_at").eq("driver_id",d.id).eq("status","cancelled").eq("cancellation_reason","client_cancelled").gte("cancelled_at",cancellationCutoff).order("cancelled_at",{ascending:false}).limit(20)
 ]);
 if(assignedQ.error||broadcastQ.error||cancelledQ.error)return fail("Не удалось загрузить заказы.",500);
 const locationAge=d.location_updated_at?Date.now()-Date.parse(d.location_updated_at):Infinity;
 const hasFreshLocation=locationAge>=0&&locationAge<=5*60*1000&&d.current_lat!==null&&d.current_lat!==undefined&&d.current_lng!==null&&d.current_lng!==undefined&&Number.isFinite(Number(d.current_lat))&&Number.isFinite(Number(d.current_lng));
 const ids=new Set((assignedQ.data||[]).map((o:any)=>o.id));
 const requestedSearchRadiusRaw=Number(p.search_radius_km);
 const requestedSearchRadiusKm=Number.isFinite(requestedSearchRadiusRaw)&&requestedSearchRadiusRaw>0?Math.min(25,Math.max(3,requestedSearchRadiusRaw)):25;
 const nearbyBroadcasts=(broadcastQ.data||[]).filter((o:any)=>{
  if(!hasFreshLocation)return true;
  const hasPickup=o.pickup_lat!==null&&o.pickup_lat!==undefined&&o.pickup_lng!==null&&o.pickup_lng!==undefined&&Number.isFinite(Number(o.pickup_lat))&&Number.isFinite(Number(o.pickup_lng));
  if(!hasPickup)return false;
  return km(Number(d.current_lat),Number(d.current_lng),Number(o.pickup_lat),Number(o.pickup_lng))<=requestedSearchRadiusKm;
 });
 const all=[...(assignedQ.data||[]),...nearbyBroadcasts.filter((o:any)=>!ids.has(o.id))].sort((a:any,b:any)=>Date.parse(b.created_at)-Date.parse(a.created_at));
 const {data:myOffers}=await c.from("order_offers").select("order_id,status,price").eq("driver_id",d.id).in("status",["pending","accepted","declined","skipped"]).limit(1000);
 const declined=new Set((myOffers||[]).filter((x:any)=>x.status==="skipped").map((x:any)=>x.order_id));
 return reply({ok:true,orders:all.filter((o:any)=>o.driver_id||!declined.has(o.id)).map((o:any)=>({...enrich(o,d),my_offer:(myOffers||[]).find((x:any)=>x.order_id===o.id)||null})),recently_cancelled:cancelledQ.data||[],is_online:d.is_online,search_radius_km:requestedSearchRadiusKm,gps_fresh:hasFreshLocation});
}if(a==="driver_history"){const {data:os,error}=await c.from("orders").select("*,clients(name,phone)").eq("driver_id",d.id).eq("status","completed").order("completed_at",{ascending:false}).limit(100);if(error)return fail("Не удалось загрузить историю.",500);return reply({ok:true,orders:os||[]})}
if(a==="driver_cancel_no_show"){
 const id=String(p.order_id||"");
 if(!id)return fail("Не указан заказ.");
 const {data:o,error:oe}=await c.from("orders").select("id,status,arrived_at,driver_id").eq("id",id).eq("driver_id",d.id).maybeSingle();
 if(oe||!o)return fail("Заказ не найден.",404);
 if(!["arrived","client_ready"].includes(o.status))return fail("Отменить по причине «пассажир не вышел» можно только после прибытия.");
 const arrivalTime=Date.parse(o.arrived_at||"");
 if(!Number.isFinite(arrivalTime))return fail("Время прибытия не найдено. Обнови заказ или обратись в поддержку.",409);
 const remainingMs=10*60*1000-(Date.now()-arrivalTime);
 if(remainingMs>0)return fail("10 минут ожидания ещё не прошло. Осталось примерно "+Math.ceil(remainingMs/1000)+" секунд.",409);
 const cancelledAt=new Date().toISOString();
 const {data:u,error}=await c.from("orders").update({status:"cancelled",cancelled_at:cancelledAt,cancellation_reason:"driver_no_show"}).eq("id",id).eq("driver_id",d.id).in("status",["arrived","client_ready"]).eq("arrived_at",o.arrived_at).select("id,status,cancelled_at,cancellation_reason").maybeSingle();
 if(error||!u)return fail("Не удалось отменить заказ. Возможно, его статус уже изменился.",409);
 return reply({ok:true,order:u});
}
if(a==="driver_update"){
 const id=String(p.order_id||""),status=String(p.status||"");
 if(!["accepted","arrived","started","completed"].includes(status))return fail("Недопустимый статус. Для отмены используй специальную кнопку ожидания.");
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
 if(status==="arrived")patch.arrived_at=new Date().toISOString();
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
}
return fail("Неизвестное действие.",400)}catch(e){console.error("moy-taxi-api",e);return fail("Внутренняя ошибка сервера.",500)}});

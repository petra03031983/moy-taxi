"use client";
import { useEffect, useRef, useState } from "react";
import { callApi, statusLabel } from "./api";
import RouteMap from "./passenger/RouteMap";
function twoGisRoute(lat, lng, address) {
  if (typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng)) {
    return `https://2gis.kz/routeSearch/rsType/car/to/${lng},${lat}/go`;
  }
  return `https://2gis.kz/search/${encodeURIComponent(address || "")}`;
}
function twoGisTripRoute(fromLat, fromLng, toLat, toLng, address) {
  if ([fromLat, fromLng, toLat, toLng].every(v => typeof v === "number" && Number.isFinite(v))) {
    return `https://2gis.kz/directions/points/${fromLng},${fromLat}|${toLng},${toLat}`;
  }
  return twoGisRoute(toLat, toLng, address);
}
function inferVehicleCapabilities(model) {
  const value = String(model || "").toLocaleLowerCase("ru-RU").replace(/[ё]/g, "е").replace(/[^a-zа-я0-9+ ]/g, " ").trim();
  const has = (...names) => names.some(name => value.includes(name));
  const comfort = has("camry","камри","sonata","соната","k5","optima","оптима","accord","аккорд","passat","пассат","superb","суперб","teana","тиана","mazda 6","mazda6","kia k7","cadenza","azera","grandeur","avalon","crown","mark x","markx","lexus es","es 300","es 350","lexus gs","genesis","bmw 5","5 series","e class","e-класс","мерседес е","audi a6","a6");
  const seats6 = has("sienna","alphard","vellfire","estima","noah","voxy","esquire","serena","elgrand","odyssey","carnival","sedona","staria","multivan","caravelle","transporter","hiace","starex","grand starex","h1","sprinter","transit","ducato","raf","раф","гран старекс","минивэн","минивен","pacifica","vito","viano","v-class","v class","tourneo","шаттл");
  return { economy: true, comfort, seats6, primary: seats6 ? "minivan" : comfort ? "comfort" : "economy" };
}
function isCourierOrder(order) {
  return Boolean(order && (order.is_delivery || order.order_type === "delivery" || order.order_type === "parcel" || order.service_type === "delivery" || order.service_type === "courier" || order.kind === "courier" || order.courier_type));
}
function isCargoOrder(order) {
  const type=String(order?.order_type||order?.service_type||order?.kind||"").toLocaleLowerCase("ru-RU");
  return Boolean(order&&(order.is_cargo||order.cargo_type||["cargo","freight","truck","грузовой","грузоперевозка"].includes(type)));
}
function passesIncomingNotificationFilter(order, maxPickupKm, minPricePerKm, minOrderPrice) {
  const pickupKm = Number(order?.distance_km);
  if (!Number.isFinite(pickupKm) || pickupKm < 0 || pickupKm > Number(maxPickupKm)) return false;
  const fare = Number(order?.agreed_price || order?.client_price || order?.driver_price || 0);
  if (!Number.isFinite(fare) || fare < Number(minOrderPrice)) return false;
  const routeKm = Number(order?.route_distance_km);
  if (!Number.isFinite(routeKm) || routeKm <= 0) return false;
  if (fare / routeKm < Number(minPricePerKm)) return false;
  return true;
}
const VEHICLE_CLASSES=[["economy","Эконом"],["comfort","Комфорт"],["comfort_plus","Комфорт+"],["business","Бизнес"],["minivan","Минивэн"],["premium","Премиум"]];
const emptyForm={name:"",phone:"",password:"",car_model:"",car_plate:"",car_color:"",vehicle_class:"economy",photo_url:""};
function cleanSession(v){return v&&typeof v.driver_id==="string"&&typeof v.session_token==="string"?v:null}
function sortOrdersNewestFirst(list){
 return [...(Array.isArray(list)?list:[])].sort((a,b)=>{
  const at=Date.parse(a?.created_at||"");const bt=Date.parse(b?.created_at||"");
  return (Number.isFinite(bt)?bt:0)-(Number.isFinite(at)?at:0);
 });
}
function orderClock(value){
 const time=Date.parse(value||"");
 return Number.isFinite(time)?new Date(time).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}):"";
}
function orderAge(value){
 const time=Date.parse(value||"");
 if(!Number.isFinite(time))return "время неизвестно";
 const seconds=Math.max(0,Math.floor((Date.now()-time)/1000));
 if(seconds<10)return "сейчас";
 if(seconds<60)return seconds+" сек.";
 const minutes=Math.floor(seconds/60);
 if(minutes<60)return minutes+" мин.";
 const hours=Math.floor(minutes/60);
 if(hours<24)return hours+" ч.";
 return new Date(time).toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit"});
}
const DRIVER_OFFER_TTL_MS=60*1000;
function offerTimeRemaining(offer,now=Date.now()){
 const created=Date.parse(offer?.created_at||"");
 if(!Number.isFinite(created))return 0;
 return Math.max(0,DRIVER_OFFER_TTL_MS-(now-created));
}
function formatOfferTimeLeft(ms){
 const total=Math.max(0,Math.ceil(Number(ms||0)/1000));
 return String(Math.floor(total/60)).padStart(2,"0")+":"+String(total%60).padStart(2,"0");
}
function offerTimePercent(offer,now=Date.now()){
 return Math.max(0,Math.min(100,offerTimeRemaining(offer,now)/DRIVER_OFFER_TTL_MS*100));
}
function formatDistance(value){
 const km=Number(value);
 if(!Number.isFinite(km)||km<0)return "";
 return km<1?Math.round(km*1000)+" м":km.toLocaleString("ru-RU",{maximumFractionDigits:1})+" км";
}
function counterOfferBase(order){
 const value=Number(order?.client_price||order?.agreed_price||order?.driver_price||0);
 return Number.isFinite(value)&&value>0?Math.round(value):0;
}
function maxCounterOffer(order){
 const base=counterOfferBase(order);
 return base>0?Math.floor(base*1.3/50)*50:0;
}
function counterOfferOptions(order){
 const base=counterOfferBase(order),cap=maxCounterOffer(order);
 if(!base||cap<=base)return [];
 return [...new Set([10,20,30].map(percent=>Math.floor(base*(1+percent/100)/50)*50).filter(value=>value>base&&value<=cap))];
}
function validOrderPoint(lat,lng){
 const a=Number(lat),b=Number(lng);
 return Number.isFinite(a)&&Number.isFinite(b)&&a>=-90&&a<=90&&b>=-180&&b<=180?{lat:a,lng:b}:null;
}
export default function Home(){
 const [entryMode,setEntryMode]=useState("choose"),[authMode,setAuthMode]=useState("login"),[form,setForm]=useState(emptyForm),[session,setSession]=useState(null),[driver,setDriver]=useState(null),[orders,setOrders]=useState([]),[history,setHistory]=useState([]),[tab,setTab]=useState("orders"),[showQR,setShowQR]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[installPrompt,setInstallPrompt]=useState(null),[origin,setOrigin]=useState(""),[offerPrices,setOfferPrices]=useState({}),[selectedOrderId,setSelectedOrderId]=useState(null),[offerCustomOpen,setOfferCustomOpen]=useState(false),[detailRouteGeometry,setDetailRouteGeometry]=useState([]),[detailRouteStats,setDetailRouteStats]=useState(null),[detailPickupStats,setDetailPickupStats]=useState(null),[detailMapLoading,setDetailMapLoading]=useState(false),[walletInfo,setWalletInfo]=useState({wallet_balance:0,test_mode:true,minimum_wallet_balance:500,transactions:[]}),[notificationPermission,setNotificationPermission]=useState("default"),[incomingAlerts,setIncomingAlerts]=useState([]),[lineSwitchBusy,setLineSwitchBusy]=useState(false),[driverMenuOpen,setDriverMenuOpen]=useState(false),[settingsTab,setSettingsTab]=useState("orders"),[darkMode,setDarkMode]=useState("system"),[feedSounds,setFeedSounds]=useState(true),[orderChain,setOrderChain]=useState(false),[quickSwitch,setQuickSwitch]=useState(false),[navigatorApp,setNavigatorApp]=useState("2gis"),[filterMinPrice,setFilterMinPrice]=useState(""),[filterMaxDistance,setFilterMaxDistance]=useState(""),[filterVehicleClass,setFilterVehicleClass]=useState("all"),[filterTripType,setFilterTripType]=useState("all"),[filterPickupDistance,setFilterPickupDistance]=useState(3),[scanRadiusKm,setScanRadiusKm]=useState(3),[filterMinPricePerKm,setFilterMinPricePerKm]=useState(500),[filterMinOrderPrice,setFilterMinOrderPrice]=useState(3000),[settingsLoaded,setSettingsLoaded]=useState(false),[tariffModes,setTariffModes]=useState({economy:true,noBargaining:true,comfort:false,seats6:false,parcels:true}),[vehicleEditOpen,setVehicleEditOpen]=useState(false),[vehicleDraft,setVehicleDraft]=useState({car_model:"",car_plate:""}),[vehicleSaving,setVehicleSaving]=useState(false),[academyCompleted,setAcademyCompleted]=useState([]),[safetyChecks,setSafetyChecks]=useState({vehicle:false,seatbelt:false,phone:false}),[supportMessage,setSupportMessage]=useState(""),[appRefreshing,setAppRefreshing]=useState(false),[sessionRestorePending,setSessionRestorePending]=useState(true),[sessionRestoreError,setSessionRestoreError]=useState(""),[restoreSessionRetry,setRestoreSessionRetry]=useState(0),[appReady,setAppReady]=useState(false),[clockNow,setClockNow]=useState(Date.now());
 const [offerWaitOverlay,setOfferWaitOverlay]=useState(null);
 const previousIds=useRef(new Set()),previousCancelledIds=useRef(new Set()),firstLoad=useRef(true),audioRef=useRef(null),watchRef=useRef(null);
 const hasArrivalClock=orders.some(o=>["arrived","client_ready"].includes(o.status)&&o.arrived_at);
 const hasPendingOfferClock=orders.some(o=>o.my_offer?.status==="pending");
 useEffect(()=>{const entryParams=new URLSearchParams(window.location.search);if(entryParams.get("role")==="driver"&&entryParams.get("register")==="1"){setEntryMode("driver");setAuthMode("register")}setOrigin(window.location.origin);setNotificationPermission("Notification"in window?Notification.permission:"unsupported");if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});const bip=e=>{e.preventDefault();setInstallPrompt(e)};window.addEventListener("beforeinstallprompt",bip);const saved=localStorage.getItem("moyTaxiSession");if(saved){try{const s=cleanSession(JSON.parse(saved));if(s){setEntryMode("driver");const savedTab=localStorage.getItem("moyTaxiDriverTab");const validTabs=["orders","active","demand","stats","history","wallet","profile","settings","order-filter","city","intercity","cargo","academy","notifications","safety","help","online-registration","invite","support"];if(validTabs.includes(savedTab))setTab(savedTab);let cachedDriver=null;try{const cached=JSON.parse(localStorage.getItem("moyTaxiDriverCache")||"null");if(cached&&String(cached.id)===String(s.driver_id))cachedDriver=cached}catch{}setSessionRestorePending(!cachedDriver);setSessionRestoreError("");setSession(s);if(cachedDriver){setDriver(cachedDriver);setAppReady(true)}}else{localStorage.removeItem("moyTaxiSession");localStorage.removeItem("moyTaxiDriverCache");setSessionRestorePending(false);setAppReady(true)}}catch{localStorage.removeItem("moyTaxiSession");localStorage.removeItem("moyTaxiDriverCache");setSessionRestorePending(false);setAppReady(true)}}else{setSessionRestorePending(false);setAppReady(true)}const unlock=()=>{try{const C=window.AudioContext||window.webkitAudioContext;if(C&&!audioRef.current)audioRef.current=new C();audioRef.current?.resume()}catch{}};window.addEventListener("pointerdown",unlock,{once:true});return()=>{window.removeEventListener("beforeinstallprompt",bip);window.removeEventListener("pointerdown",unlock)}},[]);
 useEffect(()=>{
  if(!session){setSessionRestorePending(false);return}
  if(driver){setSessionRestorePending(false);setSessionRestoreError("");return}
  let alive=true;
  let retryTimer=null;
  const restore=async()=>{
   try{
    const me=await callApi("driver_me",session);
    if(!alive)return;
    if(!me?.driver)throw new Error("Не удалось восстановить профиль водителя.");
    setDriver(me.driver);
    try{localStorage.setItem("moyTaxiDriverCache",JSON.stringify(me.driver))}catch{}
    setSessionRestoreError("");
    setSessionRestorePending(false);
    setAppReady(true);
   }catch(e){
    if(!alive)return;
    const message=String(e?.message||"");
    if(/сессия|войти снова|авторизац|unauthorized|invalid token|token expired/i.test(message)){
     localStorage.removeItem("moyTaxiSession");
     localStorage.removeItem("moyTaxiDriverCache");
     setSession(null);
     setDriver(null);
     setAppReady(true);
     setEntryMode("driver");
     setAuthMode("login");
     setSessionRestorePending(false);
     setSessionRestoreError("");
     return;
    }
    setSessionRestorePending(false);
    setSessionRestoreError("Не удалось связаться с сервером. Сохранённый вход не удалён. Приложение попробует подключиться ещё раз.");
    retryTimer=window.setTimeout(()=>{
     if(alive){setSessionRestorePending(true);restore()}
    },4000);
   }
  };
  setSessionRestorePending(true);
  setSessionRestoreError("");
  restore();
  return()=>{alive=false;if(retryTimer)window.clearTimeout(retryTimer)};
 },[session?.driver_id,session?.session_token,Boolean(driver),restoreSessionRetry]);
 useEffect(()=>{
  if(!appReady||!driver)return;
  try{localStorage.setItem("moyTaxiDriverCache",JSON.stringify(driver));localStorage.setItem("moyTaxiDriverTab",tab)}catch{}
 },[appReady,driver,tab]);
 useEffect(()=>{
  if(!appReady)return;
  try{
   const saved=Number(localStorage.getItem("moyTaxiDriverScrollY")||0);
   localStorage.removeItem("moyTaxiDriverScrollY");
   if(Number.isFinite(saved)&&saved>0)window.requestAnimationFrame(()=>window.scrollTo(0,saved));
  }catch{}
 },[appReady]);
 useEffect(()=>{if(!session){setWalletInfo(null);return}let alive=true;const loadWallet=()=>Promise.all([callApi("driver_wallet",session),callApi("driver_me",session)]).then(([data,me])=>{if(alive){setWalletInfo(data);setDriver(old=>old?{...old,...me.driver}:me.driver)}}).catch(()=>{});loadWallet();const timer=setInterval(loadWallet,15000);return()=>{alive=false;clearInterval(timer)}},[session?.driver_id,session?.session_token]);
 useEffect(()=>{
  if(!session){setHistory([]);return}
  let alive=true;
  const loadHistory=async()=>{try{const d=await callApi("driver_history",session);if(alive)setHistory(d.orders||[])}catch{}};
  loadHistory();
  const timer=setInterval(loadHistory,60000);
  return()=>{alive=false;clearInterval(timer)};
 },[session?.driver_id,session?.session_token]);
 useEffect(()=>{
  if(!hasArrivalClock&&!hasPendingOfferClock&&!offerWaitOverlay)return;
  setClockNow(Date.now());
  const timer=window.setInterval(()=>setClockNow(Date.now()),1000);
  return()=>window.clearInterval(timer);
 },[hasArrivalClock,hasPendingOfferClock,Boolean(offerWaitOverlay)]);
 useEffect(()=>{
  if(offerWaitOverlay){
   if(offerWaitRemaining<=0){setOfferWaitOverlay(null);return}
   const current=orders.find(o=>String(o.id)===String(offerWaitOverlay.orderId));
   if(current?.my_offer&&current.my_offer.status!=="pending"){setOfferWaitOverlay(null);return}
   return;
  }
  const pending=orders.filter(o=>o?.my_offer?.status==="pending").map(o=>{
   const createdAt=o.my_offer.created_at||o.my_offer.updated_at||"";
   const remaining=offerTimeRemaining({created_at:createdAt},clockNow);
   return {order:o,createdAt,remaining};
  }).filter(x=>x.remaining>0).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  if(pending.length){
   const x=pending[0];
   setOfferWaitOverlay({orderId:String(x.order.id),price:Number(x.order.my_offer.price||0),createdAt:x.createdAt});
  }
 },[orders,clockNow,offerWaitOverlay?.orderId,offerWaitRemaining]);
 useEffect(()=>{
  if(!session){previousIds.current=new Set();previousCancelledIds.current=new Set();firstLoad.current=true;return}
  let alive=true;
  const playTone=(frequencies,duration=.17,peak=.16)=>{
   try{
    const C=window.AudioContext||window.webkitAudioContext;
    if(!audioRef.current&&C)audioRef.current=new C();
    const c=audioRef.current;if(!c)return;
    void c.resume();
    frequencies.forEach((f,i)=>{
     const o=c.createOscillator(),g=c.createGain();o.type="sine";o.frequency.value=f;
     const t=c.currentTime+i*duration*.72;
     g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(peak,t+.025);
     g.gain.exponentialRampToValueAtTime(.0001,t+duration);o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+duration+.01);
    });
   }catch{}
  };
  const ding=()=>playTone([880],.17,.16);
  const cancellationDing=()=>playTone([510,360],.21,.14);
  const notifyNewOrder=async(o)=>{
   if(!("Notification"in window)||Notification.permission!=="granted")return;
   const title="Мой Такси: новый заказ!";
   const body=(o.pickup_address||"Подача не указана")+" · "+(Number(o.client_price)>0?Number(o.client_price).toLocaleString("ru-RU")+" ₸":"цена не указана");
   try{
    if("serviceWorker"in navigator){
     const registration=await navigator.serviceWorker.ready;
     await registration.showNotification(title,{body,tag:"moy-taxi-order-"+o.id,renotify:true,icon:"/icon-192.png",badge:"/icon-192.png",data:{url:"/"}});
    }else new Notification(title,{body,tag:"moy-taxi-order-"+o.id});
   }catch{
    try{new Notification(title,{body,tag:"moy-taxi-order-"+o.id})}catch{}
   }
  };
  const load=async()=>{
   try{
    const d=await callApi("driver_list",{...session,search_radius_km:scanRadiusKm});if(!alive)return;
    const next=sortOrdersNewestFirst(d.orders||[]);
    const ids=new Set(next.map(o=>o.id));
    const fresh=next.filter(o=>o.status==="new"&&!previousIds.current.has(o.id));
     // Focus the main feed when new orders arrive or when an existing order is found after app restore.
     if((firstLoad.current&&next.some(o=>o.status==="new"))||(!firstLoad.current&&fresh.length>0))setTab("orders");
    const notificationFresh=fresh.filter(o=>passesIncomingNotificationFilter(o,filterPickupDistance,filterMinPricePerKm,filterMinOrderPrice));
    const cancelled=Array.isArray(d.recently_cancelled)?d.recently_cancelled.filter(o=>o&&o.id):[];
    const cancelledIds=new Set(cancelled.map(o=>String(o.id)));
    const freshCancelled=cancelled.filter(o=>!previousCancelledIds.current.has(String(o.id)));
    if(!firstLoad.current&&fresh.length){
     // Price/distance filters only limit extra popup/browser notifications, not the sound.
     if(feedSounds)fresh.forEach((o,index)=>window.setTimeout(ding,index*500));
     if(feedSounds&&navigator.vibrate)navigator.vibrate(fresh.length>1?[180,80,180]:[180]);
    }
    if(!firstLoad.current&&notificationFresh.length){
     const alerts=notificationFresh.map(o=>({id:o.id,body:(o.pickup_address||"Адрес подачи не указан")+" · "+(Number(o.client_price)>0?Number(o.client_price).toLocaleString("ru-RU")+" ₸":"цена не указана")}));
     setIncomingAlerts(current=>[...alerts,...current].slice(0,3));
     alerts.forEach(alert=>window.setTimeout(()=>setIncomingAlerts(current=>current.filter(item=>item.id!==alert.id)),8000));
     notificationFresh.forEach(o=>void notifyNewOrder(o));
    }
    if(!firstLoad.current&&freshCancelled.length){
     if(feedSounds)freshCancelled.forEach((o,index)=>window.setTimeout(cancellationDing,index*350));
     if(feedSounds&&navigator.vibrate)navigator.vibrate([150,80,150]);
     setNotice("Пассажир отменил принятый заказ.");
    }
    previousIds.current=ids;
    previousCancelledIds.current=cancelledIds;
    firstLoad.current=false;
    setOrders(next);setDriver(old=>old?{...old,is_online:Boolean(d.is_online)}:old);
   }catch(e){
    if(alive&&/сессия|войти снова/i.test(e.message||"")){
     localStorage.removeItem("moyTaxiSession");setSession(null);setDriver(null);
    }
   }
  };
  load();const t=setInterval(load,3000);
  return()=>{alive=false;clearInterval(t)};
 },[session?.driver_id,session?.session_token,feedSounds,filterPickupDistance,filterMinPricePerKm,filterMinOrderPrice,scanRadiusKm]);
 useEffect(()=>{
  if(!session||!driver?.is_online)return;
  if(!("geolocation"in navigator)){
   setNotice("Браузер не передаёт GPS. Разреши местоположение в Chrome и включи геолокацию телефона.");
   return;
  }
  let active=true,locationWarningShown=false;
  const options={enableHighAccuracy:true,maximumAge:10000,timeout:25000};
  const send=async position=>{
   if(!active||!position?.coords)return;
   const lat=Number(position.coords.latitude),lng=Number(position.coords.longitude),accuracy=Number(position.coords.accuracy);
   if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return;
   const updatedAt=new Date().toISOString();
   setDriver(current=>current?{...current,current_lat:lat,current_lng:lng,location_updated_at:updatedAt}:current);
   try{
    await callApi("driver_location",{...session,lat,lng,accuracy:Number.isFinite(accuracy)?accuracy:null});
    if(active&&locationWarningShown){locationWarningShown=false;setNotice("✅ Местоположение снова обновляется.");}
   }catch{
    if(active&&!locationWarningShown){locationWarningShown=true;setNotice("GPS получен, но не удалось передать координаты на сервер. Проверяю соединение…");}
   }
  };
  const locationError=error=>{
   if(!active||locationWarningShown)return;
   locationWarningShown=true;
   if(error?.code===1)setNotice("📍 Доступ к GPS запрещён. В Chrome открой значок слева от адреса → Разрешения → Местоположение → Разрешить. На телефоне включи «Местоположение», затем обнови страницу.");
   else if(error?.code===3)setNotice("📍 GPS отвечает слишком долго. Проверь, что на телефоне включено «Местоположение»; приложение продолжит пробовать снова.");
   else setNotice("📍 Пока не удаётся определить GPS. Проверь геолокацию телефона; приложение продолжит пробовать снова.");
  };
  const locate=()=>{
   if(!active)return;
   try{navigator.geolocation.getCurrentPosition(send,locationError,options)}catch{locationError({code:2})}
  };
  locate();
  try{watchRef.current=navigator.geolocation.watchPosition(send,locationError,options)}catch{locationError({code:2})}
  const refreshTimer=setInterval(locate,45000);
  return()=>{
   active=false;
   clearInterval(refreshTimer);
   if(watchRef.current!=null){try{navigator.geolocation.clearWatch(watchRef.current)}catch{}watchRef.current=null}
  };
 },[session?.driver_id,session?.session_token,driver?.is_online]);
 useEffect(()=>{
  const locationFresh=Boolean(driver?.location_updated_at&&Date.now()-Date.parse(driver.location_updated_at)<=5*60*1000&&driver.current_lat!=null&&driver.current_lng!=null);
  if(!driver?.is_online||!locationFresh){setScanRadiusKm(3);return}
  setScanRadiusKm(3);
  const radiusTimer=setInterval(()=>setScanRadiusKm(current=>current>=25?25:Math.min(25,current+1)),5000);
  return()=>clearInterval(radiusTimer);
 },[driver?.is_online,Boolean(driver?.location_updated_at&&Date.now()-Date.parse(driver.location_updated_at)<=5*60*1000&&driver.current_lat!=null&&driver.current_lng!=null)]);
 useEffect(()=>{
  try{
   const raw=localStorage.getItem("moyTaxiDriverSettings");
   if(raw){const x=JSON.parse(raw);setDarkMode(x.darkMode||"system");setFeedSounds(x.soundPreferenceVersion===2?Boolean(x.feedSounds):true);setOrderChain(Boolean(x.orderChain));setQuickSwitch(Boolean(x.quickSwitch));setNavigatorApp(x.navigatorApp||"2gis");setFilterMinPrice(x.filterMinPrice||"");setFilterMaxDistance(x.filterMaxDistance||"");setFilterVehicleClass(x.filterVehicleClass||"all");setFilterTripType(x.filterTripType||"all");setFilterPickupDistance(Number.isFinite(Number(x.filterPickupDistance))?Number(x.filterPickupDistance):3);setFilterMinPricePerKm(Number.isFinite(Number(x.filterMinPricePerKm))?Number(x.filterMinPricePerKm):500);setFilterMinOrderPrice(Number.isFinite(Number(x.filterMinOrderPrice))?Number(x.filterMinOrderPrice):3000);setTariffModes(x.tariffModes||{economy:true,noBargaining:true,comfort:false,seats6:false,parcels:true});setAcademyCompleted(Array.isArray(x.academyCompleted)?x.academyCompleted:[]);setSafetyChecks(x.safetyChecks&&typeof x.safetyChecks==="object"?x.safetyChecks:{vehicle:false,seatbelt:false,phone:false})}
  }catch{}
  setSettingsLoaded(true);
 },[]);
 useEffect(()=>{if(!settingsLoaded)return;try{localStorage.setItem("moyTaxiDriverSettings",JSON.stringify({darkMode,feedSounds,soundPreferenceVersion:2,orderChain,quickSwitch,navigatorApp,filterMinPrice,filterMaxDistance,filterVehicleClass,filterTripType,filterPickupDistance,filterMinPricePerKm,filterMinOrderPrice,tariffModes,academyCompleted,safetyChecks}))}catch{}},[settingsLoaded,darkMode,feedSounds,orderChain,quickSwitch,navigatorApp,filterMinPrice,filterMaxDistance,filterVehicleClass,filterTripType,filterPickupDistance,filterMinPricePerKm,filterMinOrderPrice,tariffModes,academyCompleted,safetyChecks]);
 function navigationRoute(lat,lng,address){
  const app=(()=>{try{return localStorage.getItem("moyTaxiNavigator")||navigatorApp}catch{return navigatorApp}})();
  if(app==="google"&&Number.isFinite(Number(lat))&&Number.isFinite(Number(lng)))return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  if(app==="yandex"&&Number.isFinite(Number(lat))&&Number.isFinite(Number(lng)))return `https://yandex.ru/maps/?rtext=~${lat},${lng}&rtt=auto`;
  return twoGisRoute(lat,lng,address);
 }
 function navigationTripRoute(fromLat,fromLng,toLat,toLng,address){
  const app=(()=>{try{return localStorage.getItem("moyTaxiNavigator")||navigatorApp}catch{return navigatorApp}})();
  if([fromLat,fromLng,toLat,toLng].every(v=>typeof v==="number"&&Number.isFinite(v))){
    if(app==="google")return `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&travelmode=driving`;
    if(app==="yandex")return `https://yandex.ru/maps/?rtext=${fromLat},${fromLng}~${toLat},${toLng}&rtt=auto`;
    return twoGisTripRoute(fromLat,fromLng,toLat,toLng,address);
  }
  return navigationRoute(toLat,toLng,address);
 }
 useEffect(()=>{try{document.documentElement.dataset.moyTaxiTheme=darkMode;document.documentElement.style.colorScheme=darkMode==="system"?"":darkMode==="dark"?"dark":"light"}catch{}},[darkMode]);
 function saveDriverSettings(){try{localStorage.setItem("moyTaxiDriverSettings",JSON.stringify({darkMode,feedSounds,soundPreferenceVersion:2,orderChain,quickSwitch,navigatorApp,filterMinPrice,filterMaxDistance,filterVehicleClass,filterTripType,tariffModes}));localStorage.setItem("moyTaxiNavigator",navigatorApp);setNotice("Настройки сохранены.")}catch{setNotice("Настройки применены на этом телефоне.")}}
 async function auth(e){e.preventDefault();setBusy(true);setError("");try{const payload=authMode==="register"?{...form,vehicle_class:inferVehicleCapabilities(form.car_model).primary}:form;const r=await callApi(authMode==="register"?"register_driver":"login_driver",payload),s={driver_id:r.driver.id,session_token:r.session_token};localStorage.setItem("moyTaxiSession",JSON.stringify(s));setSession(s);setDriver(r.driver);setForm(emptyForm);setNotice(authMode==="register"?("Аккаунт создан. Лицевой счёт: "+(r.driver.account_number||"назначается")):"Вход выполнен.")}catch(e){setError(e.message||"Ошибка")}finally{setBusy(false)}}
 async function refreshHistory(){try{const d=await callApi("driver_history",session);setHistory(d.orders||[])}catch(e){setError(e.message)}}
 async function refreshWallet(){try{const w=await callApi("driver_wallet",session);setWalletInfo(w);const me=await callApi("driver_me",session);setDriver(me.driver)}catch(e){setError(e.message)}}
 async function toggle(){if(lineSwitchBusy)return;setLineSwitchBusy(true);setError("");try{const d=await callApi("driver_toggle_online",{...session,is_online:!driver.is_online});setDriver(d.driver||{...driver,is_online:d.is_online});setNotice(d.is_online?"Ты на линии.":"Ты не на линии.")}catch(e){setError(e.message)}finally{setLineSwitchBusy(false)}}
 async function updateOrder(id,status){
  try{
   const result=await callApi("driver_update",{...session,order_id:id,status});
   const d=await callApi("driver_list",session);setOrders(sortOrdersNewestFirst(d.orders||[]));
   if(status==="completed"){
    await refreshHistory();await refreshWallet();setTab(orderChain?"orders":"history");
    const f=result.finance;
    if(f){
      const gross=Number(f.fare||0).toLocaleString("ru-RU");
      const fee=Number(f.commission||0).toLocaleString("ru-RU");
      const net=Number(f.net||0).toLocaleString("ru-RU");
      setNotice("Поездка завершена. Сумма "+gross+" ₸; комиссия "+fee+" ₸; твой заработок "+net+" ₸. "+(f.test_mode?"Тестовый расчёт — с кошелька ничего не списано.":"Комиссия списана с лицевого счёта."));
    } else setNotice(statusLabel(status));
   }else setNotice(statusLabel(status));
   return true;
  }catch(e){setError(e.message);return false}
 }
 async function cancelNoShowOrder(id){
  if(busy)return;
  setBusy(true);setError("");setNotice("");
  try{
   await callApi("driver_cancel_no_show",{...session,order_id:id});
   const list=await callApi("driver_list",session);
   setOrders(sortOrdersNewestFirst(list.orders||[]));
   if(String(selectedOrderId)===String(id))setSelectedOrderId(null);
   setNotice("Заказ отменён: пассажир не вышел после 10 минут ожидания.");
  }catch(e){setError(e.message||"Не удалось отменить заказ. Проверь время ожидания и повтори попытку.");}
  finally{setBusy(false)}
 }
 async function acceptOrderAndNavigate(o){
  if(!o?.driver_id&&!orderClassAllowed(o)){
    const wrongClass=!isCourierOrder(o)&&String(o?.vehicle_class||"economy")!==String(driver?.vehicle_class||"economy");
    setError(wrongClass?"Этот заказ относится к другому классу автомобиля. Его можно увидеть в ленте, но принять нельзя.":"Этот тариф выключен в настройках водителя.");
    return;
  }
  const mapTab=window.open("about:blank","_blank");
  try{
    let acceptedOrder=o;
    if(o.driver_id){
      const ok=await updateOrder(o.id,"accepted");
      if(!ok){mapTab?.close();return}
    }else{
      const result=await callApi("driver_accept_broadcast",{...session,order_id:o.id});
      acceptedOrder=result.order||o;
      const list=await callApi("driver_list",session);
      setOrders(sortOrdersNewestFirst(list.orders||[]));
      setNotice("Заказ принят за "+Number(result.fare||o.client_price||0).toLocaleString("ru-RU")+" ₸. Открываем маршрут к клиенту.");
    }
    if(mapTab){mapTab.location.href=navigationRoute(acceptedOrder.pickup_lat,acceptedOrder.pickup_lng,acceptedOrder.pickup_address)}
    else{setNotice("Заказ принят. Нажми «Маршрут к клиенту в 2GIS», чтобы открыть навигатор.")}
    setSelectedOrderId(null);setOfferCustomOpen(false);
  }catch(e){mapTab?.close();setError(e.message||"Не удалось принять заказ.")}
}
 async function offerPrice(o,overridePrice){if(!o?.driver_id&&!orderClassAllowed(o)){setError(!isCourierOrder(o)&&String(o?.vehicle_class||"economy")!==String(driver?.vehicle_class||"economy")?"Этот заказ относится к другому классу автомобиля.":"Этот тариф выключен в настройках водителя.");return}const amount=Number(overridePrice??offerPrices[o.id]),base=counterOfferBase(o),cap=maxCounterOffer(o);if(!Number.isFinite(amount)||amount<base){setError("Предложение должно быть не ниже цены пассажира: "+base.toLocaleString("ru-RU")+" ₸.");return}if(!Number.isInteger(amount)||amount>cap){setError("Максимальная цена — "+cap.toLocaleString("ru-RU")+" ₸ (не более 30% сверху).");return}setError("");try{const sent=await callApi("driver_offer_price",{...session,order_id:o.id,price:amount});const createdAt=sent?.offer?.created_at||new Date().toISOString();setOfferWaitOverlay({orderId:String(o.id),price:amount,createdAt});setSelectedOrderId(null);setOfferCustomOpen(false);const d=await callApi("driver_list",session);setOrders(sortOrdersNewestFirst(d.orders||[]));setNotice("");setOfferPrices(prev=>({...prev,[o.id]:""}));}catch(e){setError(e.message||"Не удалось отправить цену.")}}
 async function skipOrder(o){try{await callApi("driver_skip_order",{...session,order_id:o.id});setOrders(prev=>prev.filter(item=>item.id!==o.id));setNotice("Заказ скрыт только у тебя. Пассажир продолжит получать предложения других водителей.")}catch(e){setError(e.message||"Не удалось убрать заказ из списка.")}}
 function beginVehicleEdit(){setVehicleDraft({car_model:driver?.car_model||"",car_plate:driver?.car_plate||""});setVehicleEditOpen(v=>!v)}
 async function saveTariffVehicle(e){
  e.preventDefault();setVehicleSaving(true);setError("");
  const detected=inferVehicleCapabilities(vehicleDraft.car_model);
  try{
   const result=await callApi("driver_update_profile",{...session,name:driver.name||"",car_model:vehicleDraft.car_model.trim(),car_plate:vehicleDraft.car_plate.trim(),car_color:driver.car_color||"",vehicle_class:detected.primary,photo_url:driver.photo_url||""});
   setDriver(result.driver);setTariffModes(m=>({...m,comfort:detected.comfort,seats6:detected.seats6}));setVehicleEditOpen(false);setNotice("Автомобиль сохранён. Доступные тарифы определены по марке и модели.");
  }catch(e){setError(e.message||"Не удалось сохранить автомобиль.")}
  finally{setVehicleSaving(false)}
 }
 async function saveProfile(e){e.preventDefault();setBusy(true);try{const d=await callApi("driver_update_profile",{...session,name:form.name,car_model:form.car_model,car_plate:form.car_plate,car_color:form.car_color,vehicle_class:inferVehicleCapabilities(form.car_model).primary,photo_url:form.photo_url||""});setDriver(d.driver);setNotice("Профиль сохранён.")}catch(e){setError(e.message)}finally{setBusy(false)}}
 function photo(e){const f=e.target.files?.[0];if(!f)return;if(f.size>5*1024*1024){setError("Фото должно быть до 5 МБ.");return}const rd=new FileReader();rd.onload=()=>{const img=new Image();img.onload=()=>{const c=document.createElement("canvas"),m=Math.min(1,400/Math.max(img.width,img.height));c.width=Math.round(img.width*m);c.height=Math.round(img.height*m);c.getContext("2d").drawImage(img,0,0,c.width,c.height);setForm(x=>({...x,photo_url:c.toDataURL("image/jpeg",.82)}))};img.src=rd.result};rd.readAsDataURL(f)}
 async function logout(){try{await callApi("driver_logout",session)}catch{}localStorage.removeItem("moyTaxiSession");setSession(null);setDriver(null);setEntryMode("choose")}
 async function notify(){if(!("Notification"in window)){setNotificationPermission("unsupported");setNotice("Уведомления браузера недоступны.");return}try{const p=await Notification.requestPermission();setNotificationPermission(p);setNotice(p==="granted"?"Уведомления включены. Новые заказы будут сопровождаться звуком и уведомлением.":"Разрешение на уведомления не дано. Пока приложение открыто, новые заказы будут отмечаться в ленте и звуковым сигналом.")}catch{setNotice("Не удалось включить уведомления браузера.")}}
 async function share(){const link=origin+"/c/"+driver.public_code;if(navigator.share){try{await navigator.share({title:"Мой Такси",text:"Закажи такси у меня",url:link})}catch{}}else{await navigator.clipboard?.writeText(link);setNotice("Ссылка скопирована.")}}
 async function install(){
   if(installPrompt){
    await installPrompt.prompt();
    const choice=await installPrompt.userChoice;
    setInstallPrompt(null);
    setNotice(choice?.outcome==="accepted"?"«Мой Такси» добавляется на главный экран.":"Установка не подтверждена. Можно повторить позже.");
    return;
   }
   const standalone=window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;
   setNotice(standalone?"Сейчас ты уже в установленном приложении. Чтобы добавить отдельную иконку «Мой Такси», открой основной сайт в Chrome, не через иконку кабинета владельца, затем нажми ⋮ → «Установить приложение» или «Добавить на главный экран».":"Chrome пока не предложил окно установки. Открой основной сайт напрямую в Chrome, затем нажми ⋮ → «Установить приложение» или «Добавить на главный экран».");
  }
 async function refreshDriverApp(){
   if(appRefreshing)return;
   try{localStorage.setItem("moyTaxiDriverCache",JSON.stringify(driver));localStorage.setItem("moyTaxiDriverTab",tab);localStorage.setItem("moyTaxiDriverScrollY",String(window.scrollY||0))}catch{}
   setAppRefreshing(true);
   setError("");
   setNotice("Проверяем обновление приложения…");
   try{
     if("serviceWorker" in navigator){
       const registration=await navigator.serviceWorker.getRegistration("/");
       if(registration){
         await Promise.race([
           registration.update(),
           new Promise(resolve=>window.setTimeout(resolve,2500))
         ]);
         const waiting=registration.waiting;
         if(waiting)waiting.postMessage({type:"SKIP_WAITING"});
       }
     }
     setNotice("Обновляем приложение…");
     window.setTimeout(()=>window.location.reload(),350);
   }catch{
     setNotice("Перезапускаем приложение…");
     window.setTimeout(()=>window.location.reload(),350);
   }
  }
 useEffect(()=>{
  if(!selectedOrderId){
   setDetailRouteGeometry([]);setDetailRouteStats(null);setDetailPickupStats(null);setDetailMapLoading(false);setOfferCustomOpen(false);
   return;
  }
  let alive=true;
  const o=orders.find(item=>String(item.id)===String(selectedOrderId))||null;
  if(!o||o.status!=="new"){
   setDetailRouteGeometry([]);setDetailRouteStats(null);setDetailPickupStats(null);setDetailMapLoading(false);setOfferCustomOpen(false);
   return ()=>{alive=false};
  }
  const orderPickup=validOrderPoint(o.pickup_lat,o.pickup_lng);
  const driverPoint=validOrderPoint(driver?.current_lat,driver?.current_lng);
  setDetailRouteGeometry(Array.isArray(o.route_geometry)?o.route_geometry:[]);
  setDetailRouteStats({distanceKm:Number(o.route_distance_km||0),durationMin:Number(o.route_duration_minutes||o.duration_minutes||0)});
  setDetailPickupStats(o.distance_km!=null?{distanceKm:Number(o.distance_km),durationMin:0}:null);
  setDetailMapLoading(true);
  const routeToDestination=callApi("calculate_route",{
   pickup_address:o.pickup_address||"Моё местоположение",
   destination_address:o.destination_address||"",
   pickup_lat:o.pickup_lat??null,pickup_lng:o.pickup_lng??null,
   destination_lat:o.destination_lat??null,destination_lng:o.destination_lng??null
  }).then(result=>{
   if(!alive)return;
   if(Array.isArray(result.route_geometry))setDetailRouteGeometry(result.route_geometry);
   setDetailRouteStats({distanceKm:Number(result.distance_km||o.route_distance_km||0),durationMin:Number(result.duration_minutes||0)});
  }).catch(()=>{
   if(alive)setDetailRouteStats({distanceKm:Number(o.route_distance_km||0),durationMin:Number(o.route_duration_minutes||o.duration_minutes||0)});
  });
  const routeToPassenger=(driverPoint&&orderPickup)?callApi("calculate_route",{
   pickup_address:"Моё местоположение",
   destination_address:o.pickup_address||"Адрес пассажира",
   pickup_lat:driverPoint.lat,pickup_lng:driverPoint.lng,
   destination_lat:orderPickup.lat,destination_lng:orderPickup.lng
  }).then(result=>{
   if(!alive)return;
   setDetailPickupStats({distanceKm:Number(result.distance_km||0),durationMin:Number(result.duration_minutes||0)});
  }).catch(()=>{
   if(alive)setDetailPickupStats(o.distance_km!=null?{distanceKm:Number(o.distance_km),durationMin:0}:null);
  }):Promise.resolve();
  Promise.all([routeToDestination,routeToPassenger]).finally(()=>{if(alive)setDetailMapLoading(false)});
  return()=>{alive=false};
 },[selectedOrderId,session?.driver_id,session?.session_token,driver?.current_lat,driver?.current_lng]);
 if(!appReady) return <main className="app auth-app" aria-busy="true"></main>;
 if(entryMode==="choose") return <main className="app auth-app">
  <header className="header"><div className="logo">Мой <span>Такси</span></div><div className="small">Единое приложение</div></header>
  <section className="hero panel role-menu">
    <div className="hero-icon">🚕</div>
    <p className="eyebrow">ДОБРО ПОЖАЛОВАТЬ</p>
    <h1>Как вы хотите пользоваться «Мой Такси»?</h1>
    <p className="muted">Выберите свою роль. Пассажир заказывает поездку, водитель принимает заказы и управляет поездками.</p>
    <div className="role-actions">
      <a className="button primary" href="/passenger"><span>🧍</span><span><b>Я пассажир</b><small>Указать адрес и заказать такси</small></span><span>›</span></a>
      <button type="button" className="button secondary" onClick={()=>setEntryMode("driver")}><span>🚘</span><span><b>Я водитель</b><small>Войти или зарегистрироваться</small></span><span>›</span></button>
    </div>
    <button type="button" className="button install" onClick={install}>
      <span style={{fontSize:24}}>📲</span>
      <span><b>Установить «Мой Такси»</b><small>Отдельная иконка для пассажира и водителя</small></span>
    </button>
    {notice && <div className="success" role="status">{notice}</div>}
    <p className="muted small role-test-note">Мой Такси сейчас работает в тестовом режиме.</p>
  </section>
</main>;
if(!session||!driver) return <main className="app auth-app"><header className="header"><div className="logo">Мой <span>Такси</span></div><span className="small">Панель водителя</span></header><section className="hero panel"><div className="hero-icon">🚕</div><p className="eyebrow">ЛИЧНЫЙ СЕРВИС</p><h1>{authMode==="register"?"Регистрация водителя":"Вход водителя"}</h1><p className="muted">Один аккаунт — твой QR-код и твои клиенты.</p></section>{error&&<div className="error">{error}</div>}{notice&&<div className="success">{notice}</div>}<section className="panel auth-panel"><div className="switcher"><button className={authMode==="login"?"switch active":"switch"} onClick={()=>setAuthMode("login")}>Войти</button><button className={authMode==="register"?"switch active":"switch"} onClick={()=>setAuthMode("register")}>Регистрация</button></div><form onSubmit={auth}>{authMode==="register"&&<div className="field"><label>Имя</label><input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Имя водителя"/></div>}<div className="field"><label>Номер телефона</label><input required type="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+7 777 000 00 00"/></div><div className="field"><label>Пароль</label><input required type="password" minLength={8} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Не менее 8 символов"/></div>{authMode==="register"&&<><div className="field"><label>Автомобиль</label><input value={form.car_model} onChange={e=>setForm({...form,car_model:e.target.value})} placeholder="Toyota Camry"/></div><div className="field"><label>Госномер</label><input value={form.car_plate} onChange={e=>setForm({...form,car_plate:e.target.value})} placeholder="123 ABC 01"/></div><div className="field"><label>Цвет машины</label><input value={form.car_color} onChange={e=>setForm({...form,car_color:e.target.value})} placeholder="Белый"/></div><div className="field"><label>Класс автомобиля</label><p className="muted small">Класс определяется автоматически по марке и модели автомобиля.</p></div></>}<button className="button primary" disabled={busy}>{busy?"Подожди…":authMode==="register"?"Создать аккаунт":"Войти"}</button></form></section></main>;
 const link=origin+"/c/"+driver.public_code,qr="https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data="+encodeURIComponent(link),newCount=orders.filter(o=>o.status==="new").length,active=orders.filter(o=>["accepted","arrived","client_ready","started"].includes(o.status));
 const todayDate=new Date();
 const earningsToday=history.reduce((sum,o)=>{
  const completedAt=Date.parse(o.completed_at||"");
  if(!Number.isFinite(completedAt))return sum;
  const done=new Date(completedAt);
  if(done.getFullYear()!==todayDate.getFullYear()||done.getMonth()!==todayDate.getMonth()||done.getDate()!==todayDate.getDate())return sum;
  const fare=Number(o.agreed_price||o.driver_price||o.client_price||0);
  const commission=Number(o.platform_commission_amount||0);
  const net=Number(o.driver_net_amount??(fare-commission));
  return sum+(Number.isFinite(net)?net:0);
 },0);
 const todayCompletedOrders=history.filter(o=>{const t=Date.parse(o.completed_at||"");if(!Number.isFinite(t))return false;const d=new Date(t);return d.getFullYear()===todayDate.getFullYear()&&d.getMonth()===todayDate.getMonth()&&d.getDate()===todayDate.getDate()});
 const totalNetEarnings=history.reduce((sum,o)=>{const fare=Number(o.agreed_price||o.driver_price||o.client_price||0),commission=Number(o.platform_commission_amount||0),net=Number(o.driver_net_amount??(fare-commission));return sum+(Number.isFinite(net)?net:0)},0);
 const demandOrders=orders.filter(o=>o.status==="new");
 const cityOrders=orders.filter(o=>o.trip_type!=="intercity"&&!isCargoOrder(o));
 const intercityOrders=orders.filter(o=>o.trip_type==="intercity"&&!isCargoOrder(o));
 const cargoOrders=orders.filter(isCargoOrder);
 const notificationOrders=orders.filter(o=>o.status==="new");
 const gpsFresh=Boolean(driver.location_updated_at&&Date.now()-Date.parse(driver.location_updated_at)<=5*60*1000&&driver.current_lat!=null&&driver.current_lng!=null);
 const vehicleCapabilities=inferVehicleCapabilities(driver?.car_model||"");
 const orderClassAllowed=(o)=>isCourierOrder(o)?tariffModes.parcels:true;
 const filteredOrders=orders;
 const visibleOrders=tab==="active"?filteredOrders.filter(o=>["accepted","arrived","client_ready","started"].includes(o.status)):filteredOrders;
 const selectedOrder=selectedOrderId?orders.find(o=>String(o.id)===String(selectedOrderId))||null:null;
 const selectedPendingOffer=selectedOrder?.my_offer?.status==="pending"?selectedOrder.my_offer:null;
 const selectedOfferRemaining=offerTimeRemaining(selectedPendingOffer,clockNow);
 const selectedOfferProgress=offerTimePercent(selectedPendingOffer,clockNow);
 const offerWaitCreatedAt=offerWaitOverlay?.createdAt||"";
 const offerWaitClockOffer=offerWaitOverlay?{created_at:offerWaitCreatedAt}:null;
 const offerWaitRemaining=offerTimeRemaining(offerWaitClockOffer,clockNow);
 const offerWaitProgress=offerTimePercent(offerWaitClockOffer,clockNow);
 const selectedOrderWrongVehicleClass=false;
 const selectedOrderTariffDisabled=Boolean(selectedOrder&&!selectedOrderWrongVehicleClass&&!orderClassAllowed(selectedOrder));
 const showDriverProfile=()=>{setForm({...emptyForm,name:driver.name||"",car_model:driver.car_model||"",car_plate:driver.car_plate||"",car_color:driver.car_color||"",vehicle_class:driver.vehicle_class||"economy",photo_url:driver.photo_url||""});setTab("profile");setDriverMenuOpen(false)};
 const openDriverSettings=()=>{setTab("settings");setDriverMenuOpen(false)};
 const openDriverSupport=()=>{setTab("support");setDriverMenuOpen(false)};
 const openDriverTab=(name)=>{setTab(name);setDriverMenuOpen(false);if(name==="wallet")void refreshWallet();if(name==="history")void refreshHistory()};
 const openOrderFromMenu=(id)=>{setTab("orders");setDriverMenuOpen(false);window.setTimeout(()=>document.getElementById("order-"+id)?.scrollIntoView({behavior:"smooth",block:"center"}),180)};
 const toggleAcademyModule=(id)=>setAcademyCompleted(list=>list.includes(id)?list.filter(x=>x!==id):[...list,id]);
 const toggleSafetyItem=(id)=>setSafetyChecks(items=>({...items,[id]:!items[id]}));
 async function copyDriverAccountNumber(){const value=String(driver?.account_number||"");if(!value){setError("Номер лицевого счёта ещё не назначен.");return}try{await navigator.clipboard.writeText(value);setNotice("Номер лицевого счёта скопирован.")}catch{setNotice("Номер лицевого счёта: "+value)}}
 async function copyInviteLink(){const link=origin+"/c/"+driver.public_code;try{await navigator.clipboard.writeText(link);setNotice("Ссылка для приглашения скопирована.")}catch{setNotice("Используй кнопку «Поделиться ссылкой» для отправки приглашения.")}}
 async function shareSupportMessage(){const message="Обращение в службу поддержки «Мой Такси»\nВодитель: "+(driver.name||"не указано")+"\nТелефон: "+(driver.phone||"не указан")+"\nСообщение: "+(supportMessage.trim()||"Прошу связаться со мной по вопросу работы приложения.");try{if(navigator.share){await navigator.share({title:"Поддержка «Мой Такси»",text:message})}else{await navigator.clipboard?.writeText(message);setNotice("Текст обращения скопирован. Отправь его в мессенджере.")}}catch(e){if(e?.name!=="AbortError")setNotice("Не удалось открыть меню отправки. Попробуй ещё раз.")}}
 const renderMenuOrders=(list,emptyText)=>list.length===0?<div className="driver-menu-empty"><div className="empty-icon">🚕</div><h3>{emptyText}</h3><p className="muted">Заказы обновляются автоматически, пока водитель на линии.</p></div>:<div className="driver-service-orders">{sortOrdersNewestFirst(list).map(o=>{const fare=Number(o.agreed_price||o.client_price||o.driver_price||0);return <article className="driver-service-order" key={o.id}><div className="driver-service-order-top"><b>{fare>0?fare.toLocaleString("ru-RU")+" ₸":"Цена не указана"}</b><span className="status">{statusLabel(o.status)}</span></div><p>📍 {o.pickup_address||"Адрес подачи не указан"}</p><p>🏁 {o.destination_address||"Адрес назначения не указан"}</p><div className="actions">{o.status==="new"&&<button type="button" className="button primary" disabled={!o.driver_id&&!orderClassAllowed(o)} onClick={()=>acceptOrderAndNavigate(o)}>{!o.driver_id&&!orderClassAllowed(o)?"Тариф для другого автомобиля":"Принять заказ"}</button>}<button type="button" className="button secondary" onClick={()=>openOrderFromMenu(o.id)}>Открыть в ленте</button></div></article>})}</div>;
 return <main className="app dashboard driver-dashboard"><div className="order-alert-stack" aria-live="polite" aria-atomic="false">{incomingAlerts.map(alert=><button type="button" className="order-alert" key={alert.id} onClick={()=>document.getElementById("order-"+alert.id)?.scrollIntoView({behavior:"smooth",block:"center"})}><span className="order-alert-icon">🔔</span><span className="order-alert-copy"><b>Новый заказ!</b><small>{alert.body}</small></span><span className="order-alert-arrow">›</span></button>)}</div><div className={"driver-top-area "+(tab==="order-filter"?"driver-top-area-hidden":"")}><div className="driver-topbar">
 <div className="driver-menu-wrap">
  <button type="button" className="driver-top-action driver-menu-trigger" aria-label="Меню водителя" aria-expanded={driverMenuOpen} onClick={()=>setDriverMenuOpen(open=>!open)}>☰</button>
  {driverMenuOpen&&<>
  <button type="button" className="driver-menu-backdrop" aria-label="Закрыть меню" onClick={()=>setDriverMenuOpen(false)}></button>
  <div className="driver-menu-panel">
   <button type="button" className="driver-menu-identity driver-menu-profile" onClick={showDriverProfile}>
    <span className="driver-menu-avatar">{driver.photo_url?<img src={driver.photo_url} alt="" />:(driver.name||"В").slice(0,1).toLocaleUpperCase("ru-RU")}</span>
    <span className="driver-menu-identity-copy"><b>{driver.name||"Водитель"}</b><span>{driver.phone}</span><small>{driver.car_model||"Автомобиль не указан"}{driver.car_plate?" · "+driver.car_plate:""}</small></span><b className="driver-menu-chevron">›</b>
   </button>
   <button type="button" className="driver-menu-item" onClick={()=>openDriverTab("city")}><span>🚘</span><span>Город</span><b>›</b></button>
   <button type="button" className="driver-menu-item" onClick={()=>openDriverTab("academy")}><span>🎓</span><span>Академия</span><b>›</b></button>
   <button type="button" className="driver-menu-item" onClick={()=>openDriverTab("wallet")}><span>▣</span><span>Кошелёк</span><b>›</b></button>
   <button type="button" className="driver-menu-item" onClick={()=>openDriverTab("intercity")}><span>🌐</span><span>Межгород</span><b>›</b></button>
   <button type="button" className="driver-menu-item" onClick={()=>openDriverTab("cargo")}><span>🚚</span><span>Грузовые</span><b>›</b></button>
   <button type="button" className="driver-menu-item" onClick={()=>openDriverTab("notifications")}><span>♧</span><span>Уведомления</span>{newCount>0&&<em className="driver-menu-badge">{Math.min(newCount,99)}</em>}{newCount===0&&<b>›</b>}</button>
   <button type="button" className="driver-menu-item" onClick={()=>openDriverTab("safety")}><span>🛡</span><span>Безопасность</span><b>›</b></button>
   <button type="button" className="driver-menu-item" onClick={openDriverSettings}><span>⚙</span><span>Настройки</span><b>›</b></button>
   <button type="button" className="driver-menu-item driver-menu-refresh" onClick={()=>{setDriverMenuOpen(false);void refreshDriverApp()}} disabled={appRefreshing}><span className="driver-menu-refresh-icon">{appRefreshing?"…":"↻"}</span><span>{appRefreshing?"Обновляем приложение…":"Обновить приложение"}</span><b>↻</b></button>
   <button type="button" className="driver-menu-item" onClick={()=>openDriverTab("help")}><span>ⓘ</span><span>Помощь</span><b>›</b></button>
   <button type="button" className="driver-menu-item" onClick={openDriverSupport}><span>▤</span><span>Служба поддержки</span><b>›</b></button>
   <button type="button" className="driver-menu-item" onClick={()=>openDriverTab("online-registration")}><span>✎</span><span>Онлайн-регистрация</span><b>›</b></button>
   <button type="button" className="driver-menu-item" onClick={()=>openDriverTab("invite")}><span>♔</span><span>Пригласить друга</span><b>›</b></button>
   <a className="driver-menu-passenger" href="/passenger"><span>Стать пассажиром</span><b>›</b></a>
   <div className="driver-menu-socials"><a href={"https://www.facebook.com/sharer/sharer.php?u="+encodeURIComponent(origin+"/c/"+driver.public_code)} target="_blank" rel="noreferrer" aria-label="Поделиться в Facebook">f</a><button type="button" onClick={share} aria-label="Поделиться ссылкой в Instagram">◎</button></div>
  </div>
 </>}
 </div>
 <div className="driver-line-center" style={{display:"flex",flexDirection:"row",alignItems:"center",justifyContent:"center",width:"100%",minWidth:0,gap:0}}>
  <button type="button" className={"driver-line-switch "+(driver.is_online?"is-online":"is-offline")} onClick={toggle} disabled={lineSwitchBusy} aria-pressed={Boolean(driver.is_online)} aria-label={driver.is_online?"Уйти с линии":"Выйти на линию"}><span className="driver-line-option offline-option">Не в сети</span><span className="driver-line-option online-option">На линии</span><span className="driver-line-thumb" aria-hidden="true"></span></button>
 </div>
 <button type="button" className="driver-top-action driver-settings-trigger" aria-label="Настройки водителя" title="Настройки" onClick={openDriverSettings}>⚙{notificationPermission!=="granted"&&notificationPermission!=="unsupported"&&<span className="driver-settings-dot" aria-hidden="true"></span>}</button>
</div>{error&&<div className="error">{error}</div>}{notice&&<div className="success">{notice}</div>}
<section className="driver-financial-row" aria-label="Доход и баланс">
 <article className="driver-financial-card">
  <span className="driver-financial-label">Доход за сегодня</span>
  <div className="driver-financial-bottom"><strong>{earningsToday.toLocaleString("ru-RU",{maximumFractionDigits:0})} ₸</strong><span className="driver-financial-icon" aria-hidden="true">▣</span></div>
 </article>
 <article className="driver-financial-card">
  <span className="driver-financial-label">Баланс</span>
  <div className="driver-financial-bottom"><strong>{Number(walletInfo?.wallet_balance??driver.wallet_balance??0).toLocaleString("ru-RU",{maximumFractionDigits:0})} ₸</strong><button type="button" className="driver-topup-button" aria-label="Открыть кошелёк и пополнение" onClick={()=>{setTab("wallet");refreshWallet()}}>+</button></div>
  <button type="button" className="driver-topup-link" onClick={()=>{setTab("wallet");refreshWallet()}}>Пополнить счёт</button>
 </article>
</section></div>{!["orders","active","demand","stats","wallet","settings","order-filter"].includes(tab)&&<div className="driver-subpage-back-row"><button type="button" className="button secondary" style={{margin:"12px 18px 0"}} onClick={()=>{setTab("orders");setDriverMenuOpen(false)}}>‹ Назад в ленту заказов</button></div>}{tab==="orders"&&visibleOrders.length===0?<div className={"driver-radar-empty "+(driver.is_online&&gpsFresh?"is-searching":driver.is_online?"is-locating":"is-offline")}>
  <div className="driver-radar-status"><span className="driver-radar-status-dot"></span>{driver.is_online&&gpsFresh?"ПОИСК ЗАКАЗОВ":driver.is_online?"ОЖИДАЕМ ГЕОЛОКАЦИЮ":"НЕ В СЕТИ"}</div>
  <div className="driver-radar-range driver-radar-range-top"><span>РАДИУС ПОИСКА</span><b>до {scanRadiusKm} км</b></div>
  <div className="driver-radar-visual" role="img" aria-label={driver.is_online&&gpsFresh?"Анимированный радар поиска заказов":"Радар ожидания"}>
   <div className="driver-radar-ring driver-radar-ring-outer"></div><div className="driver-radar-ring driver-radar-ring-middle"></div><div className="driver-radar-ring driver-radar-ring-inner"></div>
   <div className="driver-radar-cross driver-radar-cross-x"></div><div className="driver-radar-cross driver-radar-cross-y"></div>
   <div className="driver-radar-sweep"></div>
   <i className="driver-radar-point driver-radar-point-a"></i><i className="driver-radar-point driver-radar-point-b"></i><i className="driver-radar-point driver-radar-point-c"></i><i className="driver-radar-point driver-radar-point-d"></i><i className="driver-radar-point driver-radar-point-e"></i>
   <div className="driver-radar-center" aria-hidden="true"><span></span></div>
  </div>
  <h2>{driver.is_online&&gpsFresh?"Ищем заказы рядом":driver.is_online?"Определяем местоположение":"Новых заказов пока нет"}</h2>
  <p>{driver.is_online&&gpsFresh?"Сканируем новые заявки поблизости. Как только появится подходящий заказ, он отобразится в ленте.":driver.is_online?"Разреши доступ к геолокации и подожди обновления местоположения.":"Выйди на линию, чтобы начать поиск заказов."}</p>
  <div className="driver-radar-bottom"><span></span><small>{driver.is_online&&gpsFresh?"Поиск активен":driver.is_online?"Ожидаем GPS":"Поиск приостановлен"}</small><span></span></div>
 </div>:(tab==="orders"||tab==="active")&&<section className="panel">
 <div className="section-heading">
  <div><div className="eyebrow">{tab==="active"?"ТЕКУЩИЕ ПОЕЗДКИ":"ВХОДЯЩИЕ ЗАКАЗЫ"}</div><h2>{tab==="active"?"В работе":"Лента заказов"}</h2></div>
  <span className="status">{tab==="active"?active.length+" в работе":newCount+" новых"}</span>
 </div>
 <div className="driver-order-feed">
 {visibleOrders.length===0?<div className="empty-state"><div className="empty-icon">🚕</div><h3>Заказов пока нет</h3><p className="muted">Когда клиент закажет поездку, здесь появится компактная карточка и прозвучит сигнал нового заказа.</p></div>:sortOrdersNewestFirst(visibleOrders).map(o=>{
  const customerName=o.clients?.name||"Клиент";
  const fare=Number(o.agreed_price||o.client_price||o.driver_price||0);
  const routeKm=Number(o.route_distance_km);
  const pricePerKm=Number.isFinite(routeKm)&&routeKm>0&&fare>0?Math.round(fare/routeKm):null;
  const pickupDistance=o.distance_km!=null?formatDistance(o.distance_km):"";
  const arrivalTime=Date.parse(o.arrived_at||"");
  const arrivalRecorded=Number.isFinite(arrivalTime);
  const waitElapsed=arrivalRecorded?Math.max(0,clockNow-arrivalTime):0;
  const waitRemaining=Math.max(0,10*60*1000-waitElapsed);
  const canCancelNoShow=arrivalRecorded&&waitElapsed>=10*60*1000;
  const waitCountdown=(()=>{const total=Math.ceil(waitRemaining/1000);return String(Math.floor(total/60)).padStart(2,"0")+":"+String(total%60).padStart(2,"0")})();
  return <article className={"order feed-order "+(o.status==="new"?"feed-order-new feed-order-selectable":"")} id={"order-"+o.id} key={o.id} onClick={()=>{if(o.status==="new")setSelectedOrderId(o.id)}} onKeyDown={e=>{if(o.status==="new"&&(e.key==="Enter"||e.key===" ")){e.preventDefault();setSelectedOrderId(o.id)}}} role={o.status==="new"?"button":undefined} tabIndex={o.status==="new"?0:undefined} style={o.status==="new"?{cursor:"pointer"}:undefined}>
   <aside className="feed-order-side">
    <div className="feed-order-avatar">{customerName.slice(0,1).toLocaleUpperCase("ru-RU")}</div>
    <strong>{customerName}</strong>
    <span className="feed-order-age">{orderAge(o.created_at)}</span>
   </aside>
   <div className="feed-order-main">
    <div className="feed-order-heading">
     <div className="feed-order-topline">
      {pricePerKm!==null&&<b>{pricePerKm.toLocaleString("ru-RU")} ₸/км</b>}
      {pickupDistance&&<span>~{pickupDistance}</span>}
      <small>{orderClock(o.created_at)}</small>
     </div>
     <span className="status">{statusLabel(o.status)}</span>
    </div>
    <div className="feed-order-price">{fare>0?fare.toLocaleString("ru-RU")+" ₸":"Цена не указана"}</div>
    <p className="feed-order-address"><span className="feed-pickup-dot">●</span><span>{o.pickup_address||"Адрес подачи не указан"}</span></p>
    <p className="feed-order-address"><span className="feed-destination-dot">●</span><span>{o.destination_address||"Адрес назначения не указан"}</span></p>
    <div className="feed-order-meta">
     <span>{VEHICLE_CLASSES.find(x=>x[0]===o.vehicle_class)?.[1]||"Эконом"}{o.trip_type==="intercity"?" · Межгород":" · Город"}</span>
     <span>{o.payment_method==="kaspi_gold"?"Kaspi перевод":"Наличные"}</span>
     {Number(o.route_distance_km)>0&&<span>Маршрут {Number(o.route_distance_km).toLocaleString("ru-RU",{maximumFractionDigits:1})} км</span>}
    </div>
    {o.price_status==="accepted"&&Number(o.agreed_price)>0&&<p className="feed-order-note success">✅ Согласовано: <b>{Number(o.agreed_price).toLocaleString("ru-RU")} ₸</b></p>}
    {o.price_status==="driver_offered"&&<p className="feed-order-note success">Твоя цена: <b>{Number(o.driver_price).toLocaleString("ru-RU")} ₸</b> · ждём ответа клиента.</p>}
    {o.my_offer?.status==="pending"&&<div className="driver-order-offer-pending">Ты предложил <b>{Number(o.my_offer.price).toLocaleString("ru-RU")} ₸</b>. Ждём ответа пассажира.
     <div style={{marginTop:8,fontSize:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}><span>Предложение активно ещё</span><b>{formatOfferTimeLeft(offerTimeRemaining(o.my_offer,clockNow))}</b></div>
      <div style={{height:5,width:"100%",borderRadius:99,background:"#cbd5d1",overflow:"hidden",marginTop:6}}><span style={{display:"block",height:"100%",width:offerTimePercent(o.my_offer,clockNow)+"%",background:"#16a34a",transition:"width 1s linear"}} /></div>
     </div>
    </div>}
    {o.price_status==="declined"&&<p className="feed-order-note muted">Клиент отклонил цену. Можно предложить другую.</p>}
    <div className="order-actions actions feed-order-actions">
     {o.status==="accepted"&&<><a className="button secondary" href={navigationRoute(o.pickup_lat,o.pickup_lng,o.pickup_address)} target="_blank" rel="noreferrer">🗺️ Маршрут в 2GIS</a><button type="button" className="button primary" onClick={()=>updateOrder(o.id,"arrived")}>✅ Я на месте</button></>}
     {["arrived","client_ready"].includes(o.status)&&<div className="success feed-order-note"><b>Ты на месте. Ожидаем пассажира.</b>{arrivalRecorded?<p className="small" style={{margin:"5px 0 0"}}>{canCancelNoShow?"10 минут ожидания истекли.":"До возможности отменить заказ осталось:"} <strong>{canCancelNoShow?"00:00":waitCountdown}</strong></p>:<p className="small" style={{margin:"5px 0 0"}}>Не удалось загрузить время прибытия. Обнови приложение; таймер проверяется сервером.</p>}{canCancelNoShow&&<button type="button" className="button danger" style={{marginTop:8}} disabled={busy} onClick={()=>cancelNoShowOrder(o.id)}>Отменить — пассажир не вышел</button>}</div>}
     {o.status==="client_ready"&&<a className="button primary" href={navigationTripRoute(o.pickup_lat,o.pickup_lng,o.destination_lat,o.destination_lng,o.destination_address)} target="_blank" rel="noreferrer" onClick={()=>updateOrder(o.id,"started")}>▶️ Начать поездку A → B</a>}
     {o.status==="started"&&<><a className="button secondary" href={navigationRoute(o.destination_lat,o.destination_lng,o.destination_address)} target="_blank" rel="noreferrer">🧭 До пункта B</a><button type="button" className="button primary" onClick={()=>updateOrder(o.id,"completed")}>Завершить поездку</button></>}
    </div>
   </div>
  </article>
 })}
 </div>
</section>}{tab==="demand"&&<section className="panel driver-utility-panel">
 <div className="eyebrow">ЗАКАЗЫ РЯДОМ</div>
 <div className="section-heading"><div><h2>Спрос</h2><p className="muted small">Поиск заказов в радиусе 25 км от текущего местоположения.</p></div><span className="status">{newCount} новых</span></div>
 <div className="driver-demand-status"><span className={"driver-demand-indicator "+(driver.is_online?"online":"offline")}></span><div className="driver-demand-status-copy"><b>{driver.is_online?"Приём заказов включён":"Ты не на линии"}</b><p className="muted small">{gpsFresh?"Геолокация обновлена — показываем заказы поблизости.":driver.is_online?"Ожидаем геолокацию. Разреши доступ к местоположению, чтобы точнее искать заказы.":"Выйди на линию и разреши доступ к геолокации для поиска поблизости."}</p></div><button type="button" className={"button "+(driver.is_online?"danger":"primary")+" driver-demand-toggle"} onClick={toggle} disabled={lineSwitchBusy}>{lineSwitchBusy?"Подожди…":driver.is_online?"Уйти с линии":"Выйти на линию"}</button></div>
 <div className="driver-demand-metrics"><div className="driver-demand-stat"><span>Радиус поиска</span><strong>25 км</strong></div><div className="driver-demand-stat"><span>Новые заказы</span><strong>{newCount}</strong></div><div className="driver-demand-stat"><span>В работе</span><strong>{active.length}</strong></div></div>
 {newCount>0?<div className="driver-demand-preview"><article className="driver-demand-order"><div className="driver-demand-order-top"><strong>{newCount} новых заказа</strong></div><p>Все карточки заказов и тарифы отображаются в основной вкладке «Лента заказов».</p><button type="button" className="button secondary" onClick={()=>setTab("orders")}>Перейти к ленте заказов</button></article></div>:<div className="empty-state"><div className="empty-icon">⚡</div><h3>{driver.is_online?"Пока нет новых заказов рядом":"Выйди на линию для поиска заказов"}</h3><p className="muted">Новые заказы автоматически появятся в ленте заказов. Проверка обновляется каждые несколько секунд.</p></div>}
 <button type="button" className="button secondary" onClick={()=>setTab("orders")}>Открыть ленту заказов</button>
 </section>}{tab==="stats"&&<section className="panel driver-utility-panel">
 <div className="eyebrow">ТВОИ РЕЗУЛЬТАТЫ</div><h2>Статистика</h2>
 <div className="driver-stats-grid"><article className="driver-stat-card"><span>Поездок сегодня</span><strong>{todayCompletedOrders.length}</strong></article><article className="driver-stat-card"><span>Заработок сегодня</span><strong>{earningsToday.toLocaleString("ru-RU",{maximumFractionDigits:0})} ₸</strong></article><article className="driver-stat-card"><span>Активные поездки</span><strong>{active.length}</strong></article><article className="driver-stat-card"><span>Поездок в истории</span><strong>{history.length}</strong></article></div>
 <div className="driver-stat-total"><span>Заработок по последним {history.length} поездкам</span><strong>{totalNetEarnings.toLocaleString("ru-RU",{maximumFractionDigits:0})} ₸</strong></div>
 <button type="button" className="button secondary" onClick={()=>{setTab("history");refreshHistory()}}>Открыть историю поездок</button><button type="button" className="button secondary" style={{marginTop:8}} onClick={()=>setTab("active")}>Текущие поездки ({active.length})</button>
 </section>}{tab==="history"&&<section className="panel"><div className="eyebrow">ИСТОРИЯ</div><h2>Завершённые поездки</h2>{history.length===0?<p className="muted">История пока пустая.</p>:history.map(o=><article className="order" key={o.id}><h3>{o.clients?.name||"Клиент"}</h3><p>📍 {o.pickup_address}</p><p>🏁 {o.destination_address}</p><p>💵 Оплата за поездку: <b>{Number(o.agreed_price||o.driver_price||o.client_price||0).toLocaleString("ru-RU")} ₸</b></p><p>🧾 Комиссия: <b>{Number(o.platform_commission_amount||0).toLocaleString("ru-RU")} ₸</b>{walletInfo?.test_mode?" (тестовый расчёт)":""}</p><p className="success">Твой заработок: <b>{Number(o.driver_net_amount ?? (Number(o.agreed_price||o.driver_price||o.client_price||0)-Number(o.platform_commission_amount||0))).toLocaleString("ru-RU")} ₸</b></p></article>)}</section>}{tab==="wallet"&&<section className="panel"><div className="eyebrow">ЛИЦЕВОЙ СЧЁТ</div><h2>Кошелёк водителя</h2><div className="driver-account-number-card"><div><span>Номер лицевого счёта</span><strong>{driver.account_number||"—"}</strong></div><button className="button secondary" type="button" disabled={!driver.account_number} onClick={copyDriverAccountNumber}>Копировать</button></div><div className="wallet-balance"><span>Текущий баланс</span><strong>{Number(walletInfo?.wallet_balance??driver.wallet_balance??0).toLocaleString("ru-RU")} ₸</strong><p>{walletInfo?.test_mode?"Тестовый режим: пополнение и списание комиссии не производятся. Комиссия за поездку отображается расчётно.":"Минимальный баланс для выхода на линию: "+Number(walletInfo?.minimum_wallet_balance||500).toLocaleString("ru-RU")+" ₸."}</p><button className="button secondary" onClick={refreshWallet}>Обновить баланс</button></div><h3>Последние операции</h3>{!(walletInfo?.transactions||[]).length?<p className="muted">Операций пока нет.</p>:(walletInfo.transactions||[]).map(tx=><article className="order" key={tx.id}><div className="order-top"><b>{tx.kind==="topup"?"Пополнение":tx.kind==="commission"?"Комиссия":"Корректировка"}</b><span>{tx.amount>0?"+":""}{Number(tx.amount).toLocaleString("ru-RU")} ₸</span></div><p className="muted small">{tx.note||"—"} · {new Date(tx.created_at).toLocaleString("ru-RU")}</p><p>Баланс после операции: {Number(tx.balance_after).toLocaleString("ru-RU")} ₸</p></article>)}</section>}{tab==="profile"&&<section className="panel"><div className="eyebrow">ПРОФИЛЬ</div><h2>Данные водителя</h2><form onSubmit={saveProfile}><div className="field"><label>Фото водителя</label>{form.photo_url&&<img src={form.photo_url} alt="Предпросмотр" style={{width:90,height:90,borderRadius:20,objectFit:"cover",marginBottom:6}}/>}<input type="file" accept="image/*" onChange={photo}/></div><div className="field"><label>Имя</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div><div className="field"><label>Номер лицевого счёта</label><input value={driver.account_number||"—"} readOnly/></div><div className="field"><label>Телефон</label><input value={driver.phone} readOnly/></div><div className="field"><label>Автомобиль</label><input value={form.car_model} onChange={e=>setForm({...form,car_model:e.target.value})}/></div><div className="field"><label>Госномер</label><input value={form.car_plate} onChange={e=>setForm({...form,car_plate:e.target.value})}/></div><div className="field"><label>Цвет машины</label><input value={form.car_color} onChange={e=>setForm({...form,car_color:e.target.value})}/></div><div className="field"><label>Класс автомобиля</label><p className="muted small">Класс определяется автоматически по марке и модели автомобиля.</p></div><div className="success">Полные номера документов клиенту не показываем. На следующем этапе добавим отметку проверки техпаспорта и водительского удостоверения.</div><button className="button primary" disabled={busy}>{busy?"Сохраняем…":"Сохранить профиль"}</button></form><button className="button danger" style={{marginTop:10}} onClick={logout}>Выйти</button></section>}{tab==="order-filter"&&<section className="driver-order-filter-page">
 <header className="driver-order-filter-header"><button type="button" aria-label="Назад" onClick={()=>setTab("settings")}>‹</button><h2>Фильтр входящих заказов</h2><span></span></header>
 <div className="driver-order-filter-info">Фильтры применяются только к входящим уведомлениям о новых заказах. Вы всё равно будете видеть все доступные заказы в ленте</div>
 <section className="driver-order-filter-control">
  <label htmlFor="pickup-distance-filter">Расстояние до точки посадки</label>
  <strong>до {Number(filterPickupDistance).toLocaleString("ru-RU")} км</strong>
  <input id="pickup-distance-filter" aria-label="Максимальное расстояние до точки посадки" type="range" min="0.5" max="3" step="0.5" value={filterPickupDistance} style={{"--range-progress":((filterPickupDistance-0.5)/(3-0.5))*100+"%"}} onChange={e=>setFilterPickupDistance(Number(e.target.value))}/>
  <div className="driver-order-filter-scale"><span>0.5 км</span><span>3 км</span></div>
 </section>
 <section className="driver-order-filter-control">
  <label htmlFor="min-price-km-filter">Минимальная цена за км</label>
  <strong>от {Number(filterMinPricePerKm).toLocaleString("ru-RU")} ₸</strong>
  <input id="min-price-km-filter" aria-label="Минимальная цена за километр" type="range" min="50" max="500" step="50" value={filterMinPricePerKm} style={{"--range-progress":((filterMinPricePerKm-50)/(500-50))*100+"%"}} onChange={e=>setFilterMinPricePerKm(Number(e.target.value))}/>
  <div className="driver-order-filter-scale"><span>50 ₸</span><span>500 ₸</span></div>
 </section>
 <section className="driver-order-filter-control">
  <label htmlFor="min-order-price-filter">Цена заказа</label>
  <strong>от {Number(filterMinOrderPrice).toLocaleString("ru-RU")} ₸</strong>
  <input id="min-order-price-filter" aria-label="Минимальная цена заказа" type="range" min="300" max="3000" step="300" value={filterMinOrderPrice} style={{"--range-progress":((filterMinOrderPrice-300)/(3000-300))*100+"%"}} onChange={e=>setFilterMinOrderPrice(Number(e.target.value))}/>
  <div className="driver-order-filter-scale"><span>300 ₸</span><span>3 000 ₸</span></div>
 </section>
</section>}{tab==="settings"&&<section className="panel driver-utility-panel driver-settings-page" data-moy-taxi-settings-v2>
 <div className="driver-settings-header"><button type="button" className="driver-settings-back" onClick={()=>setTab("orders")}>‹</button><h2>Настройки</h2><span></span></div>
 <div className="driver-settings-tabs"><button type="button" className={settingsTab==="tariffs"?"active":""} onClick={()=>setSettingsTab("tariffs")}>Тарифы</button><button type="button" className={settingsTab==="orders"?"active":""} onClick={()=>setSettingsTab("orders")}>Заказы</button></div>
 {settingsTab==="orders"&&<div className="driver-settings-body driver-orders-settings">
  <button type="button" className="driver-settings-row driver-order-filter-placeholder" onClick={()=>setTab("order-filter")}><span className="driver-settings-icon">▤</span><span><b>Фильтр входящих заказов</b></span><span className="driver-settings-chevron">›</span></button>
  <div className="driver-settings-dark-block">
   <div className="driver-settings-dark-heading"><span className="driver-settings-icon">☾</span><b>Тёмный режим</b></div>
   <div className="driver-settings-choice"><button type="button" className={darkMode==="off"?"active":""} onClick={()=>setDarkMode("off")}>Выкл.</button><button type="button" className={darkMode==="dark"?"active":""} onClick={()=>setDarkMode("dark")}>Вкл.</button><button type="button" className={darkMode==="system"?"active":""} onClick={()=>setDarkMode("system")}>Как в системе</button></div>
  </div>
  <div className="driver-settings-row driver-setting-sound"><span className="driver-settings-icon">♧</span><span><b>Звуки в ленте заказов</b><small>Получать уведомления о новых заказах в ленте</small></span><button type="button" aria-label="Звуки в ленте заказов" aria-pressed={Boolean(feedSounds)} className={"driver-settings-toggle "+(feedSounds?"on":"")} onClick={()=>setFeedSounds(v=>!v)}><i></i></button></div>
  <div className="driver-settings-row driver-setting-chain"><span className="driver-settings-icon">▷</span><span className="driver-setting-label-with-help"><b>Цепочка заказов</b><span className="driver-setting-help" title="После завершения поездки оставайся на линии для следующих заказов">?</span></span><button type="button" aria-label="Цепочка заказов" aria-pressed={Boolean(orderChain)} className={"driver-settings-toggle "+(orderChain?"on":"")} onClick={()=>setOrderChain(v=>!v)}><i></i></button></div>
  <div className="driver-settings-row driver-setting-quick"><span className="driver-settings-icon">▣</span><span><b>Кнопка быстрого перехода</b></span><button type="button" aria-label="Кнопка быстрого перехода" aria-pressed={Boolean(quickSwitch)} className={"driver-settings-toggle "+(quickSwitch?"on":"")} onClick={()=>setQuickSwitch(v=>!v)}><i></i></button></div>
  <button type="button" className="driver-settings-row driver-settings-link driver-setting-navigator" onClick={()=>{const next=navigatorApp==="2gis"?"yandex":navigatorApp==="yandex"?"google":"2gis";setNavigatorApp(next);try{localStorage.setItem("moyTaxiNavigator",next)}catch{};setNotice("Навигатор: "+(next==="2gis"?"2GIS":next==="yandex"?"Яндекс Навигатор":"Google Maps"))}}><span className="driver-settings-icon">➤</span><span><b>Навигатор</b></span><span className="driver-settings-chevron">›</span></button>
 </div>}
 {settingsTab==="tariffs"&&<div className="driver-settings-body">
  <div className="driver-vehicle-card">
   <div className="driver-vehicle-info"><b>{driver.car_model||"Автомобиль не указан"}</b><small>{driver.car_plate||"Госномер не указан"}</small><small className="driver-vehicle-class">Класс: {vehicleCapabilities.primary==="minivan"?"6 мест":vehicleCapabilities.primary==="comfort"?"Комфорт":"Эконом"}</small></div>
   <button type="button" className="driver-vehicle-edit" onClick={beginVehicleEdit}>{vehicleEditOpen?"Отмена":"Изменить"}</button>
  </div>
  {vehicleEditOpen&&<form className="driver-vehicle-edit-form" onSubmit={saveTariffVehicle}>
   <div className="field"><label>Марка и модель автомобиля</label><input required value={vehicleDraft.car_model} onChange={e=>setVehicleDraft(v=>({...v,car_model:e.target.value}))} placeholder="Например, Chevrolet Cobalt"/></div>
   <div className="field"><label>Государственный номер</label><input value={vehicleDraft.car_plate} onChange={e=>setVehicleDraft(v=>({...v,car_plate:e.target.value.toUpperCase()}))} placeholder="Например, 758BCG01"/></div>
   <button className="button primary" disabled={vehicleSaving}>{vehicleSaving?"Сохраняем…":"Сохранить автомобиль"}</button>
  </form>}
  <section className="driver-tariff-section"><h3>Поездки</h3>
   <div className="driver-tariff-option"><div className="driver-tariff-option-copy"><b>Эконом</b><small>Доступен для любого автомобиля</small></div><button type="button" className={"driver-settings-toggle "+(tariffModes.economy?"on":"")} aria-pressed={Boolean(tariffModes.economy)} onClick={()=>setTariffModes(m=>({...m,economy:!m.economy}))}><i></i></button></div>
   <div className="driver-tariff-option"><div className="driver-tariff-option-copy"><b>Без торга</b><small>Заказ по указанной цене, без предложения своей цены</small></div><button type="button" className={"driver-settings-toggle "+(tariffModes.noBargaining?"on":"")} aria-pressed={Boolean(tariffModes.noBargaining)} onClick={()=>setTariffModes(m=>({...m,noBargaining:!m.noBargaining}))}><i></i></button></div>
   <div className="driver-tariff-option"><div className="driver-tariff-option-copy"><b>Комфорт</b>{!vehicleCapabilities.comfort&&<small>Недоступен для вашего авто</small>}{vehicleCapabilities.comfort&&<small>Доступен для этой модели автомобиля</small>}</div><button type="button" disabled={!vehicleCapabilities.comfort} className={"driver-settings-toggle "+(tariffModes.comfort&&vehicleCapabilities.comfort?"on":"")} aria-label="Тариф Комфорт" aria-pressed={Boolean(tariffModes.comfort&&vehicleCapabilities.comfort)} onClick={()=>setTariffModes(m=>({...m,comfort:!m.comfort}))}><i></i></button></div>
   <div className="driver-tariff-option"><div className="driver-tariff-option-copy"><b>6 мест</b>{!vehicleCapabilities.seats6&&<small>Недоступен для вашего авто</small>}{vehicleCapabilities.seats6&&<small>Доступен для этой модели автомобиля</small>}</div><button type="button" disabled={!vehicleCapabilities.seats6} className={"driver-settings-toggle "+(tariffModes.seats6&&vehicleCapabilities.seats6?"on":"")} aria-label="Тариф 6 мест" aria-pressed={Boolean(tariffModes.seats6&&vehicleCapabilities.seats6)} onClick={()=>setTariffModes(m=>({...m,seats6:!m.seats6}))}><i></i></button></div>
  </section>
  <section className="driver-tariff-section driver-courier-section"><h3>Курьеры <span>Дополнительные заказы</span></h3>
   <div className="driver-tariff-option"><div className="driver-tariff-option-copy"><b>Доставка посылок</b><small>Получать подходящие заказы на доставку</small></div><button type="button" className={"driver-settings-toggle "+(tariffModes.parcels?"on":"")} aria-pressed={Boolean(tariffModes.parcels)} onClick={()=>setTariffModes(m=>({...m,parcels:!m.parcels}))}><i></i></button></div>
  </section>
  <div className="driver-tariff-guide">
   <div><span className="driver-tariff-guide-icon">🚘</span><section><b>Эконом</b><p>Подходит для любого исправного автомобиля.</p></section></div>
   <div><span className="driver-tariff-guide-icon">ID</span><section><b>Комфорт</b><p>Открывается автоматически только для поддерживаемых моделей автомобилей.</p></section></div>
   <div><span className="driver-tariff-guide-icon">▣</span><section><b>6 мест</b><p>Для подходящих минивэнов и автомобилей с увеличенным количеством пассажирских мест.</p></section></div>
  </div>
 </div>}
 </section>}{tab==="city"&&<section className="panel driver-menu-page"><div className="eyebrow">ГОРОД</div><h2>Городские заказы</h2><p className="muted">Поездки по городу. Выбери заказ, чтобы перейти к его карточке в ленте.</p>{renderMenuOrders(cityOrders,"Городских заказов пока нет")}<button type="button" className="button secondary" onClick={()=>openDriverTab("orders")}>Вся лента заказов</button></section>}
{tab==="intercity"&&<section className="panel driver-menu-page"><div className="eyebrow">МЕЖГОРОД</div><h2>Междугородние поездки</h2><p className="muted">Заказы с типом поездки «Межгород».</p>{renderMenuOrders(intercityOrders,"Междугородних заказов пока нет")}<button type="button" className="button secondary" onClick={()=>openDriverTab("orders")}>Вся лента заказов</button></section>}
{tab==="cargo"&&<section className="panel driver-menu-page"><div className="eyebrow">ГРУЗОВЫЕ</div><h2>Грузовые заказы</h2><p className="muted">Здесь отображаются заказы, отмеченные в системе как грузовые. Если их пока нет, новые появятся после подключения такого типа заказов.</p>{renderMenuOrders(cargoOrders,"Грузовых заказов пока нет")}<button type="button" className="button secondary" onClick={()=>openDriverTab("orders")}>Вся лента заказов</button></section>}
{tab==="academy"&&<section className="panel driver-menu-page"><div className="eyebrow">ОБУЧЕНИЕ</div><h2>Академия водителя</h2><p className="muted">Короткие памятки для безопасной и качественной работы.</p><div className="driver-academy-list">
 {[
  ["welcome","Начало работы","Проверь автомобиль, документы, номер телефона и данные профиля перед выходом на линию."],
  ["orders","Работа с заказом","Сверь адрес подачи и маршрут. Принимай заказ только после проверки цены и условий поездки."],
  ["passenger","Общение с пассажиром","Уточняй место посадки в чате или звонком и сообщай о задержке спокойно и заранее."],
  ["safety","Безопасная поездка","Не отвлекайся на экран за рулём, соблюдай ПДД и завершай поездку только после фактического окончания."]
 ].map(([id,title,body])=><article className="driver-academy-card" key={id}><div><h3>{title}</h3><p>{body}</p></div><button type="button" className={"button "+(academyCompleted.includes(id)?"secondary":"primary")} onClick={()=>toggleAcademyModule(id)}>{academyCompleted.includes(id)?"Прочитано ✓":"Отметить"}</button></article>)}
 </div><p className="muted small">Прогресс обучения сохраняется на этом телефоне.</p></section>}
{tab==="notifications"&&<section className="panel driver-menu-page"><div className="eyebrow">УВЕДОМЛЕНИЯ</div><h2>Уведомления</h2><p className="muted">Разрешение браузера: {notificationPermission==="granted"?"включено":notificationPermission==="denied"?"запрещено":notificationPermission==="unsupported"?"не поддерживается":"не запрошено"}.</p><button type="button" className="button primary" onClick={notify}>{notificationPermission==="granted"?"Проверить разрешение":"Включить уведомления"}</button><h3 style={{marginTop:22}}>Новые заказы</h3>{renderMenuOrders(notificationOrders,"Новых уведомлений пока нет")}<button type="button" className="button secondary" onClick={()=>openDriverTab("orders")}>Открыть ленту заказов</button></section>}
{tab==="safety"&&<section className="panel driver-menu-page"><div className="eyebrow">БЕЗОПАСНОСТЬ</div><h2>Проверка перед поездкой</h2><p className="muted">Отметь пункты перед выходом на линию. Список сохраняется на этом телефоне.</p><div className="driver-safety-list">
 {[
  ["vehicle","Проверить состояние автомобиля и шины"],
  ["seatbelt","Пристегнуть ремень безопасности"],
  ["phone","Установить телефон в держатель и не отвлекаться во время движения"]
 ].map(([id,label])=><label className="driver-safety-check" key={id}><input type="checkbox" checked={Boolean(safetyChecks[id])} onChange={()=>toggleSafetyItem(id)}/><span>{label}</span></label>)}
 </div><a className="button danger" href="tel:112">Экстренный номер 112</a><p className="muted small">Используй экстренный номер только при реальной угрозе жизни или здоровью.</p></section>}
{tab==="help"&&<section className="panel driver-menu-page"><div className="eyebrow">ПОМОЩЬ</div><h2>Частые вопросы</h2><details className="driver-help-item"><summary>Как выйти на линию?</summary><p>В верхней части экрана нажми переключатель «На линии» и разреши доступ к геолокации, если браузер его запрашивает.</p></details><details className="driver-help-item"><summary>Почему не приходят заказы?</summary><p>Проверь, что ты на линии, разрешена геолокация и у браузера включены уведомления. Новые заказы также отображаются в ленте при открытом приложении.</p></details><details className="driver-help-item"><summary>Где посмотреть заработок и баланс?</summary><p>Доход за сегодня показан в верхней части экрана, а подробности кошелька доступны в меню «Кошелёк».</p></details><details className="driver-help-item"><summary>Как изменить данные машины?</summary><p>Открой профиль водителя через верхнюю часть меню и сохрани изменения после редактирования автомобиля.</p></details><button type="button" className="button primary" onClick={openDriverSupport}>Связаться с поддержкой</button></section>}
{tab==="online-registration"&&<section className="panel driver-menu-page"><div className="eyebrow">ОНЛАЙН-РЕГИСТРАЦИЯ</div><h2>Данные водителя</h2><p className="muted">Проверь данные профиля, чтобы пассажиру было проще узнать тебя и автомобиль.</p><div className="driver-registration-status"><div><span>Имя</span><b>{driver.name||"Не заполнено"}</b></div><div><span>Телефон</span><b>{driver.phone||"Не указан"}</b></div><div><span>Автомобиль</span><b>{driver.car_model||"Не указан"}</b></div><div><span>Госномер</span><b>{driver.car_plate||"Не указан"}</b></div></div><p className="muted small">Проверка документов и одобрение регистрации пока не подключены к серверу.</p><button type="button" className="button primary" onClick={showDriverProfile}>Заполнить профиль</button></section>}
{tab==="invite"&&<section className="panel driver-menu-page"><div className="eyebrow">ПРИГЛАСИТЬ ДРУГА</div><h2>Поделись «Мой Такси»</h2><p className="muted">Отправь свою ссылку знакомому, чтобы он мог открыть страницу твоего такси.</p><div className="driver-invite-link">{origin+"/c/"+driver.public_code}</div><button type="button" className="button primary" onClick={share}>Поделиться ссылкой</button><button type="button" className="button secondary" style={{marginTop:8}} onClick={copyInviteLink}>Скопировать ссылку</button><p className="muted small">Автоматический учёт приглашений и бонусы ещё не подключены.</p></section>}
{tab==="support"&&<section className="panel driver-utility-panel"><div className="eyebrow">ПОДДЕРЖКА</div><h2>Служба поддержки</h2><p className="muted">Напиши, что случилось. Текст обращения можно отправить через мессенджер из системного меню телефона.</p><div className="field"><label>Сообщение</label><textarea value={supportMessage} onChange={e=>setSupportMessage(e.target.value)} placeholder="Опиши вопрос или проблему…" rows={5}/></div><button type="button" className="button primary" onClick={shareSupportMessage}>Подготовить обращение</button><button type="button" className="button secondary" style={{marginTop:8}} onClick={()=>openDriverTab("help")}>Частые вопросы</button></section>}
{selectedOrder&&selectedOrder.status==="new"&&<div className="driver-order-detail-backdrop" role="presentation" onClick={()=>setSelectedOrderId(null)}>
 <section className="driver-order-detail-sheet" role="dialog" aria-modal="true" aria-label="Подробности заказа" onClick={e=>e.stopPropagation()}>
  <header className="driver-order-detail-header"><div><span className="eyebrow">ВХОДЯЩИЙ ЗАКАЗ</span><h2>Заказ</h2></div><button type="button" className="driver-order-detail-close" aria-label="Закрыть заказ" onClick={()=>setSelectedOrderId(null)}>×</button></header>
  <div className="driver-order-detail-map">
   <RouteMap key={String(selectedOrder.id)} pickupPoint={validOrderPoint(selectedOrder.pickup_lat,selectedOrder.pickup_lng)} destinationPoint={validOrderPoint(selectedOrder.destination_lat,selectedOrder.destination_lng)} routeGeometry={detailRouteGeometry}
    pickupInfo={detailPickupStats?{timeText:detailPickupStats.durationMin>0?Math.round(detailPickupStats.durationMin)+" мин":"Рядом",distanceText:detailPickupStats.distanceKm>=0?formatDistance(detailPickupStats.distanceKm):""}:null}
    destinationInfo={{timeText:detailRouteStats?.durationMin>0?Math.round(detailRouteStats.durationMin)+" мин":"",distanceText:formatDistance(detailRouteStats?.distanceKm||selectedOrder.route_distance_km||0)}}/>
   {detailMapLoading&&<div className="driver-order-map-loading">Строим маршрут…</div>}
  </div>
  <div className="driver-order-detail-body">
   <div className="driver-order-detail-price-row"><div><span className="muted small">Цена пассажира</span><strong>{counterOfferBase(selectedOrder).toLocaleString("ru-RU")} ₸</strong></div><span className="driver-order-detail-km">{Number(selectedOrder.route_distance_km||0).toLocaleString("ru-RU",{maximumFractionDigits:1})} км</span></div>
   <div className="driver-order-detail-address"><span className="driver-order-detail-dot pickup">A</span><div><small>ОТКУДА</small><b>{selectedOrder.pickup_address||"Адрес подачи не указан"}</b></div></div>
   <div className="driver-order-detail-address"><span className="driver-order-detail-dot destination">B</span><div><small>КУДА</small><b>{selectedOrder.destination_address||"Адрес назначения не указан"}</b></div></div>
   <div className="driver-order-detail-meta"><span>{VEHICLE_CLASSES.find(x=>x[0]===selectedOrder.vehicle_class)?.[1]||"Эконом"} · {selectedOrder.trip_type==="intercity"?"Межгород":"Город"}</span><span>{selectedOrder.payment_method==="kaspi_gold"?"Перевод на Kaspi":"Наличные"}</span></div>
   {selectedOrder.my_offer?.status==="pending"&&<div className="driver-order-offer-pending">Ты предложил <b>{Number(selectedOrder.my_offer.price).toLocaleString("ru-RU")} ₸</b>. Ждём, пока пассажир ответит.
    <div style={{marginTop:8,fontSize:12}}>
     <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}><span>Предложение активно ещё</span><b>{formatOfferTimeLeft(selectedOfferRemaining)}</b></div>
     <div style={{height:5,width:"100%",borderRadius:99,background:"#cbd5d1",overflow:"hidden",marginTop:6}}><span style={{display:"block",height:"100%",width:selectedOfferProgress+"%",background:"#16a34a",transition:"width 1s linear"}} /></div>
    </div>
   </div>}
   {selectedOrder.price_status==="declined"&&<p className="muted small">Клиент отклонил предыдущую цену. Можно предложить новую.</p>}
   {selectedOrderWrongVehicleClass&&<div className="error driver-order-detail-error">Этот заказ тарифа «{VEHICLE_CLASSES.find(x=>x[0]===selectedOrder.vehicle_class)?.[1]||"другой"}» не подходит классу твоего автомобиля «{VEHICLE_CLASSES.find(x=>x[0]===driver?.vehicle_class)?.[1]||"Эконом"}». Заказ виден в ленте, но принять его нельзя.</div>}
   {selectedOrderTariffDisabled&&<div className="muted small">Этот тариф выключен в твоих настройках. Включи его в разделе «Настройки → Тарифы», чтобы принимать такие заказы.</div>}
   {error&&<div className="error driver-order-detail-error">{error}</div>}
   <button type="button" className="button primary driver-order-accept" disabled={selectedOrderWrongVehicleClass||selectedOrderTariffDisabled||(!selectedOrder.driver_id&&selectedOrder.my_offer?.status==="pending")} onClick={()=>acceptOrderAndNavigate(selectedOrder)}>{selectedOrderWrongVehicleClass?"Тариф для другого автомобиля":selectedOrderTariffDisabled?"Тариф выключен":!selectedOrder.driver_id&&selectedOrder.my_offer?.status==="pending"?"Ждём ответа клиента":"Принять за "+counterOfferBase(selectedOrder).toLocaleString("ru-RU")+" ₸"}</button>
   <div className="driver-order-offer-panel"><h3>Предложите цену</h3><p className="muted small">Можно предложить до 30% выше цены пассажира. Пассажир сам решит, соглашаться или нет.</p>
    <div className="driver-order-price-options">{counterOfferOptions(selectedOrder).map(price=><button key={price} type="button" className="driver-order-price-option" disabled={selectedOrderWrongVehicleClass||selectedOrderTariffDisabled||!driver.is_online||selectedOrder.my_offer?.status==="pending"} onClick={()=>offerPrice(selectedOrder,price)}>{price.toLocaleString("ru-RU")} ₸</button>)}<button type="button" className="driver-order-price-custom" aria-label="Ввести свою цену" title="Ввести свою цену" disabled={selectedOrderWrongVehicleClass||selectedOrderTariffDisabled||!driver.is_online||selectedOrder.my_offer?.status==="pending"||maxCounterOffer(selectedOrder)<=counterOfferBase(selectedOrder)} onClick={()=>setOfferCustomOpen(v=>!v)}><span>✎</span></button></div>
    {!driver.is_online&&<p className="muted small">Чтобы отправить предложение или принять заказ, выйди на линию.</p>}
    {offerCustomOpen&&<form className="driver-order-custom-offer" onSubmit={e=>{e.preventDefault();offerPrice(selectedOrder,offerPrices[selectedOrder.id])}}>
     <label htmlFor="driver-order-custom-price">Твоя цена, ₸</label><input id="driver-order-custom-price" type="number" inputMode="numeric" min={counterOfferBase(selectedOrder)} max={maxCounterOffer(selectedOrder)} step="10" value={offerPrices[selectedOrder.id]??""} onChange={e=>setOfferPrices(prev=>({...prev,[selectedOrder.id]:e.target.value}))} placeholder={"От "+counterOfferBase(selectedOrder).toLocaleString("ru-RU")+" до "+maxCounterOffer(selectedOrder).toLocaleString("ru-RU")+" ₸"} required/>
     <small>Максимум: {maxCounterOffer(selectedOrder).toLocaleString("ru-RU")} ₸</small><button type="submit" className="button secondary" disabled={selectedOrderWrongVehicleClass||selectedOrderTariffDisabled||!driver.is_online||!offerPrices[selectedOrder.id]||selectedOrder.my_offer?.status==="pending"}>Отправить предложение</button>
    </form>}
   </div>
   <button type="button" className="driver-order-detail-footer-close" onClick={()=>{setSelectedOrderId(null);setOfferCustomOpen(false)}}>Закрыть</button>
  </div>
 </section>
</div>}
<nav className={"driver-bottom-nav "+(tab==="order-filter"?"driver-bottom-nav-hidden":"")} aria-label="Разделы водительского приложения">
 <button type="button" className={"driver-nav-item "+(tab==="orders"?"active":"")} onClick={()=>{setTab("orders");setDriverMenuOpen(false)}}><span className="driver-nav-icon">☷</span><span>Лента заказов</span>{newCount>0&&<b className="driver-nav-count">{newCount}</b>}</button>
 <button type="button" className={"driver-nav-item "+(tab==="demand"?"active":"")} onClick={()=>{setTab("demand");setDriverMenuOpen(false)}}><span className="driver-nav-icon">ϟ</span><span>Спрос</span>{newCount>0&&<b className="driver-nav-count">{newCount}</b>}</button>
 <button type="button" className={"driver-nav-item "+(tab==="stats"?"active":"")} onClick={()=>{setTab("stats");setDriverMenuOpen(false)}}><span className="driver-nav-icon">▦</span><span>Статистика</span></button>
 <button type="button" className={"driver-nav-item "+(tab==="wallet"?"active":"")} onClick={()=>{setTab("wallet");setDriverMenuOpen(false);refreshWallet()}}><span className="driver-nav-icon">▱</span><span>Кошелёк</span></button>
</nav> {quickSwitch&&tab!=="order-filter"&&<button type="button" className="driver-quick-switch" onClick={()=>setTab("orders")} aria-label="Быстрый переход к заказам">↗ Заказы</button>}
{offerWaitOverlay&&offerWaitRemaining>0&&<div role="dialog" aria-modal="true" aria-label="Ожидание ответа пассажира" style={{position:"fixed",inset:0,zIndex:2147483647,background:"rgba(0,0,0,.68)",display:"flex",alignItems:"center",justifyContent:"center",textAlign:"center",padding:"24px",color:"#fff",fontSize:"clamp(24px,5.1vw,34px)",fontWeight:800,lineHeight:1.27,boxSizing:"border-box"}}>
 <div><div>Предлагаем вашу цену</div><div style={{fontSize:"clamp(30px,6.8vw,42px)",margin:"12px 0",fontWeight:900}}>{Number(offerWaitOverlay.price||0).toLocaleString("ru-RU")} ₸.</div><div>Дождитесь ответа</div></div>
 <div aria-label={"Осталось "+formatOfferTimeLeft(offerWaitRemaining)} style={{position:"fixed",left:0,right:0,bottom:0,height:6,zIndex:2147483647,pointerEvents:"none",background:"#333"}}><span style={{display:"block",height:"100%",width:offerWaitProgress+"%",background:"#c6ff00",transition:"width 1s linear"}} /></div>
</div>}
</main>;
}

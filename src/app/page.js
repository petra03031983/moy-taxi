"use client";
import { useEffect, useRef, useState } from "react";
import { callApi, statusLabel } from "./api";
function twoGisRoute(lat, lng, address) {
  if (typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng)) {
    return `https://2gis.kz/routeSearch/rsType/car/to/${lng},${lat}/go`;
  }
  return `https://2gis.kz/search/${encodeURIComponent(address || "")}`;
}
function twoGisTripRoute(fromLat, fromLng, toLat, toLng, address) {
  if ([fromLat, fromLng, toLat, toLng].every(v => typeof v === "number" && Number.isFinite(v))) {
    // 2GIS current route format: points are longitude,latitude and separated with "|".
    return `https://2gis.kz/directions/points/${fromLng},${fromLat}|${toLng},${toLat}`;
  }
  return twoGisRoute(toLat, toLng, address);
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
function formatDistance(value){
 const km=Number(value);
 if(!Number.isFinite(km)||km<0)return "";
 return km<1?Math.round(km*1000)+" м":km.toLocaleString("ru-RU",{maximumFractionDigits:1})+" км";
}
export default function Home(){
 const [entryMode,setEntryMode]=useState("choose"),[authMode,setAuthMode]=useState("login"),[form,setForm]=useState(emptyForm),[session,setSession]=useState(null),[driver,setDriver]=useState(null),[orders,setOrders]=useState([]),[history,setHistory]=useState([]),[tab,setTab]=useState("orders"),[showQR,setShowQR]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[installPrompt,setInstallPrompt]=useState(null),[origin,setOrigin]=useState(""),[offerPrices,setOfferPrices]=useState({}),[walletInfo,setWalletInfo]=useState({wallet_balance:0,test_mode:true,minimum_wallet_balance:500,transactions:[]}),[notificationPermission,setNotificationPermission]=useState("default"),[incomingAlerts,setIncomingAlerts]=useState([]),[lineSwitchBusy,setLineSwitchBusy]=useState(false),[driverMenuOpen,setDriverMenuOpen]=useState(false);
 const previousIds=useRef(new Set()),firstLoad=useRef(true),audioRef=useRef(null),watchRef=useRef(null);
 useEffect(()=>{setOrigin(window.location.origin);setNotificationPermission("Notification"in window?Notification.permission:"unsupported");if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});const bip=e=>{e.preventDefault();setInstallPrompt(e)};window.addEventListener("beforeinstallprompt",bip);const saved=localStorage.getItem("moyTaxiSession");if(saved){try{const s=cleanSession(JSON.parse(saved));if(s){setSession(s);callApi("driver_me",s).then(d=>setDriver(d.driver)).catch(()=>{localStorage.removeItem("moyTaxiSession");setSession(null)})}}catch{localStorage.removeItem("moyTaxiSession")}}const unlock=()=>{try{const C=window.AudioContext||window.webkitAudioContext;if(C&&!audioRef.current)audioRef.current=new C();audioRef.current?.resume()}catch{}};window.addEventListener("pointerdown",unlock,{once:true});return()=>{window.removeEventListener("beforeinstallprompt",bip);window.removeEventListener("pointerdown",unlock)}},[]);
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
  if(!session){previousIds.current=new Set();firstLoad.current=true;return}
  let alive=true;
  const ding=()=>{
   try{
    const C=window.AudioContext||window.webkitAudioContext;
    if(!audioRef.current&&C)audioRef.current=new C();
    const c=audioRef.current;if(!c)return;
    c.resume();
    [880,660].forEach((f,i)=>{
     const o=c.createOscillator(),g=c.createGain();o.frequency.value=f;
     const t=c.currentTime+i*.23;
     g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.18,t+.03);
     g.gain.exponentialRampToValueAtTime(.0001,t+.32);o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+.34);
    });
   }catch{}
  };
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
    const d=await callApi("driver_list",session);if(!alive)return;
    const next=sortOrdersNewestFirst(d.orders||[]);
    const ids=new Set(next.map(o=>o.id));
    const fresh=next.filter(o=>o.status==="new"&&!previousIds.current.has(o.id));
    if(!firstLoad.current&&fresh.length){
     const alerts=fresh.map(o=>({id:o.id,body:(o.pickup_address||"Адрес подачи не указан")+" · "+(Number(o.client_price)>0?Number(o.client_price).toLocaleString("ru-RU")+" ₸":"цена не указана")}));
     setIncomingAlerts(current=>[...alerts,...current].slice(0,3));
     alerts.forEach(alert=>window.setTimeout(()=>setIncomingAlerts(current=>current.filter(item=>item.id!==alert.id)),8000));
     fresh.forEach((o,index)=>{
      window.setTimeout(ding,index*650);
      void notifyNewOrder(o);
     });
     if(navigator.vibrate)navigator.vibrate(fresh.length>1?[250,100,250,100,250]:[250,100,250]);
    }
    previousIds.current=ids;firstLoad.current=false;
    setOrders(next);setDriver(old=>old?{...old,is_online:Boolean(d.is_online)}:old);
   }catch(e){
    if(alive&&/сессия|войти снова/i.test(e.message||"")){
     localStorage.removeItem("moyTaxiSession");setSession(null);setDriver(null);
    }
   }
  };
  load();const t=setInterval(load,3000);
  return()=>{alive=false;clearInterval(t)};
 },[session?.driver_id,session?.session_token]);
 useEffect(()=>{if(!session||!driver?.is_online||!("geolocation"in navigator))return;const send=p=>callApi("driver_location",{...session,lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}).catch(()=>{});const locate=()=>navigator.geolocation.getCurrentPosition(send,()=>{},{enableHighAccuracy:true,maximumAge:15000,timeout:15000});locate();watchRef.current=navigator.geolocation.watchPosition(send,()=>{},{enableHighAccuracy:true,maximumAge:15000,timeout:15000});const refreshTimer=setInterval(locate,60000);return()=>{clearInterval(refreshTimer);if(watchRef.current!=null)navigator.geolocation.clearWatch(watchRef.current)}},[session?.driver_id,session?.session_token,driver?.is_online]);
 async function auth(e){e.preventDefault();setBusy(true);setError("");try{const r=await callApi(authMode==="register"?"register_driver":"login_driver",form),s={driver_id:r.driver.id,session_token:r.session_token};localStorage.setItem("moyTaxiSession",JSON.stringify(s));setSession(s);setDriver(r.driver);setForm(emptyForm);setNotice(authMode==="register"?"Аккаунт создан.":"Вход выполнен.")}catch(e){setError(e.message||"Ошибка")}finally{setBusy(false)}}
 async function refreshHistory(){try{const d=await callApi("driver_history",session);setHistory(d.orders||[])}catch(e){setError(e.message)}}
 async function refreshWallet(){try{const w=await callApi("driver_wallet",session);setWalletInfo(w);const me=await callApi("driver_me",session);setDriver(me.driver)}catch(e){setError(e.message)}}
 async function toggle(){if(lineSwitchBusy)return;setLineSwitchBusy(true);setError("");try{const d=await callApi("driver_toggle_online",{...session,is_online:!driver.is_online});setDriver(d.driver||{...driver,is_online:d.is_online});setNotice(d.is_online?"Ты на линии.":"Ты не на линии.")}catch(e){setError(e.message)}finally{setLineSwitchBusy(false)}}
 async function updateOrder(id,status){
  try{
   const result=await callApi("driver_update",{...session,order_id:id,status});
   const d=await callApi("driver_list",session);setOrders(sortOrdersNewestFirst(d.orders||[]));
   if(status==="completed"){
    await refreshHistory();await refreshWallet();setTab("history");
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
 async function acceptOrderAndNavigate(o){
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
    if(mapTab){mapTab.location.href=twoGisRoute(acceptedOrder.pickup_lat,acceptedOrder.pickup_lng,acceptedOrder.pickup_address)}
    else{setNotice("Заказ принят. Нажми «Маршрут к клиенту в 2GIS», чтобы открыть навигатор.")}
  }catch(e){mapTab?.close();setError(e.message||"Не удалось принять заказ.")}
}
 async function offerPrice(o,overridePrice){const amount=Number(overridePrice??offerPrices[o.id]);if(!Number.isFinite(amount)||amount<100){setError("Укажи свою цену не ниже 100 ₸.");return}setError("");try{await callApi("driver_offer_price",{...session,order_id:o.id,price:amount});const d=await callApi("driver_list",session);setOrders(sortOrdersNewestFirst(d.orders||[]));setNotice("Предложение отправлено пассажиру. Он решит, принимать ли твою цену.");setOfferPrices(prev=>({...prev,[o.id]:""}))}catch(e){setError(e.message||"Не удалось отправить цену.")}}
 async function skipOrder(o){try{await callApi("driver_skip_order",{...session,order_id:o.id});setOrders(prev=>prev.filter(item=>item.id!==o.id));setNotice("Заказ скрыт только у тебя. Пассажир продолжит получать предложения других водителей.")}catch(e){setError(e.message||"Не удалось убрать заказ из списка.")}}
 async function saveProfile(e){e.preventDefault();setBusy(true);try{const d=await callApi("driver_update_profile",{...session,name:form.name,car_model:form.car_model,car_plate:form.car_plate,car_color:form.car_color,vehicle_class:form.vehicle_class||"economy",photo_url:form.photo_url||""});setDriver(d.driver);setNotice("Профиль сохранён.")}catch(e){setError(e.message)}finally{setBusy(false)}}
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
if(!session||!driver) return <main className="app auth-app"><header className="header"><div className="logo">Мой <span>Такси</span></div><span className="small">Панель водителя</span></header><section className="hero panel"><div className="hero-icon">🚕</div><p className="eyebrow">ЛИЧНЫЙ СЕРВИС</p><h1>{authMode==="register"?"Регистрация водителя":"Вход водителя"}</h1><p className="muted">Один аккаунт — твой QR-код и твои клиенты.</p></section>{error&&<div className="error">{error}</div>}{notice&&<div className="success">{notice}</div>}<section className="panel auth-panel"><div className="switcher"><button className={authMode==="login"?"switch active":"switch"} onClick={()=>setAuthMode("login")}>Войти</button><button className={authMode==="register"?"switch active":"switch"} onClick={()=>setAuthMode("register")}>Регистрация</button></div><form onSubmit={auth}>{authMode==="register"&&<div className="field"><label>Имя</label><input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Имя водителя"/></div>}<div className="field"><label>Номер телефона</label><input required type="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+7 777 000 00 00"/></div><div className="field"><label>Пароль</label><input required type="password" minLength={8} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Не менее 8 символов"/></div>{authMode==="register"&&<><div className="field"><label>Автомобиль</label><input value={form.car_model} onChange={e=>setForm({...form,car_model:e.target.value})} placeholder="Toyota Camry"/></div><div className="field"><label>Госномер</label><input value={form.car_plate} onChange={e=>setForm({...form,car_plate:e.target.value})} placeholder="123 ABC 01"/></div><div className="field"><label>Цвет машины</label><input value={form.car_color} onChange={e=>setForm({...form,car_color:e.target.value})} placeholder="Белый"/></div><div className="field"><label>Класс автомобиля</label><select value={form.vehicle_class||"economy"} onChange={e=>setForm({...form,vehicle_class:e.target.value})}><option value="economy">Эконом</option><option value="comfort">Комфорт</option><option value="comfort_plus">Комфорт+</option><option value="business">Бизнес</option><option value="minivan">Минивэн</option><option value="premium">Премиум</option></select><p className="muted small">Выбери класс по требованиям платформы. Позже добавим проверку категории по марке, модели и документам.</p></div></>}<button className="button primary" disabled={busy}>{busy?"Подожди…":authMode==="register"?"Создать аккаунт":"Войти"}</button></form></section></main>;
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
 const gpsFresh=Boolean(driver.location_updated_at&&Date.now()-Date.parse(driver.location_updated_at)<=5*60*1000&&driver.current_lat!=null&&driver.current_lng!=null);
 const visibleOrders=tab===""active"?orders.filter(o=>["accepted","arrived","client_ready","started"].includes(o.status)):orders;
 const showDriverProfile=()=>{setForm({...emptyForm,name:driver.name||"",car_model:driver.car_model||"",car_plate:driver.car_plate||"",car_color:driver.car_color||"",vehicle_class:driver.vehicle_class||"economy",photo_url:driver.photo_url||""});setTab("profile");setDriverMenuOpen(false)};
 const openDriverSettings=()=>{setTab("settings");setDriverMenuOpen(false)};
 const openDriverSupport=()=>{setTab("support");setDriverMenuOpen(false)};
 return <main className="app dashboard driver-dashboard"><div className="order-alert-stack" aria-live="polite" aria-atomic="false">{incomingAlerts.map(alert=><button type="button" className="order-alert" key={alert.id} onClick={()=>document.getElementById("order-"+alert.id)?.scrollIntoView({behavior:"smooth",block:"center"})}><span className="order-alert-icon">🔔</span><span className="order-alert-copy"><b>Новый заказ!</b><small>{alert.body}</small></span><span className="order-alert-arrow">›</span></button>)}</div><div className="driver-top-area"><div className="driver-topbar">
 <div className="driver-menu-wrap">
  <button type="button" className="driver-top-action driver-menu-trigger" aria-label="Меню водителя" aria-expanded={driverMenuOpen} onClick={()=>setDriverMenuOpen(open=>!open)}>☰</button>
  {driverMenuOpen&&<div className="driver-menu-panel">
   <div className="driver-menu-identity">
    <div className="driver-menu-avatar">{driver.photo_url?<img src={driver.photo_url} alt="" />:(driver.name||"В").slice(0,1).toLocaleUpperCase("ru-RU")}</div>
    <div className="driver-menu-identity-copy"><b>{driver.name||"Водитель"}</b><span>{driver.phone}</span><small>{driver.car_model||"Автомобиль не указан"}{driver.car_plate?" · "+driver.car_plate:""}</small></div>
   </div>
   <button type="button" className="driver-menu-item" onClick={showDriverProfile}><span>👤</span><span>Профиль водителя</span><b>›</b></button>
   <button type="button" className="driver-menu-item" onClick={openDriverSettings}><span>⚙️</span><span>Настройки</span><b>›</b></button>
   <button type="button" className="driver-menu-item" onClick={openDriverSupport}><span>💬</span><span>Связаться с поддержкой</span><b>›</b></button>
   <button type="button" className="driver-menu-item" onClick={()=>{setTab("active");setDriverMenuOpen(false)}}><span>🚕</span><span>Текущие поездки</span><b>›</b></button>
   <button type="button" className="driver-menu-item" onClick={()=>{setTab("history");setDriverMenuOpen(false);refreshHistory()}}><span>↻</span><span>История поездок</span><b>›</b></button>
  </div>}
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
</section></div>{(tab==="orders"||tab==="active")&&<section className="panel">
 <div className="section-heading">
  <div><div className="eyebrow">{tab==="active"?"ТЕКУЩИЕ ПОЕЗДКИ":"ВХОДЯЩИЕ ЗАКАЗЫ"}</div><h2>{tab==="active"?"В работе":"Лента заказов"}</h2></div>
  <span className="status">{tab==="active"?active.length+" в работе":newCount+" новых"}</span>
 </div>
 {tab==="orders"&&notificationPermission!=="granted"&&notificationPermission!=="unsupported"&&<button className="button secondary feed-notifications-button" type="button" onClick={notify}>🔔 Включить уведомления</button>}
 <p className="muted small feed-sort-note">{tab==="active"?"Здесь только принятые заказы и текущие поездки.":"Новые заказы появляются сверху. Старые остаются ниже."}</p>
 <div className="driver-order-feed">
 {visibleOrders.length===0?<div className="empty-state"><div className="empty-icon">🚕</div><h3>Заказов пока нет</h3><p className="muted">Когда клиент закажет поездку, здесь появится компактная карточка и прозвучит сигнал нового заказа.</p></div>:sortOrdersNewestFirst(visibleOrders).map(o=>{
  const customerName=o.clients?.name||"Клиент";
  const fare=Number(o.agreed_price||o.client_price||o.driver_price||0);
  const routeKm=Number(o.route_distance_km);
  const pricePerKm=Number.isFinite(routeKm)&&routeKm>0&&fare>0?Math.round(fare/routeKm):null;
  const pickupDistance=o.distance_km!=null?formatDistance(o.distance_km):"";
  return <article className={"order feed-order "+(o.status==="new"?"feed-order-new":"")} id={"order-"+o.id} key={o.id}>
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
    {o.price_status==="declined"&&<p className="feed-order-note muted">Клиент отклонил цену. Можно предложить другую.</p>}
    {o.status==="new"&&<details className="order-offer-details">
     <summary>💬 Предложить свою цену</summary>
     <div className="field feed-offer-field">
      <label htmlFor={"offer-"+o.id}>Твоя цена пассажиру, ₸</label>
      {o.my_offer?.status==="pending"&&<p className="success small">Ты уже предложил {Number(o.my_offer.price).toLocaleString("ru-RU")} ₸ — ждём ответа.</p>}
      <input id={"offer-"+o.id} type="number" min="100" max="1000000" step="50" value={offerPrices[o.id]??""} onChange={e=>setOfferPrices(prev=>({...prev,[o.id]:e.target.value}))} placeholder={o.client_price?"Цена пассажира "+Number(o.client_price).toLocaleString("ru-RU")+" ₸":"Введите цену поездки"}/>
      <button className="button secondary" type="button" disabled={!offerPrices[o.id]} onClick={()=>offerPrice(o)}>Отправить цену</button>
     </div>
    </details>}
    <div className="order-actions actions feed-order-actions">
     {o.status==="new"&&<><button type="button" className="button primary" disabled={!o.driver_id&&o.my_offer?.status==="pending"} onClick={()=>acceptOrderAndNavigate(o)}>{!o.driver_id&&o.my_offer?.status==="pending"?"Ждём ответа клиента":fare>0?("Принять за "+fare.toLocaleString("ru-RU")+" ₸"):"Принять заказ"}</button>{!o.driver_id&&<button type="button" className="button danger" onClick={()=>skipOrder(o)}>Не беру</button>}{o.driver_id&&<button type="button" className="button danger" onClick={()=>updateOrder(o.id,"cancelled")}>Отклонить</button>}</>}
     {o.status==="accepted"&&<><a className="button secondary" href={twoGisRoute(o.pickup_lat,o.pickup_lng,o.pickup_address)} target="_blank" rel="noreferrer">🗺️ Маршрут в 2GIS</a><button type="button" className="button primary" onClick={()=>updateOrder(o.id,"arrived")}>✅ Я на месте</button></>}
     {o.status==="arrived"&&<div className="success feed-order-note"><b>Ты на месте.</b><p className="small" style={{margin:"5px 0 0"}}>Ждём, пока пассажир нажмёт «Я выхожу».</p></div>}
     {o.status==="client_ready"&&<a className="button primary" href={twoGisTripRoute(o.pickup_lat,o.pickup_lng,o.destination_lat,o.destination_lng,o.destination_address)} target="_blank" rel="noreferrer" onClick={()=>updateOrder(o.id,"started")}>▶️ Начать поездку A → B</a>}
     {o.status==="started"&&<><a className="button secondary" href={twoGisRoute(o.destination_lat,o.destination_lng,o.destination_address)} target="_blank" rel="noreferrer">🧭 До пункта B</a><button type="button" className="button primary" onClick={()=>updateOrder(o.id,"completed")}>Завершить поездку</button></>}
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
 {newCount>0?<div className="driver-demand-preview">{demandOrders.slice(0,3).map(o=>{const fare=Number(o.agreed_price||o.client_price||o.driver_price||0),distance=o.distance_km!=null?formatDistance(o.distance_km):"";return <article className="driver-demand-order" key={o.id}><div className="driver-demand-order-top"><strong>{fare>0?fare.toLocaleString("ru-RU")+" ₸":"Цена не указана"}</strong>{distance&&<span>до {distance}</span>}</div><p>📍 {o.pickup_address||"Адрес подачи не указан"}</p><p>🏁 {o.destination_address||"Адрес назначения не указан"}</p><button type="button" className="button secondary" onClick={()=>setTab("orders")}>Открыть в ленте</button></article>})}</div>:<div className="empty-state"><div className="empty-icon">⚡</div><h3>{driver.is_online?"Пока нет новых заказов рядом":"Выйди на линию для поиска заказов"}</h3><p className="muted">Новые предложения будут появляться здесь. Проверка заказов обновляется автоматически.</p></div>}
 <button type="button" className="button secondary" onClick={()=>setTab("orders")}>Открыть ленту заказов</button>
 </section>}{tab==="stats"&&<section className="panel driver-utility-panel">
 <div className="eyebrow">ТВОИ РЕЗУЛЬТАТЫ</div><h2>Статистика</h2>
 <div className="driver-stats-grid"><article className="driver-stat-card"><span>Поездок сегодня</span><strong>{todayCompletedOrders.length}</strong></article><article className="driver-stat-card"><span>Заработок сегодня</span><strong>{earningsToday.toLocaleString("ru-RU",{maximumFractionDigits:0})} ₸</strong></article><article className="driver-stat-card"><span>Активные поездки</span><strong>{active.length}</strong></article><article className="driver-stat-card"><span>Поездок в истории</span><strong>{history.length}</strong></article></div>
 <div className="driver-stat-total"><span>Заработок по последним {history.length} поездкам</span><strong>{totalNetEarnings.toLocaleString("ru-RU",{maximumFractionDigits:0})} ₸</strong></div>
 <button type="button" className="button secondary" onClick={()=>{setTab("history");refreshHistory()}}>Открыть историю поездок</button><button type="button" className="button secondary" style={{marginTop:8}} onClick={()=>setTab("active")}>Текущие поездки ({active.length})</button>
 </section>}{tab==="history"&&<section className="panel"><div className="eyebrow">ИСТОРИЯ</div><h2>Завершённые поездки</h2>{history.length===0?<p className="muted">История пока пустая.</p>:history.map(o=><article className="order" key={o.id}><h3>{o.clients?.name||"Клиент"}</h3><p>📍 {o.pickup_address}</p><p>🏁 {o.destination_address}</p><p>💵 Оплата за поездку: <b>{Number(o.agreed_price||o.driver_price||o.client_price||0).toLocaleString("ru-RU")} ₸</b></p><p>🧾 Комиссия: <b>{Number(o.platform_commission_amount||0).toLocaleString("ru-RU")} ₸</b>{walletInfo?.test_mode?" (тестовый расчёт)":""}</p><p className="success">Твой заработок: <b>{Number(o.driver_net_amount ?? (Number(o.agreed_price||o.driver_price||o.client_price||0)-Number(o.platform_commission_amount||0))).toLocaleString("ru-RU")} ₸</b></p></article>)}</section>}{tab==="wallet"&&<section className="panel"><div className="eyebrow">ЛИЦЕВОЙ СЧЁТ</div><h2>Кошелёк водителя</h2><div className="wallet-balance"><span>Текущий баланс</span><strong>{Number(walletInfo?.wallet_balance??driver.wallet_balance??0).toLocaleString("ru-RU")} ₸</strong><p>{walletInfo?.test_mode?"Тестовый режим: пополнение и списание комиссии не производятся. Комиссия за поездку отображается расчётно.":"Минимальный баланс для выхода на линию: "+Number(walletInfo?.minimum_wallet_balance||500).toLocaleString("ru-RU")+" ₸."}</p><button className="button secondary" onClick={refreshWallet}>Обновить баланс</button></div><h3>Последние операции</h3>{!(walletInfo?.transactions||[]).length?<p className="muted">Операций пока нет.</p>:(walletInfo.transactions||[]).map(tx=><article className="order" key={tx.id}><div className="order-top"><b>{tx.kind==="topup"?"Пополнение":tx.kind==="commission"?"Комиссия":"Корректировка"}</b><span>{tx.amount>0?"+":""}{Number(tx.amount).toLocaleString("ru-RU")} ₸</span></div><p className="muted small">{tx.note||"—"} · {new Date(tx.created_at).toLocaleString("ru-RU")}</p><p>Баланс после операции: {Number(tx.balance_after).toLocaleString("ru-RU")} ₸</p></article>)}</section>}{tab==="profile"&&<section className="panel"><div className="eyebrow">ПРОФИЛЬ</div><h2>Данные водителя</h2><form onSubmit={saveProfile}><div className="field"><label>Фото водителя</label>{form.photo_url&&<img src={form.photo_url} alt="Предпросмотр" style={{width:90,height:90,borderRadius:20,objectFit:"cover",marginBottom:6}}/>}<input type="file" accept="image/*" onChange={photo}/></div><div className="field"><label>Имя</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div><div className="field"><label>Телефон</label><input value={driver.phone} readOnly/></div><div className="field"><label>Автомобиль</label><input value={form.car_model} onChange={e=>setForm({...form,car_model:e.target.value})}/></div><div className="field"><label>Госномер</label><input value={form.car_plate} onChange={e=>setForm({...form,car_plate:e.target.value})}/></div><div className="field"><label>Цвет машины</label><input value={form.car_color} onChange={e=>setForm({...form,car_color:e.target.value})}/></div><div className="field"><label>Класс автомобиля</label><select value={form.vehicle_class||"economy"} onChange={e=>setForm({...form,vehicle_class:e.target.value})}><option value="economy">Эконом</option><option value="comfort">Комфорт</option><option value="comfort_plus">Комфорт+</option><option value="business">Бизнес</option><option value="minivan">Минивэн</option><option value="premium">Премиум</option></select></div><div className="success">Полные номера документов клиенту не показываем. На следующем этапе добавим отметку проверки техпаспорта и водительского удостоверения.</div><button className="button primary" disabled={busy}>{busy?"Сохраняем…":"Сохранить профиль"}</button></form><button className="button danger" style={{marginTop:10}} onClick={logout}>Выйти</button></section>}{tab==="settings"&&<section className="panel driver-utility-panel"><div className="eyebrow">АККАУНТ ВОДИТЕЛЯ</div><h2>Настройки</h2><div className="driver-setting-row"><div><b>Уведомления о заказах</b><p className="muted small">{notificationPermission==="granted"?"Разрешение включено. Новые заказы сопровождаются уведомлениями.":notificationPermission==="unsupported"?"Этот браузер не поддерживает системные уведомления.":"Разреши уведомления, чтобы видеть новые заказы."}</p></div>{notificationPermission!=="granted"&&notificationPermission!=="unsupported"&&<button type="button" className="button secondary" onClick={notify}>Включить</button>}</div><button type="button" className="button secondary" onClick={async()=>{await Promise.all([refreshWallet(),refreshHistory()]);setNotice("Баланс и история обновлены.")}}>Обновить данные</button><button type="button" className="button danger" style={{marginTop:10}} onClick={logout}>Выйти из аккаунта</button></section>}{tab==="support"&&<section className="panel driver-utility-panel"><div className="eyebrow">ПОМОЩЬ</div><h2>Связаться с поддержкой</h2><p className="muted">Раздел поддержки добавлен в меню водителя. Официальный телефон или WhatsApp поддержки пока не указан, поэтому я не стал подставлять случайный контакт.</p><p className="muted small">Когда будет номер или ссылка службы поддержки, подключим их сюда.</p><button type="button" className="button secondary" onClick={()=>setTab("orders")}>Вернуться к ленте</button></section>}<nav className="driver-bottom-nav" aria-label="Разделы водительского приложения">
 <button type="button" className={"driver-nav-item "+(tab==="orders"?"active":"")} onClick={()=>{setTab("orders");setDriverMenuOpen(false)}}><span className="driver-nav-icon">☷</span><span>Лента заказов</span>{newCount>0&&<b className="driver-nav-count">{newCount}</b>}</button>
 <button type="button" className={"driver-nav-item "+(tab==="demand"?"active":"")} onClick={()=>{setTab("demand");setDriverMenuOpen(false)}}><span className="driver-nav-icon">ϟ</span><span>Спрос</span>{newCount>0&&<b className="driver-nav-count">{newCount}</b>}</button>
 <button type="button" className={"driver-nav-item "+(tab==="stats"?"active":"")} onClick={()=>{setTab("stats");setDriverMenuOpen(false)}}><span className="driver-nav-icon">▦</span><span>Статистика</span></button>
 <button type="button" className={"driver-nav-item "+(tab==="wallet"?"active":"")} onClick={()=>{setTab("wallet");setDriverMenuOpen(false);refreshWallet()}}><span className="driver-nav-icon">▱</span><span>Кошелёк</span></button>
</nav></main>;
}

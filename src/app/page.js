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
const DRIVER_DOCUMENT_FIELDS=[
 {key:"license_front",label:"Водительское удостоверение — лицевая сторона"},
 {key:"license_back",label:"Водительское удостоверение — обратная сторона"},
 {key:"vehicle_reg_front",label:"Техпаспорт — лицевая сторона"},
 {key:"vehicle_reg_back",label:"Техпаспорт — обратная сторона"},
 {key:"id_selfie",label:"Селфи: лицо и лицевая сторона удостоверения личности",capture:"user"}
];
const CAR_PHOTO_FIELDS=[
 {key:"left",label:"Левая сторона автомобиля"},
 {key:"front",label:"Перед автомобиля"},
 {key:"right",label:"Правая сторона автомобиля"},
 {key:"rear",label:"Задняя сторона автомобиля"},
 {key:"front_seat",label:"Переднее пассажирское сиденье — ремни видны"},
 {key:"rear_seat",label:"Заднее сиденье — ремни видны"},
 {key:"trunk",label:"Открытый багажник"}
];
const blankCarPhotos=()=>Object.fromEntries(CAR_PHOTO_FIELDS.map(x=>[x.key,""]));
const blankDocuments=()=>Object.fromEntries(DRIVER_DOCUMENT_FIELDS.map(x=>[x.key,""]));
const emptyForm={name:"",phone:"",password:"",car_model:"",car_plate:"",car_color:"",vehicle_class:"economy",photo_url:"",document_photos:blankDocuments(),car_photos:blankCarPhotos(),car_cleanliness_confirmed:false,legal_consent:false};
function cleanSession(v){return v&&typeof v.driver_id==="string"&&typeof v.session_token==="string"?v:null}
function driverReadyForWork(d){return d?.verification_status==="approved"&&Boolean(d?.documents_verified)&&d?.photo_control_status==="approved"&&Boolean(d?.next_photo_control_at)&&Date.parse(d.next_photo_control_at)>Date.now()}
function compressPhotoFile(file,maxDimension=1100,quality=.68){return new Promise((resolve,reject)=>{if(!file){reject(new Error("Выбери фотографию."));return}const reader=new FileReader();reader.onerror=()=>reject(new Error("Не удалось прочитать фотографию."));reader.onload=()=>{const img=new Image();img.onerror=()=>reject(new Error("Не удалось открыть изображение."));img.onload=()=>{try{const scale=Math.min(1,maxDimension/Math.max(img.width,img.height)),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);const data=canvas.toDataURL("image/jpeg",quality);if(data.length>320000)reject(new Error("Фото слишком большое. Сними документ ближе и выбери его снова."));else resolve(data)}catch{reject(new Error("Не удалось обработать фотографию."))}};img.src=String(reader.result||"")};reader.readAsDataURL(file)})}
function VerificationFields({form,setForm,onPhotoChange}){return <>
 <div className="field"><label>Марка и модель автомобиля</label><input required maxLength={100} value={form.car_model} onChange={e=>setForm(v=>({...v,car_model:e.target.value}))} placeholder="Toyota Camry"/></div>
 <div className="field"><label>Государственный номер</label><input required maxLength={30} value={form.car_plate} onChange={e=>setForm(v=>({...v,car_plate:e.target.value}))} placeholder="123 ABC 01"/></div>
 <div className="field"><label>Цвет автомобиля</label><input required maxLength={40} value={form.car_color} onChange={e=>setForm(v=>({...v,car_color:e.target.value}))} placeholder="Белый"/></div>
 <div className="field"><label>Класс автомобиля</label><select required value={form.vehicle_class||"economy"} onChange={e=>setForm(v=>({...v,vehicle_class:e.target.value}))}><option value="economy">Эконом</option><option value="comfort">Комфорт</option><option value="comfort_plus">Комфорт+</option><option value="business">Бизнес</option><option value="minivan">Минивэн</option><option value="premium">Премиум</option></select></div>
 <div className="divider-owner" />
 <h3>Документы водителя</h3><p className="muted small">Сфотографируй документы целиком, без бликов, чтобы текст и края были видны. Фото хранятся в закрытой базе и не показываются клиентам.</p>
 {DRIVER_DOCUMENT_FIELDS.map(item=><div className="field" key={item.key}><label>{item.label}</label>{form.document_photos?.[item.key]&&<img src={form.document_photos[item.key]} alt={item.label} style={{width:"100%",maxWidth:220,maxHeight:145,objectFit:"contain",borderRadius:12,marginBottom:7,background:"#f2f5f2"}}/>}<input type="file" accept="image/*" capture={item.capture||"environment"} required={!form.document_photos?.[item.key]} onChange={e=>onPhotoChange(e,"document_photos",item.key)}/></div>)}
 <div className="divider-owner" />
 <h3>Фотоконтроль автомобиля</h3><p className="muted small">Машина должна быть чистой. На фотографиях переднего и заднего сидений должны быть хорошо видны ремни безопасности. Для фото багажника открой его.</p>
 {CAR_PHOTO_FIELDS.map(item=><div className="field" key={item.key}><label>{item.label}</label>{form.car_photos?.[item.key]&&<img src={form.car_photos[item.key]} alt={item.label} style={{width:"100%",maxWidth:220,maxHeight:145,objectFit:"contain",borderRadius:12,marginBottom:7,background:"#f2f5f2"}}/>}<input type="file" accept="image/*" capture="environment" required={!form.car_photos?.[item.key]} onChange={e=>onPhotoChange(e,"car_photos",item.key)}/></div>)}
 <div className="field"><label><input type="checkbox" required checked={Boolean(form.car_cleanliness_confirmed)} onChange={e=>setForm(v=>({...v,car_cleanliness_confirmed:e.target.checked}))}/> Подтверждаю, что автомобиль чистый, ремни безопасности видны, фотографии сделаны сейчас.</label></div>
 <div className="field"><label><input type="checkbox" required checked={Boolean(form.legal_consent)} onChange={e=>setForm(v=>({...v,legal_consent:e.target.checked}))}/> Я ознакомился с <a href="/legal/driver-terms" target="_blank" rel="noreferrer">соглашением водителя</a> и <a href="/legal/privacy" target="_blank" rel="noreferrer">политикой обработки персональных данных</a>, даю согласие на обработку документов и фотографий для проверки.</label></div>
 </>}

export default function Home(){
 const [entryMode,setEntryMode]=useState("choose"),[authMode,setAuthMode]=useState("login"),[form,setForm]=useState(emptyForm),[session,setSession]=useState(null),[driver,setDriver]=useState(null),[orders,setOrders]=useState([]),[history,setHistory]=useState([]),[tab,setTab]=useState("orders"),[showQR,setShowQR]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[installPrompt,setInstallPrompt]=useState(null),[origin,setOrigin]=useState(""),[offerPrices,setOfferPrices]=useState({}),[walletInfo,setWalletInfo]=useState({wallet_balance:0,test_mode:true,minimum_wallet_balance:500,transactions:[]});
 const previousIds=useRef(new Set()),firstLoad=useRef(true),audioRef=useRef(null),watchRef=useRef(null);
 const [controlForm,setControlForm]=useState({car_photos:blankCarPhotos(),weekly_selfie_photo:"",car_cleanliness_confirmed:false});
 useEffect(()=>{setOrigin(window.location.origin);if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});const bip=e=>{e.preventDefault();setInstallPrompt(e)};window.addEventListener("beforeinstallprompt",bip);const saved=localStorage.getItem("moyTaxiSession");if(saved){try{const s=cleanSession(JSON.parse(saved));if(s){setSession(s);callApi("driver_me",s).then(d=>setDriver(d.driver)).catch(()=>{localStorage.removeItem("moyTaxiSession");setSession(null)})}}catch{localStorage.removeItem("moyTaxiSession")}}const unlock=()=>{try{const C=window.AudioContext||window.webkitAudioContext;if(C&&!audioRef.current)audioRef.current=new C();audioRef.current?.resume()}catch{}};window.addEventListener("pointerdown",unlock,{once:true});return()=>{window.removeEventListener("beforeinstallprompt",bip);window.removeEventListener("pointerdown",unlock)}},[]);
 useEffect(()=>{if(!session){setWalletInfo(null);return}let alive=true;const loadWallet=()=>Promise.all([callApi("driver_wallet",session),callApi("driver_me",session)]).then(([data,me])=>{if(alive){setWalletInfo(data);setDriver(old=>old?{...old,...me.driver}:me.driver);setForm(current=>({...current,name:current.name||me.driver.name||"",car_model:current.car_model||me.driver.car_model||"",car_plate:current.car_plate||me.driver.car_plate||"",car_color:current.car_color||me.driver.car_color||"",vehicle_class:current.vehicle_class||me.driver.vehicle_class||"economy"}))}}).catch(()=>{});loadWallet();const timer=setInterval(loadWallet,15000);return()=>{alive=false;clearInterval(timer)}},[session?.driver_id,session?.session_token]);
 useEffect(()=>{if(!session)return;let alive=true;const ding=()=>{try{const C=window.AudioContext||window.webkitAudioContext;if(!audioRef.current&&C)audioRef.current=new C();const c=audioRef.current;if(!c)return;c.resume();[880,660].forEach((f,i)=>{const o=c.createOscillator(),g=c.createGain();o.frequency.value=f;const t=c.currentTime+i*.23;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.18,t+.03);g.gain.exponentialRampToValueAtTime(.0001,t+.32);o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+.34)})}catch{}};const load=async()=>{try{const d=await callApi("driver_list",session);if(!alive)return;const next=d.orders||[],ids=new Set(next.map(o=>o.id)),fresh=next.filter(o=>o.status==="new"&&!previousIds.current.has(o.id));if(!firstLoad.current&&fresh.length){ding();navigator.vibrate?.([250,100,250]);if("Notification"in window&&Notification.permission==="granted")fresh.forEach(o=>{try{new Notification("Мой Такси: новый заказ",{body:`${o.clients?.name||"Клиент"} · ${o.pickup_address||"Подача"}`})}catch{}})}previousIds.current=ids;firstLoad.current=false;setOrders(next);setDriver(old=>old?{...old,is_online:Boolean(d.is_online)}:old)}catch(e){if(alive&&/сессия|войти снова/i.test(e.message||"")){localStorage.removeItem("moyTaxiSession");setSession(null);setDriver(null)}}};load();const t=setInterval(load,3000);return()=>{alive=false;clearInterval(t)}},[session?.driver_id,session?.session_token,driver?.verification_status,driver?.photo_control_status,driver?.next_photo_control_at]);
 useEffect(()=>{if(!session||!driver?.is_online||!("geolocation"in navigator))return;const send=p=>callApi("driver_location",{...session,lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}).catch(()=>{});navigator.geolocation.getCurrentPosition(send,()=>{},{enableHighAccuracy:true,maximumAge:10000,timeout:10000});watchRef.current=navigator.geolocation.watchPosition(send,()=>{},{enableHighAccuracy:true,maximumAge:10000,timeout:15000});return()=>{if(watchRef.current!=null)navigator.geolocation.clearWatch(watchRef.current)}},[session?.driver_id,session?.session_token,driver?.is_online]);
 async function auth(e){
  e.preventDefault();setError("");setNotice("");
  if(authMode==="register"){
   if(DRIVER_DOCUMENT_FIELDS.some(item=>!form.document_photos?.[item.key])){setError("Загрузи все фотографии документов.");return}
   if(CAR_PHOTO_FIELDS.some(item=>!form.car_photos?.[item.key])){setError("Загрузи все 7 фотографий автомобиля.");return}
   if(!form.car_cleanliness_confirmed){setError("Подтверди, что машина чистая и ремни безопасности видны.");return}
   if(!form.legal_consent){setError("Для регистрации нужно принять соглашение и согласие на обработку персональных данных.");return}
  }
  setBusy(true);
  try{
   const payload=authMode==="register"?{...form,legal_consent:true,car_cleanliness_confirmed:true}:{phone:form.phone,password:form.password};
   const r=await callApi(authMode==="register"?"register_driver":"login_driver",payload);
   const s={driver_id:r.driver.id,session_token:r.session_token};
   localStorage.setItem("moyTaxiSession",JSON.stringify(s));setSession(s);setDriver(r.driver);
   setForm(emptyForm);
   setNotice(authMode==="register"?"Регистрация отправлена владельцу на проверку. Пока документы не подтверждены, выход на линию закрыт.":"Вход выполнен.");
  }catch(e){setError(e.message||"Ошибка")}finally{setBusy(false)}
 }
 async function handlePhotoUpload(event,group,key,target="registration"){
  const file=event.target.files?.[0];if(!file)return;
  if(file.size>12*1024*1024){setError("Исходная фотография слишком большая (максимум 12 МБ).");event.target.value="";return}
  setError("");
  try{
   const data=await compressPhotoFile(file,1100,.68);
   if(target==="weekly"){
    if(group==="car_photos")setControlForm(v=>({...v,car_photos:{...v.car_photos,[key]:data}}));
    else setControlForm(v=>({...v,weekly_selfie_photo:data}));
   }else{
    if(group==="document_photos")setForm(v=>({...v,document_photos:{...v.document_photos,[key]:data}}));
    else if(group==="car_photos")setForm(v=>({...v,car_photos:{...v.car_photos,[key]:data}}));
   }
  }catch(e){setError(e.message||"Не удалось обработать фотографию.")}
  finally{event.target.value=""}
 }
 async function resubmitVerification(event){
  event.preventDefault();setBusy(true);setError("");setNotice("");
  try{
   const result=await callApi("driver_submit_verification",{...session,name:form.name,car_model:form.car_model,car_plate:form.car_plate,car_color:form.car_color,vehicle_class:form.vehicle_class,document_photos:form.document_photos,car_photos:form.car_photos,car_cleanliness_confirmed:form.car_cleanliness_confirmed,legal_consent:form.legal_consent});
   setDriver(old=>({...old,...result.driver}));setNotice(result.message||"Документы отправлены на проверку.");setForm(emptyForm);
  }catch(e){setError(e.message||"Не удалось отправить документы.")}finally{setBusy(false)}
 }
 async function submitWeeklyPhotoControl(event){
  event.preventDefault();setBusy(true);setError("");setNotice("");
  try{
   if(CAR_PHOTO_FIELDS.some(item=>!controlForm.car_photos?.[item.key]))throw new Error("Загрузи все 7 фотографий автомобиля.");
   if(!controlForm.weekly_selfie_photo)throw new Error("Добавь новое фото водителя.");
   if(!controlForm.car_cleanliness_confirmed)throw new Error("Подтверди, что автомобиль чистый и ремни видны.");
   const result=await callApi("driver_submit_photo_control",{...session,car_photos:controlForm.car_photos,weekly_selfie_photo:controlForm.weekly_selfie_photo,car_cleanliness_confirmed:true});
   setDriver(old=>({...old,...result.driver}));setControlForm({car_photos:blankCarPhotos(),weekly_selfie_photo:"",car_cleanliness_confirmed:false});setNotice(result.message||"Фотоконтроль отправлен владельцу.");
  }catch(e){setError(e.message||"Не удалось отправить фотоконтроль.")}finally{setBusy(false)}
 }
 async function refreshHistory(){try{const d=await callApi("driver_history",session);setHistory(d.orders||[])}catch(e){setError(e.message)}}
 async function refreshWallet(){try{const w=await callApi("driver_wallet",session);setWalletInfo(w);const me=await callApi("driver_me",session);setDriver(me.driver)}catch(e){setError(e.message)}}
 async function toggle(){try{const d=await callApi("driver_toggle_online",{...session,is_online:!driver.is_online});setDriver(d.driver||{...driver,is_online:d.is_online});setNotice(d.is_online?"Ты на линии.":"Ты не на линии.")}catch(e){setError(e.message)}}
 async function updateOrder(id,status){
  try{
   const result=await callApi("driver_update",{...session,order_id:id,status});
   const d=await callApi("driver_list",session);setOrders(d.orders||[]);
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
      setOrders(list.orders||[]);
      setNotice("Заказ принят за "+Number(result.fare||o.client_price||0).toLocaleString("ru-RU")+" ₸. Открываем маршрут к клиенту.");
    }
    if(mapTab){mapTab.location.href=twoGisRoute(acceptedOrder.pickup_lat,acceptedOrder.pickup_lng,acceptedOrder.pickup_address)}
    else{setNotice("Заказ принят. Нажми «Маршрут к клиенту в 2GIS», чтобы открыть навигатор.")}
  }catch(e){mapTab?.close();setError(e.message||"Не удалось принять заказ.")}
}
 async function offerPrice(o,overridePrice){const amount=Number(overridePrice??offerPrices[o.id]);if(!Number.isFinite(amount)||amount<100){setError("Укажи свою цену не ниже 100 ₸.");return}setError("");try{await callApi("driver_offer_price",{...session,order_id:o.id,price:amount});const d=await callApi("driver_list",session);setOrders(d.orders||[]);setNotice("Предложение отправлено пассажиру. Он решит, принимать ли твою цену.");setOfferPrices(prev=>({...prev,[o.id]:""}))}catch(e){setError(e.message||"Не удалось отправить цену.")}}
 async function skipOrder(o){try{await callApi("driver_skip_order",{...session,order_id:o.id});setOrders(prev=>prev.filter(item=>item.id!==o.id));setNotice("Заказ скрыт только у тебя. Пассажир продолжит получать предложения других водителей.")}catch(e){setError(e.message||"Не удалось убрать заказ из списка.")}}
 async function saveProfile(e){e.preventDefault();setBusy(true);try{const d=await callApi("driver_update_profile",{...session,name:form.name,car_model:form.car_model,car_plate:form.car_plate,car_color:form.car_color,vehicle_class:form.vehicle_class||"economy",photo_url:form.photo_url||""});setDriver(d.driver);setNotice("Профиль сохранён.")}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function photo(e){const f=e.target.files?.[0];if(!f)return;try{const data=await compressPhotoFile(f,400,.78);setForm(x=>({...x,photo_url:data}))}catch(err){setError(err.message||"Не удалось обработать фото")}}
 async function logout(){try{await callApi("driver_logout",session)}catch{}localStorage.removeItem("moyTaxiSession");setSession(null);setDriver(null);setEntryMode("choose")}
 async function notify(){if(!("Notification"in window)){setNotice("Уведомления браузера недоступны.");return}const p=await Notification.requestPermission();setNotice(p==="granted"?"Уведомления включены.":"Разрешение не дано.")}
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
if(session&&driver&&driver.verification_status!=="approved"){
 const needsInitialDocuments=driver.verification_status==="pending"&&driver.verification_files_submitted===false;
 const canResubmitDocuments=driver.verification_status==="rejected"||needsInitialDocuments;
 return <main className="app dashboard">
  <header className="header"><div className="logo">Мой <span>Такси</span></div><span className="small">Проверка водителя</span></header>
  {error&&<div className="error" role="alert">{error}</div>}{notice&&<div className="success" role="status">{notice}</div>}
  <section className="hero panel"><div className="hero-icon">🪪</div><p className="eyebrow">РЕГИСТРАЦИЯ ВОДИТЕЛЯ</p>
  <h1>{driver.verification_status==="rejected"?"Нужно исправить данные":needsInitialDocuments?"Заверши регистрацию водителя":"Документы на проверке"}</h1>
  <p className="muted">{driver.verification_status==="rejected"?(driver.verification_note||"Владелец попросил повторно отправить документы и фотографии."):needsInitialDocuments?"Этому аккаунту ещё не отправляли документы. Заполни форму ниже, чтобы владелец мог проверить водительское удостоверение, техпаспорт, селфи и автомобиль.":"Владелец проверит водительское удостоверение, техпаспорт, селфи и фотографии автомобиля. До подтверждения документов заказы недоступны."}</p>
  {canResubmitDocuments&&<form onSubmit={resubmitVerification}>
   <VerificationFields form={form} setForm={setForm} onPhotoChange={handlePhotoUpload}/>
   <button className="button primary" disabled={busy}>{busy?"Отправляем…":needsInitialDocuments?"Отправить документы на первую проверку":"Отправить исправленные документы"}</button>
  </form>}
  <a className="button secondary" href="/passenger">🚕 Переключиться в режим пассажира</a>
  <button className="button danger" style={{marginTop:10}} onClick={logout}>Выйти из аккаунта водителя</button>
  </section>
 </main>;
}

if(!session||!driver) return <main className="app auth-app"><header className="header"><div className="logo">Мой <span>Такси</span></div><span className="small">Панель водителя</span></header><section className="hero panel"><div className="hero-icon">🚕</div><p className="eyebrow">ЛИЧНЫЙ СЕРВИС</p><h1>{authMode==="register"?"Регистрация водителя":"Вход водителя"}</h1><p className="muted">Один аккаунт — твой QR-код и твои клиенты.</p></section>{error&&<div className="error">{error}</div>}{notice&&<div className="success">{notice}</div>}<section className="panel auth-panel"><div className="switcher"><button className={authMode==="login"?"switch active":"switch"} onClick={()=>setAuthMode("login")}>Войти</button><button className={authMode==="register"?"switch active":"switch"} onClick={()=>setAuthMode("register")}>Регистрация</button></div><form onSubmit={auth}>
 {authMode==="register"&&<div className="field"><label>Полное имя водителя</label><input required maxLength={100} value={form.name} onChange={e=>setForm(v=>({...v,name:e.target.value}))} placeholder="Как в удостоверении"/></div>}
 <div className="field"><label>Номер телефона</label><input required type="tel" value={form.phone} onChange={e=>setForm(v=>({...v,phone:e.target.value}))} placeholder="+7 777 000 00 00" autoComplete="tel"/></div>
 <div className="field"><label>Пароль</label><input required type="password" minLength={8} value={form.password} onChange={e=>setForm(v=>({...v,password:e.target.value}))} placeholder="Не менее 8 символов" autoComplete={authMode==="register"?"new-password":"current-password"}/></div>
 {authMode==="register"&&<VerificationFields form={form} setForm={setForm} onPhotoChange={handlePhotoUpload}/>}
 <button className="button primary" disabled={busy}>{busy?"Подожди…":authMode==="register"?"Отправить на проверку":"Войти"}</button>
 </form></section></main>;
 const link=origin+"/c/"+driver.public_code,qr="https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data="+encodeURIComponent(link),newCount=orders.filter(o=>o.status==="new").length,active=orders.filter(o=>["accepted","arrived","client_ready","started"].includes(o.status)),needsPhotoControl=driver.verification_status==="approved"&&(driver.photo_control_status==="rejected"||!driver.next_photo_control_at||Date.parse(driver.next_photo_control_at)<=Date.now());
 return <main className="app dashboard"><header className="header dashboard-header"><div><div className="logo">Мой <span>Такси</span></div><div className="muted small">Водитель · {driver.phone} · класс {VEHICLE_CLASSES.find(x=>x[0]===driver.vehicle_class)?.[1]||"Эконом"}</div><a className="small" style={{display:"inline-block",marginTop:5,color:"var(--green)",fontWeight:800,textDecoration:"none"}} href="/passenger">🚕 Открыть режим пассажира</a></div><button className={driver.is_online?"button online-button":"button offline-button"} onClick={toggle}>{driver.is_online?"🟢 На линии":"⚪ Не на линии"}</button></header>{error&&<div className="error" role="alert">{error}</div>}{notice&&<div className="success" role="status">{notice}</div>}
 {driver.verification_status==="approved"&&driver.photo_control_status==="pending"&&<section className="panel"><h2>Фотоконтроль на проверке</h2><p className="muted">Фотографии получены. Как только владелец подтвердит их, доступ к линии снова откроется.</p></section>}
 {needsPhotoControl&&<section className="panel"><p className="eyebrow">ЕЖЕНЕДЕЛЬНАЯ ПРОВЕРКА</p><h2>Фотоконтроль автомобиля и водителя</h2><p className="muted">Нужно раз в 7 дней. Машина должна быть чистой, ремни безопасности хорошо видны. До подтверждения владельцем выход на линию будет закрыт.</p>
 <form onSubmit={submitWeeklyPhotoControl}>
 {CAR_PHOTO_FIELDS.map(item=><div className="field" key={item.key}><label>{item.label}</label>{controlForm.car_photos[item.key]&&<img src={controlForm.car_photos[item.key]} alt={item.label} style={{width:"100%",maxWidth:220,maxHeight:145,objectFit:"contain",borderRadius:12,marginBottom:7,background:"#f2f5f2"}}/>}<input type="file" accept="image/*" capture="environment" required={!controlForm.car_photos[item.key]} onChange={e=>handlePhotoUpload(e,"car_photos",item.key,"weekly")}/></div>)}
 <div className="field"><label>Новое селфи водителя</label>{controlForm.weekly_selfie_photo&&<img src={controlForm.weekly_selfie_photo} alt="Фото водителя" style={{width:100,height:100,objectFit:"cover",borderRadius:14,marginBottom:7}}/>}<input type="file" accept="image/*" capture="user" required={!controlForm.weekly_selfie_photo} onChange={e=>handlePhotoUpload(e,"weekly_selfie_photo","weekly_selfie_photo","weekly")}/></div>
 <div className="field"><label><input type="checkbox" required checked={controlForm.car_cleanliness_confirmed} onChange={e=>setControlForm(v=>({...v,car_cleanliness_confirmed:e.target.checked}))}/> Подтверждаю: машина чистая, ремни безопасности видны, фотографии свежие.</label></div>
 <button className="button primary" disabled={busy}>{busy?"Отправляем…":"Отправить фотоконтроль владельцу"}</button>
 </form></section>}
 <section className="welcome-strip"><div><div className="eyebrow">ВОДИТЕЛЬ</div><h1>{driver.name}</h1><p className="muted">{driver.car_model||"Автомобиль не указан"}{driver.car_color?" · "+driver.car_color:""}{driver.car_plate?" · "+driver.car_plate:""}</p><p className="muted small">{driver.rating_count>0?"★ "+Number(driver.rating_average).toFixed(2)+" · "+driver.rating_count+" оценок":"Пока нет оценок пассажиров"}</p></div><div className="avatar" style={{overflow:"hidden"}}>{driver.photo_url?<img src={driver.photo_url} alt="Фото водителя" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:(driver.name||"В").slice(0,1).toUpperCase()}</div></section><section className="wallet-strip"><div><span>Лицевой счёт</span><strong>{Number(walletInfo?.wallet_balance??driver.wallet_balance??0).toLocaleString("ru-RU")} ₸</strong></div><p>{walletInfo?.test_mode?"Тестовый режим: пополнение и списание комиссии выключены.":"Для выхода на линию необходимо пополнить лицевой счёт."}</p><button className="button secondary" onClick={()=>{setTab("wallet");refreshWallet()}}>История операций</button></section><div className="metrics"><div className="metric"><span className="metric-icon">🔔</span><strong>{newCount}</strong><span>Новых заказов</span></div><div className="metric"><span className="metric-icon">🚕</span><strong>{active.length}</strong><span>В работе</span></div><div className="metric"><span className="metric-icon">🧾</span><strong>{history.length}</strong><span>История</span></div></div><div className="tabbar"><button className={tab==="orders"?"tab active":"tab"} onClick={()=>setTab("orders")}>Заказы {newCount>0&&<span className="tab-count">{newCount}</span>}</button><button className={tab==="history"?"tab active":"tab"} onClick={()=>{setTab("history");refreshHistory()}}>История</button><button className={tab==="wallet"?"tab active":"tab"} onClick={()=>{setTab("wallet");refreshWallet()}}>Кошелёк</button><button className={tab==="profile"?"tab active":"tab"} onClick={()=>{setTab("profile");setForm({...emptyForm,name:driver.name,car_model:driver.car_model||"",car_plate:driver.car_plate||"",car_color:driver.car_color||"",vehicle_class:driver.vehicle_class||"economy",photo_url:driver.photo_url||""})}}>Профиль</button></div>{tab==="orders"&&<section className="panel"><div className="section-heading"><div><div className="eyebrow">ВХОДЯЩИЕ И ТЕКУЩИЕ</div><h2>Заказы</h2></div><span className="status">{newCount} новых</span></div>{orders.length===0?<div className="empty-state"><div className="empty-icon">🚕</div><h3>Заказов пока нет</h3><p className="muted">Когда клиент закажет поездку, здесь появится карточка и прозвучит «дзынь-дзынь».</p></div>:orders.map(o=><article className="order" key={o.id}><div className="order-top"><div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>{o.clients?.photo_url?<img src={o.clients.photo_url} alt={"Фото клиента "+(o.clients?.name||"Клиент")} style={{width:44,height:44,objectFit:"cover",borderRadius:"50%",flex:"0 0 auto"}}/>:<div className="avatar" style={{width:44,height:44,flex:"0 0 auto"}}>{(o.clients?.name||"К").slice(0,1).toUpperCase()}</div>}<h3 style={{margin:0}}>{o.clients?.name||"Клиент"}</h3></div><span className="status">{statusLabel(o.status)}</span></div><p><b>Класс:</b> {VEHICLE_CLASSES.find(x=>x[0]===o.vehicle_class)?.[1]||"Эконом"} · {o.trip_type==="intercity"?"Межгород":"Город"}{Number(o.route_distance_km)>0?" · "+Number(o.route_distance_km).toFixed(1)+" км по маршруту":""}</p><p><b>Оплата:</b> {o.payment_method==="kaspi_gold"?"Kaspi перевод":"Наличные"}</p><p><b>📍 Подача:</b> {o.pickup_address}</p><p><b>🏁 Куда:</b> {o.destination_address}</p><p><b>📏 До клиента:</b> {o.distance_km!=null?`${o.distance_km.toFixed(1)} км`:"геопозиция ещё не получена"}</p>
<p><b>💰 Цена клиента:</b> {Number(o.client_price)>0?`${Number(o.client_price).toLocaleString("ru-RU")} ₸`:"не указана"}</p>
{o.price_status==="accepted"&&Number(o.agreed_price)>0&&<p className="success"><b>✅ Согласовано: {Number(o.agreed_price).toLocaleString("ru-RU")} ₸</b></p>}
{o.price_status==="driver_offered"&&<div className="success">Отправлена твоя цена: <b>{Number(o.driver_price).toLocaleString("ru-RU")} ₸</b>. Ожидаем ответа клиента.</div>}
{o.price_status==="declined"&&<p className="muted">Клиент отклонил цену. Можешь предложить другую.</p>}
{o.status==="new"&&<div className="field"><label htmlFor={`offer-${o.id}`}>Твоя цена пассажиру, ₸</label>{o.my_offer?.status==="pending"&&<p className="success small">Ты уже предложил {Number(o.my_offer.price).toLocaleString("ru-RU")} ₸ — ждём ответа.</p>}<input id={`offer-${o.id}`} type="number" min="100" max="1000000" step="50" value={offerPrices[o.id]??""} onChange={e=>setOfferPrices(prev=>({...prev,[o.id]:e.target.value}))} placeholder={o.client_price?`Цена пассажира ${Number(o.client_price).toLocaleString("ru-RU")} ₸`:"Введите цену поездки"}/><button className="button secondary" type="button" disabled={!offerPrices[o.id]} onClick={()=>offerPrice(o)}>💬 Отправить свою цену</button></div>}
<div className="order-actions actions">
{o.status==="new"&&<><button className="button primary" disabled={!o.driver_id&&o.my_offer?.status==="pending"} onClick={()=>acceptOrderAndNavigate(o)}>{!o.driver_id&&o.my_offer?.status==="pending"?"Ждём ответа клиента":Number(o.agreed_price||o.client_price)>0?("Принять за "+Number(o.agreed_price||o.client_price).toLocaleString("ru-RU")+" ₸"):"Принять заказ"}</button>{!o.driver_id&&<button className="button danger" onClick={()=>skipOrder(o)}>Не беру</button>}{o.driver_id&&<button className="button danger" onClick={()=>updateOrder(o.id,"cancelled")}>Отклонить</button>}</>}
{o.status==="accepted"&&<><a className="button secondary" href={twoGisRoute(o.pickup_lat,o.pickup_lng,o.pickup_address)} target="_blank" rel="noreferrer">🗺️ Маршрут к клиенту в 2GIS</a><button className="button primary" onClick={()=>updateOrder(o.id,"arrived")}>✅ Я на месте</button></>}
{o.status==="arrived"&&<div className="success"><b>Ты на месте.</b><p className="small" style={{margin:"5px 0 0"}}>Ждём, пока пассажир нажмёт «Я выхожу». После этого появится кнопка начала поездки.</p></div>}
{o.status==="client_ready"&&<a className="button primary" href={twoGisTripRoute(o.pickup_lat,o.pickup_lng,o.destination_lat,o.destination_lng,o.destination_address)} target="_blank" rel="noreferrer" onClick={()=>updateOrder(o.id,"started")}>▶️ Пассажир выходит · начать поездку A → B</a>}
{o.status==="started"&&<><a className="button secondary" href={twoGisRoute(o.destination_lat,o.destination_lng,o.destination_address)} target="_blank" rel="noreferrer">🧭 Навигация до пункта B</a><button className="button primary" onClick={()=>updateOrder(o.id,"completed")}>Завершить поездку</button></>}
</div></article>)}</section>}{tab==="history"&&<section className="panel"><div className="eyebrow">ИСТОРИЯ</div><h2>Завершённые поездки</h2>{history.length===0?<p className="muted">История пока пустая.</p>:history.map(o=><article className="order" key={o.id}><h3>{o.clients?.name||"Клиент"}</h3><p>📍 {o.pickup_address}</p><p>🏁 {o.destination_address}</p><p>💵 Оплата за поездку: <b>{Number(o.agreed_price||o.driver_price||o.client_price||0).toLocaleString("ru-RU")} ₸</b></p><p>🧾 Комиссия: <b>{Number(o.platform_commission_amount||0).toLocaleString("ru-RU")} ₸</b>{walletInfo?.test_mode?" (тестовый расчёт)":""}</p><p className="success">Твой заработок: <b>{Number(o.driver_net_amount ?? (Number(o.agreed_price||o.driver_price||o.client_price||0)-Number(o.platform_commission_amount||0))).toLocaleString("ru-RU")} ₸</b></p></article>)}</section>}{tab==="wallet"&&<section className="panel"><div className="eyebrow">ЛИЦЕВОЙ СЧЁТ</div><h2>Кошелёк водителя</h2><div className="wallet-balance"><span>Текущий баланс</span><strong>{Number(walletInfo?.wallet_balance??driver.wallet_balance??0).toLocaleString("ru-RU")} ₸</strong><p>{walletInfo?.test_mode?"Тестовый режим: пополнение и списание комиссии не производятся. Комиссия за поездку отображается расчётно.":"Минимальный баланс для выхода на линию: "+Number(walletInfo?.minimum_wallet_balance||500).toLocaleString("ru-RU")+" ₸."}</p><button className="button secondary" onClick={refreshWallet}>Обновить баланс</button></div><h3>Последние операции</h3>{!(walletInfo?.transactions||[]).length?<p className="muted">Операций пока нет.</p>:(walletInfo.transactions||[]).map(tx=><article className="order" key={tx.id}><div className="order-top"><b>{tx.kind==="topup"?"Пополнение":tx.kind==="commission"?"Комиссия":"Корректировка"}</b><span>{tx.amount>0?"+":""}{Number(tx.amount).toLocaleString("ru-RU")} ₸</span></div><p className="muted small">{tx.note||"—"} · {new Date(tx.created_at).toLocaleString("ru-RU")}</p><p>Баланс после операции: {Number(tx.balance_after).toLocaleString("ru-RU")} ₸</p></article>)}</section>}{tab==="profile"&&<section className="panel"><div className="eyebrow">ПРОФИЛЬ</div><h2>Данные водителя</h2><form onSubmit={saveProfile}><div className="field"><label>Фото водителя</label>{form.photo_url&&<img src={form.photo_url} alt="Предпросмотр" style={{width:90,height:90,borderRadius:20,objectFit:"cover",marginBottom:6}}/>}<input type="file" accept="image/*" onChange={photo}/></div><div className="field"><label>Имя</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div><div className="field"><label>Телефон</label><input value={driver.phone} readOnly/></div><div className="field"><label>Автомобиль</label><input value={form.car_model} onChange={e=>setForm({...form,car_model:e.target.value})}/></div><div className="field"><label>Госномер</label><input value={form.car_plate} onChange={e=>setForm({...form,car_plate:e.target.value})}/></div><div className="field"><label>Цвет машины</label><input value={form.car_color} onChange={e=>setForm({...form,car_color:e.target.value})}/></div><div className="field"><label>Класс автомобиля</label><select value={form.vehicle_class||"economy"} onChange={e=>setForm({...form,vehicle_class:e.target.value})}><option value="economy">Эконом</option><option value="comfort">Комфорт</option><option value="comfort_plus">Комфорт+</option><option value="business">Бизнес</option><option value="minivan">Минивэн</option><option value="premium">Премиум</option></select></div><div className="success">Полные номера документов клиенту не показываем. На следующем этапе добавим отметку проверки техпаспорта и водительского удостоверения.</div><button className="button primary" disabled={busy}>{busy?"Сохраняем…":"Сохранить профиль"}</button></form><button className="button danger" style={{marginTop:10}} onClick={logout}>Выйти</button></section>}</main>;
}

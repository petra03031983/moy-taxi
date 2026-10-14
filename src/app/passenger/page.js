"use client";
import { useEffect, useRef, useState } from "react";
import { callApi, statusLabel } from "../api";

const CLASSES = [
  { id: "economy", label: "Эконом", icon: "🚕" },
  { id: "comfort", label: "Комфорт", icon: "🚘" },
  { id: "comfort_plus", label: "Комфорт+" , icon: "✨" },
  { id: "business", label: "Бизнес", icon: "🖤" },
  { id: "minivan", label: "Минивэн", icon: "🚐" },
  { id: "premium", label: "Премиум", icon: "⭐" },
];

const money = value => Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₸";

function routeUrl(a, b) {
  return "https://2gis.kz/directions/points/" + a.lng + "," + a.lat + "|" + b.lng + "," + b.lat;
}
export default function PassengerPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [comment, setComment] = useState("");
  const [pickupPoint, setPickupPoint] = useState(null);
  const [destinationPoint, setDestinationPoint] = useState(null);
  const [pickupSuggestions, setPickupSuggestions] = useState([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [onlineClasses, setOnlineClasses] = useState(CLASSES.map(x => x.id));
  const [testMode, setTestMode] = useState(true);
  const [tripType, setTripType] = useState("city");
  const [selectedClass, setSelectedClass] = useState("economy");
  const [route, setRoute] = useState(null);
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const routeRequestRef = useRef(false);

  useEffect(() => {
    try {
      const profile = JSON.parse(localStorage.getItem("moyTaxiClientProfile") || "{}");
      setName(profile.name || ""); setPhone(profile.phone || "");
      const saved = JSON.parse(localStorage.getItem("moyTaxiGeneralOrder") || "null");
      if (saved?.id && saved?.client_token) setOrder(saved);
    } catch {}
    callApi("public_tariffs").then(data => {
      setTestMode(data.test_mode !== false);
      if (Array.isArray(data.online_classes)) setOnlineClasses(data.online_classes);
    }).catch(() => setNotice("Используются временные тарифы. Проверь соединение перед заказом."));
    if (!navigator.geolocation) { setLocating(false); return; }
    navigator.geolocation.getCurrentPosition(position => {
      const point = { lat: position.coords.latitude, lng: position.coords.longitude };
      setPickupPoint(point); setPickup(current => current.trim() ? current : "Моё местоположение");
      setLocating(false);
    }, () => setLocating(false), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }, []);

  useEffect(() => {
    if (pickup.trim().length < 3 || pickupPoint || pickup === "Моё местоположение") { setPickupSuggestions([]); return; }
    let active = true;
    const timer = setTimeout(() => {
      callApi("address_suggest", { query: pickup }).then(result => {
        if (active) setPickupSuggestions(result.suggestions || []);
      }).catch(() => { if (active) setPickupSuggestions([]); });
    }, 450);
    return () => { active = false; clearTimeout(timer); };
  }, [pickup, pickupPoint]);

  useEffect(() => {
    if (destination.trim().length < 3 || destinationPoint) { setDestinationSuggestions([]); return; }
    let active = true;
    const timer = setTimeout(() => {
      callApi("address_suggest", { query: destination, near_lat: pickupPoint?.lat ?? null, near_lng: pickupPoint?.lng ?? null }).then(result => {
        if (active) setDestinationSuggestions(result.suggestions || []);
      }).catch(() => { if (active) setDestinationSuggestions([]); });
    }, 450);
    return () => { active = false; clearTimeout(timer); };
  }, [destination, destinationPoint, pickupPoint?.lat, pickupPoint?.lng]);

  useEffect(() => {
    if (!order?.id || !order?.client_token) return;
    let active = true;
    const load = async () => {
      try {
        const data = await callApi("order_status", { order_id: order.id, client_token: order.client_token });
        if (!active) return;
        const updated = { ...order, ...data.order, offers: data.offers || [] };
        setOrder(updated); localStorage.setItem("moyTaxiGeneralOrder", JSON.stringify(updated));
      } catch {}
    };
    load();
    const timer = setInterval(load, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [order?.id, order?.client_token]);

  const quote = route?.estimated_prices?.[selectedClass] ?? null;
  const driver = order?.drivers || order?.assigned_driver || null;
  const showBooking = !order || ["cancelled", "completed"].includes(order.status);

  async function calculateRouteData() {
    if (routeRequestRef.current || busy) return;
    if (!pickup.trim()) { setError("Разреши GPS или укажи адрес подачи."); return; }
    if (!destination.trim()) { setError("Укажи город, улицу и дом назначения."); return; }
    routeRequestRef.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi("calculate_route", {
        pickup_address: pickup,
        destination_address: destination,
        pickup_lat: pickupPoint?.lat ?? null,
        pickup_lng: pickupPoint?.lng ?? null,
        destination_lat: destinationPoint?.lat ?? null,
        destination_lng: destinationPoint?.lng ?? null,
      });
      const a = result.pickup_point;
      const b = result.destination_point;
      if (!a || !b || !Number.isFinite(Number(result.distance_km)) || !result.estimated_prices) {
        throw new Error("Маршрут рассчитать не удалось. Проверь адрес подачи и назначения.");
      }
      setPickupPoint({ lat: Number(a.lat), lng: Number(a.lng) });
      setDestinationPoint({ lat: Number(b.lat), lng: Number(b.lng) });
      setRoute({
        distanceKm: Number(result.distance_km),
        durationMin: Number(result.duration_minutes),
        estimated_prices: result.estimated_prices,
      });
      if (Array.isArray(result.online_classes)) setOnlineClasses(result.online_classes);
      if (pickup !== "Моё местоположение") setPickup(pickup.trim());
      setNotice("Автомобильный маршрут построен. Цены по классам рассчитаны.");
    } catch (e) {
      setRoute(null);
      setError(e.message || "Не удалось найти адрес. Укажи город, улицу и дом.");
    } finally {
      routeRequestRef.current = false;
      setBusy(false);
    }
  }
  async function calculateRoute(event) {
    event.preventDefault();
    await calculateRouteData();
  }

  async function submitOrder() {
    if (!route || !pickupPoint || !destinationPoint) { setError("Сначала рассчитай автомобильный маршрут."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const fare = Number(route.estimated_prices?.[selectedClass] || 0);
      if (!fare) throw new Error("Не удалось рассчитать цену для этого класса. Пересчитай маршрут.");
      const result = await callApi("create_order", {
        driver_code: "AUTO", name, phone, pickup_address: pickup || "Моё местоположение",
        destination_address: destination, pickup_lat: pickupPoint.lat, pickup_lng: pickupPoint.lng,
        destination_lat: destinationPoint.lat, destination_lng: destinationPoint.lng,
        route_distance_km: route.distanceKm, vehicle_class: selectedClass, trip_type: tripType,
        payment_method: paymentMethod, client_price: fare, comment,
      });
      const saved = { ...result.order, assigned_driver: result.assigned_driver, offers: [], pickup_point: pickupPoint,
        destination_point: destinationPoint, route_distance_km: route.distanceKm, vehicle_class: selectedClass };
      setOrder(saved); localStorage.setItem("moyTaxiGeneralOrder", JSON.stringify(saved));
      localStorage.setItem("moyTaxiClientProfile", JSON.stringify({ name, phone }));
      setNotice(testMode ? "Заказ отправлен. Тестовый режим: никаких списаний." : "Заказ отправлен водителю.");
      setRoute(null); setComment("");
    } catch (e) { setError(e.message || "Не удалось отправить заказ."); }
    finally { setBusy(false); }
  }

  async function cancelOrder() {
    if (!order?.id) return;
    setBusy(true); setError("");
    try {
      const result = await callApi("cancel_order", { order_id: order.id, client_token: order.client_token });
      const updated = { ...order, ...result.order };
      setOrder(updated); localStorage.setItem("moyTaxiGeneralOrder", JSON.stringify(updated));
    } catch (e) { setError(e.message || "Не удалось отменить заказ."); }
    finally { setBusy(false); }
  }
  async function priceAnswer(action, offerId) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi(action, { order_id: order.id, client_token: order.client_token, offer_id: offerId });
      const updated = { ...order, ...result.order, offers: (order.offers || []).map(offer => offer.id === offerId ? { ...offer, status: action === "client_accept_offer" ? "accepted" : "declined" } : offer) };
      setOrder(updated); localStorage.setItem("moyTaxiGeneralOrder", JSON.stringify(updated));
      setNotice(action === "client_accept_offer" ? "Ты выбрал водителя. Он направляется к тебе." : "Предложение отклонено. Ищем другие варианты.");
    } catch (e) { setError(e.message || "Не удалось ответить на предложение."); }
    finally { setBusy(false); }
  }
  function newOrder() {
    localStorage.removeItem("moyTaxiGeneralOrder");
    setOrder(null); setRoute(null); setDestinationPoint(null); setPickupSuggestions([]); setDestinationSuggestions([]); setError(""); setNotice("");
  }
  function detectPickup() {
    setLocating(true);
    navigator.geolocation?.getCurrentPosition(position => {
      setPickupPoint({ lat: position.coords.latitude, lng: position.coords.longitude });
      setPickup("Моё местоположение"); setLocating(false); setError("");
    }, () => { setPickupPoint(null); setLocating(false); setError("Не удалось определить GPS. Введи адрес подачи вручную."); },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  return <main className="app client-app">
    <header className="header"><a href="/" className="logo" style={{ textDecoration: "none", color: "inherit" }}>Мой <span>Такси</span></a><a href="/" className="small">На главную</a></header>
    <section className="panel hero"><div className="hero-icon">🚕</div><div className="eyebrow">ЗАКАЗ ТАКСИ</div><h1>Куда едем?</h1><p className="muted">Система рассчитывает автомобильный маршрут и показывает ориентировочную цену до отправки заказа.</p></section>
    {error && <div className="error" role="alert">{error}</div>}
    {notice && <div className="success" role="status">{notice}</div>}
    {!showBooking ? <section className="panel">
      <div className="eyebrow">ВАША ПОЕЗДКА</div><h2>{order.status === "new" ? "Заказ отправлен" : order.status === "accepted" ? "Водитель едет к вам" : order.status === "arrived" ? "Водитель на месте" : order.status === "started" ? "Поездка началась" : statusLabel(order.status)}</h2>
      <div className="status large-status">{statusLabel(order.status)}</div>
      <p><b>Класс:</b> {CLASSES.find(x=>x.id===order.vehicle_class)?.label || CLASSES.find(x=>x.id===driver?.vehicle_class)?.label || "Эконом"} · {order.trip_type==="intercity"?"Межгород":"Город"}</p>
      <p><b>📍 Откуда:</b> {order.pickup_address}</p><p><b>🏁 Куда:</b> {order.destination_address}</p>
      {Number(order.route_distance_km)>0 && <p><b>📏 Маршрут:</b> {Number(order.route_distance_km).toFixed(1)} км · ориентировочно {Math.ceil(Number(order.route_distance_km)/35*60)} мин.</p>}
      <p><b>💰 Цена:</b> {money(order.agreed_price || order.client_price || order.driver_price)}</p>
      <p><b>Оплата:</b> {order.payment_method==="kaspi_gold"?"Kaspi Gold — перевод водителю":"Наличные водителю"}</p>
      {driver?.name && <><p><b>Водитель:</b> {driver.name}</p><p><b>Автомобиль:</b> {driver.car_model || "—"} · {driver.car_color || "цвет не указан"} · {driver.car_plate || "номер не указан"}</p><p><b>Телефон:</b> <a href={"tel:"+driver.phone}>{driver.phone}</a></p></>}
      {order.status === "new" && <div className="searching-panel"><div className="searching-pulse">⌕</div><h3>Ищем водителей</h3><p className="muted">Водители выбранного класса рядом получат заказ и смогут предложить свою цену.</p><p><b>Предложений: {(order.offers||[]).filter(offer=>offer.status==="pending").length}</b></p>
        {(order.offers||[]).filter(offer=>offer.status==="pending").map(offer=><article className="driver-offer-card" key={offer.id}><div className="order-top"><h3>{offer.drivers?.name||"Водитель"}</h3><span className="status">{CLASSES.find(x=>x.id===offer.drivers?.vehicle_class)?.label||"Водитель"}</span></div><p><b>{money(offer.price)}</b></p><p>{offer.drivers?.car_model||"Автомобиль"}{offer.drivers?.car_color?" · "+offer.drivers.car_color:""}{offer.drivers?.car_plate?" · "+offer.drivers.car_plate:""}</p>{offer.drivers?.phone&&<p><a href={"tel:"+offer.drivers.phone}>{offer.drivers.phone}</a></p>}<div className="actions"><button className="button primary" disabled={busy} onClick={()=>priceAnswer("client_accept_offer",offer.id)}>Принять</button><button className="button danger" disabled={busy} onClick={()=>priceAnswer("client_decline_offer",offer.id)}>Отклонить</button></div></article>)}
        <button className="button danger" disabled={busy} onClick={cancelOrder}>Отменить заказ</button></div>}
      {["accepted","arrived","started"].includes(order.status) && order.pickup_lat != null && order.destination_lat != null && <a className="button secondary" href={routeUrl({lat:order.pickup_lat,lng:order.pickup_lng},{lat:order.destination_lat,lng:order.destination_lng})} target="_blank" rel="noreferrer">🗺️ Открыть маршрут A → B в 2ГИС</a>}
      {["completed","cancelled"].includes(order.status) && <button className="button primary" onClick={newOrder}>Заказать ещё раз</button>}
    </section> : <section className="panel">
      <form onSubmit={calculateRoute}>
        <div className="field"><label>Ваше имя</label><input required maxLength={100} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Как вас зовут?" /></div>
        <div className="field"><label>Телефон</label><input required type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+7 777 000 00 00" /></div>
        <div className="field"><label>Тип поездки</label><div className="switcher"><button type="button" className={tripType==="city"?"switch active":"switch"} onClick={()=>setTripType("city")}>🏙️ Город</button><button type="button" className={tripType==="intercity"?"switch active":"switch"} onClick={()=>setTripType("intercity")}>🛣️ Межгород</button></div></div>
        <div className="field address-field"><label>Откуда забрать (точка A)</label><p className="muted small">{locating ? "📍 Определяем местоположение…" : pickupPoint ? "✅ Место подачи определено GPS." : "GPS недоступен — введи адрес вручную."}</p><input required maxLength={300} value={pickup} onChange={e=>{setPickup(e.target.value); setPickupPoint(null);setRoute(null);}} placeholder="Адрес подачи или нажми GPS" autoComplete="street-address" />{pickupSuggestions.length>0&&<div className="address-suggestions">{pickupSuggestions.map((item,i)=><button type="button" className="address-suggestion" key={item.label+"-"+i} onClick={()=>{setPickup(item.label);setPickupPoint({lat:item.lat,lng:item.lng});setPickupSuggestions([]);setRoute(null);}}><b>{item.name}</b><span>{item.label}</span><small>{item.city}</small></button>)}</div>}<button type="button" className="button secondary" onClick={detectPickup}>📍 Определить моё местоположение</button></div>
        <div className="field address-field"><label>Куда ехать (точка B)</label><input required maxLength={300} value={destination} onChange={e=>{setDestination(e.target.value);setRoute(null);setDestinationPoint(null);}} placeholder="Например: Астана, улица Достык, 9" autoComplete="off" />{destinationSuggestions.length>0&&<div className="address-suggestions">{destinationSuggestions.map((item,i)=><button type="button" className="address-suggestion" key={item.label+"-"+i} onClick={()=>{setDestination(item.label);setDestinationPoint({lat:item.lat,lng:item.lng});setDestinationSuggestions([]);setRoute(null);}}><b>{item.name}</b><span>{item.label}</span><small>{item.city}</small></button>)}</div>}</div>
        <div className="field"><label>Класс автомобиля</label><p className="muted small">После расчёта маршрута покажем примерную стоимость для каждого класса.</p><div className="class-grid">{CLASSES.map(item=>{const available=onlineClasses.includes(item.id);const estimated=route?.estimated_prices?.[item.id];return <button key={item.id} type="button" className={selectedClass===item.id?"class-card selected":"class-card"} onClick={()=>setSelectedClass(item.id)}><span className="class-icon">{item.icon}</span><b>{item.label}</b><span className="class-price">{estimated?money(estimated):"Цена после расчёта"}</span><span className="small muted">{available?"Есть водитель":"Пока нет на линии"}</span></button>})}</div></div>
        <div className="field"><label>Комментарий (необязательно)</label><textarea maxLength={500} value={comment} onChange={e=>setComment(e.target.value)} placeholder="Подъезд, ориентир…" /></div>
        <button className="button primary submit-order" type="submit" disabled={busy || !name.trim() || !phone.trim() || !pickup.trim() || !destination.trim()}>{busy ? "Рассчитываем…" : "🗺️ Рассчитать маршрут и цену"}</button>
      </form>
      {route && destinationPoint && <div className="quote-panel"><div className="eyebrow">ПРЕДВАРИТЕЛЬНЫЙ РАСЧЁТ</div><h2>{route.distanceKm.toFixed(1)} км</h2><p className="muted">В пути ориентировочно {route.durationMin} мин. · автомобильный маршрут</p><div className="route-price-list">{CLASSES.map(item=><div className={selectedClass===item.id?"route-price-row active":"route-price-row"} key={item.id}><span>{item.icon} {item.label}</span><b>{route.estimated_prices?.[item.id]?money(route.estimated_prices[item.id]):"—"}</b></div>)}</div><div className="success"><b>Выбрано: {CLASSES.find(x=>x.id===selectedClass)?.label} — {money(quote)}</b></div><div className="field"><label>Способ оплаты</label><div className="payment-options"><button type="button" className={paymentMethod==="cash"?"payment-card selected":"payment-card"} onClick={()=>setPaymentMethod("cash")}><span>💵</span><b>Наличные</b><small>Оплата водителю после поездки</small></button><button type="button" className={paymentMethod==="kaspi_gold"?"payment-card selected":"payment-card"} onClick={()=>setPaymentMethod("kaspi_gold")}><span>🟥</span><b>Kaspi Gold</b><small>Перевод водителю вручную</small></button></div><p className="muted small">Kaspi Gold пока не подключён как встроенный платёж: система сохранит выбор, а перевод делается напрямую водителю.</p></div><a className="button secondary" href={routeUrl(pickupPoint,destinationPoint)} target="_blank" rel="noreferrer">Посмотреть маршрут A → B в 2ГИС</a><button className="button primary" disabled={busy || !onlineClasses.includes(selectedClass)} onClick={submitOrder}>{busy?"Отправляем…":onlineClasses.includes(selectedClass) ? "Подтвердить цену и вызвать такси" : "Нет водителей этого класса"}</button><p className="muted small">Стоимость ориентировочная. Тарифы пока тестовые.</p></div>}
    </section>}
    <p className="muted small footer-note">Мой Такси · при расчёте используются дорожные маршруты OSRM и адресный поиск Photon/OpenStreetMap.</p>
  </main>;
}

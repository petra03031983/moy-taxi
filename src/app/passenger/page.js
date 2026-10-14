"use client";
import { useEffect, useState } from "react";
import { callApi, statusLabel } from "../api";

const CLASSES = [
  { id: "economy", label: "Эконом", icon: "🚕" },
  { id: "comfort", label: "Комфорт", icon: "🚘" },
  { id: "comfort_plus", label: "Комфорт+" , icon: "✨" },
  { id: "business", label: "Бизнес", icon: "🖤" },
  { id: "minivan", label: "Минивэн", icon: "🚐" },
  { id: "premium", label: "Премиум", icon: "⭐" },
];
const DEFAULT_RATES = {
  economy: { rate_per_km: 40, minimum_fare: 500 },
  comfort: { rate_per_km: 50, minimum_fare: 700 },
  comfort_plus: { rate_per_km: 60, minimum_fare: 900 },
  business: { rate_per_km: 80, minimum_fare: 1500 },
  minivan: { rate_per_km: 70, minimum_fare: 1200 },
  premium: { rate_per_km: 100, minimum_fare: 2000 },
};
const money = value => Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₸";

async function geocodeAddress(address, nearPoint) {
  const clean = String(address || "").trim();
  if (!clean || clean.toLowerCase() === "моё местоположение") {
    if (nearPoint) return nearPoint;
    throw new Error("Разреши доступ к GPS или введи адрес подачи.");
  }
  const query = /казахстан|қазақстан|kazakhstan/i.test(clean) ? clean : clean + ", Kazakhstan";
  const params = new URLSearchParams({ q: query, limit: "1", lang: "ru" });
  if (nearPoint) { params.set("lat", String(nearPoint.lat)); params.set("lon", String(nearPoint.lng)); }
  let response;
  try { response = await fetch("https://photon.komoot.io/api/?" + params.toString()); }
  catch { throw new Error("Не удалось найти адрес. Проверь интернет и укажи город, улицу и дом."); }
  if (!response.ok) throw new Error("Поиск адреса временно недоступен. Попробуй ещё раз.");
  const data = await response.json();
  const coords = data?.features?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2 || !Number.isFinite(Number(coords[0])) || !Number.isFinite(Number(coords[1]))) {
    throw new Error("Адрес не найден. Укажи город, улицу и номер дома.");
  }
  return { lat: Number(coords[1]), lng: Number(coords[0]) };
}
async function roadRoute(a, b) {
  const url = "https://router.project-osrm.org/route/v1/driving/" +
    [a, b].map(p => p.lng + "," + p.lat).join(";") + "?overview=false&steps=false";
  let response;
  try { response = await fetch(url); }
  catch { throw new Error("Не удалось рассчитать автомобильный маршрут. Проверь интернет и повтори расчёт."); }
  if (!response.ok) throw new Error("Сервис автомобильных маршрутов временно недоступен.");
  const data = await response.json();
  const route = data?.routes?.[0];
  if (data?.code !== "Ok" || !route || !Number.isFinite(route.distance) || route.distance <= 0) {
    throw new Error("Не нашли автомобильный маршрут между этими адресами. Проверь точку подачи и назначения.");
  }
  return { distanceKm: route.distance / 1000, durationMin: Math.max(1, Math.ceil(route.duration / 60)) };
}
function routeUrl(a, b) {
  return "https://2gis.kz/directions/points/" + a.lng + "," + a.lat + "|" + b.lng + "," + b.lat;
}
function fareFor(rate, distance) {
  const perKm = Number(rate?.rate_per_km || 0), min = Number(rate?.minimum_fare || 0);
  return Math.max(min, Math.ceil((distance * perKm) / 10) * 10);
}

export default function PassengerPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [comment, setComment] = useState("");
  const [pickupPoint, setPickupPoint] = useState(null);
  const [destinationPoint, setDestinationPoint] = useState(null);
  const [rates, setRates] = useState(DEFAULT_RATES);
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

  useEffect(() => {
    try {
      const profile = JSON.parse(localStorage.getItem("moyTaxiClientProfile") || "{}");
      setName(profile.name || ""); setPhone(profile.phone || "");
      const saved = JSON.parse(localStorage.getItem("moyTaxiGeneralOrder") || "null");
      if (saved?.id && saved?.client_token) setOrder(saved);
    } catch {}
    callApi("public_tariffs").then(data => {
      if (data.vehicle_rates) setRates(data.vehicle_rates);
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
    if (!order?.id || !order?.client_token) return;
    let active = true;
    const load = async () => {
      try {
        const data = await callApi("order_status", { order_id: order.id, client_token: order.client_token });
        if (!active) return;
        const updated = { ...order, ...data.order };
        setOrder(updated); localStorage.setItem("moyTaxiGeneralOrder", JSON.stringify(updated));
      } catch {}
    };
    load();
    const timer = setInterval(load, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [order?.id, order?.client_token]);

  const selectedRate = rates[selectedClass] || DEFAULT_RATES[selectedClass];
  const quote = route ? fareFor(selectedRate, route.distanceKm) : null;
  const driver = order?.drivers || order?.assigned_driver || null;
  const showBooking = !order || ["cancelled", "completed"].includes(order.status);

  async function calculateRoute(event) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      if (!pickup.trim()) throw new Error("Укажи адрес подачи или разреши GPS.");
      if (!destination.trim()) throw new Error("Укажи, куда ехать.");
      const a = pickupPoint || await geocodeAddress(pickup, null);
      const b = await geocodeAddress(destination, a);
      const result = await roadRoute(a, b);
      setPickupPoint(a); setDestinationPoint(b); setRoute(result);
      if (!pickupPoint && pickup !== "Моё местоположение") setPickup(pickup.trim());
      setNotice("Маршрут рассчитан по автомобильным дорогам.");
    } catch (e) { setRoute(null); setError(e.message || "Не удалось рассчитать поездку."); }
    finally { setBusy(false); }
  }

  async function submitOrder() {
    if (!route || !pickupPoint || !destinationPoint) { setError("Сначала рассчитай автомобильный маршрут."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const fare = fareFor(rates[selectedClass] || DEFAULT_RATES[selectedClass], route.distanceKm);
      const result = await callApi("create_order", {
        driver_code: "AUTO", name, phone, pickup_address: pickup || "Моё местоположение",
        destination_address: destination, pickup_lat: pickupPoint.lat, pickup_lng: pickupPoint.lng,
        destination_lat: destinationPoint.lat, destination_lng: destinationPoint.lng,
        route_distance_km: route.distanceKm, vehicle_class: selectedClass, trip_type: tripType,
        client_price: fare, comment,
      });
      const saved = { ...result.order, assigned_driver: result.assigned_driver, pickup_point: pickupPoint,
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
  async function priceAnswer(action) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi(action, { order_id: order.id, client_token: order.client_token });
      const updated = { ...order, ...result.order };
      setOrder(updated); localStorage.setItem("moyTaxiGeneralOrder", JSON.stringify(updated));
      setNotice(action === "client_accept_price" ? "Цена согласована." : "Предложение водителя отклонено.");
    } catch (e) { setError(e.message || "Не удалось ответить на цену."); }
    finally { setBusy(false); }
  }
  function newOrder() {
    localStorage.removeItem("moyTaxiGeneralOrder");
    setOrder(null); setRoute(null); setDestinationPoint(null); setError(""); setNotice("");
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
      {driver?.name && <><p><b>Водитель:</b> {driver.name}</p><p><b>Автомобиль:</b> {driver.car_model || "—"} · {driver.car_color || "цвет не указан"} · {driver.car_plate || "номер не указан"}</p><p><b>Телефон:</b> <a href={"tel:"+driver.phone}>{driver.phone}</a></p></>}
      {order.price_status === "driver_offered" && order.status === "new" && <div className="price-offer"><h3>Водитель предлагает цену</h3><p><b>{money(order.driver_price)}</b></p><div className="actions"><button className="button primary" disabled={busy} onClick={()=>priceAnswer("client_accept_price")}>Согласиться</button><button className="button danger" disabled={busy} onClick={()=>priceAnswer("client_decline_price")}>Отказаться</button></div></div>}
      {order.status === "new" && <button className="button danger" disabled={busy} onClick={cancelOrder}>Отменить заказ</button>}
      {["accepted","arrived","started"].includes(order.status) && order.pickup_lat != null && order.destination_lat != null && <a className="button secondary" href={routeUrl({lat:order.pickup_lat,lng:order.pickup_lng},{lat:order.destination_lat,lng:order.destination_lng})} target="_blank" rel="noreferrer">🗺️ Открыть маршрут A → B в 2ГИС</a>}
      {["completed","cancelled"].includes(order.status) && <button className="button primary" onClick={newOrder}>Заказать ещё раз</button>}
    </section> : <section className="panel">
      <form onSubmit={calculateRoute}>
        <div className="field"><label>Ваше имя</label><input required maxLength={100} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Как вас зовут?" /></div>
        <div className="field"><label>Телефон</label><input required type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+7 777 000 00 00" /></div>
        <div className="field"><label>Тип поездки</label><div className="switcher"><button type="button" className={tripType==="city"?"switch active":"switch"} onClick={()=>setTripType("city")}>🏙️ Город</button><button type="button" className={tripType==="intercity"?"switch active":"switch"} onClick={()=>setTripType("intercity")}>🛣️ Межгород</button></div></div>
        <div className="field"><label>Откуда забрать (точка A)</label><p className="muted small">{locating ? "📍 Определяем местоположение…" : pickupPoint ? "✅ Место подачи определено GPS." : "GPS недоступен — введи адрес вручную."}</p><input required maxLength={300} value={pickup} onChange={e=>{setPickup(e.target.value); if(e.target.value!=="Моё местоположение")setPickupPoint(null);}} placeholder="Адрес подачи или нажми GPS" /><button type="button" className="button secondary" onClick={detectPickup}>📍 Определить моё местоположение</button></div>
        <div className="field"><label>Куда ехать (точка B)</label><input required maxLength={300} value={destination} onChange={e=>{setDestination(e.target.value);setRoute(null);setDestinationPoint(null);}} placeholder="Город, улица, дом или название места" /></div>
        <div className="field"><label>Класс автомобиля</label><div className="class-grid">{CLASSES.map(item=>{const rate=rates[item.id]||DEFAULT_RATES[item.id];const available=onlineClasses.includes(item.id);return <button key={item.id} type="button" className={selectedClass===item.id?"class-card selected":"class-card"} onClick={()=>setSelectedClass(item.id)}><span className="class-icon">{item.icon}</span><b>{item.label}</b><span className="small">{rate?.rate_per_km||0} ₸/км</span><span className="small">{route?money(fareFor(rate,route.distanceKm)):"Рассчитаем"}</span><span className="small muted">{available?"Есть водитель":"Пока нет на линии"}</span></button>})}</div></div>
        <div className="field"><label>Комментарий (необязательно)</label><textarea maxLength={500} value={comment} onChange={e=>setComment(e.target.value)} placeholder="Подъезд, ориентир…" /></div>
        <button className="button primary submit-order" type="submit" disabled={busy || !name.trim() || !phone.trim() || !pickup.trim() || !destination.trim()}>{busy ? "Рассчитываем…" : "🗺️ Рассчитать маршрут и цену"}</button>
      </form>
      {route && destinationPoint && <div className="quote-panel"><div className="eyebrow">ПРЕДВАРИТЕЛЬНЫЙ РАСЧЁТ</div><h2>{route.distanceKm.toFixed(1)} км</h2><p className="muted">В пути ориентировочно {route.durationMin} мин. · автомобильный маршрут</p><div className="success"><b>{CLASSES.find(x=>x.id===selectedClass)?.label}: {money(quote)}</b><div className="small" style={{marginTop:5}}>{rates[selectedClass]?.rate_per_km || 0} ₸/км · минимальная стоимость {money(selectedRate?.minimum_fare)}</div></div><a className="button secondary" href={routeUrl(pickupPoint,destinationPoint)} target="_blank" rel="noreferrer">Посмотреть маршрут A → B в 2ГИС</a><button className="button primary" disabled={busy || !onlineClasses.includes(selectedClass)} onClick={submitOrder}>{busy?"Отправляем…":onlineClasses.includes(selectedClass) ? "Подтвердить цену и вызвать такси" : "Нет водителей этого класса"}</button><p className="muted small">Тарифы пока тестовые — перед запуском сверим их с реальными ценами в вашем городе.</p></div>}
    </section>}
    <p className="muted small footer-note">Мой Такси · при расчёте используются дорожные маршруты OSRM и адресный поиск Photon/OpenStreetMap.</p>
  </main>;
}

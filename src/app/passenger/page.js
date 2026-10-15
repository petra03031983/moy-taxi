"use client";
import { useEffect, useRef, useState } from "react";
import { callApi, statusLabel } from "../api";
import RouteMap from "./RouteMap";

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
  const [showContactFields, setShowContactFields] = useState(false);
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [comment, setComment] = useState("");
  const [pickupPoint, setPickupPoint] = useState(null);
  const [destinationPoint, setDestinationPoint] = useState(null);
  const [pickupSuggestions, setPickupSuggestions] = useState([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [ratingStars, setRatingStars] = useState(5);
  const [ratingComment, setRatingComment] = useState("");
  const [savingRating, setSavingRating] = useState(false);
  const [onlineClasses, setOnlineClasses] = useState(CLASSES.map(x => x.id));
  const [testMode, setTestMode] = useState(true);
  const [tripType, setTripType] = useState("city");
  const [selectedClass, setSelectedClass] = useState("economy");
  const [priceAdjustment, setPriceAdjustment] = useState(0);
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
      setShowContactFields(!profile.name || !profile.phone);
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
      callApi("address_reverse", point).then(result => setPickup(current =>
        !current.trim() || current === "Моё местоположение" ? result.label : current
      )).catch(() => {});
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
    const clean = destination.trim();
    if (clean.length < 2 || destinationPoint) {
      setDestinationSuggestions([]);
      setSuggestionError("");
      setSuggestionLoading(false);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setSuggestionLoading(true);
      setSuggestionError("");
      try {
        const result = await callApi("address_suggest", {
          query: clean,
          near_lat: pickupPoint?.lat ?? null,
          near_lng: pickupPoint?.lng ?? null
        });
        if (active) {
          const rows = result.suggestions || [];
          setDestinationSuggestions(rows);
          setSuggestionError(rows.length ? "" : "2ГИС не нашёл совпадений. Добавь город или уточни улицу/название объекта.");
        }
      } catch (e) {
        if (active) {
          setDestinationSuggestions([]);
          setSuggestionError(e.message || "Поиск адресов через 2ГИС недоступен. Попробуй ещё раз.");
        }
      } finally {
        if (active) setSuggestionLoading(false);
      }
    }, 450);
    return () => { active = false; clearTimeout(timer); };
  }, [destination, destinationPoint, pickupPoint?.lat, pickupPoint?.lng]);

  useEffect(() => {
    if (pickupPoint && destinationPoint && destination.trim() && !route) {
      void calculateRouteData();
    }
  }, [pickupPoint?.lat, pickupPoint?.lng, destinationPoint?.lat, destinationPoint?.lng]);

  useEffect(() => {
    if (!order?.id || !order?.client_token) return;
    let active = true;
    const load = async () => {
      try {
        const data = await callApi("order_status", { order_id: order.id, client_token: order.client_token });
        if (!active) return;
        const updated = { ...order, ...data.order, offers: data.offers || [], rating: data.rating || null };
        setOrder(updated); localStorage.setItem("moyTaxiGeneralOrder", JSON.stringify(updated));
      } catch {}
    };
    load();
    const timer = setInterval(load, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [order?.id, order?.client_token]);

  const baseQuote = route?.estimated_prices?.[selectedClass] ?? null;
  const quote = baseQuote == null ? null : Math.max(50, Number(baseQuote) + priceAdjustment);
  function changeOfferPrice(delta) {
    if (baseQuote == null) return;
    setPriceAdjustment(current => Math.max(50, Number(baseQuote) + current + delta) - Number(baseQuote));
  }
  const driver = order?.drivers || order?.assigned_driver || null;
  const showBooking = !order || order.status === "cancelled";

  async function calculateRouteData() {
    if (routeRequestRef.current || busy) return;
    if (!pickupPoint) { setError("Разреши доступ к геопозиции телефона — приложение само определит точку подачи."); return; }
    if (!destination.trim()) { setError("Введи конечный адрес — точка подачи определится автоматически."); return; }
    routeRequestRef.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi("calculate_route", {
        pickup_address: pickup || "Моё местоположение",
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
      setPriceAdjustment(0);
      setRoute({
        distanceKm: Number(result.distance_km),
        durationMin: Number(result.duration_minutes),
        geometry: result.route_geometry || [],
        estimated_prices: result.estimated_prices,
      });
      setTripType(Number(result.distance_km) >= 35 ? "intercity" : "city");
      if (Array.isArray(result.online_classes)) setOnlineClasses(result.online_classes);
      setPickup(current => current || "Моё местоположение");
      setNotice("");
    } catch (e) {
      setRoute(null);
      setError(e.message || "Не получилось найти этот адрес. Выбери точный адрес в подсказках ниже.");
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
    if (!pickupPoint) { setError("Разреши доступ к геопозиции телефона, чтобы определить точку подачи."); return; }
    if (!route || !destinationPoint) { setError("Подожди, пока рассчитается маршрут и появятся цены."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const fare = Number(quote || 0);
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
      setShowContactFields(false);
      setNotice(testMode ? "Заказ отправлен. Тестовый режим: никаких списаний." : "Заказ отправлен водителям.");
      setComment("");
    } catch (e) { setError(e.message || "Не удалось отправить заказ."); }
    finally { setBusy(false); }
  }

  async function markClientReady() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi("client_mark_ready", { order_id: order.id, client_token: order.client_token });
      const updated = { ...order, ...result.order };
      setOrder(updated); localStorage.setItem("moyTaxiGeneralOrder", JSON.stringify(updated));
      setNotice("Водитель получил сообщение: ты выходишь.");
    } catch (e) { setError(e.message || "Не удалось сообщить водителю."); }
    finally { setBusy(false); }
  }
  async function submitRating() {
    if (!order?.id || order?.rating?.id) return;
    setSavingRating(true); setError(""); setNotice("");
    try {
      const result = await callApi("client_rate_driver", { order_id: order.id, client_token: order.client_token, stars: ratingStars, comment: ratingComment });
      const updated = { ...order, rating: result.rating };
      setOrder(updated); localStorage.setItem("moyTaxiGeneralOrder", JSON.stringify(updated));
      setNotice("Спасибо! Оценка водителя сохранена.");
    } catch (e) { setError(e.message || "Не удалось сохранить оценку."); }
    finally { setSavingRating(false); }
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
    if (!navigator.geolocation) {
      setLocating(false);
      setPickupPoint(null);
      setError("Этот браузер не передаёт геопозицию. Открой приложение в Chrome и разреши местоположение.");
      return;
    }
    setLocating(true); setError("");
    navigator.geolocation.getCurrentPosition(position => {
      const point = { lat: position.coords.latitude, lng: position.coords.longitude };
      setPickupPoint(point); setPickup("Моё местоположение"); setLocating(false); setRoute(null);
      callApi("address_reverse", point).then(result => setPickup(result.label || "Моё местоположение")).catch(() => {});
    }, () => {
      setPickupPoint(null); setLocating(false);
      setError("Не удалось определить GPS. В Chrome нажми на значок настроек сайта → Разрешения → Местоположение → Разрешить, затем повтори.");
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 });
  }

  return <main className="app client-app">
    <header className="header"><a href="/" className="logo" style={{ textDecoration: "none", color: "inherit" }}>Мой <span>Такси</span></a><a href="/" className="small">На главную</a></header>
    <section className="panel hero"><div className="hero-icon">🚕</div><div className="eyebrow">ЗАКАЗ ТАКСИ</div><h1>Куда едем?</h1><p className="muted">Место подачи определим по GPS. Введи конечный адрес — маршрут и цены появятся автоматически.</p></section>
    {error && <div className="error" role="alert">{error}</div>}
    {notice && <div className="success" role="status">{notice}</div>}
    {(destinationPoint || order?.destination_lat != null) && <RouteMap pickupPoint={pickupPoint || (order?.pickup_lat != null ? {lat:order.pickup_lat,lng:order.pickup_lng} : null)} destinationPoint={destinationPoint || (order?.destination_lat != null ? {lat:order.destination_lat,lng:order.destination_lng} : null)} routeGeometry={route?.geometry} />}
    {!showBooking ? <section className="panel">
      <div className="eyebrow">ВАША ПОЕЗДКА</div><h2>{order.status === "new" ? "Заказ отправлен" : order.status === "accepted" ? "Водитель едет к вам" : order.status === "arrived" ? "Водитель на месте" : order.status === "started" ? "Поездка началась" : statusLabel(order.status)}</h2>
      <div className="status large-status">{statusLabel(order.status)}</div>
      <p><b>Класс:</b> {CLASSES.find(x=>x.id===order.vehicle_class)?.label || CLASSES.find(x=>x.id===driver?.vehicle_class)?.label || "Эконом"} · {order.trip_type==="intercity"?"Межгород":"Город"}</p>
      <p><b>📍 Откуда:</b> {order.pickup_address}</p><p><b>🏁 Куда:</b> {order.destination_address}</p>
      {Number(order.route_distance_km)>0 && <p><b>📏 Маршрут:</b> {Number(order.route_distance_km).toFixed(1)} км · ориентировочно {Math.ceil(Number(order.route_distance_km)/35*60)} мин.</p>}
      <p><b>💰 Цена:</b> {money(order.agreed_price || order.client_price || order.driver_price)}</p>
      <p><b>Оплата:</b> {order.payment_method==="kaspi_gold"?"Kaspi перевод":"Наличные"}</p>
      {driver?.name && <><p><b>Водитель:</b> {driver.name}</p><p><b>Автомобиль:</b> {driver.car_model || "—"} · {driver.car_color || "цвет не указан"} · {driver.car_plate || "номер не указан"}</p><p><b>Телефон:</b> <a href={"tel:"+driver.phone}>{driver.phone}</a></p></>}
      {order.status === "arrived" && <div className="searching-panel"><h3>Водитель на месте</h3><p className="muted">Водитель приехал за тобой. Нажми кнопку, когда выходишь к машине.</p><button className="button primary" disabled={busy} onClick={markClientReady}>👋 Я выхожу</button></div>}
      {order.status === "client_ready" && <div className="success"><b>Ты сообщил водителю, что выходишь.</b><p className="small" style={{margin:"5px 0 0"}}>Садись в автомобиль; водитель начнёт поездку после посадки.</p></div>}
      {order.status === "new" && <div className="searching-panel"><div className="searching-pulse">⌕</div><h3>Ищем водителей</h3><p className="muted">Водители выбранного класса рядом получат заказ и смогут предложить свою цену.</p><p><b>Предложений: {(order.offers||[]).filter(offer=>offer.status==="pending").length}</b></p>
        {(order.offers||[]).filter(offer=>offer.status==="pending").map(offer=><article className="driver-offer-card" key={offer.id}><div className="order-top"><h3>{offer.drivers?.name||"Водитель"}</h3><span className="status">{CLASSES.find(x=>x.id===offer.drivers?.vehicle_class)?.label||"Водитель"}</span></div><p><b>{money(offer.price)}</b></p><p>{offer.drivers?.car_model||"Автомобиль"}{offer.drivers?.car_color?" · "+offer.drivers.car_color:""}{offer.drivers?.car_plate?" · "+offer.drivers.car_plate:""}</p>{offer.drivers?.phone&&<p><a href={"tel:"+offer.drivers.phone}>{offer.drivers.phone}</a></p>}<div className="actions"><button className="button primary" disabled={busy} onClick={()=>priceAnswer("client_accept_offer",offer.id)}>Принять</button><button className="button danger" disabled={busy} onClick={()=>priceAnswer("client_decline_offer",offer.id)}>Отклонить</button></div></article>)}
        <button className="button danger" disabled={busy} onClick={cancelOrder}>Отменить заказ</button></div>}
      {["accepted","arrived","started"].includes(order.status) && order.pickup_lat != null && order.destination_lat != null && <a className="button secondary" href={routeUrl({lat:order.pickup_lat,lng:order.pickup_lng},{lat:order.destination_lat,lng:order.destination_lng})} target="_blank" rel="noreferrer">🗺️ Открыть маршрут A → B в 2ГИС</a>}
      {order.status === "completed" && !order.rating?.id && <section className="panel rating-panel"><h2>Как прошла поездка?</h2><p className="muted">Оцени водителя — это поможет улучшать сервис.</p><div className="rating-stars" role="group" aria-label="Оценка от 1 до 5 звёзд">{[1,2,3,4,5].map(star=><button type="button" key={star} className={star<=ratingStars?"rating-star active":"rating-star"} aria-label={star+" из 5"} aria-pressed={ratingStars===star} onClick={()=>setRatingStars(star)}>★</button>)}</div><div className="field"><label>Комментарий (необязательно)</label><textarea maxLength={500} value={ratingComment} onChange={e=>setRatingComment(e.target.value)} placeholder="Что понравилось или что улучшить?" /></div><button className="button primary" disabled={savingRating} onClick={submitRating}>{savingRating?"Сохраняем…":"Отправить оценку"}</button></section>}
      {order.status === "completed" && order.rating?.id && <div className="success"><b>Спасибо за оценку!</b><p style={{margin:"5px 0 0"}}>{"★".repeat(order.rating.stars)}{"☆".repeat(5-order.rating.stars)}{order.rating.comment?" · "+order.rating.comment:""}</p></div>}
      {["completed","cancelled"].includes(order.status) && <button className="button primary" onClick={newOrder}>Заказать ещё раз</button>}
    </section> : <section className="panel">
      <form onSubmit={event => event.preventDefault()}>
        {(showContactFields || !name.trim() || !phone.trim()) ? <div className="contact-fields"><div className="field"><label>Ваше имя</label><input required maxLength={100} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Как вас зовут?" /></div><div className="field"><label>Телефон</label><input required type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+7 777 000 00 00" /></div></div> : <button type="button" className="saved-contact" onClick={()=>setShowContactFields(true)}>👤 {name} · {phone} <span>Изменить</span></button>}
        <div className="pickup-auto-bar">
          <div className="pickup-auto-icon">📍</div>
          <div className="pickup-auto-copy"><b>{locating ? "Определяем ваше местоположение…" : pickupPoint ? "Место подачи определено" : "Нужно разрешить GPS"}</b><span>{pickupPoint ? (pickup && pickup !== "Моё местоположение" ? pickup : "Точка подачи определена автоматически по GPS") : "Разреши доступ к геопозиции — адрес подачи вводить не нужно."}</span></div>
          {!pickupPoint && <button type="button" className="button secondary" onClick={detectPickup} disabled={locating}>Разрешить GPS</button>}
        </div>
        <div className="field address-field"><label>Куда едем?</label><input required maxLength={300} value={destination} onChange={e=>{setDestination(e.target.value);setPriceAdjustment(0);setRoute(null);setDestinationPoint(null);setError("");setSuggestionError("");}} onKeyDown={e=>{if(e.key==="Enter"&&destinationSuggestions.length){e.preventDefault();const item=destinationSuggestions[0];setDestination(item.label);setDestinationPoint({lat:item.lat,lng:item.lng});setDestinationSuggestions([]);setSuggestionError("");setPriceAdjustment(0);setRoute(null);}}} placeholder="Например: аэропорт, улица, дом или ТРЦ" autoComplete="off" />{suggestionLoading && <p className="muted small">🔎 Ищем адреса…</p>}{destinationSuggestions.length>0&&<div className="address-suggestions">{destinationSuggestions.map((item,i)=><button type="button" className="address-suggestion" key={item.label+"-"+i} onClick={()=>{setDestination(item.label);setDestinationPoint({lat:item.lat,lng:item.lng});setDestinationSuggestions([]);setSuggestionError("");setPriceAdjustment(0);setRoute(null);setError("");}}><b>{item.name}</b><span>{item.label}</span><small>{item.city}</small></button>)}</div>}{suggestionError && !suggestionLoading && <p className="muted small address-search-help">{suggestionError}</p>}
          {busy && !route && <p className="muted small">📏 Рассчитываем маршрут и цены…</p>}
          {route && <p className="route-result-note">Маршрут {route.distanceKm.toFixed(1)} км · около {route.durationMin} мин. Цены рассчитаны автоматически.</p>}
        </div>
        {route && <div className="field"><label>Выбери класс и цену</label><div className="class-grid class-list">{CLASSES.map(item=>{const estimated=route?.estimated_prices?.[item.id];return <button key={item.id} type="button" className={selectedClass===item.id?"class-option selected":"class-option"} onClick={()=>{setSelectedClass(item.id);setPriceAdjustment(0);}} aria-pressed={selectedClass===item.id} disabled={!estimated}><span className="class-icon">{item.icon}</span><b className="class-name">{item.label}</b><span className="class-price">{estimated?money(selectedClass===item.id&&quote!=null?quote:estimated):"—"}</span></button>})}</div></div>}
        {route && quote != null && <section className="client-price-control" aria-label="Настройка предложенной цены">
          <div className="client-price-heading"><b>Твоя цена</b><span>Изменение по 50 ₸</span></div>
          <div className="client-price-stepper">
            <button type="button" aria-label="Уменьшить цену на 50 тенге" onClick={()=>changeOfferPrice(-50)} disabled={busy || quote <= 50}>−</button>
            <strong>{money(quote)}</strong>
            <button type="button" aria-label="Увеличить цену на 50 тенге" onClick={()=>changeOfferPrice(50)} disabled={busy}>+</button>
          </div>
          <p>Предложи свою цену. Водитель сможет принять её или предложить встречную.</p>
        </section>}
        <div className="field"><label>Комментарий (необязательно)</label><textarea maxLength={500} value={comment} onChange={e=>setComment(e.target.value)} placeholder="Подъезд, ориентир…" /></div>
        {route && <div className="field"><label>Способ оплаты</label><div className="payment-options"><button type="button" className={paymentMethod==="cash"?"payment-card selected":"payment-card"} onClick={()=>setPaymentMethod("cash")}><span>💵</span><b>Наличные</b></button><button type="button" className={paymentMethod==="kaspi_gold"?"payment-card selected":"payment-card"} onClick={()=>setPaymentMethod("kaspi_gold")}><span>🟥</span><b>Kaspi перевод</b></button></div></div>}
        {route && !onlineClasses.includes(selectedClass) && <p className="muted small" role="status">Сейчас водители класса «{CLASSES.find(x=>x.id===selectedClass)?.label || "Эконом"}» не на линии. Заказ сохранится; водители увидят его, когда выйдут на линию.</p>}
        <button className="button primary submit-order" type="button" onClick={submitOrder} disabled={busy || !name.trim() || !phone.trim() || !pickupPoint || !destinationPoint || !route}>{busy ? "Подождите…" : route ? "🚕 Заказать такси · "+money(quote) : "Введите адрес назначения"}</button>
      </form>
      {route && destinationPoint && <div className="quote-panel"><div className="route-summary"><b>{route.distanceKm.toFixed(1)} км</b><span>· около {route.durationMin} мин.</span></div><p className="muted small">Цена примерная и может измениться, если водитель предложит другую.</p><a className="button secondary" href={routeUrl(pickupPoint,destinationPoint)} target="_blank" rel="noreferrer">🗺️ Посмотреть маршрут</a></div>}
    </section>}
    <p className="muted small footer-note">Мой Такси · адресные подсказки и автомобильное расстояние рассчитываются через 2ГИС.</p>
  </main>;
}

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
function gpsErrorMessage(error) {
  if (error?.code === 1) return "Chrome не разрешил доступ к местоположению. Нажми значок слева от адреса сайта → Разрешения → Местоположение → Разрешить. На телефоне также включи «Местоположение». Затем нажми «Моё местоположение» ещё раз.";
  if (error?.code === 2) return "Телефон пока не смог определить координаты. Включи GPS/Местоположение и попробуй ещё раз на открытом месте.";
  if (error?.code === 3) return "GPS отвечает слишком долго. Включи «Местоположение» в телефоне и нажми кнопку ещё раз — приложение попробует получить координаты повторно.";
  return "Не удалось получить координаты GPS. Проверь разрешение местоположения для Chrome и попробуй ещё раз.";
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
  const pickupManuallyChosenRef = useRef(false);
  const clientAudioRef = useRef(null);

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
    if (!navigator.geolocation) {
      setLocating(false);
      setError("Геолокация недоступна в этом браузере. Разреши местоположение в Chrome или укажи адрес подачи вручную.");
      return;
    }
    let active = true;
    const applyPosition = position => {
      if (!active || !position?.coords) return;
      const point = { lat: Number(position.coords.latitude), lng: Number(position.coords.longitude) };
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
        setLocating(false);
        setError("Телефон вернул некорректные координаты GPS. Нажми «Моё местоположение» повторно.");
        return;
      }
      setLocating(false);
      if (pickupManuallyChosenRef.current) return;
      setPickupPoint(point);
      setPickup(current => pickupManuallyChosenRef.current || (current.trim() && current !== "Моё местоположение") ? current : "Моё местоположение");
      callApi("address_reverse", point).then(result => {
        if (active && !pickupManuallyChosenRef.current) setPickup(current =>
          !current.trim() || current === "Моё местоположение" ? result.label || "Моё местоположение" : current
        );
      }).catch(() => {});
    };
    const failPosition = error => {
      if (!active) return;
      if (error?.code !== 1) {
        navigator.geolocation.getCurrentPosition(applyPosition, finalError => {
          if (!active) return;
          setLocating(false);
          setError(gpsErrorMessage(finalError));
        }, { enableHighAccuracy: false, timeout: 30000, maximumAge: 300000 });
        return;
      }
      setLocating(false);
      setError(gpsErrorMessage(error));
    };
    setLocating(true);
    navigator.geolocation.getCurrentPosition(applyPosition, failPosition, { enableHighAccuracy: true, timeout: 25000, maximumAge: 120000 });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (pickup.trim().length < 3 || pickupPoint || pickup === "Моё местоположение") {
      setPickupSuggestions([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      callApi("address_suggest", { query: pickup }).then(result => {
        if (active) setPickupSuggestions(result.suggestions || []);
      }).catch(() => { if (active) setPickupSuggestions([]); });
    }, 650);
    return () => { active = false; clearTimeout(timer); };
  }, [pickup, pickupPoint]);

  useEffect(() => {
    const clean = destination.trim();
    if (clean.length < 3 || destinationPoint) {
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
    }, 650);
    return () => { active = false; clearTimeout(timer); };
  }, [destination, destinationPoint, pickupPoint?.lat, pickupPoint?.lng]);

  useEffect(() => {
    if (pickupPoint && destinationPoint && destination.trim() && !route) {
      void calculateRouteData();
    }
  }, [pickupPoint?.lat, pickupPoint?.lng, destinationPoint?.lat, destinationPoint?.lng]);

  useEffect(() => {
    const unlockAudio = () => {
      try {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!clientAudioRef.current && C) clientAudioRef.current = new C();
        if (clientAudioRef.current?.state === "suspended") void clientAudioRef.current.resume();
      } catch {}
    };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  function playClientTone() {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!clientAudioRef.current && C) clientAudioRef.current = new C();
      const context = clientAudioRef.current;
      if (!context) return;
      void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime;
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.14, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.21);
    } catch {}
  }

  useEffect(() => {
    if (!order?.id || !order?.client_token) return;
    let active = true;
    let previousStatus = order.status || "new";
    const load = async () => {
      try {
        const data = await callApi("order_status", { order_id: order.id, client_token: order.client_token });
        if (!active) return;
        const incomingStatus = String(data.order?.status || previousStatus);
        if (previousStatus === "new" && incomingStatus === "accepted") {
          playClientTone();
          setNotice("✅ Водитель принял заказ и едет к тебе.");
        }
        if (previousStatus !== "cancelled" && incomingStatus === "cancelled") {
          setNotice("Заказ отменён.");
        }
        previousStatus = incomingStatus;
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
    if (!pickup.trim()) { setError("Введи адрес подачи или нажми «Моё местоположение»."); return; }
    if (!destination.trim()) { setError("Введи адрес назначения."); return; }
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
      setNotice(result.route_notice || "");
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
      if (updated.status === "cancelled") setNotice("Заказ отменён.");
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
      setError("Геолокация недоступна в этом браузере. Можно указать адрес подачи вручную.");
      return;
    }
    pickupManuallyChosenRef.current = false;
    setLocating(true); setError(""); setNotice(""); setRoute(null);
    setPickupPoint(null); setPickup("Моё местоположение"); setPickupSuggestions([]);
    let finished = false;
    const onSuccess = position => {
      if (finished || pickupManuallyChosenRef.current) return;
      const point = { lat: Number(position?.coords?.latitude), lng: Number(position?.coords?.longitude) };
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
        finished = true;
        setPickupPoint(null); setLocating(false); setPickup("");
        setError("Телефон вернул некорректные координаты. Проверь GPS и попробуй снова.");
        return;
      }
      finished = true;
      setLocating(false);
      setPickupPoint(point); setPickup("Моё местоположение");
      callApi("address_reverse", point).then(result => {
        if (!pickupManuallyChosenRef.current) setPickup(result.label || "Моё местоположение");
      }).catch(() => {});
    };
    const onError = error => {
      if (finished) return;
      if (error?.code !== 1) {
        navigator.geolocation.getCurrentPosition(onSuccess, finalError => {
          if (finished) return;
          finished = true;
          setPickupPoint(null); setLocating(false); setPickup("");
          setError(gpsErrorMessage(finalError));
        }, { enableHighAccuracy: false, timeout: 30000, maximumAge: 300000 });
        return;
      }
      finished = true;
      setPickupPoint(null); setLocating(false); setPickup("");
      setError(gpsErrorMessage(error));
    };
    navigator.geolocation.getCurrentPosition(onSuccess, onError, { enableHighAccuracy: true, timeout: 25000, maximumAge: 120000 });
  }

  return <main className="app client-app">
    <header className="header"><a href="/" className="logo" style={{ textDecoration: "none", color: "inherit" }}>Мой <span>Такси</span></a><a href="/" className="small">На главную</a></header>
    <section className="panel hero"><div className="hero-icon">🚕</div><div className="eyebrow">ЗАКАЗ ТАКСИ</div><h1>Куда едем?</h1><p className="muted">Укажи, откуда забрать пассажира, и куда ехать. Можно выбрать любой адрес или использовать своё местоположение.</p></section>
    {error && <div className="error" role="alert">{error}</div>}
    {notice && <div className={notice.startsWith("2ГИС временно") ? "error" : "success"} role="status">{notice}</div>}
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
      {order.status === "arrived" && <div className="searching-panel"><h3>Водитель на месте</h3><p className="muted">Водитель приехал за тобой. Пожалуйста, выйди в течение 10 минут. Нажми кнопку, когда подходишь к машине.</p><button className="button primary" disabled={busy} onClick={markClientReady}>👋 Я выхожу</button></div>}
      {order.status === "client_ready" && <div className="success"><b>Ты сообщил водителю, что выходишь.</b><p className="small" style={{margin:"5px 0 0"}}>Садись в автомобиль; водитель начнёт поездку после посадки.</p></div>}
      {order.status === "new" && <div className="searching-panel"><div className="searching-pulse">⌕</div><h3>Ищем водителей</h3><p className="muted">Водители выбранного класса рядом получат заказ и смогут предложить свою цену.</p><p><b>Предложений: {(order.offers||[]).filter(offer=>offer.status==="pending").length}</b></p>
        {(order.offers||[]).filter(offer=>offer.status==="pending").map(offer=><article className="driver-offer-card" key={offer.id}><div className="order-top"><h3>{offer.drivers?.name||"Водитель"}</h3><span className="status">{CLASSES.find(x=>x.id===offer.drivers?.vehicle_class)?.label||"Водитель"}</span></div><p><b>{money(offer.price)}</b></p><p>{offer.drivers?.car_model||"Автомобиль"}{offer.drivers?.car_color?" · "+offer.drivers.car_color:""}{offer.drivers?.car_plate?" · "+offer.drivers.car_plate:""}</p>{offer.drivers?.phone&&<p><a href={"tel:"+offer.drivers.phone}>{offer.drivers.phone}</a></p>}<div className="actions"><button className="button primary" disabled={busy} onClick={()=>priceAnswer("client_accept_offer",offer.id)}>Принять</button><button className="button danger" disabled={busy} onClick={()=>priceAnswer("client_decline_offer",offer.id)}>Отклонить</button></div></article>)}
        <button className="button danger" disabled={busy} onClick={cancelOrder}>Отменить заказ</button></div>}
      {["accepted","arrived","started"].includes(order.status) && order.pickup_lat != null && order.destination_lat != null && <a className="button secondary" href={routeUrl({lat:order.pickup_lat,lng:order.pickup_lng},{lat:order.destination_lat,lng:order.destination_lng})} target="_blank" rel="noreferrer">🗺️ Открыть маршрут A → B в 2ГИС</a>}
      {["accepted","arrived","client_ready"].includes(order.status) && <div className="searching-panel"><p>Если планы изменились, можно отменить заказ до начала поездки.</p><button className="button danger" type="button" disabled={busy} onClick={cancelOrder}>Отменить заказ</button></div>}
      {order.status === "completed" && !order.rating?.id && <section className="panel rating-panel"><h2>Как прошла поездка?</h2><p className="muted">Оцени водителя — это поможет улучшать сервис.</p><div className="rating-stars" role="group" aria-label="Оценка от 1 до 5 звёзд">{[1,2,3,4,5].map(star=><button type="button" key={star} className={star<=ratingStars?"rating-star active":"rating-star"} aria-label={star+" из 5"} aria-pressed={ratingStars===star} onClick={()=>setRatingStars(star)}>★</button>)}</div><div className="field"><label>Комментарий (необязательно)</label><textarea maxLength={500} value={ratingComment} onChange={e=>setRatingComment(e.target.value)} placeholder="Что понравилось или что улучшить?" /></div><button className="button primary" disabled={savingRating} onClick={submitRating}>{savingRating?"Сохраняем…":"Отправить оценку"}</button></section>}
      {order.status === "completed" && order.rating?.id && <div className="success"><b>Спасибо за оценку!</b><p style={{margin:"5px 0 0"}}>{"★".repeat(order.rating.stars)}{"☆".repeat(5-order.rating.stars)}{order.rating.comment?" · "+order.rating.comment:""}</p></div>}
      {["completed","cancelled"].includes(order.status) && <button className="button primary" onClick={newOrder}>Заказать ещё раз</button>}
    </section> : <section className="panel">
      <form onSubmit={event => event.preventDefault()}>
        {(showContactFields || !name.trim() || !phone.trim()) ? <div className="contact-fields"><div className="field"><label>Ваше имя</label><input required maxLength={100} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Как вас зовут?" /></div><div className="field"><label>Телефон</label><input required type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+7 777 000 00 00" /></div></div> : <button type="button" className="saved-contact" onClick={()=>setShowContactFields(true)}>👤 {name} · {phone} <span>Изменить</span></button>}
        <div className="field address-field pickup-address-field">
          <label htmlFor="pickupAddress">Откуда забрать?</label>
          <input id="pickupAddress" required maxLength={300} value={pickup} onChange={e=>{
            const value=e.target.value;
            pickupManuallyChosenRef.current=true;
            setPickup(value); setPickupPoint(null); setPickupSuggestions([]); setRoute(null); setError(""); setNotice("");
          }} onKeyDown={e=>{
            if(e.key==="Enter"&&pickupSuggestions.length){
              e.preventDefault();
              const item=pickupSuggestions[0];
              pickupManuallyChosenRef.current=true;
              setPickup(item.label);
              setPickupPoint({lat:Number(item.lat),lng:Number(item.lng)});
              setPickupSuggestions([]);
              setRoute(null); setError(""); setNotice("");
            }
          }} placeholder="Адрес подачи: улица, дом, ориентир" autoComplete="off" />
          {pickupSuggestions.length>0&&<div className="address-suggestions">{pickupSuggestions.map((item,i)=><button type="button" className="address-suggestion" key={item.label+"-pickup-"+i} onClick={()=>{
            pickupManuallyChosenRef.current=true;
            setPickup(item.label);
            setPickupPoint({lat:Number(item.lat),lng:Number(item.lng)});
            setPickupSuggestions([]);
            setRoute(null); setError(""); setNotice("");
          }}><b>{item.name}</b><span>{item.label}</span><small>{item.city}</small></button>)}</div>}
          <div className="pickup-address-actions">
            <span className="pickup-address-hint">{pickupPoint ? "✓ Точка подачи выбрана. Можешь изменить адрес вручную." : pickup.trim().length>=3 ? "Выбери адрес из подсказок или рассчитай маршрут по введённому адресу." : "Можно указать любой адрес — не обязательно текущее местоположение телефона."}</span>
            <button type="button" className="button secondary pickup-gps-button" onClick={detectPickup} disabled={locating}>{locating ? "Определяем GPS…" : "📍 Моё местоположение"}</button>
          </div>
        </div>
        <div className="field address-field"><label>Куда едем?</label><input required maxLength={300} value={destination} onChange={e=>{setDestination(e.target.value);setPriceAdjustment(0);setRoute(null);setDestinationPoint(null);setError("");setSuggestionError("");}} onKeyDown={e=>{if(e.key==="Enter"&&destinationSuggestions.length){e.preventDefault();const item=destinationSuggestions[0];setDestination(item.label);setDestinationPoint({lat:item.lat,lng:item.lng});setDestinationSuggestions([]);setSuggestionError("");setPriceAdjustment(0);setRoute(null);}}} placeholder="Например: аэропорт, улица, дом или ТРЦ" autoComplete="off" />{suggestionLoading && <p className="muted small">🔎 Ищем адреса…</p>}{destinationSuggestions.length>0&&<div className="address-suggestions">{destinationSuggestions.map((item,i)=><button type="button" className="address-suggestion" key={item.label+"-"+i} onClick={()=>{setDestination(item.label);setDestinationPoint({lat:item.lat,lng:item.lng});setDestinationSuggestions([]);setSuggestionError("");setPriceAdjustment(0);setRoute(null);setError("");}}><b>{item.name}</b><span>{item.label}</span><small>{item.city}</small></button>)}</div>}{suggestionError && !suggestionLoading && <p className="muted small address-search-help">{suggestionError}</p>}
          {busy && !route && <p className="muted small">📏 Рассчитываем маршрут и цены…</p>}
          {route && <p className="route-result-note">Маршрут {route.distanceKm.toFixed(1)} км · около {route.durationMin} мин. Цены рассчитаны автоматически.</p>}
        </div>
        {!route && pickup.trim() && destination.trim() && <button type="button" className="button secondary calculate-route-button" disabled={busy} onClick={calculateRouteData}>{busy ? "📏 Рассчитываем маршрут…" : "📍 Рассчитать маршрут и цены"}</button>}
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

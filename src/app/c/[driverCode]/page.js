"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { callApi, statusLabel } from "../../api";

function distanceKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some(v => typeof v !== "number" || !Number.isFinite(v))) return null;
  const R = 6371, rad = v => v * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(a));
  // Ignore impossible GPS distances so customers never see huge false ETAs.
  return Number.isFinite(km) && km <= 300 ? km : null;
}

export default function ClientOrder() {
  const params = useParams();
  const driverCode = String(params?.driverCode || "").toUpperCase();
  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [comment, setComment] = useState("");
  const [pickupPoint, setPickupPoint] = useState(null);
  const [locationStatus, setLocationStatus] = useState("locating");
  const [order, setOrder] = useState(null);
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);

  const orderKey = "moyTaxiOrder:" + driverCode;

  async function geocodeDestination(address, nearPoint) {
    const clean = String(address || "").trim();
    const query = /казахстан|қазақстан|kazakhstan/i.test(clean) ? clean : clean + ", Kazakhstan";
    const cacheKey = "moyTaxiGeocode:" + query.toLocaleLowerCase() + ":" +
      (nearPoint ? Math.round(nearPoint.lat * 100) / 100 + "," + Math.round(nearPoint.lng * 100) / 100 : "no-gps");
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) return cached;
    } catch {}
    const params = new URLSearchParams({ q: query, limit: "1", lang: "ru" });
    if (nearPoint && Number.isFinite(nearPoint.lat) && Number.isFinite(nearPoint.lng)) {
      params.set("lat", String(nearPoint.lat));
      params.set("lon", String(nearPoint.lng));
    }
    let response;
    try {
      response = await fetch("https://photon.komoot.io/api/?" + params.toString(), {
        headers: { Accept: "application/json" }
      });
    } catch {
      throw new Error("Не получилось найти адрес на карте. Проверь интернет и укажи город, улицу и дом.");
    }
    if (!response.ok) throw new Error("Поиск адреса временно недоступен. Попробуй ещё раз через минуту.");
    const data = await response.json();
    const coords = data?.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2 ||
        !Number.isFinite(Number(coords[0])) || !Number.isFinite(Number(coords[1]))) {
      throw new Error("Не удалось найти точку назначения. Укажи город, улицу и дом.");
    }
    const point = { lat: Number(coords[1]), lng: Number(coords[0]) };
    try { localStorage.setItem(cacheKey, JSON.stringify(point)); } catch {}
    return point;
  }

  function detectPickupLocation() {
    setLocationStatus("locating");
    if (!("geolocation" in navigator)) {
      setLocationStatus("manual");
      setPickupPoint(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => {
        setPickupPoint({ lat: position.coords.latitude, lng: position.coords.longitude });
        setPickup(current => current.trim() ? current : "Моё местоположение");
        setLocationStatus("ready");
      },
      () => {
        setPickupPoint(null);
        setLocationStatus("manual");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    try {
      const profile = JSON.parse(localStorage.getItem("moyTaxiClientProfile") || "{}");
      setName(profile.name || "");
      setPhone(profile.phone || "");
      const saved = JSON.parse(localStorage.getItem(orderKey) || "null");
      if (saved?.id && saved?.client_token) setOrder(saved);
      else detectPickupLocation();
      localStorage.setItem("moyTaxiDriverCode", driverCode);
    } catch {}
    const beforeInstall = event => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    // A client-installed shortcut should reopen this specific driver's order page.
    const manifest = document.querySelector('link[rel="manifest"]');
    const oldManifest = manifest?.getAttribute("href");
    if (manifest && driverCode) manifest.setAttribute("href", `/c/${driverCode}/manifest.webmanifest`);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      if (manifest && oldManifest) manifest.setAttribute("href", oldManifest);
    };
  }, [driverCode]);

  useEffect(() => {
    if (!driverCode) return;
    let live = true;
    const load = async () => {
      try {
        const result = await callApi("availability", { driver_code: driverCode });
        if (live) setDriver(result.driver);
      } catch (e) {
        if (live) setError(e.message || "Не удалось загрузить водителя.");
      } finally { if (live) setLoading(false); }
    };
    load();
    const timer = setInterval(load, 10000);
    return () => { live = false; clearInterval(timer); };
  }, [driverCode]);

  useEffect(() => {
    if (!order?.id || !order?.client_token) return;
    let live = true;
    const check = async () => {
      try {
        const result = await callApi("order_status", { order_id: order.id, client_token: order.client_token });
        if (!live) return;
        let previous = {};
        try { previous = JSON.parse(localStorage.getItem(orderKey) || "{}"); } catch {}
        const updated = { ...previous, ...order, ...result.order };
        setOrder(updated);
        localStorage.setItem(orderKey, JSON.stringify(updated));
      } catch {}
    };
    check();
    const timer = setInterval(check, 3000);
    return () => { live = false; clearInterval(timer); };
  }, [order?.id, order?.client_token, driverCode]);

  const targetDistance = useMemo(() => {
    const targetLat = order?.status === "started" ? order?.destination_lat : order?.pickup_lat;
    const targetLng = order?.status === "started" ? order?.destination_lng : order?.pickup_lng;
    return distanceKm(targetLat, targetLng, order?.driver_lat, order?.driver_lng);
  }, [order]);
  const etaMinutes = targetDistance == null ? null : Math.max(1, Math.ceil(targetDistance / 0.45));

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      setNotice("Ищем точку назначения на карте…");
      const destinationPoint = await geocodeDestination(destination, pickupPoint);
      const result = await callApi("create_order", {
        driver_code: driverCode, name, phone,
        pickup_address: pickup, destination_address: destination, comment,
        pickup_lat: pickupPoint?.lat ?? null, pickup_lng: pickupPoint?.lng ?? null,
        destination_lat: destinationPoint.lat, destination_lng: destinationPoint.lng,
        client_price: price ? Number(price) : null,
      });
      localStorage.setItem("moyTaxiClientProfile", JSON.stringify({ name, phone }));
      const saved = {
        ...result.order,
        pickup_address: pickup, destination_address: destination,
        pickup_lat: pickupPoint?.lat ?? null, pickup_lng: pickupPoint?.lng ?? null,
        destination_lat: destinationPoint.lat, destination_lng: destinationPoint.lng,
        client_price: price ? Number(price) : null,
      };
      localStorage.setItem(orderKey, JSON.stringify(saved));
      setOrder(saved);
      setNotice("");
    } catch (e) { setError(e.message || "Не удалось отправить заказ."); setNotice(""); }
    finally { setBusy(false); }
  }

  async function cancelOrder() {
    if (!order) return;
    setBusy(true); setError("");
    try {
      const result = await callApi("cancel_order", { order_id: order.id, client_token: order.client_token });
      const updated = { ...order, ...result.order };
      setOrder(updated); localStorage.setItem(orderKey, JSON.stringify(updated));
    } catch (e) { setError(e.message || "Не удалось отменить заказ."); }
    finally { setBusy(false); }
  }

  async function answerPrice(action) {
    if (!order) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi(action, { order_id: order.id, client_token: order.client_token });
      const updated = { ...order, ...result.order };
      setOrder(updated); localStorage.setItem(orderKey, JSON.stringify(updated));
      setNotice(action === "client_accept_price" ? "Цена согласована. Теперь водитель может принять заказ." : "Вы отклонили предложение. Ждём возможную новую цену.");
    } catch (e) { setError(e.message || "Не удалось сохранить ответ."); }
    finally { setBusy(false); }
  }

  function resetForNewOrder() {
    localStorage.removeItem(orderKey);
    setOrder(null); setPickup(""); setDestination(""); setComment("");
    setPickupPoint(null); setPrice(""); setError(""); setNotice("");
    detectPickupLocation();
    // Имя и телефон сохраняются: клиенту не нужно регистрироваться снова.
  }

  async function saveToHomeScreen() {
    if (installPrompt) {
      await installPrompt.prompt();
      setInstallPrompt(null);
      return;
    }
    setNotice("В Chrome нажмите ⋮ → «Добавить на главный экран». Значок будет открывать страницу заказа именно у этого водителя.");
  }

  if (loading) return <main className="app"><section className="panel loading-panel"><div className="hero-icon">🚕</div><h1>Загружаем водителя…</h1><p className="muted">Подождите немного.</p></section></main>;
  if (!driver) return <main className="app"><header className="header"><div className="logo">Мой <span>Такси</span></div></header><section className="panel"><div className="hero-icon">🚕</div><h1>Водитель не найден</h1><p className="muted">Попросите водителя отправить актуальную QR-ссылку.</p>{error && <div className="error">{error}</div>}</section></main>;

  const driverDistance = targetDistance;
  return <main className="app client-app">
    <header className="header"><div className="logo">Мой <span>Такси</span></div><span className={driver.is_online ? "driver-status online-text" : "driver-status offline-text"}>{driver.is_online ? "● На линии" : "● Не на линии"}</span></header>
    <section className="client-driver panel">
      <div className="avatar" style={{ overflow: "hidden" }}>{driver.photo_url ? <img src={driver.photo_url} alt="Фото водителя" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (driver.name || "В").slice(0, 1).toUpperCase()}</div>
      <div className="client-driver-info"><div className="eyebrow">ВАШ ВОДИТЕЛЬ</div><h1>{driver.name}</h1><p className="muted"><a href={`tel:${driver.phone}`}>{driver.phone}</a></p><p className="muted small">{driver.car_model || "Частный водитель"}{driver.car_color ? " · " + driver.car_color : ""}{driver.car_plate ? " · " + driver.car_plate : ""}</p><button type="button" className="button secondary" style={{ marginTop: 8 }} onClick={saveToHomeScreen}>📲 Сохранить на экран телефона</button></div>
    </section>
    {notice && <div className="success" role="status">{notice}</div>}
    {error && <div className="error" role="alert">{error}</div>}
    {order ? <section className="panel">
      <div className="eyebrow">ВАША ПОЕЗДКА</div>
      <h2>{order.status === "completed" ? "Поездка завершена" : order.status === "cancelled" ? "Заказ отменён" : order.status === "accepted" ? "Водитель едет к вам" : order.status === "arrived" ? "Водитель на месте" : order.status === "started" ? "Поездка началась" : "Заказ отправлен"}</h2>
      <div className="status large-status">{statusLabel(order.status)}</div>
      {order.status === "new" && <div className="success"><b>⏳ Заказ отправлен водителю. Ждём подтверждение.</b></div>}
      {order.status === "accepted" && <div className="success"><b>🚕 Водитель направляется к вам.</b>{etaMinutes != null && <div style={{ marginTop: 6 }}>Прибытие ориентировочно через <b>{etaMinutes} мин.</b></div>}{driverDistance != null && <div className="small" style={{ marginTop: 5 }}>Расстояние до подачи: {driverDistance.toFixed(1)} км</div>}<div className="small" style={{ marginTop: 5 }}>Геопозиция обновляется автоматически, пока водитель на линии и разрешил доступ к местоположению.</div></div>}
      {order.status === "arrived" && <div className="success"><b>✅ Водитель прибыл к точке подачи.</b></div>}
      {order.status === "started" && <div className="success"><b>🛣️ Вы едете к пункту назначения.</b>{etaMinutes != null && <div style={{ marginTop: 6 }}>До пункта B ориентировочно <b>{etaMinutes} мин.</b></div>}{driverDistance != null && <div className="small" style={{ marginTop: 5 }}>Осталось примерно {driverDistance.toFixed(1)} км</div>}</div>}
      <p><b>Водитель:</b> {driver.name}</p>
      <p><b>Телефон:</b> <a href={`tel:${driver.phone}`}>{driver.phone}</a></p>
      <p><b>Автомобиль:</b> {driver.car_model || "—"} · {driver.car_color || "цвет не указан"} · {driver.car_plate || "номер не указан"}</p>
      <p><b>📍 Откуда:</b> {order.pickup_address || "—"}</p>
      <p><b>🏁 Куда:</b> {order.destination_address || "—"}</p>
      {order.client_price > 0 && <p><b>💰 Цена клиента:</b> {Number(order.client_price).toLocaleString("ru-RU")} ₸</p>}
      {order.price_status === "driver_offered" && order.status === "new" && <div className="price-offer"><h3>Водитель предлагает свою цену</h3><p><b>{Number(order.driver_price).toLocaleString("ru-RU")} ₸</b>{order.client_price > 0 ? ` вместо ${Number(order.client_price).toLocaleString("ru-RU")} ₸` : ""}</p><div className="actions"><button className="button primary" disabled={busy} onClick={() => answerPrice("client_accept_price")}>Согласиться на цену</button><button className="button danger" disabled={busy} onClick={() => answerPrice("client_decline_price")}>Отклонить цену</button></div></div>}
      {order.price_status === "declined" && order.status === "new" && <p className="muted">Вы отклонили последнее предложение водителя. Можно дождаться новой цены.</p>}
      {order.price_status === "accepted" && order.agreed_price > 0 && <p className="success"><b>✅ Согласованная стоимость: {Number(order.agreed_price).toLocaleString("ru-RU")} ₸</b></p>}
      {order.status === "new" && <button type="button" className="button danger" disabled={busy} onClick={cancelOrder}>Отменить заказ</button>}
      {["completed", "cancelled"].includes(order.status) && <><p className="muted">Чтобы заказать снова, нажмите кнопку ниже. Ваши имя и телефон уже сохранены на этом телефоне.</p><button type="button" className="button primary" onClick={resetForNewOrder}>Заказать ещё раз</button></>}
    </section> : <section className="panel">
      <div className="eyebrow">ЗАКАЗ ПО QR-КОДУ</div><h2>Куда едем?</h2><p className="muted">Эта ссылка всегда ведёт к выбранному водителю. Регистрироваться повторно не нужно — имя и телефон сохраняются на телефоне.</p>
      {!driver.is_online && <div className="error">Водитель сейчас не на линии.</div>}
      <form onSubmit={submit}>
        <div className="field"><label htmlFor="client-name">Ваше имя</label><input id="client-name" required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="Как вас зовут?" autoComplete="name" /></div>
        <div className="field"><label htmlFor="client-phone">Номер телефона</label><input id="client-phone" required type="tel" maxLength={40} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7 777 000 00 00" autoComplete="tel" /></div>
        <div className="field"><label htmlFor="pickup-address">Откуда забрать</label>
          <p className="muted small">{locationStatus === "locating" ? "📍 Определяем ваше местоположение…" : locationStatus === "ready" ? "✅ Точка подачи определена автоматически по GPS." : "GPS не определился. Введите адрес подачи вручную или нажмите кнопку ниже."}</p>
          <input id="pickup-address" required maxLength={300} value={pickup} onChange={e => setPickup(e.target.value)} placeholder={locationStatus === "ready" ? "Моё местоположение" : "Улица, дом, ориентир"} />
          <button type="button" className="button secondary" onClick={detectPickupLocation}>📍 Определить моё местоположение</button>
          {pickupPoint && <p className="muted small">Координаты подачи сохранены — водитель сможет открыть маршрут к вам в 2ГИС.</p>}
        </div>
        <div className="field"><label htmlFor="destination-address">Куда ехать</label>
          <input id="destination-address" required maxLength={300} value={destination} onChange={e => setDestination(e.target.value)} placeholder="Адрес, улица и дом или название места" />
          <p className="muted small">Напишите адрес назначения. Отмечать точку на карте не нужно.</p>
        </div>
        <div className="field"><label htmlFor="client-price">Ваша цена, ₸</label><input id="client-price" type="number" min="100" max="1000000" step="50" value={price} onChange={e => setPrice(e.target.value)} placeholder="Например, 2000" /><p className="muted small">Водитель увидит предложение и сможет принять его или предложить другую стоимость.</p></div>
        <div className="field"><label htmlFor="client-comment">Комментарий</label><textarea id="client-comment" maxLength={500} value={comment} onChange={e => setComment(e.target.value)} placeholder="Подъезд, ориентир…" /></div>
        <button className="button primary submit-order" type="submit" disabled={busy || !driver.is_online}>{busy ? "Отправляем…" : driver.is_online ? "🚕 Заказать такси" : "Водитель не на линии"}</button>
      </form>
    </section>}
    <p className="muted small footer-note">«Мой Такси» · ссылка закреплена за этим водителем.</p>
  </main>;
}

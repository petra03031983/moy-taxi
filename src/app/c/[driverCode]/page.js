"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import MapPicker from "../../MapPicker";
import { callApi, statusLabel } from "../../api";

export default function ClientOrder() {
  const params = useParams();
  const driverCode = String(params?.driverCode || "").toUpperCase();
  const [driver, setDriver] = useState(null);
  const [loadingDriver, setLoadingDriver] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [comment, setComment] = useState("");
  const [point, setPoint] = useState(null);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    try {
      const profile = JSON.parse(localStorage.getItem("moyTaxiClientProfile") || "{}");
      if (profile.name) setName(profile.name);
      if (profile.phone) setPhone(profile.phone);
      const savedOrder = JSON.parse(localStorage.getItem("moyTaxiOrder:" + driverCode) || "null");
      if (savedOrder?.id && savedOrder?.client_token) setOrder(savedOrder);
    } catch {}
  }, [driverCode]);

  useEffect(() => {
    if (!driverCode) return;
    let live = true;
    setLoadingDriver(true); setError("");
    callApi("availability", { driver_code: driverCode })
      .then((result) => { if (live) setDriver(result.driver); })
      .catch((e) => { if (live) { setDriver(null); setError(e.message || "Не удалось найти водителя."); } })
      .finally(() => { if (live) setLoadingDriver(false); });
    const timer = setInterval(() => {
      callApi("availability", { driver_code: driverCode }).then((result) => { if (live) setDriver(result.driver); }).catch(() => {});
    }, 15000);
    return () => { live = false; clearInterval(timer); };
  }, [driverCode]);

  useEffect(() => {
    if (!order?.id || !order?.client_token) return;
    let live = true;
    const check = async () => {
      try {
        const result = await callApi("order_status", { order_id: order.id, client_token: order.client_token });
        if (!live) return;
        const updated = { ...order, ...result.order };
        setOrder(updated);
        localStorage.setItem("moyTaxiOrder:" + driverCode, JSON.stringify(updated));
      } catch {}
    };
    check();
    const timer = setInterval(check, 4000);
    return () => { live = false; clearInterval(timer); };
  }, [order?.id, order?.client_token, driverCode]);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await callApi("create_order", {
        driver_code: driverCode,
        name, phone, pickup_address: pickup, destination_address: destination, comment,
        pickup_lat: point?.lat, pickup_lng: point?.lng,
      });
      localStorage.setItem("moyTaxiClientProfile", JSON.stringify({ name, phone }));
      const savedOrder = { ...result.order, pickup_address: pickup, destination_address: destination };
      localStorage.setItem("moyTaxiOrder:" + driverCode, JSON.stringify(savedOrder));
      setOrder(savedOrder);
    } catch (e) { setError(e.message || "Не удалось отправить заказ."); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!order) return; setError("");
    try {
      const result = await callApi("cancel_order", { order_id: order.id, client_token: order.client_token });
      const updated = { ...order, ...result.order };
      setOrder(updated); localStorage.setItem("moyTaxiOrder:" + driverCode, JSON.stringify(updated));
    } catch (e) { setError(e.message); }
  }
  function newOrder() {
    setOrder(null); setPickup(""); setDestination(""); setComment(""); setPoint(null); setError("");
    localStorage.removeItem("moyTaxiOrder:" + driverCode);
  }

  if (loadingDriver) return <main className="app"><section className="panel loading-panel"><div className="hero-icon">🚕</div><h1>Загружаем профиль водителя…</h1><p className="muted">Подожди немного.</p></section></main>;
  if (!driver) return <main className="app"><header className="header"><div className="logo">Мой <span>Такси</span></div></header><section className="panel"><div className="hero-icon">🚕</div><h1>Водитель не найден</h1><p className="muted">Попроси у водителя актуальный QR-код и отсканируй его ещё раз.</p>{error && <div className="error">{error}</div>}</section></main>;

  return <main className="app client-app">
    <header className="header"><div className="logo">Мой <span>Такси</span></div><span className={driver.is_online ? "driver-status online-text" : "driver-status offline-text"}>{driver.is_online ? "● На линии" : "● Не на линии"}</span></header>
    <section className="client-driver panel">
      <div className="avatar">{(driver.name || "В").trim().slice(0, 1).toUpperCase()}</div>
      <div className="client-driver-info"><div className="eyebrow">ТВОЙ ВОДИТЕЛЬ</div><h1>{driver.name}</h1><p className="muted">{driver.car_model || "Частный водитель"}{driver.car_plate ? " · " + driver.car_plate : ""}</p><p className="muted small">Код водителя: {driver.public_code}</p></div>
    </section>
    {error && <div className="error" role="alert">{error}</div>}
    {order ? <section className="panel">
      <div className="eyebrow">ТВОЯ ПОЕЗДКА</div>
      <h2>{order.status === "completed" ? "Поездка завершена" : order.status === "cancelled" ? "Заказ отменён" : "Заказ отправлен"}</h2>
      <div className="status large-status">{statusLabel(order.status)}</div>
      <p><b>Номер заказа:</b> {String(order.id).slice(0, 8).toUpperCase()}</p>
      <p><b>Откуда:</b> {order.pickup_address || pickup || "Адрес сохранён в заказе"}</p>
      <p><b>Куда:</b> {order.destination_address || destination || "Адрес сохранён в заказе"}</p>
      <p className="muted">Статус обновляется автоматически, пока эта страница открыта.</p>
      {order.status === "new" && <button type="button" className="button danger" onClick={cancel}>Отменить заказ</button>}
      {["completed", "cancelled"].includes(order.status) && <button type="button" className="button primary" onClick={newOrder}>Заказать ещё раз</button>}
    </section> : <section className="panel">
      <div className="eyebrow">ЗАКАЗ ПО QR-КОДУ</div><h2>Куда едем?</h2><p className="muted">Заполни маршрут, и заказ сразу придёт этому водителю.</p>
      {!driver.is_online && <div className="error">Водитель сейчас не на линии. Попробуй немного позже.</div>}
      <form onSubmit={submit}>
        <div className="field"><label htmlFor="clientName">Твоё имя</label><input id="clientName" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Как тебя зовут?" autoComplete="name" /></div>
        <div className="field"><label htmlFor="clientPhone">Номер телефона</label><input id="clientPhone" required type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 777 000 00 00" autoComplete="tel" /></div>
        <div className="field"><label htmlFor="pickup">Откуда забрать</label><input id="pickup" required maxLength={300} value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="Адрес подачи" /></div>
        <div className="field"><label>Или отметь место на карте</label><MapPicker lat={point?.lat} lng={point?.lng} onPick={setPoint} /><p className="muted small">{point ? "Точка подачи отмечена на карте." : "Нажми на карте, чтобы отметить точку подачи."}</p></div>
        <div className="field"><label htmlFor="destination">Куда ехать</label><input id="destination" required maxLength={300} value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Адрес назначения" /></div>
        <div className="field"><label htmlFor="comment">Комментарий (необязательно)</label><textarea id="comment" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Подъезд, ориентир или пожелание" /></div>
        <button className="button primary submit-order" type="submit" disabled={busy || !driver.is_online}>{busy ? "Отправляем заказ…" : driver.is_online ? "🚕 Заказать такси" : "Водитель не на линии"}</button>
      </form>
    </section>}
    <p className="muted small footer-note">Сервис «Мой Такси» · заказ поступает выбранному водителю.</p>
  </main>;
}
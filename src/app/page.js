"use client";
import { useEffect, useRef, useState } from "react";
import { callApi, statusLabel } from "./api";

const emptyForm = { name: "", phone: "", password: "", car_model: "", car_plate: "" };
function cleanSession(value) {
  return value && typeof value.driver_id === "string" && typeof value.session_token === "string" ? value : null;
}
export default function Home() {
  const [authMode, setAuthMode] = useState("login");
  const [form, setForm] = useState(emptyForm);
  const [session, setSession] = useState(null);
  const [driver, setDriver] = useState(null);
  const [orders, setOrders] = useState([]);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState("orders");
  const [showQR, setShowQR] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);
  const previousIds = useRef(new Set());
  const firstOrderLoad = useRef(true);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const beforeInstall = (event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    const saved = localStorage.getItem("moyTaxiSession");
    if (saved) {
      try {
        const parsed = cleanSession(JSON.parse(saved));
        if (parsed) {
          setSession(parsed);
          callApi("driver_me", parsed).then((data) => setDriver(data.driver)).catch(() => {
            localStorage.removeItem("moyTaxiSession");
            setSession(null);
          });
        }
      } catch { localStorage.removeItem("moyTaxiSession"); }
    }
    return () => window.removeEventListener("beforeinstallprompt", beforeInstall);
  }, []);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    const load = async () => {
      try {
        const data = await callApi("driver_list", session);
        if (!alive) return;
        const nextOrders = data.orders || [];
        const nextIds = new Set(nextOrders.map((o) => o.id));
        if (!firstOrderLoad.current) {
          const fresh = nextOrders.find((o) => o.status === "new" && !previousIds.current.has(o.id));
          if (fresh && "Notification" in window && Notification.permission === "granted") {
            try { new Notification("Мой Такси: новый заказ", { body: (fresh.clients?.name || "Клиент") + " • " + fresh.pickup_address }); } catch {}
          }
        }
        previousIds.current = nextIds;
        firstOrderLoad.current = false;
        setOrders(nextOrders);
        setDriver((old) => old ? { ...old, is_online: Boolean(data.is_online) } : old);
      } catch (e) {
        if (alive && /сессия|войти снова/i.test(e.message || "")) {
          localStorage.removeItem("moyTaxiSession");
          setSession(null);
          setDriver(null);
        }
      }
    };
    load();
    const timer = setInterval(load, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [session?.driver_id, session?.session_token]);

  async function submitAuth(event) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const action = authMode === "register" ? "register_driver" : "login_driver";
      const result = await callApi(action, form);
      const nextSession = { driver_id: result.driver.id, session_token: result.session_token };
      localStorage.setItem("moyTaxiSession", JSON.stringify(nextSession));
      setSession(nextSession); setDriver(result.driver); setForm(emptyForm);
      setTab("orders"); setShowQR(true); setError("");
      setNotice(authMode === "register" ? "Аккаунт создан. Это твоя личная панель водителя." : "Вход выполнен.");
    } catch (e) { setError(e.message || "Не удалось выполнить действие."); }
    finally { setBusy(false); }
  }

  async function refreshHistory() {
    if (!session) return;
    setError("");
    try { const data = await callApi("driver_history", session); setHistory(data.orders || []); }
    catch (e) { setError(e.message); }
  }
  async function chooseTab(nextTab) {
    setTab(nextTab); setNotice("");
    if (nextTab === "history") await refreshHistory();
  }
  async function changeOnline() {
    if (!session || !driver) return;
    setError(""); setNotice("");
    try {
      const data = await callApi("driver_toggle_online", { ...session, is_online: !driver.is_online });
      setDriver({ ...driver, is_online: data.is_online });
      setNotice(data.is_online ? "Ты снова на линии — новые заказы доступны." : "Ты не на линии. Новые заказы временно отключены.");
    } catch (e) { setError(e.message); }
  }
  async function changeOrder(orderId, status) {
    if (!session) return;
    setError(""); setNotice("");
    try {
      await callApi("driver_update", { ...session, order_id: orderId, status });
      const result = await callApi("driver_list", session);
      setOrders(result.orders || []);
      if (status === "completed") {
        await refreshHistory();
        setTab("history");
        setNotice("Поездка завершена и добавлена в историю.");
      } else if (status === "accepted") setNotice("Заказ принят. Свяжись с клиентом и открой маршрут.");
      else if (status === "arrived") setNotice("Отмечено: ты на месте.");
      else if (status === "started") setNotice("Поездка началась.");
    } catch (e) { setError(e.message); }
  }
  async function saveProfile(event) {
    event.preventDefault(); if (!session) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await callApi("driver_update_profile", { ...session, name: form.name || driver.name, car_model: form.car_model, car_plate: form.car_plate });
      setDriver({ ...driver, ...data.driver });
      setNotice("Профиль сохранён.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function logout() {
    try { if (session) await callApi("driver_logout", session); } catch {}
    localStorage.removeItem("moyTaxiSession");
    setSession(null); setDriver(null); setOrders([]); setHistory([]); setNotice(""); setError("");
  }
  async function copyLink() {
    const link = window.location.origin + "/c/" + driver.public_code;
    try { await navigator.clipboard.writeText(link); setNotice("Ссылка на твой QR скопирована."); }
    catch { window.prompt("Скопируй ссылку клиенту:", link); }
  }
  async function shareLink() {
    const link = window.location.origin + "/c/" + driver.public_code;
    if (navigator.share) {
      try { await navigator.share({ title: "Мой Такси", text: "Закажи поездку у меня", url: link }); }
      catch {}
    } else await copyLink();
  }
  async function enableNotifications() {
    if (!("Notification" in window)) { setNotice("В этом браузере уведомления не поддерживаются."); return; }
    const result = await Notification.requestPermission();
    setNotice(result === "granted" ? "Уведомления о новых заказах включены, пока приложение открыто." : "Разрешение на уведомления не предоставлено.");
  }
  async function installApp() {
    if (!installPrompt) { setNotice("В Chrome нажми меню ⋮ и выбери «Добавить на главный экран» или «Установить приложение»."); return; }
    await installPrompt.prompt(); setInstallPrompt(null);
  }

  if (!session || !driver) {
    return <main className="app auth-app">
      <header className="header"><div className="logo">Мой <span>Такси</span></div><span className="small">Панель водителя</span></header>
      <section className="hero panel">
        <div className="hero-icon">🚕</div>
        <p className="eyebrow">ТВОЙ ЛИЧНЫЙ СЕРВИС</p>
        <h1>{authMode === "register" ? "Создай аккаунт водителя" : "Добро пожаловать"}</h1>
        <p className="muted">{authMode === "register" ? "Зарегистрируйся один раз — и получи свою панель, QR-код и список заказов." : "Войди в свой аккаунт, чтобы управлять заказами и показывать клиентам личный QR-код."}</p>
      </section>
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="success">{notice}</div>}
      <section className="panel auth-panel">
        <div className="switcher">
          <button type="button" className={authMode === "login" ? "switch active" : "switch"} onClick={() => { setAuthMode("login"); setError(""); }}>Войти</button>
          <button type="button" className={authMode === "register" ? "switch active" : "switch"} onClick={() => { setAuthMode("register"); setError(""); }}>Регистрация</button>
        </div>
        <form onSubmit={submitAuth}>
          {authMode === "register" && <div className="field"><label htmlFor="name">Имя водителя</label><input id="name" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Например, Мидет" autoComplete="name" /></div>}
          <div className="field"><label htmlFor="phone">Номер телефона</label><input id="phone" required type="tel" maxLength={40} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+7 777 000 00 00" autoComplete="tel" /></div>
          <div className="field"><label htmlFor="password">Пароль</label><input id="password" required type="password" minLength={8} maxLength={128} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Не менее 8 символов" autoComplete={authMode === "register" ? "new-password" : "current-password"} /></div>
          {authMode === "register" && <>
            <div className="field"><label htmlFor="car">Автомобиль (необязательно)</label><input id="car" maxLength={100} value={form.car_model} onChange={(e) => setForm({ ...form, car_model: e.target.value })} placeholder="Например, Toyota Camry" /></div>
            <div className="field"><label htmlFor="plate">Госномер (необязательно)</label><input id="plate" maxLength={30} value={form.car_plate} onChange={(e) => setForm({ ...form, car_plate: e.target.value })} placeholder="Например, 123 ABC 01" /></div>
          </>}
          <button className="button primary" type="submit" disabled={busy}>{busy ? "Подожди…" : authMode === "register" ? "Создать аккаунт" : "Войти в приложение"}</button>
        </form>
        <p className="muted small">Пароль хранится в базе только в виде криптографического хеша.</p>
      </section>
    </main>;
  }

  const clientLink = typeof window !== "undefined" ? window.location.origin + "/c/" + driver.public_code : "";
  const qrImage = clientLink ? "https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=" + encodeURIComponent(clientLink) : "";
  const newCount = orders.filter((o) => o.status === "new").length;
  const tripCount = orders.filter((o) => ["accepted", "arrived", "started"].includes(o.status)).length;

  return <main className="app dashboard">
    <header className="header dashboard-header">
      <div><div className="logo">Мой <span>Такси</span></div><div className="muted small">Личный кабинет водителя</div></div>
      <button type="button" className={driver.is_online ? "button online-button" : "button offline-button"} onClick={changeOnline}>{driver.is_online ? "🟢 На линии" : "⚪ Не на линии"}</button>
    </header>
    {error && <div className="error" role="alert">{error}</div>}
    {notice && <div className="success">{notice}</div>}
    <section className="welcome-strip">
      <div><div className="eyebrow">С возвращением</div><h1>{driver.name}</h1><p className="muted">{driver.car_model || "Твой личный сервис такси"}{driver.car_plate ? " · " + driver.car_plate : ""}</p></div>
      <div className="avatar">{(driver.name || "В").trim().slice(0, 1).toUpperCase()}</div>
    </section>
    <div className="metrics">
      <div className="metric"><span className="metric-icon">🔔</span><strong>{newCount}</strong><span>Новых заказов</span></div>
      <div className="metric"><span className="metric-icon">🚕</span><strong>{tripCount}</strong><span>В работе</span></div>
      <div className="metric"><span className="metric-icon">🧾</span><strong>{history.length}</strong><span>В истории загружено</span></div>
    </div>
    <section className="panel qr-panel">
      <div className="section-heading"><div><div className="eyebrow">ТВОЯ ЛИЧНАЯ ССЫЛКА</div><h2>QR-код для клиентов</h2><p className="muted">Клиент сканирует код камерой — открывается форма заказа именно у тебя.</p></div><button type="button" className="icon-button" onClick={() => setShowQR(!showQR)} aria-label={showQR ? "Скрыть QR-код" : "Показать QR-код"}>{showQR ? "−" : "+"}</button></div>
      {showQR && <div className="qr-content">
        <div className="qr-frame">{qrImage ? <img className="qr" src={qrImage} width="240" height="240" alt="Персональный QR-код водителя" /> : <div className="qr-placeholder">QR</div>}</div>
        <div className="qr-details"><div className="small muted">Код водителя</div><div className="code">{driver.public_code}</div><p className="muted small">Распечатай QR или покажи клиенту с экрана.</p><div className="actions"><button className="button primary" type="button" onClick={shareLink}>Поделиться QR-ссылкой</button><button className="button secondary" type="button" onClick={copyLink}>Скопировать ссылку</button></div></div>
      </div>}
    </section>
    <nav className="tabbar" aria-label="Разделы панели">
      <button type="button" className={tab === "orders" ? "tab active" : "tab"} onClick={() => chooseTab("orders")}>Заказы {newCount > 0 && <span className="tab-count">{newCount}</span>}</button>
      <button type="button" className={tab === "history" ? "tab active" : "tab"} onClick={() => chooseTab("history")}>История</button>
      <button type="button" className={tab === "profile" ? "tab active" : "tab"} onClick={() => chooseTab("profile")}>Профиль</button>
    </nav>
    {tab === "orders" && <section className="panel"><div className="section-heading"><div><h2>Твои заказы</h2><p className="muted">Обновление автоматически каждые 4 секунды.</p></div><button type="button" className="icon-button" onClick={() => enableNotifications()} aria-label="Включить уведомления">🔔</button></div>
      {orders.length === 0 ? <div className="empty-state"><div className="empty-icon">🛣️</div><h3>Пока нет заказов</h3><p className="muted">Покажи клиенту QR-код выше. Когда клиент оформит поездку, заказ появится здесь.</p></div> :
        orders.map((o) => <article className="order" key={o.id}>
          <div className="order-top"><div><div className="eyebrow">ЗАКАЗ #{String(o.id).slice(0, 8).toUpperCase()}</div><h3>{o.clients?.name || "Клиент"}</h3></div><div className="status">{statusLabel(o.status)}</div></div>
          <p><b>📞 Телефон:</b> <a href={"tel:" + (o.clients?.phone || "")}>{o.clients?.phone || "—"}</a></p>
          <p><b>📍 Откуда:</b> {o.pickup_address}</p>
          <p><b>🏁 Куда:</b> {o.destination_address}</p>
          {o.comment && <p><b>💬 Комментарий:</b> {o.comment}</p>}
          <div className="actions order-actions">
            {o.status === "new" && <button type="button" className="button primary" onClick={() => changeOrder(o.id, "accepted")}>Принять заказ</button>}
            {o.status === "accepted" && <button type="button" className="button primary" onClick={() => changeOrder(o.id, "arrived")}>Я на месте</button>}
            {o.status === "arrived" && <button type="button" className="button primary" onClick={() => changeOrder(o.id, "started")}>Начать поездку</button>}
            {o.status === "started" && <button type="button" className="button primary" onClick={() => changeOrder(o.id, "completed")}>Завершить поездку</button>}
            {["new", "accepted", "arrived"].includes(o.status) && <button type="button" className="button danger" onClick={() => changeOrder(o.id, "cancelled")}>Отменить заказ</button>}
            {(o.pickup_lat != null && o.pickup_lng != null) ? <a className="button secondary center-button" href={"https://2gis.kz/astana/directions/points/|" + o.pickup_lng + "," + o.pickup_lat} target="_blank" rel="noreferrer">Открыть маршрут в 2GIS</a> : <a className="button secondary center-button" href={"https://2gis.kz/astana/search/" + encodeURIComponent(o.pickup_address)} target="_blank" rel="noreferrer">Найти адрес в 2GIS</a>}
          </div>
        </article>)}
    </section>}
    {tab === "history" && <section className="panel"><div className="section-heading"><div><h2>История поездок</h2><p className="muted">Последние завершённые и отменённые заказы.</p></div><button type="button" className="icon-button" onClick={refreshHistory} aria-label="Обновить историю">↻</button></div>
      {history.length === 0 ? <div className="empty-state"><div className="empty-icon">🧾</div><h3>История пока пустая</h3><p className="muted">Завершённые поездки появятся здесь.</p></div> : history.map((o) => <article className="order history-order" key={o.id}><div className="order-top"><h3>{o.clients?.name || "Клиент"}</h3><div className="status">{statusLabel(o.status)}</div></div><p><b>Откуда:</b> {o.pickup_address}</p><p><b>Куда:</b> {o.destination_address}</p><p className="muted small">{new Date(o.created_at).toLocaleString("ru-RU")}</p></article>)}
    </section>}
    {tab === "profile" && <section className="panel"><h2>Профиль водителя</h2><p className="muted">Контакты и данные, которые увидит клиент.</p>
      <form onSubmit={saveProfile}>
        <div className="field"><label htmlFor="profileName">Имя</label><input id="profileName" required maxLength={100} value={form.name || driver.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label>Номер телефона</label><input value={driver.phone} readOnly /></div>
        <div className="field"><label htmlFor="profileCar">Автомобиль</label><input id="profileCar" maxLength={100} value={form.car_model ?? driver.car_model ?? ""} onChange={(e) => setForm({ ...form, car_model: e.target.value })} placeholder="Марка и модель" /></div>
        <div className="field"><label htmlFor="profilePlate">Госномер</label><input id="profilePlate" maxLength={30} value={form.car_plate ?? driver.car_plate ?? ""} onChange={(e) => setForm({ ...form, car_plate: e.target.value })} placeholder="Госномер" /></div>
        <button className="button primary" type="submit" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить профиль"}</button>
      </form>
      <button className="button install" type="button" onClick={installApp}>📲 <span>Добавить «Мой Такси» на экран<small>Чтобы открывать панель как приложение</small></span></button>
      <button className="button danger" type="button" onClick={logout}>Выйти из аккаунта</button>
    </section>}
    <footer className="footer-note">Мой Такси · личная панель водителя</footer>
  </main>;
}
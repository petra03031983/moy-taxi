"use client";
import { useCallback, useEffect, useState } from "react";
import { callApi } from "../api";

const currency = value => (Number(value || 0)).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₸";
const dateTime = value => value ? new Date(value).toLocaleString("ru-RU") : "—";
const tabLabels = { overview: "Обзор", drivers: "Водители", orders: "Заказы", commissions: "Комиссия" };
const VEHICLE_CLASSES = [
  ["economy","Эконом"],["comfort","Комфорт"],["comfort_plus","Комфорт+"],
  ["business","Бизнес"],["minivan","Минивэн"],["premium","Премиум"]
];
const DEFAULT_RATES = {
  economy:{rate_per_km:40,minimum_fare:500},comfort:{rate_per_km:50,minimum_fare:700},
  comfort_plus:{rate_per_km:60,minimum_fare:900},business:{rate_per_km:80,minimum_fare:1500},
  minivan:{rate_per_km:70,minimum_fare:1200},premium:{rate_per_km:100,minimum_fare:2000}
};

export default function OwnerAdmin() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [stats, setStats] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [percent, setPercent] = useState("5");
  const [vehicleRates, setVehicleRates] = useState(DEFAULT_RATES);
  const [testMode, setTestMode] = useState(true);
  const [walletAmounts, setWalletAmounts] = useState({});
  const [dgisApiKey, setDgisApiKey] = useState("");
  const [dgisApiConfigured, setDgisApiConfigured] = useState(false);
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadAll = useCallback(async sessionToken => {
    const payload = { admin_token: sessionToken };
    const [summary, driverData, orderData, commissionData] = await Promise.all([
      callApi("admin_dashboard", payload),
      callApi("admin_drivers", payload),
      callApi("admin_orders", payload),
      callApi("admin_commissions", payload)
    ]);
    setStats(summary.stats);
    setPercent(String(summary.stats.commission_percent ?? 5));
    setVehicleRates(summary.stats.vehicle_rates && Object.keys(summary.stats.vehicle_rates).length ? summary.stats.vehicle_rates : DEFAULT_RATES);
    setTestMode(summary.stats.test_mode !== false);
    setDgisApiConfigured(Boolean(summary.stats.dgis_api_configured));
    setDrivers(driverData.drivers || []);
    setOrders(orderData.orders || []);
    setCommissions(commissionData.commissions || []);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("moyTaxiAdminSession");
    if (saved) {
      setToken(saved);
      loadAll(saved).catch(() => {
        localStorage.removeItem("moyTaxiAdminSession");
        setToken("");
      });
    }
  }, [loadAll]);

  async function login(event) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi("admin_login", { password });
      localStorage.setItem("moyTaxiAdminSession", result.admin_token);
      setToken(result.admin_token); setPassword("");
      await loadAll(result.admin_token);
      setNotice("Вход в кабинет владельца выполнен.");
    } catch (e) { setError(e.message || "Не удалось войти."); }
    finally { setBusy(false); }
  }

  async function refresh() {
    if (!token) return;
    setBusy(true); setError(""); setNotice("");
    try { await loadAll(token); setNotice("Статистика обновлена."); }
    catch (e) {
      setError(e.message || "Не удалось обновить данные.");
      if (/сессия|войти|вход владельца/i.test(e.message || "")) logout();
    } finally { setBusy(false); }
  }

  async function savePercent(event) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi("admin_update_commission_percent", {
        admin_token: token, commission_percent: Number(percent)
      });
      setPercent(String(result.commission_percent));
      await loadAll(token);
      setNotice("Процент комиссии сохранён. Новый процент применяется к новым завершённым поездкам.");
    } catch (e) { setError(e.message || "Не удалось сохранить комиссию."); }
    finally { setBusy(false); }
  }

  async function saveVehicleRates(event) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi("admin_update_vehicle_rates", { admin_token: token, vehicle_rates: vehicleRates });
      setVehicleRates(result.vehicle_rates);
      await loadAll(token);
      setNotice("Тарифы сохранены. Новые расчёты пассажиров будут использовать эти ставки.");
    } catch (e) { setError(e.message || "Не удалось сохранить тарифы."); }
    finally { setBusy(false); }
  }

  async function saveDgisApiKey(event) {
    event.preventDefault();
    const key = dgisApiKey.trim();
    if (key.length < 8) { setError("Вставь API-ключ 2ГИС из кабинета разработчика."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await callApi("admin_set_2gis_api_key", { admin_token: token, api_key: key });
      setDgisApiConfigured(true);
      setDgisApiKey("");
      await loadAll(token);
      setNotice("Ключ 2ГИС сохранён в закрытых настройках сервера. Он не показывается в публичной части сайта.");
    } catch (e) { setError(e.message || "Не удалось сохранить ключ 2ГИС."); }
    finally { setBusy(false); }
  }

  async function testDgisApi() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi("admin_test_2gis", { admin_token: token });
      setNotice(result.message || "Поиск 2ГИС отвечает.");
    } catch (e) { setError(e.message || "Проверка 2ГИС не удалась."); }
    finally { setBusy(false); }
  }

  async function setTestingMode() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi("admin_set_test_mode", { admin_token: token, test_mode: true });
      setTestMode(result.test_mode);
      await loadAll(token);
      setNotice("Тестовый режим включён: комиссия с поездок не начисляется.");
    } catch (e) { setError(e.message || "Не удалось включить режим."); }
    finally { setBusy(false); }
  }

  async function topupWallet(driver) {
    const amount = Number(walletAmounts[driver.id]);
    if (!Number.isFinite(amount) || amount <= 0) { setError("Укажи сумму пополнения больше нуля."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi("admin_wallet_adjust", {
        admin_token: token, driver_id: driver.id, amount,
        note: "Пополнение владельцем после ручной проверки перевода"
      });
      await loadAll(token);
      setWalletAmounts(prev => ({...prev, [driver.id]: ""}));
      setNotice("Лицевой счёт пополнен на " + currency(result.topup.amount) + ". Новый баланс: " + currency(result.topup.balance_after) + ".");
    } catch (e) { setError(e.message || "Не удалось пополнить лицевой счёт."); }
    finally { setBusy(false); }
  }

  async function markPaid(row) {
    setError(""); setNotice("");
    try {
      await callApi("admin_mark_commission_paid", { admin_token: token, commission_id: row.id, note: "Отмечено владельцем в кабинете" });
      await loadAll(token);
      setNotice("Начисление отмечено как полученное. Это учётная отметка, не автоматический перевод денег.");
    } catch (e) { setError(e.message || "Не удалось обновить начисление."); }
  }

  async function changePassword(event) {
    event.preventDefault(); setError(""); setNotice("");
    if (newPassword.length < 12) { setError("Новый пароль должен содержать минимум 12 символов."); return; }
    setBusy(true);
    try {
      await callApi("admin_change_password", { admin_token: token, new_password: newPassword });
      setNewPassword("");
      setNotice("Пароль владельца сменён. Сохрани новый пароль в надёжном месте.");
    } catch (e) { setError(e.message || "Не удалось сменить пароль."); }
    finally { setBusy(false); }
  }

  async function logout() {
    try { if (token) await callApi("admin_logout", { admin_token: token }); } catch {}
    localStorage.removeItem("moyTaxiAdminSession");
    setToken(""); setStats(null); setDrivers([]); setOrders([]); setCommissions([]);
  }

  if (!token || !stats) {
    return <main className="app auth-app">
      <header className="header"><a href="/" className="logo" style={{ textDecoration: "none", color: "inherit" }}>Мой <span>Такси</span></a><span className="small">Кабинет владельца</span></header>
      <section className="hero panel"><div className="hero-icon">📊</div><p className="eyebrow">УПРАВЛЕНИЕ СЕРВИСОМ</p><h1>Кабинет владельца</h1><p className="muted">Статистика водителей и клиентов, заказы и учёт комиссии.</p></section>
      {error && <div className="error" role="alert">{error}</div>}
      <section className="panel auth-panel"><form onSubmit={login}>
        <div className="field"><label htmlFor="ownerPassword">Пароль владельца</label><input id="ownerPassword" type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Введите пароль кабинета" /></div>
        <button className="button primary" disabled={busy}>{busy ? "Входим…" : "Открыть кабинет"}</button>
      </form><p className="muted small" style={{ marginTop: 14 }}>Кабинет закрыт отдельным паролем. Водители и клиенты не могут просматривать эту статистику.</p></section>
    </main>;
  }

  const due = commissions.filter(item => item.status === "due");
  const paid = commissions.filter(item => item.status === "paid");
  return <main className="app dashboard owner-dashboard">
    <header className="header dashboard-header"><div><a href="/" className="logo" style={{ textDecoration: "none", color: "inherit" }}>Мой <span>Такси</span></a><div className="muted small">Кабинет владельца сервиса</div></div><button className="button secondary owner-logout" onClick={logout}>Выйти</button></header>
    {error && <div className="error" role="alert">{error}</div>}
    {notice && <div className="success" role="status">{notice}</div>}
    <div className="section-heading" style={{ margin: "14px 0" }}><div><p className="eyebrow">БИЗНЕС-СВОДКА</p><h1>Управление «Мой Такси»</h1><p className="muted">Водители, поездки и комиссия платформы.</p></div><button className="icon-button" onClick={refresh} disabled={busy} aria-label="Обновить данные">↻</button></div>
    <div className="metrics owner-metrics">
      <div className="metric"><span className="metric-icon">🚕</span><strong>{stats.drivers}</strong><span>Всего водителей</span></div>
      <div className="metric"><span className="metric-icon">🟢</span><strong>{stats.online_drivers}</strong><span>На линии</span></div>
      <div className="metric"><span className="metric-icon">👥</span><strong>{stats.unique_clients}</strong><span>Клиентов по телефонам</span></div>
      <div className="metric"><span className="metric-icon">📦</span><strong>{stats.orders}</strong><span>Всего заказов</span></div>
      <div className="metric"><span className="metric-icon">✅</span><strong>{stats.completed_orders}</strong><span>Завершённых поездок</span></div>
      <div className="metric"><span className="metric-icon">💸</span><strong>{currency(stats.commission_due)}</strong><span>Комиссия ожидает получения</span></div>
    </div>
    <div className="owner-balance panel"><div><span className="muted small">Всего начислено комиссии</span><strong>{currency(stats.commission_total)}</strong></div><div><span className="muted small">Уже отмечено как полученное</span><strong>{currency(stats.commission_paid)}</strong></div></div>
    <nav className="tabbar owner-tabs">{Object.entries(tabLabels).map(([key,label])=><button key={key} className={tab===key?"tab active":"tab"} onClick={()=>setTab(key)}>{label}</button>)}</nav>

    {tab === "overview" && <section className="panel">
      <h2>Режим сервиса</h2>
      <div className={testMode ? "success" : "error"}><b>{testMode ? "ТЕСТОВЫЙ РЕЖИМ ВКЛЮЧЁН" : "РАБОЧИЙ РЕЖИМ"}</b><p style={{margin:"6px 0 0"}}>{testMode ? "Комиссия не начисляется. Тарифы используются только для проверки заказов." : "Комиссия начнёт учитываться, но электронный кошелёк и автоматическое списание ещё не подключены."}</p></div>
      <button type="button" className={testMode ? "button secondary" : "button primary"} disabled={busy || testMode} onClick={setTestingMode}>{testMode ? "Тестовый режим включён — списания выключены" : "Вернуть бесплатный тестовый режим"}</button>
      <div className="divider-owner" />
      <h2>2ГИС — поиск адресов и маршруты</h2>
      <div className={dgisApiConfigured ? "success" : "error"}><b>{dgisApiConfigured ? "Ключ 2ГИС сохранён" : "Ключ 2ГИС ещё не настроен"}</b><p style={{margin:"6px 0 0"}}>{dgisApiConfigured ? "Пассажирский поиск и расчёт маршрута будут обращаться к 2ГИС. Проверь, что у ключа есть права Suggest/Geocoder и Routing API." : "Раньше приложение открывало 2ГИС только как навигатор. Для поиска адресов внутри приложения нужен API-ключ 2ГИС с доступом к поиску и маршрутам."}</p></div>
      <form onSubmit={saveDgisApiKey}>
        <div className="field"><label htmlFor="dgisApiKey">API-ключ 2ГИС (вставь ключ из кабинета разработчика)</label><input id="dgisApiKey" type="password" autoComplete="off" spellCheck={false} value={dgisApiKey} onChange={e=>setDgisApiKey(e.target.value)} placeholder={dgisApiConfigured ? "Ключ сохранён — вставь новый, чтобы заменить" : "Вставь ключ 2ГИС"} required /></div>
        <button className="button primary" disabled={busy || dgisApiKey.trim().length<8}>Сохранить ключ 2ГИС</button>
      </form>
      <button type="button" className="button secondary" disabled={busy || !dgisApiConfigured} onClick={testDgisApi}>Проверить поиск 2ГИС</button>
      <p className="muted small">Ключ хранится в закрытой базе владельца и не передаётся пассажирам. Проверь, чтобы в кабинете 2ГИС для него были включены сервисы Search/Suggest/Geocoder и Routing API.</p>
      <div className="divider-owner" />
      <h2>Тарифы по классам автомобилей</h2>
      <p className="muted">Цена рассчитывается по автомобильному маршруту: расстояние × ставка за километр, но не ниже минимального тарифа. Значения ниже пока тестовые — перед запуском скорректируй их под реальную цену в своём городе.</p>
      <form onSubmit={saveVehicleRates}>
        {VEHICLE_CLASSES.map(([key,label]) => <article className="order" key={key}>
          <h3>{label}</h3>
          <div className="field"><label htmlFor={"rate-"+key}>Цена за километр, ₸</label><input id={"rate-"+key} type="number" min="1" max="10000" step="1" required value={vehicleRates[key]?.rate_per_km ?? ""} onChange={e=>setVehicleRates(prev=>({...prev,[key]:{...prev[key],rate_per_km:e.target.value}}))}/></div>
          <div className="field"><label htmlFor={"minimum-"+key}>Минимальная стоимость, ₸</label><input id={"minimum-"+key} type="number" min="0" max="1000000" step="50" required value={vehicleRates[key]?.minimum_fare ?? ""} onChange={e=>setVehicleRates(prev=>({...prev,[key]:{...prev[key],minimum_fare:e.target.value}}))}/></div>
        </article>)}
        <button className="button primary" disabled={busy}>Сохранить тарифы</button>
      </form>
      <div className="divider-owner" />
      <h2>Процент платформы</h2><p className="muted">Сейчас: {stats.commission_percent}%. Процент фиксируется для каждой поездки в момент завершения; тестовый режим отключает начисление комиссии.</p>
      <form onSubmit={savePercent}><div className="field"><label htmlFor="commissionPercent">Комиссия с поездки, % (0–30)</label><input id="commissionPercent" type="number" min="0" max="30" step="0.5" required value={percent} onChange={e=>setPercent(e.target.value)} /></div><button className="button primary" disabled={busy}>Сохранить процент</button></form>
      <div className="divider-owner" />
      <h2>Сменить пароль кабинета</h2><p className="muted">Используй длинный пароль и не передавай его водителям.</p>
      <form onSubmit={changePassword}><div className="field"><label htmlFor="newAdminPassword">Новый пароль (минимум 12 символов)</label><input id="newAdminPassword" type="password" minLength={12} autoComplete="new-password" required value={newPassword} onChange={e=>setNewPassword(e.target.value)} /></div><button className="button secondary" disabled={busy}>Сменить пароль</button></form>
      <p className="muted small" style={{ marginTop: 14 }}>Сейчас кабинет показывает начисления и позволяет отмечать комиссию полученной. Сам перевод средств автоматически не выполняется; для него позже подключим платёжный сервис или банковский перевод.</p>
    </section>}

    {tab === "drivers" && <section className="panel"><div className="section-heading"><div><h2>Водители</h2><p className="muted">Новые регистрации появляются здесь автоматически.</p></div><span className="status">{drivers.length} в списке</span></div>
      {drivers.length===0?<p className="muted">Пока нет зарегистрированных водителей.</p>:drivers.map(d=><article className="order" key={d.id}><div className="order-top"><h3>{d.name}</h3><span className="status">{d.is_online?"🟢 На линии":"Не на линии"}</span></div><p><b>Телефон:</b> <a href={`tel:${d.phone}`}>{d.phone}</a></p><p><b>Машина:</b> {[d.car_model,d.car_color,d.car_plate].filter(Boolean).join(" · ")||"Не указана"}</p><p><b>Класс:</b> {VEHICLE_CLASSES.find(x=>x[0]===d.vehicle_class)?.[1]||"Эконом"}</p><p><b>Лицевой счёт:</b> <strong>{currency(d.wallet_balance)}</strong></p><div className="wallet-topup-row"><input aria-label={"Сумма пополнения для "+d.name} type="number" min="1" max="1000000" step="100" value={walletAmounts[d.id]??""} onChange={e=>setWalletAmounts(prev=>({...prev,[d.id]:e.target.value}))} placeholder="Сумма пополнения, ₸"/><button className="button secondary" type="button" disabled={busy||!walletAmounts[d.id]} onClick={()=>topupWallet(d)}>Пополнить</button></div><p className="muted small">Зачисляй только после проверки поступления денег. Автоматическая оплата пока не подключена.</p><p><b>Персональный код:</b> {d.public_code}</p><p className="muted small">Регистрация: {dateTime(d.created_at)}</p></article>)}
    </section>}

    {tab === "orders" && <section className="panel"><div className="section-heading"><div><h2>Последние заказы</h2><p className="muted">До 200 последних заказов всех водителей.</p></div></div>
      {orders.length===0?<p className="muted">Заказов пока нет.</p>:orders.map(o=><article className="order" key={o.id}><div className="order-top"><h3>{o.clients?.name||"Клиент"} → {o.drivers?.name||"Водитель"}</h3><span className="status">{o.status}</span></div><p><b>Телефон клиента:</b> {o.clients?.phone||"—"}</p><p><b>Откуда:</b> {o.pickup_address}</p><p><b>Куда:</b> {o.destination_address}</p><p><b>Класс:</b> {VEHICLE_CLASSES.find(x=>x[0]===o.vehicle_class)?.[1]||"Эконом"}{Number(o.route_distance_km)>0?" · "+Number(o.route_distance_km).toFixed(1)+" км":""}</p><p><b>Оплата:</b> {o.payment_method==="kaspi_gold"?"Kaspi Gold — перевод":"Наличные"}</p><p><b>Цена:</b> {currency(o.agreed_price||o.driver_price||o.client_price)}</p><p className="muted small">{dateTime(o.created_at)}</p></article>)}
    </section>}

    {tab === "commissions" && <section className="panel"><div className="section-heading"><div><h2>Начисления платформы</h2><p className="muted">Отметь комиссию полученной после фактического расчёта с водителем.</p></div></div>
      <div className="owner-balance"><div><span className="muted small">Ожидает</span><strong>{due.length}</strong></div><div><span className="muted small">Получено</span><strong>{paid.length}</strong></div></div>
      {commissions.length===0?<p className="muted">Начисления появятся после завершения заказов с указанной стоимостью.</p>:commissions.map(item=><article className="order" key={item.id}><div className="order-top"><h3>{item.drivers?.name||"Водитель"}</h3><span className="status">{item.status==="paid"?"Получено":"Ожидает"}</span></div><p><b>Телефон:</b> {item.drivers?.phone||"—"}</p><p><b>Стоимость поездки:</b> {currency(item.fare)}</p><p><b>Комиссия:</b> {item.commission_percent}% · <strong>{currency(item.commission_amount)}</strong></p><p><b>Маршрут:</b> {item.orders?.pickup_address||"—"} → {item.orders?.destination_address||"—"}</p><p className="muted small">Завершена: {dateTime(item.orders?.completed_at||item.created_at)}{item.paid_at?" · Получено: "+dateTime(item.paid_at):""}</p>{item.status==="due"&&<button type="button" className="button primary" onClick={()=>markPaid(item)}>Отметить комиссию полученной</button>}</article>)}
    </section>}
    <p className="muted small footer-note">Мой Такси · учёт владельца · комиссия по завершённым поездкам</p>
  </main>;
}

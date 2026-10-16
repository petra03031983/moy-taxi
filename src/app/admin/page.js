"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const [installPrompt, setInstallPrompt] = useState(null);
  const [rateSaveState, setRateSaveState] = useState("saved");
  const [percentSaveState, setPercentSaveState] = useState("saved");
  const vehicleRatesRef = useRef(DEFAULT_RATES);
  const savedVehicleRatesRef = useRef(DEFAULT_RATES);
  const vehicleRateVersionRef = useRef(0);
  const vehicleRateQueueRef = useRef(Promise.resolve());
  const percentRef = useRef("5");
  const savedPercentRef = useRef("5");
  const percentVersionRef = useRef(0);
  const percentQueueRef = useRef(Promise.resolve());

  const loadAll = useCallback(async sessionToken => {
    const payload = { admin_token: sessionToken };
    const [summary, driverData, orderData, commissionData] = await Promise.all([
      callApi("admin_dashboard", payload),
      callApi("admin_drivers", payload),
      callApi("admin_orders", payload),
      callApi("admin_commissions", payload)
    ]);
    setStats(summary.stats);
    const loadedPercent = String(summary.stats.commission_percent ?? 5);
    percentRef.current = loadedPercent;
    savedPercentRef.current = loadedPercent;
    setPercent(loadedPercent);
    const loadedRates = summary.stats.vehicle_rates && Object.keys(summary.stats.vehicle_rates).length ? summary.stats.vehicle_rates : DEFAULT_RATES;
    vehicleRatesRef.current = loadedRates;
    savedVehicleRatesRef.current = loadedRates;
    setVehicleRates(loadedRates);
    setTestMode(summary.stats.test_mode !== false);
    setDgisApiConfigured(Boolean(summary.stats.dgis_api_configured));
    setDrivers(driverData.drivers || []);
    setOrders(orderData.orders || []);
    setCommissions(commissionData.commissions || []);
  }, []);

  useEffect(() => {
    const handleInstallPrompt = event => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const saved = localStorage.getItem("moyTaxiAdminSession");
    if (saved) {
      setToken(saved);
      loadAll(saved).catch(() => {
        localStorage.removeItem("moyTaxiAdminSession");
        setToken("");
      });
    }
    return () => window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
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

  function changeVehicleRate(key, field, direction) {
    if (!token) return;
    const currentRates = vehicleRatesRef.current || DEFAULT_RATES;
    const currentClass = currentRates[key] || DEFAULT_RATES[key];
    const step = field === "rate_per_km" ? 10 : 50;
    const min = field === "rate_per_km" ? 1 : 0;
    const max = field === "rate_per_km" ? 10000 : 1000000;
    const nextValue = Math.min(max, Math.max(min, Math.round(Number(currentClass[field] || 0) + direction * step)));
    if (nextValue === Number(currentClass[field] || 0)) return;
    const nextRates = {
      ...currentRates,
      [key]: { ...currentClass, [field]: nextValue }
    };
    vehicleRatesRef.current = nextRates;
    setVehicleRates(nextRates);
    const version = ++vehicleRateVersionRef.current;
    setRateSaveState("saving");
    setError("");

    vehicleRateQueueRef.current = vehicleRateQueueRef.current.catch(() => {}).then(async () => {
      try {
        const result = await callApi("admin_update_vehicle_rates", {
          admin_token: token,
          vehicle_rates: nextRates
        });
        const persistedRates = result.vehicle_rates || nextRates;
        savedVehicleRatesRef.current = persistedRates;
        if (version === vehicleRateVersionRef.current) {
          vehicleRatesRef.current = persistedRates;
          setVehicleRates(persistedRates);
          setStats(current => current ? { ...current, vehicle_rates: persistedRates } : current);
          setRateSaveState("saved");
        }
      } catch (e) {
        if (version === vehicleRateVersionRef.current) {
          vehicleRatesRef.current = savedVehicleRatesRef.current;
          setVehicleRates(savedVehicleRatesRef.current);
          setRateSaveState("error");
          setError((e.message || "Не удалось сохранить тариф.") + " Значение возвращено к последнему сохранённому.");
        }
      }
    });
  }

  function changeCommissionPercent(direction) {
    if (!token) return;
    const current = Number(percentRef.current || 0);
    const nextNumber = Math.min(30, Math.max(0, Math.round((current + direction * 0.5) * 2) / 2));
    if (nextNumber === current) return;
    const nextPercent = String(nextNumber);
    percentRef.current = nextPercent;
    setPercent(nextPercent);
    const version = ++percentVersionRef.current;
    setPercentSaveState("saving");
    setError("");

    percentQueueRef.current = percentQueueRef.current.catch(() => {}).then(async () => {
      try {
        const result = await callApi("admin_update_commission_percent", {
          admin_token: token,
          commission_percent: nextNumber
        });
        const persistedPercent = String(result.commission_percent ?? nextPercent);
        savedPercentRef.current = persistedPercent;
        if (version === percentVersionRef.current) {
          percentRef.current = persistedPercent;
          setPercent(persistedPercent);
          setStats(currentStats => currentStats ? { ...currentStats, commission_percent: Number(persistedPercent) } : currentStats);
          setPercentSaveState("saved");
        }
      } catch (e) {
        if (version === percentVersionRef.current) {
          percentRef.current = savedPercentRef.current;
          setPercent(savedPercentRef.current);
          setPercentSaveState("error");
          setError((e.message || "Не удалось сохранить процент комиссии.") + " Значение возвращено к последнему сохранённому.");
        }
      }
    });
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
      if (result.search_works && result.geocoder_works && result.routing_works) {
        setNotice(result.message || "Все сервисы 2ГИС работают.");
      } else {
        setError(result.message || "Один или несколько сервисов 2ГИС недоступны.");
      }
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

  async function installOwnerApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      setInstallPrompt(null);
      return;
    }
    setNotice("Чтобы добавить отдельную иконку: открой эту страницу в Chrome, нажми ⋮ и выбери «Установить приложение» или «Добавить на главный экран».");
  }

  const ownerInstallPanel = <section className="panel owner-install-guide">
    <div className="owner-install-title">📲 Отдельная иконка владельца</div>
    <p className="muted">Панель владельца устанавливается отдельно от основного «Мой Такси» и открывается со своей синей иконкой.</p>
    <button type="button" className="button secondary" onClick={installOwnerApp}>Установить кабинет владельца</button>
    <p className="muted small owner-install-help">Если кнопка не открыла окно установки: в Chrome нажми ⋮ → «Установить приложение» или «Добавить на главный экран».</p>
  </section>;

  if (!token || !stats) {
    return <main className="app auth-app">
      <header className="header"><div className="logo">Мой <span>Такси</span></div><span className="small">Кабинет владельца</span></header>
      <section className="hero panel"><div className="hero-icon">📊</div><p className="eyebrow">УПРАВЛЕНИЕ СЕРВИСОМ</p><h1>Кабинет владельца</h1><p className="muted">Статистика водителей и клиентов, заказы и учёт комиссии.</p></section>
      {ownerInstallPanel}
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
    <header className="header dashboard-header"><div><div className="logo">Мой <span>Такси</span></div><div className="muted small">Кабинет владельца сервиса</div></div><button className="button secondary owner-logout" onClick={logout}>Выйти</button></header>
    {ownerInstallPanel}
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
      <div className="owner-rates-list">
        {VEHICLE_CLASSES.map(([key,label]) => <article className="owner-rate-card" key={key}>
          <div className="owner-rate-card-heading">
            <h3>{label}</h3>
            <span className="owner-rate-auto-tag">Автосохранение</span>
          </div>
          <div className="owner-rate-controls">
            <div className="owner-rate-control">
              <span className="owner-rate-control-label">Цена за км</span>
              <div className="owner-stepper">
                <button type="button" className="owner-stepper-btn" aria-label={"Уменьшить цену за км — "+label} disabled={Number(vehicleRates[key]?.rate_per_km ?? DEFAULT_RATES[key].rate_per_km)<=1} onClick={()=>changeVehicleRate(key,"rate_per_km",-1)}>−</button>
                <output>{Number(vehicleRates[key]?.rate_per_km ?? DEFAULT_RATES[key].rate_per_km).toLocaleString("ru-RU")} ₸</output>
                <button type="button" className="owner-stepper-btn" aria-label={"Увеличить цену за км — "+label} disabled={Number(vehicleRates[key]?.rate_per_km ?? DEFAULT_RATES[key].rate_per_km)>=10000} onClick={()=>changeVehicleRate(key,"rate_per_km",1)}>+</button>
              </div>
              <span className="owner-rate-step-hint">Шаг 10 ₸</span>
            </div>
            <div className="owner-rate-control">
              <span className="owner-rate-control-label">Минимальная цена</span>
              <div className="owner-stepper">
                <button type="button" className="owner-stepper-btn" aria-label={"Уменьшить минимум — "+label} disabled={Number(vehicleRates[key]?.minimum_fare ?? DEFAULT_RATES[key].minimum_fare)<=0} onClick={()=>changeVehicleRate(key,"minimum_fare",-1)}>−</button>
                <output>{Number(vehicleRates[key]?.minimum_fare ?? DEFAULT_RATES[key].minimum_fare).toLocaleString("ru-RU")} ₸</output>
                <button type="button" className="owner-stepper-btn" aria-label={"Увеличить минимум — "+label} disabled={Number(vehicleRates[key]?.minimum_fare ?? DEFAULT_RATES[key].minimum_fare)>=1000000} onClick={()=>changeVehicleRate(key,"minimum_fare",1)}>+</button>
              </div>
              <span className="owner-rate-step-hint">Шаг 50 ₸</span>
            </div>
          </div>
        </article>)}
      </div>
      <p className={"owner-autosave-status "+rateSaveState} aria-live="polite">
        {rateSaveState==="saving"?"Сохраняем тариф…":rateSaveState==="error"?"Не удалось сохранить тариф":"✓ Тарифы сохраняются автоматически"}
      </p>
      <div className="divider-owner" />
      <h2>Процент платформы</h2><p className="muted">Процент фиксируется для каждой поездки при завершении. Нажми «−» или «+» — новое значение сохранится автоматически. В тестовом режиме начисление комиссии отключено.</p>
      <div className="owner-commission-adjuster">
        <div className="owner-commission-copy">
          <span>Комиссия с поездки</span>
          <small>Допустимый диапазон: 0–30%</small>
        </div>
        <div className="owner-commission-stepper" aria-label="Настройка процента комиссии">
          <button type="button" className="owner-stepper-btn" aria-label="Уменьшить комиссию на 0,5 процента" disabled={Number(percent)<=0} onClick={()=>changeCommissionPercent(-1)}>−</button>
          <output>{Number(percent).toLocaleString("ru-RU",{maximumFractionDigits:1})}<span>%</span></output>
          <button type="button" className="owner-stepper-btn" aria-label="Увеличить комиссию на 0,5 процента" disabled={Number(percent)>=30} onClick={()=>changeCommissionPercent(1)}>+</button>
        </div>
      </div>
      <p className={"owner-autosave-status "+percentSaveState} aria-live="polite">
        {percentSaveState==="saving"?"Сохраняем процент…":percentSaveState==="error"?"Не удалось сохранить процент":"✓ Процент сохраняется автоматически"}
      </p>
      <div className="divider-owner" />
      <h2>Сменить пароль кабинета</h2><p className="muted">Используй длинный пароль и не передавай его водителям.</p>
      <form onSubmit={changePassword}><div className="field"><label htmlFor="newAdminPassword">Новый пароль (минимум 12 символов)</label><input id="newAdminPassword" type="password" minLength={12} autoComplete="new-password" required value={newPassword} onChange={e=>setNewPassword(e.target.value)} /></div><button className="button secondary" disabled={busy}>Сменить пароль</button></form>
      <p className="muted small" style={{ marginTop: 14 }}>Сейчас кабинет показывает начисления и позволяет отмечать комиссию полученной. Сам перевод средств автоматически не выполняется; для него позже подключим платёжный сервис или банковский перевод.</p>
    </section>}

    {tab === "drivers" && <section className="panel"><div className="section-heading"><div><h2>Водители</h2><p className="muted">Новые регистрации появляются здесь автоматически.</p></div><span className="status">{drivers.length} в списке</span></div>
      {drivers.length===0?<p className="muted">Пока нет зарегистрированных водителей.</p>:drivers.map(d=><article className="order" key={d.id}><div className="order-top"><h3>{d.name}</h3><span className="status">{d.is_online?"🟢 На линии":"Не на линии"}</span></div><p><b>Телефон:</b> <a href={`tel:${d.phone}`}>{d.phone}</a></p><p><b>Машина:</b> {[d.car_model,d.car_color,d.car_plate].filter(Boolean).join(" · ")||"Не указана"}</p><p><b>Класс:</b> {VEHICLE_CLASSES.find(x=>x[0]===d.vehicle_class)?.[1]||"Эконом"}</p><p><b>Номер лицевого счёта:</b> <strong className="owner-account-number">{d.account_number||"—"}</strong></p><p><b>Баланс лицевого счёта:</b> <strong>{currency(d.wallet_balance)}</strong></p><div className="wallet-topup-row"><input aria-label={"Сумма пополнения для "+d.name} type="number" min="1" max="1000000" step="100" value={walletAmounts[d.id]??""} onChange={e=>setWalletAmounts(prev=>({...prev,[d.id]:e.target.value}))} placeholder="Сумма пополнения, ₸"/><button className="button secondary" type="button" disabled={busy||!walletAmounts[d.id]} onClick={()=>topupWallet(d)}>Пополнить</button></div><p className="muted small">Зачисляй только после проверки поступления денег. Автоматическая оплата пока не подключена.</p><p><b>Персональный код:</b> {d.public_code}</p><p className="muted small">Регистрация: {dateTime(d.created_at)}</p></article>)}
    </section>}

    {tab === "orders" && <section className="panel"><div className="section-heading"><div><h2>Последние заказы</h2><p className="muted">До 200 последних заказов всех водителей.</p></div></div>
      {orders.length===0?<p className="muted">Заказов пока нет.</p>:orders.map(o=><article className="order" key={o.id}><div className="order-top"><h3>{o.clients?.name||"Клиент"} → {o.drivers?.name||"Водитель"}</h3><span className="status">{o.status}</span></div><p><b>Телефон клиента:</b> {o.clients?.phone||"—"}</p><p><b>Откуда:</b> {o.pickup_address}</p><p><b>Куда:</b> {o.destination_address}</p><p><b>Класс:</b> {VEHICLE_CLASSES.find(x=>x[0]===o.vehicle_class)?.[1]||"Эконом"}{Number(o.route_distance_km)>0?" · "+Number(o.route_distance_km).toFixed(1)+" км":""}</p><p><b>Оплата:</b> {o.payment_method==="kaspi_gold"?"Kaspi перевод":"Наличные"}</p><p><b>Цена:</b> {currency(o.agreed_price||o.driver_price||o.client_price)}</p><p className="muted small">{dateTime(o.created_at)}</p></article>)}
    </section>}

    {tab === "commissions" && <section className="panel"><div className="section-heading"><div><h2>Начисления платформы</h2><p className="muted">Отметь комиссию полученной после фактического расчёта с водителем.</p></div></div>
      <div className="owner-balance"><div><span className="muted small">Ожидает</span><strong>{due.length}</strong></div><div><span className="muted small">Получено</span><strong>{paid.length}</strong></div></div>
      {commissions.length===0?<p className="muted">Начисления появятся после завершения заказов с указанной стоимостью.</p>:commissions.map(item=><article className="order" key={item.id}><div className="order-top"><h3>{item.drivers?.name||"Водитель"}</h3><span className="status">{item.status==="paid"?"Получено":"Ожидает"}</span></div><p><b>Телефон:</b> {item.drivers?.phone||"—"}</p><p><b>Стоимость поездки:</b> {currency(item.fare)}</p><p><b>Комиссия:</b> {item.commission_percent}% · <strong>{currency(item.commission_amount)}</strong></p><p><b>Маршрут:</b> {item.orders?.pickup_address||"—"} → {item.orders?.destination_address||"—"}</p><p className="muted small">Завершена: {dateTime(item.orders?.completed_at||item.created_at)}{item.paid_at?" · Получено: "+dateTime(item.paid_at):""}</p>{item.status==="due"&&<button type="button" className="button primary" onClick={()=>markPaid(item)}>Отметить комиссию полученной</button>}</article>)}
    </section>}
    <p className="muted small footer-note">Мой Такси · учёт владельца · комиссия по завершённым поездкам</p>
  </main>;
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { callApi } from "../api";

const currency = value => (Number(value || 0)).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₸";
const dateTime = value => value ? new Date(value).toLocaleString("ru-RU") : "—";
const tabLabels = { overview: "Обзор", drivers: "Водители", orders: "Заказы", commissions: "Комиссия" };

export default function OwnerAdmin() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [stats, setStats] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [percent, setPercent] = useState("5");
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
      <h2>Процент платформы</h2><p className="muted">Сейчас: {stats.commission_percent}%. Процент фиксируется для каждой поездки в момент завершения; изменение ставки влияет на последующие завершённые поездки.</p>
      <form onSubmit={savePercent}><div className="field"><label htmlFor="commissionPercent">Комиссия с поездки, % (0–30)</label><input id="commissionPercent" type="number" min="0" max="30" step="0.5" required value={percent} onChange={e=>setPercent(e.target.value)} /></div><button className="button primary" disabled={busy}>Сохранить процент</button></form>
      <div className="divider-owner" />
      <h2>Сменить пароль кабинета</h2><p className="muted">Используй длинный пароль и не передавай его водителям.</p>
      <form onSubmit={changePassword}><div className="field"><label htmlFor="newAdminPassword">Новый пароль (минимум 12 символов)</label><input id="newAdminPassword" type="password" minLength={12} autoComplete="new-password" required value={newPassword} onChange={e=>setNewPassword(e.target.value)} /></div><button className="button secondary" disabled={busy}>Сменить пароль</button></form>
      <p className="muted small" style={{ marginTop: 14 }}>Сейчас кабинет показывает начисления и позволяет отмечать комиссию полученной. Сам перевод средств автоматически не выполняется; для него позже подключим платёжный сервис или банковский перевод.</p>
    </section>}

    {tab === "drivers" && <section className="panel"><div className="section-heading"><div><h2>Водители</h2><p className="muted">Новые регистрации появляются здесь автоматически.</p></div><span className="status">{drivers.length} в списке</span></div>
      {drivers.length===0?<p className="muted">Пока нет зарегистрированных водителей.</p>:drivers.map(d=><article className="order" key={d.id}><div className="order-top"><h3>{d.name}</h3><span className="status">{d.is_online?"🟢 На линии":"Не на линии"}</span></div><p><b>Телефон:</b> <a href={`tel:${d.phone}`}>{d.phone}</a></p><p><b>Машина:</b> {[d.car_model,d.car_color,d.car_plate].filter(Boolean).join(" · ")||"Не указана"}</p><p><b>Персональный код:</b> {d.public_code}</p><p className="muted small">Регистрация: {dateTime(d.created_at)}</p></article>)}
    </section>}

    {tab === "orders" && <section className="panel"><div className="section-heading"><div><h2>Последние заказы</h2><p className="muted">До 200 последних заказов всех водителей.</p></div></div>
      {orders.length===0?<p className="muted">Заказов пока нет.</p>:orders.map(o=><article className="order" key={o.id}><div className="order-top"><h3>{o.clients?.name||"Клиент"} → {o.drivers?.name||"Водитель"}</h3><span className="status">{o.status}</span></div><p><b>Телефон клиента:</b> {o.clients?.phone||"—"}</p><p><b>Откуда:</b> {o.pickup_address}</p><p><b>Куда:</b> {o.destination_address}</p><p><b>Цена:</b> {currency(o.agreed_price||o.driver_price||o.client_price)}</p><p className="muted small">{dateTime(o.created_at)}</p></article>)}
    </section>}

    {tab === "commissions" && <section className="panel"><div className="section-heading"><div><h2>Начисления платформы</h2><p className="muted">Отметь комиссию полученной после фактического расчёта с водителем.</p></div></div>
      <div className="owner-balance"><div><span className="muted small">Ожидает</span><strong>{due.length}</strong></div><div><span className="muted small">Получено</span><strong>{paid.length}</strong></div></div>
      {commissions.length===0?<p className="muted">Начисления появятся после завершения заказов с указанной стоимостью.</p>:commissions.map(item=><article className="order" key={item.id}><div className="order-top"><h3>{item.drivers?.name||"Водитель"}</h3><span className="status">{item.status==="paid"?"Получено":"Ожидает"}</span></div><p><b>Телефон:</b> {item.drivers?.phone||"—"}</p><p><b>Стоимость поездки:</b> {currency(item.fare)}</p><p><b>Комиссия:</b> {item.commission_percent}% · <strong>{currency(item.commission_amount)}</strong></p><p><b>Маршрут:</b> {item.orders?.pickup_address||"—"} → {item.orders?.destination_address||"—"}</p><p className="muted small">Завершена: {dateTime(item.orders?.completed_at||item.created_at)}{item.paid_at?" · Получено: "+dateTime(item.paid_at):""}</p>{item.status==="due"&&<button type="button" className="button primary" onClick={()=>markPaid(item)}>Отметить комиссию полученной</button>}</article>)}
    </section>}
    <p className="muted small footer-note">Мой Такси · учёт владельца · комиссия по завершённым поездкам</p>
  </main>;
}

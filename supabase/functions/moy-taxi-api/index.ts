import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
const fail = (message: string, status = 400) => reply({ ok: false, error: message }, status);
const enc = new TextEncoder();
const hex = (buffer: ArrayBuffer | Uint8Array) =>
  Array.from(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (value: string) =>
  new Uint8Array((value.match(/.{1,2}/g) || []).map((v) => parseInt(v, 16)));
async function sha256(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}
async function passwordHash(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(saltHex), iterations: 120000, hash: "SHA-256" },
    key,
    256,
  );
  return hex(bits);
}
function equalConstantTime(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function normalizePhone(input: unknown) {
  let digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = "7" + digits.slice(1);
  if (digits.length < 10 || digits.length > 15) return "";
  return "+" + digits;
}
function publicDriver(driver: any) {
  return {
    id: driver.id,
    public_code: driver.public_code,
    name: driver.name,
    phone: driver.phone,
    car_model: driver.car_model || "",
    car_plate: driver.car_plate || "",
    is_online: Boolean(driver.is_online),
  };
}
async function getDb() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) throw new Error("Server configuration is incomplete");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function driverSession(db: any, payload: any) {
  const id = String(payload.driver_id || "");
  const token = String(payload.session_token || "");
  if (!id || token.length < 20) return { error: "Сессия истекла. Войди снова.", status: 401 };
  const { data, error } = await db.from("drivers")
    .select("id,public_code,name,phone,car_model,car_plate,is_online,created_at,session_token_hash,session_expires_at")
    .eq("id", id).maybeSingle();
  if (error || !data) return { error: "Не удалось проверить вход. Войди снова.", status: 401 };
  const expiresAt = data.session_expires_at ? Date.parse(data.session_expires_at) : 0;
  const tokenHash = await sha256(token);
  if (!data.session_token_hash || !equalConstantTime(tokenHash, data.session_token_hash) || expiresAt < Date.now()) {
    return { error: "Сессия истекла. Войди снова.", status: 401 };
  }
  return { driver: publicDriver(data) };
}
async function createSession(db: any, driverId: string) {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await db.from("drivers")
    .update({ session_token_hash: tokenHash, session_expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq("id", driverId);
  if (error) throw error;
  return token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);
  try {
    const db = await getDb();
    const payload = await req.json();
    const action = String(payload.action || "");

    if (action === "register_driver") {
      const name = String(payload.name || "").trim().slice(0, 100);
      const phone = normalizePhone(payload.phone);
      const password = String(payload.password || "");
      const carModel = String(payload.car_model || "").trim().slice(0, 100);
      const carPlate = String(payload.car_plate || "").trim().slice(0, 30);
      if (!name || !phone || password.length < 8) return fail("Укажи имя, телефон и пароль не короче 8 символов.");
      const { count: existingCount, error: countError } = await db.from("drivers")
        .select("id", { count: "exact", head: true });
      if (countError) return fail("Не удалось проверить регистрацию. Попробуй позже.", 500);
      const { data: existing } = await db.from("drivers").select("id").eq("phone", phone).maybeSingle();
      if (existing) return fail("Этот номер уже зарегистрирован. Войди в приложение.");
      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      const salt = hex(saltBytes);
      const hash = await passwordHash(password, salt);
      const { data: created, error } = await db.from("drivers").insert({
        name, phone, password_salt: salt, password_hash: hash,
        car_model: carModel || null, car_plate: carPlate || null, is_online: true,
      }).select("id,public_code,name,phone,car_model,car_plate,is_online,created_at").single();
      if (error || !created) {
        console.error("register driver", error);
        return fail("Не удалось создать аккаунт. Проверь номер и попробуй снова.", 500);
      }
      if ((existingCount || 0) === 0) {
        const { error: legacyError } = await db.from("orders").update({ driver_id: created.id }).is("driver_id", null);
        if (legacyError) console.error("legacy order migration", legacyError);
      }
      const session_token = await createSession(db, created.id);
      return reply({ ok: true, driver: publicDriver(created), session_token });
    }

    if (action === "login_driver") {
      const phone = normalizePhone(payload.phone);
      const password = String(payload.password || "");
      if (!phone || !password) return fail("Введи номер телефона и пароль.");
      const { data: driver, error } = await db.from("drivers")
        .select("id,public_code,name,phone,car_model,car_plate,is_online,created_at,password_salt,password_hash")
        .eq("phone", phone).maybeSingle();
      if (error) return fail("Не удалось выполнить вход. Попробуй позже.", 500);
      if (!driver || !equalConstantTime(await passwordHash(password, driver.password_salt), driver.password_hash)) {
        return fail("Неверный номер телефона или пароль.", 401);
      }
      const session_token = await createSession(db, driver.id);
      return reply({ ok: true, driver: publicDriver(driver), session_token });
    }

    if (action === "availability") {
      const code = String(payload.driver_code || "").trim().toUpperCase();
      if (!code) return fail("Не указан водитель.", 400);
      const { data: driver, error } = await db.from("drivers")
        .select("id,public_code,name,phone,car_model,car_plate,is_online")
        .eq("public_code", code).maybeSingle();
      if (error) return fail("Не удалось загрузить профиль водителя.", 500);
      if (!driver) return fail("По этой QR-ссылке водитель не найден.", 404);
      return reply({ ok: true, driver: publicDriver(driver), is_online: Boolean(driver.is_online) });
    }

    if (action === "create_order") {
      const driverCode = String(payload.driver_code || "").trim().toUpperCase();
      const name = String(payload.name || "").trim().slice(0, 100);
      const phone = String(payload.phone || "").trim().slice(0, 40);
      const pickup = String(payload.pickup_address || "").trim().slice(0, 300);
      const destination = String(payload.destination_address || "").trim().slice(0, 300);
      const comment = String(payload.comment || "").trim().slice(0, 500);
      if (!driverCode || !name || !phone || !pickup || !destination) {
        return fail("Заполни имя, телефон, адрес подачи и адрес назначения.");
      }
      const { data: driver, error: driverError } = await db.from("drivers")
        .select("id,is_online").eq("public_code", driverCode).maybeSingle();
      if (driverError) return fail("Не удалось проверить водителя.", 500);
      if (!driver) return fail("Водитель не найден. Попроси новый QR-код.", 404);
      if (!driver.is_online) return fail("Водитель сейчас не на линии. Попробуй позже.", 409);
      const { data: client, error: clientError } = await db.from("clients")
        .insert({ name, phone }).select("id").single();
      if (clientError || !client) {
        console.error("client insert", clientError);
        return fail("Не удалось сохранить клиента. Попробуй ещё раз.", 500);
      }
      const lat = Number(payload.pickup_lat), lng = Number(payload.pickup_lng);
      const clientToken = crypto.randomUUID();
      const { data: order, error: orderError } = await db.from("orders").insert({
        client_id: client.id,
        driver_id: driver.id,
        pickup_address: pickup,
        pickup_lat: Number.isFinite(lat) ? lat : null,
        pickup_lng: Number.isFinite(lng) ? lng : null,
        destination_address: destination,
        comment: comment || null,
        client_token: clientToken,
        status: "new",
      }).select("id,client_token,status,created_at").single();
      if (orderError || !order) {
        console.error("order insert", orderError);
        return fail("Не удалось отправить заказ. Попробуй ещё раз.", 500);
      }
      return reply({ ok: true, order });
    }

    if (action === "order_status") {
      const id = String(payload.order_id || ""), token = String(payload.client_token || "");
      if (!id || !token) return fail("Не хватает номера заказа.");
      const { data, error } = await db.from("orders")
        .select("id,status,created_at,accepted_at,completed_at")
        .eq("id", id).eq("client_token", token).maybeSingle();
      if (error) return fail("Не удалось проверить статус.", 500);
      if (!data) return fail("Заказ не найден.", 404);
      return reply({ ok: true, order: data });
    }

    if (action === "cancel_order") {
      const id = String(payload.order_id || ""), token = String(payload.client_token || "");
      if (!id || !token) return fail("Не хватает номера заказа.");
      const { data: current, error } = await db.from("orders")
        .select("id,status").eq("id", id).eq("client_token", token).maybeSingle();
      if (error || !current) return fail("Заказ не найден.", 404);
      if (current.status !== "new") return fail("Отменить можно только заказ, который водитель ещё не принял.");
      const { data, error: updateError } = await db.from("orders")
        .update({ status: "cancelled" }).eq("id", id)
        .select("id,status").single();
      if (updateError) return fail("Не удалось отменить заказ.", 500);
      return reply({ ok: true, order: data });
    }

    if (["driver_me", "driver_list", "driver_history", "driver_update", "driver_toggle_online", "driver_update_profile", "driver_logout"].includes(action)) {
      const session = await driverSession(db, payload);
      if (!session.driver) return fail(session.error || "Нужен вход в аккаунт.", session.status || 401);
      const driver = session.driver;

      if (action === "driver_me") return reply({ ok: true, driver });

      if (action === "driver_logout") {
        await db.from("drivers").update({ session_token_hash: null, session_expires_at: null }).eq("id", driver.id);
        return reply({ ok: true });
      }

      if (action === "driver_toggle_online") {
        if (typeof payload.is_online !== "boolean") return fail("Не указан статус водителя.");
        const { data, error } = await db.from("drivers")
          .update({ is_online: payload.is_online, updated_at: new Date().toISOString() })
          .eq("id", driver.id).select("is_online").single();
        if (error) return fail("Не удалось изменить статус.", 500);
        return reply({ ok: true, is_online: data.is_online });
      }

      if (action === "driver_update_profile") {
        const name = String(payload.name || "").trim().slice(0, 100);
        const carModel = String(payload.car_model || "").trim().slice(0, 100);
        const carPlate = String(payload.car_plate || "").trim().slice(0, 30);
        if (!name) return fail("Имя не может быть пустым.");
        const { data, error } = await db.from("drivers")
          .update({ name, car_model: carModel || null, car_plate: carPlate || null, updated_at: new Date().toISOString() })
          .eq("id", driver.id).select("id,public_code,name,phone,car_model,car_plate,is_online").single();
        if (error) return fail("Не удалось обновить профиль.", 500);
        return reply({ ok: true, driver: publicDriver(data) });
      }

      if (action === "driver_list") {
        const { data, error } = await db.from("orders")
          .select("id,client_id,pickup_address,pickup_lat,pickup_lng,destination_address,comment,status,created_at,accepted_at,completed_at,clients(name,phone)")
          .eq("driver_id", driver.id)
          .in("status", ["new", "accepted", "arrived", "started"])
          .order("created_at", { ascending: false });
        if (error) { console.error("driver list", error); return fail("Не удалось загрузить заказы.", 500); }
        return reply({ ok: true, orders: data || [], is_online: driver.is_online });
      }

      if (action === "driver_history") {
        const { data, error } = await db.from("orders")
          .select("id,client_id,pickup_address,destination_address,comment,status,created_at,accepted_at,completed_at,clients(name,phone)")
          .eq("driver_id", driver.id)
          .in("status", ["completed", "cancelled"])
          .order("created_at", { ascending: false }).limit(100);
        if (error) { console.error("driver history", error); return fail("Не удалось загрузить историю.", 500); }
        return reply({ ok: true, orders: data || [] });
      }

      const orderId = String(payload.order_id || ""), nextStatus = String(payload.status || "");
      const allowed = ["accepted", "arrived", "started", "completed", "cancelled"];
      if (!orderId || !allowed.includes(nextStatus)) return fail("Недопустимый статус заказа.");
      const { data: existing, error: findError } = await db.from("orders")
        .select("id,status").eq("id", orderId).eq("driver_id", driver.id).maybeSingle();
      if (findError || !existing) return fail("Заказ не найден.", 404);
      const transitions: Record<string, string[]> = {
        new: ["accepted", "cancelled"],
        accepted: ["arrived", "cancelled"],
        arrived: ["started", "cancelled"],
        started: ["completed"],
        completed: [],
        cancelled: [],
      };
      if (!(transitions[existing.status] || []).includes(nextStatus)) {
        return fail("Нельзя изменить статус с «" + existing.status + "» на «" + nextStatus + "».");
      }
      const patch: Record<string, unknown> = { status: nextStatus };
      if (nextStatus === "accepted") patch.accepted_at = new Date().toISOString();
      if (nextStatus === "completed") patch.completed_at = new Date().toISOString();
      const { data: updated, error: updateError } = await db.from("orders")
        .update(patch).eq("id", orderId).eq("driver_id", driver.id)
        .select("id,status,accepted_at,completed_at").single();
      if (updateError) return fail("Не удалось обновить заказ.", 500);
      return reply({ ok: true, order: updated });
    }
    return fail("Неизвестное действие.", 400);
  } catch (error) {
    console.error("moy-taxi-api", error);
    return fail("Внутренняя ошибка сервера.", 500);
  }
});
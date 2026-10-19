const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qyejqovxwniqlcsspmbc.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const API_URL = SUPABASE_URL + "/functions/v1/moy-taxi-api-feed";
export async function callApi(action, payload = {}) {
  if (!SUPABASE_ANON_KEY) throw new Error("Не настроен ключ приложения.");
  const controller = new AbortController();
  const timeoutMs = action === "calculate_route" ? 24000 : 35000;
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(API_URL, {
      method:"POST",
      headers:{"Content-Type":"application/json",apikey:SUPABASE_ANON_KEY,Authorization:"Bearer "+SUPABASE_ANON_KEY},
      body:JSON.stringify({action,...payload}),
      signal:controller.signal
    });
    const data = await response.json().catch(()=>({}));
    if (!response.ok || !data.ok) throw new Error(data.error || "Ошибка сервера.");
    return data;
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(action === "calculate_route"
        ? "Маршрут рассчитывается слишком долго. Проверь подключение и попробуй ещё раз."
        : "Сервер долго не отвечает. Проверь подключение и попробуй ещё раз.");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
export const statusLabel = (status) => ({new:"Новый заказ",accepted:"Водитель едет к вам",arrived:"Водитель на месте",client_ready:"Пассажир выходит",started:"Поездка началась",completed:"Поездка завершена",cancelled:"Отменён"}[status] || status);

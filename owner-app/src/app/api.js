const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qyejqovxwniqlcsspmbc.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const API_URL = SUPABASE_URL + "/functions/v1/moy-taxi-api";
export async function callApi(action, payload = {}) {
  if (!SUPABASE_ANON_KEY) throw new Error("Не настроен ключ приложения.");
  const response = await fetch(API_URL, {method:"POST",headers:{"Content-Type":"application/json",apikey:SUPABASE_ANON_KEY,Authorization:"Bearer "+SUPABASE_ANON_KEY},body:JSON.stringify({action,...payload})});
  const data = await response.json().catch(()=>({}));
  if (!response.ok || !data.ok) throw new Error(data.error || "Ошибка сервера.");
  return data;
}
export const statusLabel = (status) => ({new:"Новый заказ",accepted:"Водитель едет к вам",arrived:"Водитель на месте",client_ready:"Пассажир выходит",started:"Поездка началась",completed:"Поездка завершена",cancelled:"Отменён"}[status] || status);

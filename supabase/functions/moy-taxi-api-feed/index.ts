import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});
const fail=(message:string,status=400)=>reply({ok:false,error:message},status);

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST")return fail("Method not allowed",405);
  try{
    const body=await req.json();
    const action=String(body?.action||"");
    const supabaseUrl=String(Deno.env.get("SUPABASE_URL")||"").replace(/\/$/,"");
    const serviceRoleKey=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"");
    if(!supabaseUrl||!serviceRoleKey)return fail("Server configuration is incomplete",500);

    const auth=req.headers.get("authorization")||"";
    const apikey=req.headers.get("apikey")||"";
    const controller=new AbortController();
    const timeoutMs=action==="calculate_route"?22000:32000;
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    let upstream:Response;
    let data:any;
    try{
      upstream=await fetch(supabaseUrl+"/functions/v1/moy-taxi-api",{
        method:"POST",
        headers:{"Content-Type":"application/json",...(auth?{authorization:auth}:{}),...(apikey?{apikey}: {})},
        body:JSON.stringify(body),
        signal:controller.signal
      });
      data=await upstream.json().catch(()=>({ok:false,error:"Ошибка ответа сервера."}));
    }catch(error){
      if((error as any)?.name==="AbortError"){
        return fail(action==="calculate_route"?"Сервис маршрутов не ответил вовремя. Повтори расчёт через несколько секунд.":"Сервер долго не отвечает. Попробуй ещё раз.",504);
      }
      throw error;
    }finally{
      clearTimeout(timer);
    }
    if(action!=="driver_list"||!data?.ok)return reply(data,upstream.status);

    const driverId=String(body?.driver_id||"");
    if(!driverId)return reply(data,upstream.status);

    const db=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:offers,error:offersError}=await db.from("order_offers")
      .select("order_id,status,price,created_at,updated_at")
      .eq("driver_id",driverId)
      .in("status",["pending","declined"])
      .order("created_at",{ascending:false})
      .limit(1000);
    if(offersError)return reply(data,upstream.status);

    const offerRows=offers||[];
    const offeredIds=[...new Set(offerRows.map((x:any)=>String(x.order_id)).filter(Boolean))];
    if(!offeredIds.length)return reply(data,upstream.status);

    const existing=new Set((Array.isArray(data.orders)?data.orders:[]).map((o:any)=>String(o.id)));
    const missingIds=offeredIds.filter(id=>!existing.has(id));
    if(!missingIds.length)return reply(data,upstream.status);

    const {data:orders,error:ordersError}=await db.from("orders")
      .select("*,clients(name,phone)")
      .in("id",missingIds)
      .eq("status","new")
      .is("driver_id",null);
    if(ordersError||!orders?.length)return reply(data,upstream.status);

    const merged=[...(data.orders||[])];
    for(const order of orders){
      const id=String(order.id);
      if(existing.has(id))continue;
      const offer=offerRows.find((x:any)=>String(x.order_id)===id)||null;
      merged.push({...order,my_offer:offer,distance_km:null,driver_lat:null,driver_lng:null,driver_location_updated_at:null});
    }
    merged.sort((a:any,b:any)=>Date.parse(b?.created_at||"")-Date.parse(a?.created_at||""));
    return reply({...data,orders:merged},upstream.status);
  }catch(e){
    return fail(e instanceof Error?e.message:"Внутренняя ошибка сервера.",500);
  }
});

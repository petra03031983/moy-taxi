"use client";

export default function StartPage() {
  return (
    <main style={{minHeight:"100dvh",background:"#f4f7f5",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",boxSizing:"border-box",fontFamily:"Arial,sans-serif"}}>
      <section style={{width:"100%",maxWidth:520,background:"#fff",borderRadius:28,padding:"30px 24px",boxSizing:"border-box",boxShadow:"0 12px 40px rgba(0,0,0,.10)"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:58,lineHeight:1,marginBottom:12}}>🚕</div>
          <div style={{fontSize:18,fontWeight:800,color:"#16865a",letterSpacing:.5}}>МОЙ ТАКСИ</div>
          <h1 style={{fontSize:"clamp(28px,7vw,38px)",lineHeight:1.15,margin:"12px 0 10px",color:"#17221d"}}>Добро пожаловать</h1>
          <p style={{margin:"0 auto 28px",maxWidth:430,fontSize:17,lineHeight:1.45,color:"#68736d"}}>Выберите, как вы хотите пользоваться приложением.</p>
        </div>

        <div style={{display:"grid",gap:14}}>
          <a href="/passenger" style={{textDecoration:"none",display:"flex",alignItems:"center",gap:16,padding:"20px 18px",borderRadius:20,background:"#dfffbd",color:"#173019",border:"1px solid #c7ef9d",boxSizing:"border-box"}}>
            <span style={{fontSize:36}}>🧍</span>
            <span style={{flex:1}}><b style={{display:"block",fontSize:21}}>Стать пассажиром</b><small style={{display:"block",marginTop:5,fontSize:14,color:"#58705d"}}>Заказать поездку и указать адрес</small></span>
            <span style={{fontSize:30}}>›</span>
          </a>

          <a href="/?role=driver" style={{textDecoration:"none",display:"flex",alignItems:"center",gap:16,padding:"20px 18px",borderRadius:20,background:"#eef2f0",color:"#17221d",border:"1px solid #dce3df",boxSizing:"border-box"}}>
            <span style={{fontSize:36}}>🚘</span>
            <span style={{flex:1}}><b style={{display:"block",fontSize:21}}>Стать водителем</b><small style={{display:"block",marginTop:5,fontSize:14,color:"#68736d"}}>Войти, зарегистрироваться и выйти на линию</small></span>
            <span style={{fontSize:30}}>›</span>
          </a>
        </div>

        <p style={{textAlign:"center",margin:"24px 0 0",fontSize:13,color:"#8a938e"}}>Одна платформа — пассажир и водитель в одном приложении.</p>
      </section>
    </main>
  );
}

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>KCCS 실제기준 + 자동모델 관리</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#071225;color:#edf4ff;font-family:Inter,Pretendard,Arial,sans-serif}
.wrap{width:min(1020px,calc(100% - 32px));margin:30px auto}
.card{background:#0c1b34;border:1px solid #294364;border-radius:16px;padding:22px;margin-bottom:14px}
h1{margin:0 0 8px;font-size:25px}h2{font-size:18px;margin:0 0 12px}
p{color:#a9b7cc;line-height:1.6}
label{display:block;font-weight:800;margin-bottom:7px}
input,select{width:100%;min-height:46px;border:1px solid #3c5475;border-radius:10px;background:#071225;color:#fff;padding:0 12px;font-size:15px}
button{min-height:46px;border-radius:10px;padding:0 18px;font-weight:900;font-size:15px;cursor:pointer;margin:4px}
button:disabled{opacity:.45}
.actual{background:#5eead4;border:1px solid #2dd4bf;color:#062a28}
.safe{background:#fbbf24;border:1px solid #f59e0b;color:#20242c}
.live{background:#ff6b6b;border:1px solid #ff8787;color:#111827}
.status{padding:13px;border-radius:10px;background:#071225;border:1px solid #294364}
.ok{color:#38d9c5}.bad{color:#ff6b6b}.wait{color:#fbbf24}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:14px}
.metric{padding:14px;border:1px solid #294364;border-radius:12px;background:#071225}
.name{font-size:13px;color:#a9b7cc}.value{font-size:22px;font-weight:900;margin-top:6px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:450px;overflow:auto;background:#06101f;border:1px solid #243a59;border-radius:10px;padding:12px}
.note{font-size:13px;color:#f6c453}
.goodnote{font-size:13px;color:#5eead4}
</style>
</head>
<body><div class="wrap">

<div class="card">
<h1>KCCS 실제 확정 기준 + 자동모델</h1>
<p><strong>2026-08-11은 실제 KCCS 확정 신호를 기준값으로 등록</strong>하고,
자동 모델은 <strong>2026-08-12부터</strong> 시작합니다.</p>
<p class="goodnote">같은 날짜에 실제 확정 신호가 있으면 자동 알고리즘보다 항상 우선합니다.</p>
</div>

<div class="card">
<label for="secret">KCCS_CRON_SECRET</label>
<input id="secret" type="password" placeholder="Vercel 비밀키"/>
</div>

<div class="card">
<h2>① 오늘 실제 KCCS 확정값 등록</h2>
<p>오늘 실제 신호가 LONG이었다면 아래 기본값 그대로 사용하면 됩니다.</p>

<div class="grid">
<div>
<label for="direction">실제 방향</label>
<select id="direction">
<option value="LONG" selected>LONG</option>
<option value="SHORT">SHORT</option>
<option value="WAIT">WAIT</option>
</select>
</div>
<div>
<label for="leverage">레버리지</label>
<select id="leverage">
<option value="1">1x</option>
<option value="2" selected>2x</option>
<option value="3">3x</option>
</select>
</div>
<div>
<label for="allocation">투자비중</label>
<input id="allocation" type="number" min="0" max="100" value="100"/>
</div>
<div>
<label for="cost">예상비용 (%)</label>
<input id="cost" type="number" min="0" step="0.01" value="0.10"/>
</div>
</div>

<div style="margin-top:14px">
<button class="actual" id="saveActual">오늘 실제 LONG 2x 기준 저장 + 원장 확정</button>
</div>
<p class="note">이 버튼은 실제 kccs_model_signals와 kccs_daily_reports에 저장합니다. Yahoo 거래일을 자동 확인하고 그 날짜에 저장합니다.</p>
</div>

<div class="card">
<h2>② 자동모델 확인</h2>
<button class="safe" id="safe">자동모델 안전 테스트 · 저장 없음</button>
<button class="live" id="live">자동모델 실제 실행</button>
<p class="note">8/12부터 자동모델 실제 실행을 사용합니다. 8/11은 위의 실제 확정값이 우선입니다.</p>
</div>

<div class="card">
<h2>상태</h2>
<div id="status" class="status">대기</div>
<div id="metrics"></div>
</div>

<div class="card">
<h2>상세 결과</h2>
<pre id="result">아직 실행하지 않았습니다.</pre>
</div>

</div>
<script>
const $=(id)=>document.getElementById(id);

function pct(v){
 const n=Number(v||0);
 return(n>=0?"+":"")+n.toFixed(2)+"%";
}

async function post(url,secret,body){
 const res=await fetch(url,{
  method:"POST",
  headers:{
   "Content-Type":"application/json",
   "x-kccs-cron-secret":secret
  },
  body:JSON.stringify(body)
 });
 const raw=await res.text();
 let data;
 try{data=JSON.parse(raw)}catch{data={raw}}
 if(!res.ok){
   throw Object.assign(new Error("HTTP "+res.status),{response:data});
 }
 return data;
}

function setMetrics(m,d,p){
 $("metrics").innerHTML=
 '<div class="grid">'+
 '<div class="metric"><div class="name">삼성전자</div><div class="value">'+pct(m&&m.samsungReturn)+'</div></div>'+
 '<div class="metric"><div class="name">SK하이닉스</div><div class="value">'+pct(m&&m.skHynixReturn)+'</div></div>'+
 '<div class="metric"><div class="name">기초변동률</div><div class="value">'+pct(m&&m.underlyingReturn)+'</div></div>'+
 '<div class="metric"><div class="name">판단 상태</div><div class="value">'+String((d&&d.decisionState)||"-")+'</div></div>'+
 '<div class="metric"><div class="name">실제 포지션</div><div class="value">'+String((d&&d.direction)||"-")+'</div></div>'+
 '<div class="metric"><div class="name">레버리지</div><div class="value">'+Number((d&&d.leverage)||0).toFixed(0)+'x</div></div>'+
 '<div class="metric"><div class="name">당일 순수익률</div><div class="value">'+pct(p&&p.daily_return)+'</div></div>'+
 '<div class="metric"><div class="name">누적수익률</div><div class="value">'+pct(p&&p.cumulative_return)+'</div></div>'+
 '</div>';
}

$("direction").addEventListener("change",()=>{
 const isWait=$("direction").value==="WAIT";
 if(isWait){
   $("leverage").value="1";
   $("allocation").value="0";
   $("cost").value="0";
 }else if(Number($("allocation").value)===0){
   $("leverage").value="2";
   $("allocation").value="100";
   $("cost").value="0.10";
 }
});

$("saveActual").addEventListener("click",async()=>{
 const secret=$("secret").value.trim();
 if(!secret){alert("비밀키를 입력하세요.");return}

 const direction=$("direction").value;
 const leverage=direction==="WAIT"?0:Number($("leverage").value);
 const allocation=direction==="WAIT"?0:Number($("allocation").value);
 const estimatedCost=direction==="WAIT"?0:Number($("cost").value);

 const yes=confirm(
   "오늘 실제 KCCS 확정값을 "+direction+" / "+leverage+"x 로 저장하고 실제 원장까지 확정합니다. 진행할까요?"
 );
 if(!yes)return;

 $("saveActual").disabled=true;
 $("safe").disabled=true;
 $("live").disabled=true;
 $("status").className="status wait";
 $("status").textContent="Yahoo 거래일 확인 중...";
 $("result").textContent="처리 중...";
 $("metrics").innerHTML="";

 try{
   const market=await post("/api/kccs/market-yahoo-v1",secret,{});
   const tradeDate=market.tradeDate;

   $("status").textContent="실제 KCCS 확정 신호 저장 중...";

   const signal=await post("/api/kccs/signal-v3",secret,{
     action:"UPSERT",
     date:tradeDate,
     direction,
     leverage,
     allocation,
     estimatedCost,
     status:"CONFIRMED",
     modelVersion:"kccs-actual-confirmed-v1",
     source:"KCCS ACTUAL CONFIRMED"
   });

   $("status").textContent="실제 원장 계산 및 저장 중...";

   const finalized=await post("/api/kccs/finalize-v4",secret,{
     date:tradeDate,
     dryRun:false
   });

   if(finalized.status!=="CONFIRMED" && finalized.status!=="SKIPPED"){
     throw Object.assign(new Error("원장 확정 응답 확인 필요"),{response:finalized});
   }

   $("status").className="status ok";
   $("status").textContent=
     finalized.status==="CONFIRMED"
       ?"오늘 실제 KCCS 기준 저장 완료 · 이 값이 자동모델보다 우선됩니다."
       :"이미 보호된 실제 확정 원장이 존재합니다.";

   const calc=finalized.calculation||{};
   const report=finalized.report||{};
   setMetrics(
     {
       samsungReturn:calc.samsungReturn,
       skHynixReturn:calc.skHynixReturn,
       underlyingReturn:calc.underlyingReturn
     },
     {
       decisionState:direction,
       direction,
       leverage
     },
     report
   );

   $("result").textContent=JSON.stringify({
     tradeDate,
     actualSignal:signal,
     finalized
   },null,2);

 }catch(e){
   $("status").className="status bad";
   $("status").textContent="실제 기준 저장 실패";
   $("result").textContent=JSON.stringify({
     message:e&&e.message?e.message:String(e),
     response:e&&e.response?e.response:null
   },null,2);
 }finally{
   $("saveActual").disabled=false;
   $("safe").disabled=false;
   $("live").disabled=false;
 }
});

async function runAuto(dryRun){
 const secret=$("secret").value.trim();
 if(!secret){alert("비밀키를 입력하세요.");return}

 if(!dryRun){
   const yes=confirm("자동 모델 판단 결과를 실제 원장에 저장합니다. 진행할까요?");
   if(!yes)return;
 }

 $("saveActual").disabled=true;
 $("safe").disabled=true;
 $("live").disabled=true;
 $("status").className="status wait";
 $("status").textContent=dryRun?"자동모델 안전 계산 중...":"자동모델 실제 실행 중...";
 $("metrics").innerHTML="";
 $("result").textContent="처리 중...";

 try{
   const data=await post("/api/kccs/auto-close-v1",secret,{dryRun});

   $("result").textContent=JSON.stringify(data,null,2);

   if(data.status==="WAITING"||data.status==="SKIPPED"){
     $("status").className="status wait";
     $("status").textContent="실행 보류 · "+(data.reason||data.status);
     return;
   }

   const model=data.model||{};
   const d=model.decision||{};
   const m=model.market||{};
   const p=dryRun
     ?(data.reportPreview||{})
     :((data.finalized&&data.finalized.report)||{});

   setMetrics(m,d,p);

   $("status").className="status ok";
   $("status").textContent=dryRun
     ?"자동모델 안전 테스트 성공 · DB 저장 없음"
     :"자동모델 실제 확정 성공";

 }catch(e){
   $("status").className="status bad";
   $("status").textContent="자동모델 실행 실패";
   $("result").textContent=JSON.stringify({
     message:e&&e.message?e.message:String(e),
     response:e&&e.response?e.response:null
   },null,2);
 }finally{
   $("saveActual").disabled=false;
   $("safe").disabled=false;
   $("live").disabled=false;
 }
}

$("safe").addEventListener("click",()=>runAuto(true));
$("live").addEventListener("click",()=>runAuto(false));
</script>
</body>
</html>`;

export default {
  async fetch(request: Request) {
    if (request.method !== "GET") {
      return Response.json(
        { error: "METHOD_NOT_ALLOWED" },
        { status: 405, headers: { Allow: "GET" } }
      );
    }

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0"
      }
    });
  }
};

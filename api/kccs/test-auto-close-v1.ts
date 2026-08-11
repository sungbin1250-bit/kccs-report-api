const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>KCCS 자동모델 최종 테스트</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#071225;color:#edf4ff;font-family:Inter,Pretendard,Arial,sans-serif}
.wrap{width:min(980px,calc(100% - 32px));margin:30px auto}.card{background:#0c1b34;border:1px solid #294364;border-radius:16px;padding:22px;margin-bottom:14px}
h1{margin:0 0 8px;font-size:25px}h2{font-size:18px}p{color:#a9b7cc;line-height:1.6}
input{width:100%;min-height:46px;border:1px solid #3c5475;border-radius:10px;background:#071225;color:#fff;padding:0 12px;font-size:15px}
button{min-height:46px;border-radius:10px;padding:0 18px;font-weight:900;font-size:15px;cursor:pointer}
.safe{background:#fbbf24;border:1px solid #f59e0b;color:#20242c}.live{background:#ff6b6b;border:1px solid #ff8787;color:#111827;margin-left:8px}
button:disabled{opacity:.45}.status{padding:13px;border-radius:10px;background:#071225;border:1px solid #294364}
.ok{color:#38d9c5}.bad{color:#ff6b6b}.wait{color:#fbbf24}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:14px}
.metric{padding:14px;border:1px solid #294364;border-radius:12px;background:#071225}.name{font-size:13px;color:#a9b7cc}.value{font-size:22px;font-weight:900;margin-top:6px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:430px;overflow:auto;background:#06101f;border:1px solid #243a59;border-radius:10px;padding:12px}
.warn{color:#f6c453;font-size:13px}
</style>
</head>
<body><div class="wrap">
<div class="card"><h1>KCCS 자동모델 최종 테스트</h1>
<p>Yahoo 종가 → 50:50 기초변동률 → ±0.30% 진입 → 2거래일 확인 → ±0.10% 유지/전환 → LONG/SHORT 2x → 비용 0.10% → 누적수익률까지 한 번에 확인합니다.</p>
<p class="warn">먼저 노란색 안전 테스트를 실행하세요. 안전 테스트는 signal/report DB를 변경하지 않습니다.</p></div>
<div class="card">
<label style="display:block;font-weight:800;margin-bottom:8px">KCCS_CRON_SECRET</label>
<input id="secret" type="password" placeholder="Vercel 비밀키"/>
<div style="margin-top:14px">
<button class="safe" id="safe">안전 테스트 · 저장 없음</button>
<button class="live" id="live">오늘 자동 확정 · 실제 원장 저장</button>
</div>
</div>
<div class="card"><h2>상태</h2><div id="status" class="status">대기</div><div id="metrics"></div></div>
<div class="card"><h2>상세 결과</h2><pre id="result">아직 실행하지 않았습니다.</pre></div>
</div>
<script>
const $=(id)=>document.getElementById(id);
function pct(v){const n=Number(v||0);return(n>=0?"+":"")+n.toFixed(2)+"%"}
async function run(dryRun){
 const secret=$("secret").value.trim();if(!secret){alert("비밀키를 입력하세요.");return}
 if(!dryRun){
   const yes=confirm("실제 kccs_model_signals와 kccs_daily_reports에 오늘 확정값을 저장합니다. 안전 테스트 결과를 확인했습니까?");
   if(!yes)return;
 }
 $("safe").disabled=true;$("live").disabled=true;
 $("status").className="status wait";$("status").textContent=dryRun?"자동모델 안전 계산 중...":"오늘 자동 확정 저장 중...";
 $("metrics").innerHTML="";$("result").textContent="처리 중...";
 try{
  const res=await fetch("/api/kccs/auto-close-v1",{method:"POST",headers:{"Content-Type":"application/json","x-kccs-cron-secret":secret},body:JSON.stringify({dryRun})});
  const raw=await res.text();let data;try{data=JSON.parse(raw)}catch{data={raw}}
  $("result").textContent=JSON.stringify(data,null,2);
  if(!res.ok)throw new Error("HTTP "+res.status);
  if(data.status==="SKIPPED"||data.status==="WAITING"){
    $("status").className="status wait";$("status").textContent="실행 보류 · "+(data.reason||data.status);return;
  }
  const model=data.model||{};
  const d=model.decision||{};
  const m=model.market||{};
  const p=dryRun?(data.reportPreview||{}):((data.finalized&&data.finalized.report)||{});
  $("metrics").innerHTML=
   '<div class="grid">'+
   '<div class="metric"><div class="name">삼성전자</div><div class="value">'+pct(m.samsungReturn)+'</div></div>'+
   '<div class="metric"><div class="name">SK하이닉스</div><div class="value">'+pct(m.skHynixReturn)+'</div></div>'+
   '<div class="metric"><div class="name">기초변동률</div><div class="value">'+pct(m.underlyingReturn)+'</div></div>'+
   '<div class="metric"><div class="name">자동 판단 상태</div><div class="value">'+String(d.decisionState||"-")+'</div></div>'+
   '<div class="metric"><div class="name">실제 포지션</div><div class="value">'+String(d.direction||"-")+'</div></div>'+
   '<div class="metric"><div class="name">레버리지</div><div class="value">'+Number(d.leverage||0).toFixed(0)+'x</div></div>'+
   '<div class="metric"><div class="name">당일 순수익률</div><div class="value">'+pct(p.daily_return)+'</div></div>'+
   '<div class="metric"><div class="name">누적수익률</div><div class="value">'+pct(p.cumulative_return)+'</div></div>'+
   '</div>';
  $("status").className="status ok";
  $("status").textContent=dryRun?"전체 안전 테스트 성공 · DB 저장 없음":"오늘 자동 확정 성공 · 원장 저장 완료";
 }catch(e){
  $("status").className="status bad";$("status").textContent="실행 실패";
 }finally{$("safe").disabled=false;$("live").disabled=false}
}
$("safe").addEventListener("click",()=>run(true));
$("live").addEventListener("click",()=>run(false));
</script></body></html>`;

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

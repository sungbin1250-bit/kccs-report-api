const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>KCCS Yahoo 종가 연결 테스트</title>
<style>
*{box-sizing:border-box} body{margin:0;background:#071225;color:#eaf1ff;font-family:Inter,Pretendard,Arial,sans-serif}
.wrap{width:min(920px,calc(100% - 32px));margin:36px auto}.card{background:#0c1b34;border:1px solid #294364;border-radius:16px;padding:22px;margin-bottom:14px}
h1{margin:0 0 8px;font-size:25px} h2{margin:0 0 10px;font-size:18px} p{color:#a9b7cc;line-height:1.6}
label{display:block;font-weight:800;margin-bottom:8px} input{width:100%;min-height:46px;border:1px solid #3c5475;border-radius:10px;background:#071225;color:#fff;padding:0 12px;font-size:15px}
button{min-height:46px;border-radius:10px;border:1px solid #f59e0b;background:#fbbf24;color:#20242c;font-weight:900;padding:0 18px;cursor:pointer;font-size:15px}
button:disabled{opacity:.45;cursor:not-allowed}.status{padding:12px;border-radius:10px;background:#071225;border:1px solid #294364;margin-top:10px}
.ok{color:#38d9c5}.bad{color:#ff5a6f}.wait{color:#fbbf24}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#06101f;border:1px solid #243a59;border-radius:10px;padding:12px;color:#d9e3f0;max-height:440px;overflow:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:12px}.metric{border:1px solid #294364;border-radius:12px;padding:14px;background:#071225}.big{font-size:23px;font-weight:900;margin-top:6px}
</style>
</head>
<body><div class="wrap">
<div class="card"><h1>KCCS Yahoo 종가 연결 테스트</h1><p>삼성전자 005930.KS와 SK하이닉스 000660.KS의 최근 두 거래일 종가를 읽어 당일 등락률과 50:50 기초수익률을 계산합니다. <strong>Supabase 원장에는 아무것도 저장하지 않습니다.</strong></p></div>
<div class="card"><label for="secret">KCCS_CRON_SECRET</label><input id="secret" type="password" placeholder="Vercel에 설정한 비밀키 입력" /><div style="margin-top:14px"><button id="run">Yahoo 종가 연결 테스트</button></div></div>
<div class="card"><h2>상태</h2><div id="status" class="status">대기</div><div id="summary"></div></div>
<div class="card"><h2>원본 결과</h2><pre id="result">아직 실행하지 않았습니다.</pre></div>
</div>
<script>
const $=(id)=>document.getElementById(id);
function pct(v){return (v>=0?"+":"")+Number(v).toFixed(2)+"%"}
$("run").addEventListener("click",async()=>{
 const secret=$("secret").value.trim(); if(!secret){alert("비밀키를 입력하세요.");return}
 $("run").disabled=true;$("status").className="status wait";$("status").textContent="Yahoo 종가 확인 중...";$("summary").innerHTML="";$("result").textContent="조회 중...";
 try{
  const res=await fetch("/api/kccs/market-yahoo-v1",{method:"POST",headers:{"Content-Type":"application/json","x-kccs-cron-secret":secret},body:JSON.stringify({})});
  const raw=await res.text(); let data; try{data=JSON.parse(raw)}catch{data={raw}}
  $("result").textContent=JSON.stringify(data,null,2);
  if(!res.ok){
    if(data && data.status==="WAITING"){
      $("status").className="status wait";$("status").textContent="Yahoo에 오늘 종가가 아직 반영되지 않았습니다. 잠시 뒤 다시 실행하세요.";
    }else{
      throw Object.assign(new Error("HTTP "+res.status),{data});
    }
    return;
  }
  const s=data.stocks["005930"], h=data.stocks["000660"];
  $("status").className="status ok";$("status").textContent="Yahoo 종가 연결 성공 · 거래일 "+data.tradeDate;
  $("summary").innerHTML=
    '<div class="grid">'+
    '<div class="metric">삼성전자<div class="big">'+pct(s.changeRate)+'</div><div>종가 '+Number(s.close).toLocaleString()+'원</div></div>'+
    '<div class="metric">SK하이닉스<div class="big">'+pct(h.changeRate)+'</div><div>종가 '+Number(h.close).toLocaleString()+'원</div></div>'+
    '<div class="metric">KCCS 기초수익률<div class="big">'+pct(data.underlyingReturn)+'</div><div>두 종목 50:50 평균</div></div>'+
    '</div>';
 }catch(e){
  $("status").className="status bad";$("status").textContent="테스트 실패";
  $("result").textContent=JSON.stringify({message:e.message,response:e.data||null},null,2);
 }finally{$("run").disabled=false}
});
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

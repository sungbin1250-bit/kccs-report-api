const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>KCCS 레버리지 계산 안전 테스트</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#071225;color:#eaf1ff;font-family:Inter,Pretendard,Arial,sans-serif}
.wrap{width:min(960px,calc(100% - 32px));margin:32px auto}
.card{background:#0c1b34;border:1px solid #294364;border-radius:16px;padding:22px;margin-bottom:14px}
h1{margin:0 0 8px;font-size:25px} h2{margin:0 0 12px;font-size:18px}
p{color:#a9b7cc;line-height:1.6}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
label{display:block;font-weight:800;margin-bottom:7px}
input,select{width:100%;min-height:46px;border:1px solid #3c5475;border-radius:10px;background:#071225;color:#fff;padding:0 12px;font-size:15px}
button{min-height:46px;border-radius:10px;border:1px solid #f59e0b;background:#fbbf24;color:#20242c;font-weight:900;padding:0 18px;cursor:pointer;font-size:15px}
button:disabled{opacity:.45;cursor:not-allowed}
.status{padding:12px;border-radius:10px;background:#071225;border:1px solid #294364}
.ok{color:#38d9c5}.bad{color:#ff5a6f}.wait{color:#fbbf24}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-top:14px}
.metric{border:1px solid #294364;border-radius:12px;padding:14px;background:#071225}
.metric .name{color:#a9b7cc;font-size:13px}.metric .value{font-size:23px;font-weight:900;margin-top:6px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#06101f;border:1px solid #243a59;border-radius:10px;padding:12px;color:#d9e3f0;max-height:420px;overflow:auto}
.note{font-size:13px;color:#f6c453}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>KCCS 레버리지 계산 안전 테스트</h1>
    <p>Yahoo에서 삼성전자·SK하이닉스 종가를 읽고, 아래에서 선택한 임시 KCCS 모델 신호를 적용해
    <strong>기초수익률 → 방향 → 레버리지 → 비중 → 비용 → 당일 순수익률</strong>까지 계산합니다.</p>
    <p class="note">실제 kccs_daily_reports 원장에는 저장하지 않습니다. 테스트 신호도 종료 후 자동 삭제합니다.</p>
  </div>

  <div class="card">
    <label for="secret">KCCS_CRON_SECRET</label>
    <input id="secret" type="password" placeholder="Vercel에 설정한 비밀키" />

    <div class="grid" style="margin-top:14px">
      <div>
        <label for="direction">테스트 방향</label>
        <select id="direction">
          <option value="LONG">LONG</option>
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
        <label for="allocation">투자비중 (%)</label>
        <input id="allocation" type="number" min="0" max="100" step="1" value="100" />
      </div>
      <div>
        <label for="cost">예상비용 (%)</label>
        <input id="cost" type="number" min="0" max="10" step="0.01" value="0.10" />
      </div>
    </div>

    <div style="margin-top:14px">
      <button id="run">레버리지 계산 안전 테스트</button>
    </div>
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
const $ = (id) => document.getElementById(id);

function pct(v) {
  const n = Number(v || 0);
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

async function post(url, secret, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kccs-cron-secret": secret
    },
    body: JSON.stringify(body)
  });

  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { raw }; }

  if (!res.ok) {
    throw Object.assign(new Error("HTTP " + res.status), {
      response: data
    });
  }

  return data;
}

$("direction").addEventListener("change", () => {
  const wait = $("direction").value === "WAIT";
  if (wait) {
    $("leverage").value = "1";
    $("allocation").value = "0";
  } else if (Number($("allocation").value) === 0) {
    $("allocation").value = "100";
  }
});

$("run").addEventListener("click", async () => {
  const secret = $("secret").value.trim();
  if (!secret) {
    alert("KCCS_CRON_SECRET을 입력하세요.");
    return;
  }

  const direction = $("direction").value;
  const leverage = direction === "WAIT" ? 0 : Number($("leverage").value);
  const allocation = direction === "WAIT" ? 0 : Number($("allocation").value);
  const estimatedCost = direction === "WAIT" ? 0 : Number($("cost").value);

  $("run").disabled = true;
  $("status").className = "status wait";
  $("status").textContent = "1/4 Yahoo 종가 확인 중...";
  $("metrics").innerHTML = "";
  $("result").textContent = "테스트 진행 중...";

  const log = [];
  let testDate = null;
  let createdSignal = false;

  try {
    // 1. Latest Yahoo market date
    const market = await post("/api/kccs/market-yahoo-v1", secret, {});
    log.push({ step: "market", response: market });

    if (!market.ok || market.status !== "READY") {
      throw Object.assign(new Error("Yahoo 종가가 아직 준비되지 않았습니다."), {
        response: market
      });
    }

    testDate = market.tradeDate;

    // 2. Temporary confirmed model signal
    $("status").textContent = "2/4 임시 확정 모델 신호 생성 중...";

    const signal = await post("/api/kccs/signal-v3", secret, {
      action: "UPSERT",
      date: testDate,
      direction,
      leverage,
      allocation,
      estimatedCost,
      status: "CONFIRMED",
      modelVersion: "backend-yahoo-leverage-safe-test-v1",
      source: "BACKEND_TEST"
    });
    createdSignal = true;
    log.push({ step: "signal", response: signal });

    // 3. Dry-run finalize using Yahoo - NO ledger write
    $("status").textContent = "3/4 KCCS 레버리지 계산 Dry Run 중...";

    const final = await post("/api/kccs/finalize-v4", secret, {
      date: testDate,
      dryRun: true
    });
    log.push({ step: "finalize", response: final });

    if (final.status !== "DRY_RUN_OK") {
      throw Object.assign(new Error("DRY_RUN_OK 응답이 아닙니다."), {
        response: final
      });
    }

    const c = final.calculation || {};
    const preview = final.reportPreview || {};

    $("metrics").innerHTML =
      '<div class="metrics">' +
        '<div class="metric"><div class="name">거래일</div><div class="value">' + testDate + '</div></div>' +
        '<div class="metric"><div class="name">삼성전자</div><div class="value">' + pct(c.samsungReturn) + '</div></div>' +
        '<div class="metric"><div class="name">SK하이닉스</div><div class="value">' + pct(c.skHynixReturn) + '</div></div>' +
        '<div class="metric"><div class="name">KCCS 기초수익률</div><div class="value">' + pct(c.underlyingReturn) + '</div></div>' +
        '<div class="metric"><div class="name">모델 방향</div><div class="value">' + String(c.direction) + '</div></div>' +
        '<div class="metric"><div class="name">레버리지</div><div class="value">' + Number(c.leverage).toFixed(0) + 'x</div></div>' +
        '<div class="metric"><div class="name">총수익률</div><div class="value">' + pct(c.grossReturn) + '</div></div>' +
        '<div class="metric"><div class="name">예상비용</div><div class="value">-' + Number(c.estimatedCost || 0).toFixed(2) + '%</div></div>' +
        '<div class="metric"><div class="name">당일 순수익률</div><div class="value">' + pct(c.dailyReturn) + '</div></div>' +
        '<div class="metric"><div class="name">누적수익률 미리보기</div><div class="value">' + pct(c.cumulativeReturn) + '</div></div>' +
      '</div>';

    $("status").className = "status ok";
    $("status").textContent =
      "계산 성공 · 실제 원장 저장 없음 · 테스트 신호 정리 중...";

    // 4. Cleanup temporary signal
    const cleanup = await post("/api/kccs/signal-v3", secret, {
      action: "DELETE_TEST",
      date: testDate
    });
    log.push({ step: "cleanup", response: cleanup });
    createdSignal = false;

    if (cleanup.status !== "TEST_SIGNAL_DELETED") {
      throw Object.assign(new Error("테스트 신호 자동 삭제 확인 실패"), {
        response: cleanup
      });
    }

    $("status").className = "status ok";
    $("status").textContent =
      "전체 성공 · Yahoo 종가 + 모델 방향 + 레버리지 계산 확인 · 원장 저장 없음 · 테스트 신호 삭제 완료";

    $("result").textContent = JSON.stringify({
      market: {
        tradeDate: market.tradeDate,
        samsung: market.stocks && market.stocks["005930"],
        skHynix: market.stocks && market.stocks["000660"],
        underlyingReturn: market.underlyingReturn
      },
      selectedModel: {
        direction,
        leverage,
        allocation,
        estimatedCost
      },
      calculation: final.calculation,
      reportPreview: preview,
      cleanup: cleanup
    }, null, 2);

  } catch (e) {
    $("status").className = "status bad";
    $("status").textContent = "테스트 실패";

    // Best-effort cleanup if a BACKEND_TEST signal was created.
    if (createdSignal && testDate) {
      try {
        const cleanup = await post("/api/kccs/signal-v3", secret, {
          action: "DELETE_TEST",
          date: testDate
        });
        log.push({ step: "cleanup-after-error", response: cleanup });
        createdSignal = false;
      } catch (cleanupError) {
        log.push({
          step: "cleanup-after-error-failed",
          response: cleanupError && cleanupError.response
            ? cleanupError.response
            : String(cleanupError)
        });
      }
    }

    $("result").textContent = JSON.stringify({
      message: e && e.message ? e.message : String(e),
      response: e && e.response ? e.response : null,
      log
    }, null, 2);
  } finally {
    $("run").disabled = false;
  }
});
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

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>KCCS Backend Safe Test</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Inter, Pretendard, Arial, sans-serif;
    background: #071225;
    color: #eaf1ff;
  }
  .wrap {
    width: min(920px, calc(100% - 32px));
    margin: 36px auto;
  }
  .card {
    background: #0c1b34;
    border: 1px solid #294364;
    border-radius: 16px;
    padding: 22px;
    margin-bottom: 14px;
  }
  h1 { margin: 0 0 8px; font-size: 25px; }
  h2 { margin: 0 0 10px; font-size: 18px; }
  p { color: #a9b7cc; line-height: 1.6; }
  .safe {
    color: #38d9c5;
    font-weight: 800;
  }
  label {
    display: block;
    font-weight: 800;
    margin-bottom: 8px;
  }
  input {
    width: 100%;
    min-height: 46px;
    border: 1px solid #3c5475;
    border-radius: 10px;
    background: #071225;
    color: #fff;
    padding: 0 12px;
    font-size: 15px;
  }
  button {
    min-height: 46px;
    border-radius: 10px;
    border: 1px solid #f59e0b;
    background: #fbbf24;
    color: #20242c;
    font-weight: 900;
    padding: 0 18px;
    cursor: pointer;
    font-size: 15px;
  }
  button:disabled { opacity: .45; cursor: not-allowed; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
  .status {
    padding: 10px 12px;
    border-radius: 10px;
    background: #071225;
    border: 1px solid #294364;
    margin-top: 8px;
  }
  .ok { color: #38d9c5; }
  .bad { color: #ff5a6f; }
  .wait { color: #fbbf24; }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: #06101f;
    border: 1px solid #243a59;
    border-radius: 10px;
    padding: 12px;
    color: #d9e3f0;
    max-height: 420px;
    overflow: auto;
  }
  .small { font-size: 13px; color: #91a4bf; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>KCCS 백엔드 안전 테스트</h1>
    <p>
      이 페이지는 Vercel → Supabase → KCCS 계산 연결을 확인합니다.
      <span class="safe">실제 kccs_daily_reports에는 저장하지 않습니다.</span>
    </p>
  </div>

  <div class="card">
    <label for="secret">KCCS_CRON_SECRET</label>
    <input id="secret" type="password" autocomplete="off"
      placeholder="Vercel에 설정한 KCCS_CRON_SECRET 값을 입력" />
    <div class="small" style="margin-top:8px">
      입력한 값은 이 페이지에 저장하지 않습니다. 나중에 이 테스트 파일은 삭제해도 됩니다.
    </div>
    <div class="row">
      <button id="run">전체 안전 테스트 실행</button>
    </div>
  </div>

  <div class="card">
    <h2>테스트 진행 상태</h2>
    <div id="s1" class="status">1. 테스트 신호 생성 — 대기</div>
    <div id="s2" class="status">2. 계산 Dry Run — 대기</div>
    <div id="s3" class="status">3. 테스트 신호 자동 삭제 — 대기</div>
  </div>

  <div class="card">
    <h2>결과</h2>
    <pre id="result">아직 실행하지 않았습니다.</pre>
  </div>
</div>

<script>
const TEST_DATE = "2099-01-01";
const $ = (id) => document.getElementById(id);

function mark(id, type, text) {
  const el = $(id);
  el.className = "status " + type;
  el.textContent = text;
}

async function post(path, secret, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kccs-cron-secret": secret
    },
    body: JSON.stringify(body)
  });

  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { data = { raw }; }

  if (!res.ok) {
    const err = new Error("HTTP " + res.status);
    err.data = data;
    throw err;
  }
  return data;
}

$("run").addEventListener("click", async () => {
  const secret = $("secret").value.trim();
  if (!secret) {
    alert("KCCS_CRON_SECRET 값을 입력하세요.");
    return;
  }

  $("run").disabled = true;
  $("result").textContent = "테스트 진행 중...";
  mark("s1", "wait", "1. 테스트 신호 생성 — 진행 중");
  mark("s2", "", "2. 계산 Dry Run — 대기");
  mark("s3", "", "3. 테스트 신호 자동 삭제 — 대기");

  const log = [];

  try {
    const signal = await post("/api/kccs/signal", secret, {
      action: "UPSERT",
      date: TEST_DATE,
      direction: "LONG",
      leverage: 2,
      allocation: 100,
      estimatedCost: 0,
      status: "CONFIRMED",
      modelVersion: "backend-safe-test-v2",
      source: "BACKEND_TEST"
    });

    log.push({ step: "signal", response: signal });
    mark("s1", "ok", "1. 테스트 신호 생성 — 성공");

    mark("s2", "wait", "2. 계산 Dry Run — 진행 중");

    const finalize = await post("/api/kccs/finalize", secret, {
      date: TEST_DATE,
      dryRun: true,
      samsungReturn: 1.0,
      skHynixReturn: -0.5,
      marketSource: "BACKEND_TEST"
    });

    log.push({ step: "finalize_dry_run", response: finalize });

    if (finalize.status !== "DRY_RUN_OK") {
      throw Object.assign(new Error("DRY_RUN_OK 응답이 아닙니다."), {
        data: finalize
      });
    }

    mark("s2", "ok", "2. 계산 Dry Run — 성공 (실제 원장 저장 없음)");

    mark("s3", "wait", "3. 테스트 신호 자동 삭제 — 진행 중");

    const cleanup = await post("/api/kccs/signal", secret, {
      action: "DELETE_TEST",
      date: TEST_DATE
    });

    log.push({ step: "cleanup", response: cleanup });
    mark("s3", "ok", "3. 테스트 신호 자동 삭제 — 성공");

    $("result").textContent =
      "✅ 전체 백엔드 안전 테스트 성공\\n\\n" +
      "예상 계산:\\n" +
      "삼성전자 +1.00%, SK하이닉스 -0.50%\\n" +
      "기초수익률 = +0.25%\\n" +
      "LONG 2.0x = +0.50%\\n\\n" +
      JSON.stringify(log, null, 2);

  } catch (error) {
    const failedData = error && error.data ? error.data : null;

    if ($("s1").textContent.includes("진행 중")) {
      mark("s1", "bad", "1. 테스트 신호 생성 — 실패");
    } else if ($("s2").textContent.includes("진행 중")) {
      mark("s2", "bad", "2. 계산 Dry Run — 실패");
    } else if ($("s3").textContent.includes("진행 중")) {
      mark("s3", "bad", "3. 테스트 신호 자동 삭제 — 실패");
    }

    // 실패하더라도 가능한 경우 테스트 신호 정리를 한 번 시도
    try {
      await post("/api/kccs/signal", secret, {
        action: "DELETE_TEST",
        date: TEST_DATE
      });
    } catch (_) {}

    $("result").textContent =
      "❌ 테스트 실패\\n\\n" +
      JSON.stringify(
        { message: error.message, response: failedData, log },
        null,
        2
      );
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

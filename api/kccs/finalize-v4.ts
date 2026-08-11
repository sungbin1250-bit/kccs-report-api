import { createClient } from "@supabase/supabase-js";

type Direction = "LONG" | "SHORT" | "WAIT";

type SignalRow = {
  report_date: string;
  status: "DRAFT" | "CONFIRMED";
  direction: Direction;
  leverage: number | string;
  allocation: number | string;
  estimated_cost: number | string | null;
  model_version: string | null;
  source: string | null;
  confirmed_at: string | null;
};

type ExistingReportRow = {
  report_date: string;
  status: string;
  cumulative_return: number | string;
  data_source: string | null;
  calculation_version: string | null;
};

type ManualBody = {
  date?: string;
  force?: boolean;
  dryRun?: boolean;
  samsungReturn?: number;
  skHynixReturn?: number;
  samsungClose?: number;
  skHynixClose?: number;
  marketSource?: string;
};

const KST = "Asia/Seoul";
const SERVICE_VERSION = "kccs-finalize-v4-yahoo";

const n = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round = (value: number, digits = 2) => {
  const p = 10 ** digits;
  return Math.round((value + Number.EPSILON) * p) / p;
};

const getKstParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
};

const monthStart = (dateKey: string) => `${dateKey.slice(0, 7)}-01`;

const directionMultiplier = (direction: Direction) =>
  direction === "LONG" ? 1 : direction === "SHORT" ? -1 : 0;

const isWeekend = (weekday: string) =>
  weekday === "Sat" || weekday === "Sun";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-KCCS-Cron-Secret, x-kccs-cron-secret",
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string;
        exchangeTimezoneName?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
    error?: {
      code?: string;
      description?: string;
    } | null;
  };
};

type DailyPoint = {
  date: string;
  close: number;
  timestamp: number;
};

const dateKeyInTimezone = (
  timestampSeconds: number,
  timeZone: string
) => {
  const date = new Date(timestampSeconds * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
};

async function fetchYahooDaily(symbol: string) {
  const hosts = [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com",
  ];

  const errors: string[] = [];

  for (const host of hosts) {
    const url =
      `${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
      "?interval=1d&range=10d&events=history&includeAdjustedClose=false";

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json,text/plain,*/*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        errors.push(`${host}:HTTP_${response.status}`);
        continue;
      }

      const payload = (await response.json()) as YahooChartResponse;
      const result = payload?.chart?.result?.[0];

      if (!result) {
        errors.push(
          `${host}:${payload?.chart?.error?.code || "EMPTY_RESULT"}`
        );
        continue;
      }

      const timestamps = Array.isArray(result.timestamp)
        ? result.timestamp
        : [];
      const closes =
        result.indicators?.quote?.[0]?.close &&
        Array.isArray(result.indicators.quote[0].close)
          ? result.indicators.quote[0].close
          : [];

      const timezone = result.meta?.exchangeTimezoneName || KST;

      const points: DailyPoint[] = timestamps
        .map((timestamp, index) => {
          const close = closes[index];
          if (
            !Number.isFinite(timestamp) ||
            typeof close !== "number" ||
            !Number.isFinite(close)
          ) {
            return null;
          }
          return {
            date: dateKeyInTimezone(timestamp, timezone),
            close,
            timestamp,
          };
        })
        .filter((point): point is DailyPoint => Boolean(point))
        .sort((a, b) => a.timestamp - b.timestamp);

      if (points.length < 2) {
        errors.push(`${host}:NOT_ENOUGH_DAILY_POINTS`);
        continue;
      }

      const latest = points[points.length - 1];
      const previous = points[points.length - 2];

      return {
        latest,
        previous,
        changeRate: round(
          ((latest.close / previous.close) - 1) * 100,
          6
        ),
        providerHost: host,
      };
    } catch (error) {
      errors.push(
        `${host}:${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  throw new Error(
    `YAHOO_FETCH_FAILED_${symbol}: ${errors.join(" | ")}`
  );
}

async function loadMarketSnapshot(
  targetDate: string,
  body: ManualBody
) {
  const hasManualReturns =
    Number.isFinite(body.samsungReturn) &&
    Number.isFinite(body.skHynixReturn);

  if (hasManualReturns) {
    return {
      tradeDate: targetDate,
      marketStatus: "MANUAL_CONFIRMED",
      source: body.marketSource || "MANUAL_TEST",
      samsungReturn: n(body.samsungReturn),
      skHynixReturn: n(body.skHynixReturn),
      samsungClose: n(body.samsungClose),
      skHynixClose: n(body.skHynixClose),
    };
  }

  const [samsung, skHynix] = await Promise.all([
    fetchYahooDaily("005930.KS"),
    fetchYahooDaily("000660.KS"),
  ]);

  if (samsung.latest.date !== skHynix.latest.date) {
    return {
      skipped: true as const,
      reason: "MISMATCHED_TRADE_DATE",
      tradeDate: "",
      targetDate,
      samsungTradeDate: samsung.latest.date,
      skHynixTradeDate: skHynix.latest.date,
      marketStatus: "WAITING",
      source: "Yahoo Finance daily chart",
    };
  }

  if (samsung.latest.date !== targetDate) {
    return {
      skipped: true as const,
      reason: "NO_TRADING_DATA_FOR_TARGET_DATE",
      tradeDate: samsung.latest.date,
      targetDate,
      marketStatus: "WAITING",
      source: "Yahoo Finance daily chart",
    };
  }

  return {
    tradeDate: targetDate,
    marketStatus: "DAILY_CLOSE_READY",
    source: "Yahoo Finance daily chart",
    samsungReturn: samsung.changeRate,
    skHynixReturn: skHynix.changeRate,
    samsungClose: samsung.latest.close,
    skHynixClose: skHynix.latest.close,
  };
}

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === "GET") {
      return Response.json(
        {
          ok: true,
          service: "kccs-finalize",
          version: SERVICE_VERSION,
          dryRunSupported: true,
          marketSource: "Yahoo Finance daily chart",
          symbols: ["005930.KS", "000660.KS"],
          writeMode: "POST_ONLY"
        },
        {
          status: 200,
          headers: {
            ...cors,
            "Cache-Control": "no-store, max-age=0"
          }
        }
      );
    }

    if (request.method !== "POST") {
      return Response.json(
        { error: "METHOD_NOT_ALLOWED" },
        { status: 405, headers: { ...cors, Allow: "GET, POST" } }
      );
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
    const cronSecret = process.env.KCCS_CRON_SECRET;

    if (!supabaseUrl || !supabaseSecretKey || !cronSecret) {
      return Response.json(
        {
          error: "SERVER_NOT_CONFIGURED",
          message:
            "SUPABASE_URL / SUPABASE_SECRET_KEY / KCCS_CRON_SECRET 환경변수를 확인하세요.",
        },
        { status: 500, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    const receivedSecret =
      request.headers.get("x-kccs-cron-secret") ||
      request.headers.get("X-KCCS-Cron-Secret") ||
      "";

    if (receivedSecret !== cronSecret) {
      return Response.json(
        { error: "UNAUTHORIZED" },
        { status: 401, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    let body: ManualBody = {};
    try {
      body = (await request.json()) as ManualBody;
    } catch {
      body = {};
    }

    const kst = getKstParts();
    const targetDate = String(body.date || kst.dateKey);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return Response.json(
        { error: "INVALID_DATE" },
        { status: 400, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    // 자동 실행은 주말 신규행 금지.
    if (!body.date && isWeekend(kst.weekday)) {
      return Response.json(
        {
          ok: true,
          status: "SKIPPED",
          reason: "WEEKEND",
          targetDate,
        },
        { status: 200, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    // 자동 실행은 17:00 KST 이후에만 허용.
    // 수동 테스트(body.date 지정)는 시간 제한 없음.
    if (!body.date && kst.hour < 17) {
      return Response.json(
        {
          ok: true,
          status: "SKIPPED",
          reason: "BEFORE_17_KST",
          targetDate,
        },
        { status: 200, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // 기존 확정 원장 보호.
    const { data: existing, error: existingError } = await supabase
      .from("kccs_daily_reports")
      .select(
        "report_date,status,cumulative_return,data_source,calculation_version"
      )
      .eq("report_date", targetDate)
      .maybeSingle();

    if (existingError) {
      return Response.json(
        {
          error: "EXISTING_REPORT_READ_ERROR",
          message: existingError.message,
        },
        { status: 500, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    const existingRow = existing as ExistingReportRow | null;
    const existingSource = String(existingRow?.data_source || "");
    const autoOwned =
      existingSource.startsWith("KCCS 자동 확정") ||
      String(existingRow?.calculation_version || "").startsWith("kccs-auto-");

    if (
      existingRow?.status === "CONFIRMED" &&
      !autoOwned &&
      body.force !== true
    ) {
      return Response.json(
        {
          ok: true,
          status: "SKIPPED",
          reason: "EXISTING_CONFIRMED_ROW_PROTECTED",
          targetDate,
          existingDataSource: existingRow.data_source,
        },
        { status: 200, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    // 해당 날짜의 '확정 모델 신호'만 사용.
    const { data: signalData, error: signalError } = await supabase
      .from("kccs_model_signals")
      .select(
        "report_date,status,direction,leverage,allocation,estimated_cost,model_version,source,confirmed_at"
      )
      .eq("report_date", targetDate)
      .eq("status", "CONFIRMED")
      .maybeSingle();

    if (signalError) {
      return Response.json(
        {
          error: "SIGNAL_READ_ERROR",
          message: signalError.message,
        },
        { status: 500, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    if (!signalData) {
      return Response.json(
        {
          ok: false,
          status: "WAITING",
          reason: "SIGNAL_NOT_CONFIRMED",
          targetDate,
        },
        { status: 409, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    const signal = signalData as SignalRow;
    const direction = signal.direction;
    const leverage = Math.max(0, n(signal.leverage));
    const allocation = Math.min(100, Math.max(0, n(signal.allocation)));
    const estimatedCost = Math.max(0, n(signal.estimated_cost));

    let market: Awaited<ReturnType<typeof loadMarketSnapshot>>;
    try {
      market = await loadMarketSnapshot(targetDate, body);
    } catch (error) {
      return Response.json(
        {
          error: "MARKET_DATA_ERROR",
          message: error instanceof Error ? error.message : String(error),
          targetDate,
        },
        { status: 502, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    if ("skipped" in market && market.skipped) {
      return Response.json(
        {
          ok: true,
          status: "SKIPPED",
          ...market,
        },
        { status: 200, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    const samsungReturn = round(n(market.samsungReturn), 6);
    const skHynixReturn = round(n(market.skHynixReturn), 6);

    // 고정 원칙: 삼성전자·SK하이닉스 등락률 50:50 단순 평균.
    const underlyingReturn = round((samsungReturn + skHynixReturn) / 2, 6);

    const multiplier = directionMultiplier(direction);
    const grossReturn = round(
      underlyingReturn *
        multiplier *
        leverage *
        (allocation / 100),
      6
    );

    const dailyReturn =
      direction === "WAIT"
        ? 0
        : round(grossReturn - estimatedCost, 6);

    // 해당 월 직전 확정 누적값을 읽어 복리 누적.
    const { data: previousRows, error: previousError } = await supabase
      .from("kccs_daily_reports")
      .select("report_date,cumulative_return")
      .eq("status", "CONFIRMED")
      .gte("report_date", monthStart(targetDate))
      .lt("report_date", targetDate)
      .order("report_date", { ascending: false })
      .limit(1);

    if (previousError) {
      return Response.json(
        {
          error: "PREVIOUS_REPORT_READ_ERROR",
          message: previousError.message,
        },
        { status: 500, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    const previousCumulative =
      previousRows && previousRows.length > 0
        ? n(previousRows[0].cumulative_return)
        : 0;

    const cumulativeReturn = round(
      ((1 + previousCumulative / 100) *
        (1 + dailyReturn / 100) -
        1) *
        100,
      2
    );

    const nowIso = new Date().toISOString();
    const reportRow = {
      report_date: targetDate,
      status: "CONFIRMED",
      direction,
      leverage: round(leverage, 2),
      allocation: round(allocation, 2),
      samsung_return: samsungReturn,
      skhynix_return: skHynixReturn,
      underlying_return: underlyingReturn,
      gross_return: round(grossReturn, 6),
      estimated_cost: round(estimatedCost, 6),
      daily_return: round(dailyReturn, 6),
      cumulative_return: cumulativeReturn,
      pnl_on_100k: round(dailyReturn * 1000, 2),
      trade_count: 0,
      max_drawdown: 0,
      data_source: `KCCS 자동 확정 · ${market.source}`,
      calculation_version: signal.model_version
        ? `kccs-auto-v1:${signal.model_version}`
        : "kccs-auto-v1",
      confirmed_at: nowIso,
      updated_at: nowIso,
    };

    if (body.dryRun === true) {
      return Response.json(
        {
          ok: true,
          serviceVersion: SERVICE_VERSION,
          status: "DRY_RUN_OK",
          message:
            "계산 테스트만 완료했습니다. kccs_daily_reports에는 저장하지 않았습니다.",
          reportPreview: reportRow,
          calculation: {
            previousCumulative,
            samsungReturn,
            skHynixReturn,
            underlyingReturn,
            direction,
            leverage,
            allocation,
            estimatedCost,
            grossReturn,
            dailyReturn,
            cumulativeReturn
          }
        },
        {
          status: 200,
          headers: {
            ...cors,
            "Cache-Control": "no-store, max-age=0"
          }
        }
      );
    }

    const { data: upserted, error: upsertError } = await supabase
      .from("kccs_daily_reports")
      .upsert(reportRow, { onConflict: "report_date" })
      .select()
      .single();

    if (upsertError) {
      return Response.json(
        {
          error: "REPORT_UPSERT_ERROR",
          message: upsertError.message,
        },
        { status: 500, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    return Response.json(
      {
        ok: true,
        serviceVersion: SERVICE_VERSION,
        status: "CONFIRMED",
        report: upserted,
        calculation: {
          previousCumulative,
          samsungReturn,
          skHynixReturn,
          underlyingReturn,
          direction,
          leverage,
          allocation,
          estimatedCost,
          grossReturn,
          dailyReturn,
          cumulativeReturn,
        },
      },
      {
        status: 200,
        headers: {
          ...cors,
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  },
};

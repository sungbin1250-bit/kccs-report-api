type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        currency?: string;
        exchangeTimezoneName?: string;
        regularMarketPrice?: number;
        regularMarketTime?: number;
        previousClose?: number;
        chartPreviousClose?: number;
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

type PricePoint = {
  date: string;
  close: number;
  timestamp: number;
};

type SymbolSnapshot = {
  symbol: string;
  timezone: string;
  currency: string;
  latest: PricePoint;
  previous: PricePoint;
  changeRate: number;
  providerHost: string;
  sourceMode: "DAILY" | "INTRADAY_FALLBACK" | "META_FALLBACK";
};

const SERVICE_VERSION = "kccs-market-yahoo-v2-daily-intraday-fallback";
const KST = "Asia/Seoul";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-KCCS-Cron-Secret, x-kccs-cron-secret",
};

const round = (value: number, digits = 6) => {
  const p = 10 ** digits;
  return Math.round((value + Number.EPSILON) * p) / p;
};

const dateKeyInTimezone = (timestampSeconds: number, timeZone: string) => {
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

const kstDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: KST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const hosts = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
];

const commonHeaders = {
  Accept: "application/json,text/plain,*/*",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchChart(
  symbol: string,
  interval: string,
  range: string
): Promise<{
  result: NonNullable<
    NonNullable<YahooChartResponse["chart"]>["result"]
  >[number];
  host: string;
}> {
  const errors: string[] = [];

  for (const host of hosts) {
    const url =
      `${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?interval=${encodeURIComponent(interval)}` +
      `&range=${encodeURIComponent(range)}` +
      "&events=history&includeAdjustedClose=false";

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: commonHeaders,
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

      return { result, host };
    } catch (error) {
      errors.push(
        `${host}:${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  throw new Error(
    `YAHOO_FETCH_FAILED_${symbol}_${interval}: ${errors.join(" | ")}`
  );
}

function toPoints(
  result: NonNullable<
    NonNullable<YahooChartResponse["chart"]>["result"]
  >[number]
): PricePoint[] {
  const timestamps = Array.isArray(result.timestamp)
    ? result.timestamp
    : [];
  const closes =
    result.indicators?.quote?.[0]?.close &&
    Array.isArray(result.indicators.quote[0].close)
      ? result.indicators.quote[0].close
      : [];

  const timezone = result.meta?.exchangeTimezoneName || KST;

  return timestamps
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
    .filter((point): point is PricePoint => Boolean(point))
    .sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchDailyBase(symbol: string): Promise<SymbolSnapshot> {
  const { result, host } = await fetchChart(symbol, "1d", "10d");
  const points = toPoints(result);

  if (points.length < 2) {
    throw new Error(`NOT_ENOUGH_DAILY_POINTS_${symbol}`);
  }

  const latest = points[points.length - 1];
  const previous = points[points.length - 2];

  return {
    symbol,
    timezone: result.meta?.exchangeTimezoneName || KST,
    currency: result.meta?.currency || "KRW",
    latest,
    previous,
    changeRate: round(((latest.close / previous.close) - 1) * 100, 6),
    providerHost: host,
    sourceMode: "DAILY",
  };
}

async function fetchTargetWithIntradayFallback(
  symbol: string,
  targetDate: string,
  daily: SymbolSnapshot
): Promise<SymbolSnapshot> {
  // Daily candle already contains target date: use it unchanged.
  if (daily.latest.date === targetDate) return daily;

  const { result, host } = await fetchChart(symbol, "1m", "5d");
  const timezone = result.meta?.exchangeTimezoneName || KST;
  const points = toPoints(result);

  const targetPoints = points.filter((p) => p.date === targetDate);

  if (targetPoints.length > 0) {
    const latest = targetPoints[targetPoints.length - 1];

    // If 1d data is delayed by one trading day, that delayed daily close is
    // the safest previous close for the current target date.
    const previous =
      daily.latest.date < targetDate
        ? daily.latest
        : [...points]
            .filter((p) => p.date < targetDate)
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-1)[0];

    if (previous && previous.close > 0) {
      return {
        symbol,
        timezone,
        currency: result.meta?.currency || daily.currency || "KRW",
        latest,
        previous,
        changeRate: round(
          ((latest.close / previous.close) - 1) * 100,
          6
        ),
        providerHost: host,
        sourceMode: "INTRADAY_FALLBACK",
      };
    }
  }

  // Some Yahoo responses expose the just-finished session in meta before
  // the 1d candle is published. Use it only when its timestamp maps exactly
  // to the requested KRX date.
  const regularMarketPrice = Number(result.meta?.regularMarketPrice);
  const regularMarketTime = Number(result.meta?.regularMarketTime);
  const metaPrevious = Number(
    result.meta?.previousClose ?? result.meta?.chartPreviousClose
  );

  if (
    Number.isFinite(regularMarketPrice) &&
    regularMarketPrice > 0 &&
    Number.isFinite(regularMarketTime) &&
    regularMarketTime > 0 &&
    dateKeyInTimezone(regularMarketTime, timezone) === targetDate
  ) {
    const previousClose =
      Number.isFinite(metaPrevious) && metaPrevious > 0
        ? metaPrevious
        : daily.latest.close;

    if (previousClose > 0) {
      return {
        symbol,
        timezone,
        currency: result.meta?.currency || daily.currency || "KRW",
        latest: {
          date: targetDate,
          close: regularMarketPrice,
          timestamp: regularMarketTime,
        },
        previous: {
          date: daily.latest.date,
          close: previousClose,
          timestamp: daily.latest.timestamp,
        },
        changeRate: round(
          ((regularMarketPrice / previousClose) - 1) * 100,
          6
        ),
        providerHost: host,
        sourceMode: "META_FALLBACK",
      };
    }
  }

  return daily;
}

async function getKccsYahooSnapshot(targetDate?: string) {
  const requestedDate = targetDate || kstDate();

  const [samsungDaily, skDaily] = await Promise.all([
    fetchDailyBase("005930.KS"),
    fetchDailyBase("000660.KS"),
  ]);

  const [samsung, skHynix] = await Promise.all([
    fetchTargetWithIntradayFallback(
      "005930.KS",
      requestedDate,
      samsungDaily
    ),
    fetchTargetWithIntradayFallback(
      "000660.KS",
      requestedDate,
      skDaily
    ),
  ]);

  if (
    samsung.latest.date !== requestedDate ||
    skHynix.latest.date !== requestedDate
  ) {
    return {
      ok: false as const,
      status: "WAITING",
      reason: "TARGET_DATE_NOT_READY",
      targetDate: requestedDate,
      samsungTradeDate: samsung.latest.date,
      skHynixTradeDate: skHynix.latest.date,
      samsung,
      skHynix,
    };
  }

  return {
    ok: true as const,
    status: "READY",
    source:
      samsung.sourceMode === "DAILY" &&
      skHynix.sourceMode === "DAILY"
        ? "Yahoo Finance daily chart"
        : "Yahoo Finance intraday fallback",
    sourceType: "UNOFFICIAL_MARKET_DATA_SOURCE",
    tradeDate: requestedDate,
    stocks: {
      "005930": {
        symbol: "005930.KS",
        name: "삼성전자",
        close: samsung.latest.close,
        previousClose: samsung.previous.close,
        changeRate: samsung.changeRate,
        sourceMode: samsung.sourceMode,
      },
      "000660": {
        symbol: "000660.KS",
        name: "SK하이닉스",
        close: skHynix.latest.close,
        previousClose: skHynix.previous.close,
        changeRate: skHynix.changeRate,
        sourceMode: skHynix.sourceMode,
      },
    },
    underlyingReturn: round(
      (samsung.changeRate + skHynix.changeRate) / 2,
      6
    ),
    providerHosts: [
      samsung.providerHost,
      skHynix.providerHost,
    ],
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
          service: "kccs-market-yahoo",
          version: SERVICE_VERSION,
          symbols: ["005930.KS", "000660.KS"],
          fallback:
            "1d candle first; if target date is delayed, try 1m intraday/meta for the exact target date.",
          note:
            "POST with x-kccs-cron-secret performs the market-date check.",
        },
        {
          status: 200,
          headers: {
            ...cors,
            "Cache-Control": "no-store, max-age=0",
          },
        }
      );
    }

    if (request.method !== "POST") {
      return Response.json(
        { error: "METHOD_NOT_ALLOWED" },
        {
          status: 405,
          headers: { ...cors, Allow: "GET, POST" },
        }
      );
    }

    const cronSecret = process.env.KCCS_CRON_SECRET;
    if (!cronSecret) {
      return Response.json(
        { error: "SERVER_NOT_CONFIGURED" },
        { status: 500, headers: cors }
      );
    }

    const receivedSecret =
      request.headers.get("x-kccs-cron-secret") ||
      request.headers.get("X-KCCS-Cron-Secret") ||
      "";

    if (receivedSecret !== cronSecret) {
      return Response.json(
        { error: "UNAUTHORIZED" },
        { status: 401, headers: cors }
      );
    }

    let body: { date?: string } = {};
    try {
      body = (await request.json()) as { date?: string };
    } catch {
      body = {};
    }

    const targetDate = body.date || kstDate();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return Response.json(
        { error: "INVALID_DATE" },
        { status: 400, headers: cors }
      );
    }

    try {
      const snapshot = await getKccsYahooSnapshot(targetDate);

      return Response.json(
        {
          serviceVersion: SERVICE_VERSION,
          ...snapshot,
        },
        {
          status: snapshot.ok ? 200 : 425,
          headers: {
            ...cors,
            "Cache-Control": "no-store, max-age=0",
          },
        }
      );
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: "YAHOO_MARKET_DATA_ERROR",
          message:
            error instanceof Error ? error.message : String(error),
        },
        {
          status: 502,
          headers: {
            ...cors,
            "Cache-Control": "no-store, max-age=0",
          },
        }
      );
    }
  },
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        currency?: string;
        exchangeTimezoneName?: string;
        regularMarketPrice?: number;
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

type DailyPoint = {
  date: string;
  close: number;
  timestamp: number;
};

const SERVICE_VERSION = "kccs-market-yahoo-v1";
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

async function fetchYahooChart(symbol: string) {
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

      // A trading return requires at least two valid daily closes.
      if (points.length < 2) {
        errors.push(`${host}:NOT_ENOUGH_DAILY_POINTS`);
        continue;
      }

      const latest = points[points.length - 1];
      const previous = points[points.length - 2];
      const changeRate = round(
        ((latest.close / previous.close) - 1) * 100,
        6
      );

      return {
        symbol,
        timezone,
        currency: result.meta?.currency || "KRW",
        latest,
        previous,
        changeRate,
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

async function getKccsYahooSnapshot(targetDate?: string) {
  const [samsung, skHynix] = await Promise.all([
    fetchYahooChart("005930.KS"),
    fetchYahooChart("000660.KS"),
  ]);

  if (samsung.latest.date !== skHynix.latest.date) {
    return {
      ok: false as const,
      status: "WAITING",
      reason: "MISMATCHED_TRADE_DATE",
      targetDate: targetDate || kstDate(),
      samsungTradeDate: samsung.latest.date,
      skHynixTradeDate: skHynix.latest.date,
    };
  }

  const tradeDate = samsung.latest.date;
  const requestedDate = targetDate || kstDate();

  if (tradeDate !== requestedDate) {
    return {
      ok: false as const,
      status: "WAITING",
      reason: "TARGET_DATE_NOT_READY",
      targetDate: requestedDate,
      tradeDate,
      samsung,
      skHynix,
    };
  }

  return {
    ok: true as const,
    status: "READY",
    source: "Yahoo Finance daily chart",
    sourceType: "UNOFFICIAL_MARKET_DATA_SOURCE",
    tradeDate,
    stocks: {
      "005930": {
        symbol: "005930.KS",
        name: "삼성전자",
        close: samsung.latest.close,
        previousClose: samsung.previous.close,
        changeRate: samsung.changeRate,
      },
      "000660": {
        symbol: "000660.KS",
        name: "SK하이닉스",
        close: skHynix.latest.close,
        previousClose: skHynix.previous.close,
        changeRate: skHynix.changeRate,
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
          note:
            "POST with x-kccs-cron-secret performs the actual Yahoo daily-close check.",
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

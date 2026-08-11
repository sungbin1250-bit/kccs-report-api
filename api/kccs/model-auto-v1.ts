import { createClient } from "@supabase/supabase-js";

type Direction = "LONG" | "SHORT" | "WAIT";
type DecisionState =
  | "LONG"
  | "SHORT"
  | "WAIT"
  | "LONG_CANDIDATE"
  | "SHORT_CANDIDATE";

type Body = {
  date?: string;
  dryRun?: boolean;
  force?: boolean;
};

type PreviousReport = {
  report_date: string;
  direction: Direction;
  underlying_return: number | string | null;
  status: string;
};

const SERVICE_VERSION = "kccs-model-auto-v1-hysteresis";
const MODEL_VERSION = "kccs-model-auto-v1-hysteresis-030-010";
const ENTRY_THRESHOLD = 0.30;
const EXIT_BUFFER = 0.10;
const ACTIVE_LEVERAGE = 2;
const ACTIVE_ALLOCATION = 100;
const ACTIVE_COST = 0.10;
const KST = "Asia/Seoul";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-KCCS-Cron-Secret, x-kccs-cron-secret",
};

const n = (value: unknown) => {
  const x = Number(value ?? 0);
  return Number.isFinite(x) ? x : 0;
};

const round = (value: number, digits = 6) => {
  const p = 10 ** digits;
  return Math.round((value + Number.EPSILON) * p) / p;
};

const kstDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: KST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const kstHour = () =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: KST,
      hour: "2-digit",
      hour12: false,
    }).format(new Date())
  );

function decide(
  currentUnderlying: number,
  previous: PreviousReport | null
): {
  direction: Direction;
  decisionState: DecisionState;
  reason: string;
} {
  const prevDirection: Direction = previous?.direction || "WAIT";
  const prevUnderlying = previous ? n(previous.underlying_return) : null;

  // 1) Existing LONG: keep through the -0.10 buffer.
  if (prevDirection === "LONG") {
    if (currentUnderlying > -EXIT_BUFFER) {
      return {
        direction: "LONG",
        decisionState: "LONG",
        reason: "PREVIOUS_LONG_MAINTAINED_ABOVE_MINUS_010",
      };
    }

    if (currentUnderlying >= -ENTRY_THRESHOLD) {
      return {
        direction: "WAIT",
        decisionState: "WAIT",
        reason: "PREVIOUS_LONG_EXITED_TO_WAIT_BUFFER",
      };
    }

    // Opposite breakout. Confirm only if the previous trading day
    // was also below -0.30%.
    if (prevUnderlying !== null && prevUnderlying < -ENTRY_THRESHOLD) {
      return {
        direction: "SHORT",
        decisionState: "SHORT",
        reason: "SHORT_CONFIRMED_TWO_CONSECUTIVE_BREAKOUTS",
      };
    }

    return {
      direction: "WAIT",
      decisionState: "SHORT_CANDIDATE",
      reason: "FIRST_SHORT_BREAKOUT_WAIT_FOR_CONFIRMATION",
    };
  }

  // 2) Existing SHORT: keep through the +0.10 buffer.
  if (prevDirection === "SHORT") {
    if (currentUnderlying < EXIT_BUFFER) {
      return {
        direction: "SHORT",
        decisionState: "SHORT",
        reason: "PREVIOUS_SHORT_MAINTAINED_BELOW_PLUS_010",
      };
    }

    if (currentUnderlying <= ENTRY_THRESHOLD) {
      return {
        direction: "WAIT",
        decisionState: "WAIT",
        reason: "PREVIOUS_SHORT_EXITED_TO_WAIT_BUFFER",
      };
    }

    if (prevUnderlying !== null && prevUnderlying > ENTRY_THRESHOLD) {
      return {
        direction: "LONG",
        decisionState: "LONG",
        reason: "LONG_CONFIRMED_TWO_CONSECUTIVE_BREAKOUTS",
      };
    }

    return {
      direction: "WAIT",
      decisionState: "LONG_CANDIDATE",
      reason: "FIRST_LONG_BREAKOUT_WAIT_FOR_CONFIRMATION",
    };
  }

  // 3) Previous effective position was WAIT.
  if (currentUnderlying > ENTRY_THRESHOLD) {
    if (prevUnderlying !== null && prevUnderlying > ENTRY_THRESHOLD) {
      return {
        direction: "LONG",
        decisionState: "LONG",
        reason: "LONG_CONFIRMED_TWO_CONSECUTIVE_BREAKOUTS",
      };
    }

    return {
      direction: "WAIT",
      decisionState: "LONG_CANDIDATE",
      reason: "FIRST_LONG_BREAKOUT_WAIT_FOR_CONFIRMATION",
    };
  }

  if (currentUnderlying < -ENTRY_THRESHOLD) {
    if (prevUnderlying !== null && prevUnderlying < -ENTRY_THRESHOLD) {
      return {
        direction: "SHORT",
        decisionState: "SHORT",
        reason: "SHORT_CONFIRMED_TWO_CONSECUTIVE_BREAKOUTS",
      };
    }

    return {
      direction: "WAIT",
      decisionState: "SHORT_CANDIDATE",
      reason: "FIRST_SHORT_BREAKOUT_WAIT_FOR_CONFIRMATION",
    };
  }

  return {
    direction: "WAIT",
    decisionState: "WAIT",
    reason: "INSIDE_NEUTRAL_ZONE",
  };
}

async function postJson(
  url: string,
  secret: string,
  body: unknown
) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kccs-cron-secret": secret,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const raw = await res.text();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw };
  }

  if (!res.ok) {
    const error = new Error(`HTTP_${res.status}`);
    (error as any).response = data;
    throw error;
  }

  return data;
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
          service: "kccs-model-auto",
          version: SERVICE_VERSION,
          rules: {
            entryThreshold: ENTRY_THRESHOLD,
            exitBuffer: EXIT_BUFFER,
            confirmation: "2_CONSECUTIVE_TRADING_DAYS",
            candidateEffectiveDirection: "WAIT",
            activeLeverage: ACTIVE_LEVERAGE,
            activeAllocation: ACTIVE_ALLOCATION,
            activeEstimatedCost: ACTIVE_COST,
            waitLeverage: 0,
          },
        },
        {
          status: 200,
          headers: { ...cors, "Cache-Control": "no-store, max-age=0" },
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

    let body: Body = {};
    try {
      body = (await request.json()) as Body;
    } catch {
      body = {};
    }

    const targetDate = body.date || kstDate();
    const dryRun = body.dryRun !== false;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return Response.json(
        { error: "INVALID_DATE" },
        { status: 400, headers: cors }
      );
    }

    if (!dryRun && targetDate === kstDate() && kstHour() < 17) {
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

    const origin = new URL(request.url).origin;

    let market: any;
    try {
      market = await postJson(
        `${origin}/api/kccs/market-yahoo-v1`,
        cronSecret,
        { date: targetDate }
      );
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: "MARKET_DATA_ERROR",
          detail: (error as any)?.response || String(error),
        },
        { status: 502, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    if (!market?.ok || market?.status !== "READY") {
      return Response.json(
        {
          ok: false,
          status: "WAITING",
          reason: "MARKET_NOT_READY",
          market,
        },
        { status: 425, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    const currentUnderlying = round(n(market.underlyingReturn), 6);

    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Protect an already-confirmed non-auto customer ledger.
    const { data: existingReport, error: existingReportError } =
      await supabase
        .from("kccs_daily_reports")
        .select("report_date,status,data_source,calculation_version")
        .eq("report_date", targetDate)
        .maybeSingle();

    if (existingReportError) {
      return Response.json(
        {
          error: "EXISTING_REPORT_READ_ERROR",
          message: existingReportError.message,
        },
        { status: 500, headers: cors }
      );
    }

    const existingSource = String(existingReport?.data_source || "");
    const autoOwned =
      existingSource.startsWith("KCCS 자동 확정") ||
      String(existingReport?.calculation_version || "").startsWith(
        "kccs-auto-"
      );

    if (
      existingReport?.status === "CONFIRMED" &&
      !autoOwned &&
      body.force !== true
    ) {
      return Response.json(
        {
          ok: true,
          status: "SKIPPED",
          reason: "EXISTING_CONFIRMED_ROW_PROTECTED",
          targetDate,
          existingDataSource: existingReport.data_source,
        },
        { status: 200, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    // Previous confirmed trading report, regardless of month.
    const { data: previousRows, error: previousError } = await supabase
      .from("kccs_daily_reports")
      .select("report_date,direction,underlying_return,status")
      .eq("status", "CONFIRMED")
      .lt("report_date", targetDate)
      .order("report_date", { ascending: false })
      .limit(1);

    if (previousError) {
      return Response.json(
        {
          error: "PREVIOUS_REPORT_READ_ERROR",
          message: previousError.message,
        },
        { status: 500, headers: cors }
      );
    }

    const previous =
      previousRows && previousRows.length > 0
        ? (previousRows[0] as PreviousReport)
        : null;

    const decision = decide(currentUnderlying, previous);

    const leverage =
      decision.direction === "WAIT" ? 0 : ACTIVE_LEVERAGE;
    const allocation =
      decision.direction === "WAIT" ? 0 : ACTIVE_ALLOCATION;
    const estimatedCost =
      decision.direction === "WAIT" ? 0 : ACTIVE_COST;

    const nowIso = new Date().toISOString();

    const signalRow = {
      report_date: targetDate,
      status: "CONFIRMED",
      direction: decision.direction,
      leverage,
      allocation,
      estimated_cost: estimatedCost,
      model_version: MODEL_VERSION,
      source: `KCCS AUTO MODEL · ${decision.decisionState}`,
      confirmed_at: nowIso,
      updated_at: nowIso,
    };

    const responseBase = {
      ok: true,
      serviceVersion: SERVICE_VERSION,
      status: dryRun ? "DRY_RUN_OK" : "SIGNAL_CONFIRMED",
      targetDate,
      market: {
        samsungReturn: market.stocks?.["005930"]?.changeRate,
        skHynixReturn: market.stocks?.["000660"]?.changeRate,
        underlyingReturn: currentUnderlying,
      },
      previousReport: previous,
      decision: {
        ...decision,
        leverage,
        allocation,
        estimatedCost,
      },
      signalPreview: signalRow,
      rules: {
        entryThreshold: ENTRY_THRESHOLD,
        exitBuffer: EXIT_BUFFER,
        confirmation: "2_CONSECUTIVE_TRADING_DAYS",
        candidateEffectiveDirection: "WAIT",
      },
    };

    if (dryRun) {
      return Response.json(responseBase, {
        status: 200,
        headers: { ...cors, "Cache-Control": "no-store, max-age=0" },
      });
    }

    // Do not overwrite a manually entered confirmed signal unless forced.
    const { data: existingSignal, error: existingSignalError } =
      await supabase
        .from("kccs_model_signals")
        .select("report_date,status,source")
        .eq("report_date", targetDate)
        .maybeSingle();

    if (existingSignalError) {
      return Response.json(
        {
          error: "EXISTING_SIGNAL_READ_ERROR",
          message: existingSignalError.message,
        },
        { status: 500, headers: cors }
      );
    }

    const existingSignalSource = String(existingSignal?.source || "");
    const autoSignalOwned =
      existingSignalSource.startsWith("KCCS AUTO MODEL");

    if (
      existingSignal?.status === "CONFIRMED" &&
      !autoSignalOwned &&
      body.force !== true
    ) {
      return Response.json(
        {
          ...responseBase,
          status: "SKIPPED",
          reason: "EXISTING_MANUAL_SIGNAL_PROTECTED",
          existingSignalSource,
        },
        { status: 200, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    const { data: saved, error: saveError } = await supabase
      .from("kccs_model_signals")
      .upsert(signalRow, { onConflict: "report_date" })
      .select()
      .single();

    if (saveError) {
      return Response.json(
        {
          error: "AUTO_SIGNAL_UPSERT_ERROR",
          message: saveError.message,
        },
        { status: 500, headers: cors }
      );
    }

    return Response.json(
      {
        ...responseBase,
        status: "SIGNAL_CONFIRMED",
        signal: saved,
      },
      {
        status: 200,
        headers: { ...cors, "Cache-Control": "no-store, max-age=0" },
      }
    );
  },
};

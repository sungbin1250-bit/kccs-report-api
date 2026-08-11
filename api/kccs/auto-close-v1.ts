import { createClient } from "@supabase/supabase-js";

type Body = {
  date?: string;
  dryRun?: boolean;
  force?: boolean;
};

const SERVICE_VERSION = "kccs-auto-close-v1";
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

const monthStart = (dateKey: string) => `${dateKey.slice(0, 7)}-01`;

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
          service: "kccs-auto-close",
          version: SERVICE_VERSION,
          flow: [
            "Yahoo daily close",
            "KCCS auto model",
            "LONG/SHORT/WAIT + leverage",
            "monthly compound",
            "Supabase finalize",
          ],
          defaultPostMode: "DRY_RUN",
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

    // Safe by default: caller must explicitly send dryRun:false to write.
    const dryRun = body.dryRun !== false;
    const targetDate = body.date || kstDate();

    if (!dryRun && targetDate === kstDate() && kstHour() < 17) {
      return Response.json(
        {
          ok: true,
          serviceVersion: SERVICE_VERSION,
          status: "SKIPPED",
          reason: "BEFORE_17_KST",
          targetDate,
        },
        { status: 200, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    const origin = new URL(request.url).origin;

    let model: any;
    try {
      model = await postJson(
        `${origin}/api/kccs/model-auto-v1`,
        cronSecret,
        {
          date: targetDate,
          dryRun,
          force: body.force === true,
        }
      );
    } catch (error) {
      return Response.json(
        {
          ok: false,
          stage: "MODEL",
          error: "AUTO_MODEL_ERROR",
          detail: (error as any)?.response || String(error),
        },
        { status: 502, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    if (
      model?.status === "SKIPPED" ||
      model?.status === "WAITING"
    ) {
      return Response.json(
        {
          ok: true,
          serviceVersion: SERVICE_VERSION,
          stage: "MODEL",
          ...model,
        },
        { status: 200, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    // Safe dry-run: compute the full report preview without inserting
    // signal or report rows.
    if (dryRun) {
      const direction = model.decision.direction;
      const leverage = n(model.decision.leverage);
      const allocation = n(model.decision.allocation);
      const estimatedCost = n(model.decision.estimatedCost);
      const underlyingReturn = n(model.market.underlyingReturn);
      const samsungReturn = n(model.market.samsungReturn);
      const skHynixReturn = n(model.market.skHynixReturn);

      const multiplier =
        direction === "LONG" ? 1 : direction === "SHORT" ? -1 : 0;

      const grossReturn = round(
        underlyingReturn * multiplier * leverage * (allocation / 100),
        6
      );

      const dailyReturn =
        direction === "WAIT"
          ? 0
          : round(grossReturn - estimatedCost, 6);

      const supabase = createClient(supabaseUrl, supabaseSecretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

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
            error: "PREVIOUS_CUMULATIVE_READ_ERROR",
            message: previousError.message,
          },
          { status: 500, headers: cors }
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

      return Response.json(
        {
          ok: true,
          serviceVersion: SERVICE_VERSION,
          status: "DRY_RUN_OK",
          message:
            "자동 모델 판단부터 최종 원장 계산까지 검증했습니다. 실제 DB에는 저장하지 않았습니다.",
          model,
          reportPreview: {
            report_date: targetDate,
            direction,
            leverage,
            allocation,
            samsung_return: samsungReturn,
            skhynix_return: skHynixReturn,
            underlying_return: underlyingReturn,
            gross_return: grossReturn,
            estimated_cost: estimatedCost,
            daily_return: dailyReturn,
            cumulative_return: cumulativeReturn,
            pnl_on_100k: round(dailyReturn * 1000, 2),
          },
          calculation: {
            previousCumulative,
            grossReturn,
            dailyReturn,
            cumulativeReturn,
          },
        },
        {
          status: 200,
          headers: { ...cors, "Cache-Control": "no-store, max-age=0" },
        }
      );
    }

    // Live mode: model signal was written. Finalize writes the ledger.
    let finalized: any;
    try {
      finalized = await postJson(
        `${origin}/api/kccs/finalize-v4`,
        cronSecret,
        {
          date: targetDate,
          dryRun: false,
          force: body.force === true,
        }
      );
    } catch (error) {
      return Response.json(
        {
          ok: false,
          stage: "FINALIZE",
          error: "FINALIZE_ERROR",
          model,
          detail: (error as any)?.response || String(error),
        },
        { status: 502, headers: { ...cors, "Cache-Control": "no-store" } }
      );
    }

    return Response.json(
      {
        ok: true,
        serviceVersion: SERVICE_VERSION,
        status: finalized.status,
        model,
        finalized,
      },
      {
        status: 200,
        headers: { ...cors, "Cache-Control": "no-store, max-age=0" },
      }
    );
  },
};

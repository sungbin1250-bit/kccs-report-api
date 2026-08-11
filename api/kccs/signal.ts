import { createClient } from "@supabase/supabase-js";

type Direction = "LONG" | "SHORT" | "WAIT";

type SignalBody = {
  date?: string;
  direction?: Direction;
  leverage?: number;
  allocation?: number;
  estimatedCost?: number;
  status?: "DRAFT" | "CONFIRMED";
  modelVersion?: string;
  source?: string;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-KCCS-Cron-Secret, x-kccs-cron-secret",
};

const kstDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return Response.json(
        { error: "METHOD_NOT_ALLOWED" },
        { status: 405, headers: { ...cors, Allow: "POST" } }
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

    let body: SignalBody;
    try {
      body = (await request.json()) as SignalBody;
    } catch {
      return Response.json(
        { error: "INVALID_JSON" },
        { status: 400, headers: cors }
      );
    }

    const date = body.date || kstDate();
    const direction = body.direction;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json(
        { error: "INVALID_DATE" },
        { status: 400, headers: cors }
      );
    }

    if (!direction || !["LONG", "SHORT", "WAIT"].includes(direction)) {
      return Response.json(
        { error: "INVALID_DIRECTION" },
        { status: 400, headers: cors }
      );
    }

    const leverage =
      direction === "WAIT" ? 0 : Math.max(0, Number(body.leverage ?? 2));
    const allocation =
      direction === "WAIT"
        ? 0
        : Math.min(100, Math.max(0, Number(body.allocation ?? 100)));

    const nowIso = new Date().toISOString();
    const row = {
      report_date: date,
      status: body.status || "CONFIRMED",
      direction,
      leverage,
      allocation,
      estimated_cost: Math.max(0, Number(body.estimatedCost ?? 0)),
      model_version: body.modelVersion || "kccs-model-v1",
      source: body.source || "KCCS 모델 신호",
      confirmed_at:
        (body.status || "CONFIRMED") === "CONFIRMED" ? nowIso : null,
      updated_at: nowIso,
    };

    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
      .from("kccs_model_signals")
      .upsert(row, { onConflict: "report_date" })
      .select()
      .single();

    if (error) {
      return Response.json(
        { error: "SIGNAL_UPSERT_ERROR", message: error.message },
        { status: 500, headers: cors }
      );
    }

    return Response.json(
      { ok: true, signal: data },
      { status: 200, headers: { ...cors, "Cache-Control": "no-store" } }
    );
  },
};

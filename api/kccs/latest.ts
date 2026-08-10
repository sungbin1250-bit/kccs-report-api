import { createClient } from "@supabase/supabase-js";

type DbRow = {
  report_date: string;
  status: string;
  direction: string;
  leverage: number | string;
  allocation: number | string;
  samsung_return: number | string;
  skhynix_return: number | string;
  underlying_return: number | string;
  gross_return: number | string;
  estimated_cost: number | string;
  daily_return: number | string;
  cumulative_return: number | string;
  pnl_on_100k: number | string;
  trade_count: number;
  max_drawdown: number | string;
  data_source: string | null;
  calculation_version: string | null;
  confirmed_at: string | null;
  created_at?: string;
  updated_at?: string;
};

const n = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalize = (row: DbRow) => ({
  date: row.report_date,
  status: row.status,
  direction: row.direction,
  leverage: n(row.leverage),
  allocation: n(row.allocation),
  samsungReturn: n(row.samsung_return),
  skHynixReturn: n(row.skhynix_return),
  underlyingReturn: n(row.underlying_return),
  grossReturn: n(row.gross_return),
  estimatedCost: n(row.estimated_cost),
  dailyReturn: n(row.daily_return),
  cumulativeReturn: n(row.cumulative_return),
  pnlOn100k: n(row.pnl_on_100k),
  tradeCount: row.trade_count ?? 0,
  maxDrawdown: n(row.max_drawdown),
  dataSource: row.data_source,
  calculationVersion: row.calculation_version,
  confirmedAt: row.confirmed_at,
});

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "GET") {
      return Response.json(
        { error: "METHOD_NOT_ALLOWED" },
        { status: 405, headers: { "Allow": "GET" } }
      );
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !supabaseSecretKey) {
      return Response.json(
        {
          error: "SERVER_NOT_CONFIGURED",
          message: "SUPABASE_URL / SUPABASE_SECRET_KEY 환경변수를 확인하세요.",
        },
        {
          status: 500,
          headers: {
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data, error } = await supabase
      .from("kccs_daily_reports")
      .select(
        "report_date,status,direction,leverage,allocation,samsung_return,skhynix_return,underlying_return,gross_return,estimated_cost,daily_return,cumulative_return,pnl_on_100k,trade_count,max_drawdown,data_source,calculation_version,confirmed_at,created_at,updated_at"
      )
      .eq("status", "CONFIRMED")
      .order("report_date", { ascending: false })
      .limit(30);

    if (error) {
      console.error("SUPABASE_READ_ERROR", error);
      return Response.json(
        {
          error: "SUPABASE_READ_ERROR",
          message: error.message,
        },
        {
          status: 500,
          headers: {
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const history = (data ?? []).map((row) => normalize(row as DbRow));
    const latest = history[0] ?? null;

    return Response.json(
      {
        latest,
        preview: null,
        history,
        meta: {
          source: "supabase",
          count: history.length,
          generatedAt: new Date().toISOString(),
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      }
    );
  },
};

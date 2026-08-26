type AnyRow = Record<string, any>;

const KST = "Asia/Seoul";
const SERVICE_VERSION = "kccs-live-latest-v1";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

const monthKey = (date: string) => String(date || "").slice(0, 7);

export default {
    async fetch(request: Request) {
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: cors });
        }

        if (request.method !== "GET") {
            return Response.json(
                { error: "METHOD_NOT_ALLOWED" },
                {
                    status: 405,
                    headers: { ...cors, Allow: "GET, OPTIONS" },
                }
            );
        }

        const currentUrl = new URL(request.url);
        const origin = currentUrl.origin;
        const today = kstDate();

        try {
            const [latestResponse, previewResponse] = await Promise.all([
                fetch(`${origin}/api/kccs/latest?_kccs=${Date.now()}`, {
                    method: "GET",
                    cache: "no-store",
                    headers: { Accept: "application/json" },
                }),
                fetch(
                    `${origin}/api/kccs/model-preview-v1?date=${encodeURIComponent(today)}&_kccs=${Date.now()}`,
                    {
                        method: "GET",
                        cache: "no-store",
                        headers: { Accept: "application/json" },
                    }
                ),
            ]);

            if (!latestResponse.ok) {
                const raw = await latestResponse.text();
                return Response.json(
                    {
                        ok: false,
                        serviceVersion: SERVICE_VERSION,
                        error: "LATEST_API_ERROR",
                        upstreamStatus: latestResponse.status,
                        detail: raw,
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

            const base = (await latestResponse.json()) as AnyRow;
            let modelPreview: AnyRow | null = null;

            if (previewResponse.ok) {
                try {
                    modelPreview = (await previewResponse.json()) as AnyRow;
                } catch {
                    modelPreview = null;
                }
            }

            const latest = base?.latest && typeof base.latest === "object"
                ? base.latest
                : null;

            const alreadyConfirmedToday =
                latest &&
                String(latest.date || latest.report_date || "") === today &&
                String(latest.status || "").toUpperCase() === "CONFIRMED";

            let preview: AnyRow | null = null;

            if (
                !alreadyConfirmedToday &&
                modelPreview?.ok === true &&
                ["LONG", "SHORT", "WAIT"].includes(
                    String(modelPreview.direction || "").toUpperCase()
                )
            ) {
                const direction = String(modelPreview.direction).toUpperCase();
                const leverage =
                    direction === "WAIT" ? 0 : Math.max(0, n(modelPreview.leverage));
                const allocation =
                    direction === "WAIT"
                        ? 0
                        : Math.min(100, Math.max(0, n(modelPreview.allocation)));
                const estimatedCost =
                    direction === "WAIT" ? 0 : Math.max(0, n(modelPreview.estimatedCost));

                const samsungReturn = n(modelPreview.samsungReturn);
                const skHynixReturn = n(modelPreview.skHynixReturn);
                const underlyingReturn = n(modelPreview.underlyingReturn);

                const multiplier =
                    direction === "LONG" ? 1 : direction === "SHORT" ? -1 : 0;

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

                const previousCumulative =
                    latest && monthKey(latest.date) === monthKey(today)
                        ? n(latest.cumulativeReturn ?? latest.cumulative_return)
                        : 0;

                const cumulativeReturn = round(
                    ((1 + previousCumulative / 100) *
                        (1 + dailyReturn / 100) -
                        1) *
                        100,
                    2
                );

                preview = {
                    date: today,
                    status: "LIVE",
                    direction,
                    leverage,
                    allocation,
                    samsungReturn,
                    skHynixReturn,
                    underlyingReturn,
                    grossReturn,
                    estimatedCost,
                    dailyReturn,
                    cumulativeReturn,
                    pnlOn100k: round(dailyReturn * 1000, 2),
                    tradeCount: 0,
                    maxDrawdown: 0,
                    dataSource: "KCCS LIVE · backend model preview",
                    calculationVersion:
                        modelPreview.serviceVersion || "kccs-model-preview-v1",
                    confirmedAt: "",
                    decisionState: modelPreview.decisionState || direction,
                    reason: modelPreview.reason || "",
                    generatedAt: modelPreview.generatedAt || new Date().toISOString(),
                };
            }

            return Response.json(
                {
                    ...base,
                    preview,
                    meta: {
                        ...(base?.meta || {}),
                        liveWrapper: SERVICE_VERSION,
                        livePreviewAvailable: Boolean(preview),
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
        } catch (error) {
            return Response.json(
                {
                    ok: false,
                    serviceVersion: SERVICE_VERSION,
                    error: "LIVE_LATEST_ERROR",
                    message: error instanceof Error ? error.message : String(error),
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

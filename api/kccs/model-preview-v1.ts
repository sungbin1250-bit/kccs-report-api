type ApiResult = Record<string, any>;

const KST = "Asia/Seoul";
const SERVICE_VERSION = "kccs-model-preview-v1";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

const kstDate = () =>
    new Intl.DateTimeFormat("en-CA", {
        timeZone: KST,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());

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

        const cronSecret = process.env.KCCS_CRON_SECRET;

        if (!cronSecret) {
            return Response.json(
                {
                    ok: false,
                    error: "SERVER_NOT_CONFIGURED",
                    message: "KCCS_CRON_SECRET 환경변수를 확인하세요.",
                },
                {
                    status: 500,
                    headers: { ...cors, "Cache-Control": "no-store, max-age=0" },
                }
            );
        }

        const requestUrl = new URL(request.url);
        const targetDate = requestUrl.searchParams.get("date") || kstDate();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
            return Response.json(
                { ok: false, error: "INVALID_DATE", targetDate },
                {
                    status: 400,
                    headers: { ...cors, "Cache-Control": "no-store, max-age=0" },
                }
            );
        }

        const origin = requestUrl.origin;

        try {
            const response = await fetch(`${origin}/api/kccs/model-auto-v1`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-kccs-cron-secret": cronSecret,
                },
                body: JSON.stringify({
                    date: targetDate,
                    dryRun: true,
                    force: false,
                }),
                cache: "no-store",
            });

            const raw = await response.text();
            let model: ApiResult;

            try {
                model = JSON.parse(raw);
            } catch {
                model = { raw };
            }

            if (!response.ok) {
                return Response.json(
                    {
                        ok: false,
                        serviceVersion: SERVICE_VERSION,
                        targetDate,
                        upstreamStatus: response.status,
                        model,
                    },
                    {
                        status: response.status,
                        headers: {
                            ...cors,
                            "Cache-Control": "no-store, max-age=0",
                        },
                    }
                );
            }

            const decision = model?.decision || {};
            const market = model?.market || {};

            return Response.json(
                {
                    ok: true,
                    serviceVersion: SERVICE_VERSION,
                    targetDate,
                    status: model?.status || "UNKNOWN",
                    direction: decision?.direction || "WAIT",
                    decisionState: decision?.decisionState || decision?.direction || "WAIT",
                    reason: decision?.reason || "",
                    leverage: Number(decision?.leverage ?? 0),
                    allocation: Number(decision?.allocation ?? 0),
                    estimatedCost: Number(decision?.estimatedCost ?? 0),
                    samsungReturn: Number(market?.samsungReturn ?? 0),
                    skHynixReturn: Number(market?.skHynixReturn ?? 0),
                    underlyingReturn: Number(market?.underlyingReturn ?? 0),
                    previousReport: model?.previousReport ?? null,
                    authoritativeSignal: model?.authoritativeSignal === true,
                    authoritativeSource: model?.authoritativeSource ?? null,
                    generatedAt: new Date().toISOString(),
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
                    targetDate,
                    error: "MODEL_PREVIEW_ERROR",
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

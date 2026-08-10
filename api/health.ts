export default {
  async fetch() {
    const hasUrl = Boolean(process.env.SUPABASE_URL);
    const hasSecret = Boolean(process.env.SUPABASE_SECRET_KEY);

    return Response.json(
      {
        ok: hasUrl && hasSecret,
        service: "kccs-report-api",
        supabaseConfigured: hasUrl && hasSecret,
        now: new Date().toISOString(),
      },
      {
        status: hasUrl && hasSecret ? 200 : 500,
        headers: {
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  },
};

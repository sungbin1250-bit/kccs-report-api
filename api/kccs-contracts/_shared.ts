import crypto from "crypto"

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "")
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "")
const OFFICE_KEY = String(process.env.KCCS_OFFICE_API_KEY || "")

const DEFAULT_ORIGINS = [
    "https://forceful-area-812687.framer.app",
    "https://kccs-sim.com",
    "https://www.kccs-sim.com",
    "https://arc-kccs.com",
    "https://www.arc-kccs.com",
]

export function allowedOrigins() {
    const env = String(process.env.KCCS_ALLOWED_ORIGINS || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    return env.length ? env : DEFAULT_ORIGINS
}

export function setCors(req: any, res: any) {
    const origin = String(req.headers?.origin || "")
    const allowed = allowedOrigins()
    if (origin && allowed.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Vary", "Origin")
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-KCCS-Office-Key")
    res.setHeader("Cache-Control", "no-store, max-age=0")
}

export function preflight(req: any, res: any) {
    setCors(req, res)
    if (req.method === "OPTIONS") {
        res.status(204).end()
        return true
    }
    return false
}

export function requireAllowedOrigin(req: any, res: any) {
    const origin = String(req.headers?.origin || "")
    if (!origin) return true
    if (allowedOrigins().includes(origin)) return true
    res.status(403).json({ ok: false, error: "허용되지 않은 요청 출처입니다." })
    return false
}

export function requireOfficeKey(req: any, res: any) {
    if (!OFFICE_KEY) {
        res.status(500).json({ ok: false, error: "KCCS_OFFICE_API_KEY 환경변수가 설정되지 않았습니다." })
        return false
    }
    const got = String(req.headers?.["x-kccs-office-key"] || "")
    const a = Buffer.from(got)
    const b = Buffer.from(OFFICE_KEY)
    const same = a.length === b.length && crypto.timingSafeEqual(a, b)
    if (!same) {
        res.status(401).json({ ok: false, error: "OFFICE API 접속키가 올바르지 않습니다." })
        return false
    }
    return true
}

function assertEnv() {
    if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY(또는 SUPABASE_SERVICE_ROLE_KEY) 환경변수가 필요합니다.")
}

export async function sb(path: string, init: RequestInit = {}) {
    assertEnv()
    const headers: any = {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers })
    const text = await r.text()
    let data: any = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    if (!r.ok) throw new Error(typeof data === "string" ? data : (data?.message || data?.error || `Supabase HTTP ${r.status}`))
    return data
}

export function sha256(value: string) {
    return crypto.createHash("sha256").update(value).digest("hex")
}

export function newCode() {
    return String(crypto.randomInt(100000, 1000000))
}

export function newToken() {
    return crypto.randomUUID()
}

export function newContractNo() {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, "0")
    return `KCCS-CTR-${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}-${crypto.randomInt(10000,99999)}`
}

export function money(v: any) {
    const n = Number(String(v ?? "").replace(/,/g, ""))
    return Number.isFinite(n) ? n : null
}

export function mapRow(x: any) {
    if (!x) return null
    return {
        id: x.application_id,
        applicationDate: x.application_date || "",
        pbcode: x.pbcode || "",
        name: x.name || "",
        birth: x.birth || "",
        phone: x.phone || "",
        email: x.email || "",
        address: x.address || "",
        amount: x.application_amount == null ? "" : String(x.application_amount),
        currency: x.currency || "USDT",
        status: x.status || "입금대기",
        depositAmount: x.deposit_amount == null ? "" : String(x.deposit_amount),
        depositDate: x.deposit_date || "",
        txid: x.txid || "",
        contractNo: x.contract_no || "",
        publicToken: x.public_token || "",
        signedAt: x.signed_at || "",
    }
}

export function signBaseUrl() {
    return String(process.env.KCCS_CUSTOMER_SIGN_BASE_URL || "https://www.kccs-sim.com/kccs-sign").replace(/\/$/, "")
}

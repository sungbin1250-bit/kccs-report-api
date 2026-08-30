declare const process: {
  env: Record<string, string | undefined>
}

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "")
const SERVICE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ""
)
const OFFICE_KEY = String(process.env.KCCS_OFFICE_API_KEY || "")

const DEFAULT_ORIGINS = [
  "https://forceful-area-812687.framer.app",
  "https://kccs-sim.com",
  "https://www.kccs-sim.com",
  "https://arc-kccs.com",
  "https://www.arc-kccs.com",
]

type JsonRecord = Record<string, any>

const CURRENT_CONTRACT_TEMPLATE_CODE = "KCCS-AGR-2026-01"

const CURRENT_AGREEMENT_SNAPSHOT = Object.freeze({
  templateCode: CURRENT_CONTRACT_TEMPLATE_CODE,
  agreementTitle: "KCCS 전략운용·정산 서비스 이용계약서",

  managementFeePercent: 0.7,
  managementFeeBasis: "settlement_period_average_managed_balance",
  managementFeeSettlement: "monthly_and_contract_termination_prorated",

  performanceFeePercent: 1.2,
  performanceFeeMethod: "high_water_mark",
  lossCarryForward: true,

  tradingFeePercent: 0.19,
  tradingFeeBasis: "executed_notional",

  fundingFeePercent: 0.013,
  fundingFeeBasis: "position_notional_at_funding_time",

  withdrawalFeePercent: 0.07,
  withdrawalFeeBasis: "withdrawal_amount",

  fxFeePercent: 0,
  withdrawalProcessingBusinessDays: 2,
})

function cloneAgreementSnapshot() {
  return JSON.parse(JSON.stringify(CURRENT_AGREEMENT_SNAPSHOT))
}

function allowedOrigins() {
  const env = String(process.env.KCCS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  return env.length ? env : DEFAULT_ORIGINS
}

function setCors(req: any, res: any) {
  const origin = String(req.headers?.origin || "")
  const allowed = allowedOrigins()

  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin)
  }

  res.setHeader("Vary", "Origin")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,X-KCCS-Office-Key"
  )
  res.setHeader("Cache-Control", "no-store, max-age=0")
}

function requireAllowedOrigin(req: any, res: any) {
  const origin = String(req.headers?.origin || "")

  if (!origin || allowedOrigins().includes(origin)) return true

  res.status(403).json({
    ok: false,
    error: "허용되지 않은 요청 출처입니다.",
  })
  return false
}

function requireOfficeKey(req: any, res: any) {
  if (!OFFICE_KEY) {
    res.status(500).json({
      ok: false,
      error: "KCCS_OFFICE_API_KEY 환경변수가 설정되지 않았습니다.",
    })
    return false
  }

  const received = String(req.headers?.["x-kccs-office-key"] || "")
  const same = constantTimeEqual(received, OFFICE_KEY)

  if (!same) {
    res.status(401).json({
      ok: false,
      error: "OFFICE API 접속키가 올바르지 않습니다.",
    })
    return false
  }

  return true
}

function assertEnvironment() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SECRET_KEY(또는 SUPABASE_SERVICE_ROLE_KEY) 환경변수가 필요합니다."
    )
  }
}

async function supabase(path: string, init: any = {}) {
  assertEnvironment()

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...(init.headers || {}),
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers,
  })

  const raw = await response.text()
  let data: any = null

  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    data = raw
  }

  if (!response.ok) {
    throw new Error(
      typeof data === "string"
        ? data
        : data?.message || data?.error || `Supabase HTTP ${response.status}`
    )
  }

  return data
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return diff === 0
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function secureRandomInt(min: number, maxExclusive: number) {
  const range = maxExclusive - min
  const values = new Uint32Array(1)
  globalThis.crypto.getRandomValues(values)
  return min + (values[0] % range)
}

function newCode() {
  return String(secureRandomInt(100000, 1000000))
}

function newToken() {
  return globalThis.crypto.randomUUID()
}

function newContractNo() {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")

  return `KCCS-CTR-${date.getUTCFullYear()}${pad(
    date.getUTCMonth() + 1
  )}${pad(date.getUTCDate())}-${secureRandomInt(10000, 100000)}`
}

function money(value: any) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function mapRow(row: any) {
  if (!row) return null

  return {
    id: row.application_id,
    applicationDate: row.application_date || "",
    pbcode: row.pbcode || "",
    name: row.name || "",
    birth: row.birth || "",
    phone: row.phone || "",
    email: row.email || "",
    address: row.address || "",
    amount:
      row.application_amount == null
        ? ""
        : String(row.application_amount),
    currency: row.currency || "USDT",
    status: row.status || "입금대기",
    depositAmount:
      row.deposit_amount == null ? "" : String(row.deposit_amount),
    depositDate: row.deposit_date || "",
    txid: row.txid || "",
    contractNo: row.contract_no || "",
    contractTemplateCode:
      row.contract_template_code || CURRENT_CONTRACT_TEMPLATE_CODE,
    agreementSnapshot:
      row.agreement_snapshot || cloneAgreementSnapshot(),
    publicToken: row.public_token || "",
    signedAt: row.signed_at || "",
  }
}


function mapDocument(row: any) {
  if (!row) return null

  return {
    applicationId: row.application_id || "",
    applicationDate: row.application_date || "",
    pbcode: row.pbcode || "",
    name: row.name || "",
    birth: row.birth || "",
    phone: row.phone || "",
    email: row.email || "",
    address: row.address || "",
    applicationAmount: row.application_amount,
    currency: row.currency || "USDT",
    depositAmount: row.deposit_amount,
    depositDate: row.deposit_date || "",
    txid: row.txid || "",
    mismatchReason: row.mismatch_reason || "",
    mismatchNote: row.mismatch_note || "",
    contractNo: row.contract_no || "",
    contractTemplateCode:
      row.contract_template_code || CURRENT_CONTRACT_TEMPLATE_CODE,
    agreementSnapshot:
      row.agreement_snapshot || cloneAgreementSnapshot(),
    documentHash: row.document_hash || "",
    documentGeneratedAt: row.document_generated_at || "",
    status: row.status || "",
    publicToken: row.public_token || "",
    companySigner: row.company_signer || "",
    companySignatureData: row.company_signature_data || "",
    riskAgreed: Boolean(row.risk_agreed),
    infoAgreed: Boolean(row.info_agreed),
    signedName: row.signed_name || "",
    customerSignatureData: row.customer_signature_data || "",
    signedAt: row.signed_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  }
}

function signBaseUrl() {
  return String(
    process.env.KCCS_CUSTOMER_SIGN_BASE_URL ||
      "https://www.kccs-sim.com/kccs-sign"
  ).replace(/\/$/, "")
}

function actionFromRequest(req: any) {
  const value = req.query?.action
  return String(Array.isArray(value) ? value[0] : value || "")
    .trim()
    .toLowerCase()
}

async function health(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "GET only" })
  }

  await supabase("kccs_contracts?select=id&limit=1", {
    method: "GET",
  })

  return res.status(200).json({
    ok: true,
    service: "kccs-remote-esign",
    version: "kccs-contract-api-single-function-v3-template-lock",
    contractTemplateCode: CURRENT_CONTRACT_TEMPLATE_CODE,
    agreementSnapshotConfigured: true,
  })
}

async function list(req: any, res: any) {
  if (!requireOfficeKey(req, res)) return

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "GET only" })
  }

  const rows = await supabase(
    "kccs_contracts?select=*&order=created_at.desc&limit=200",
    { method: "GET" }
  )

  return res.status(200).json({
    ok: true,
    rows: (rows || []).map(mapRow),
  })
}

async function pending(req: any, res: any) {
  if (!requireOfficeKey(req, res)) return

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" })
  }

  const body: JsonRecord = req.body || {}

  if (
    !body.id ||
    !body.name ||
    !body.birth ||
    !body.phone ||
    !body.amount ||
    !body.currency
  ) {
    return res.status(400).json({
      ok: false,
      error: "필수 신청정보가 부족합니다.",
    })
  }

  const row = {
    application_id: String(body.id),
    application_date: body.applicationDate || null,
    pbcode: String(body.pbcode || ""),
    name: String(body.name),
    birth: String(body.birth || ""),
    phone: String(body.phone || ""),
    email: String(body.email || ""),
    address: String(body.address || ""),
    application_amount: money(body.amount),
    currency: String(body.currency || "USDT"),
    status: "입금대기",
  }

  const data = await supabase(
    "kccs_contracts?on_conflict=application_id",
    {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
    }
  )

  return res.status(200).json({
    ok: true,
    row: mapRow(data?.[0] || row),
  })
}

async function finalize(req: any, res: any) {
  if (!requireOfficeKey(req, res)) return

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" })
  }

  const body: JsonRecord = req.body || {}

  if (
    !body.id ||
    !body.name ||
    !body.depositAmount ||
    !body.depositDate ||
    !body.txid
  ) {
    return res.status(400).json({
      ok: false,
      error: "계약 확정 필수정보가 부족합니다.",
    })
  }

  const existing = await supabase(
    `kccs_contracts?application_id=eq.${encodeURIComponent(
      String(body.id)
    )}&select=*&limit=1`,
    { method: "GET" }
  )

  const previous = existing?.[0] || null

  if (previous?.status === "서명완료") {
    return res.status(409).json({
      ok: false,
      error:
        "이미 전자서명이 완료된 계약은 다시 확정하거나 서명링크를 재발급할 수 없습니다.",
      contractNo: previous.contract_no || "",
    })
  }

  const shouldPreserveExistingTerms =
    previous?.status === "서명대기" &&
    Boolean(previous?.contract_template_code) &&
    Boolean(previous?.agreement_snapshot)

  const contractTemplateCode = shouldPreserveExistingTerms
    ? String(previous.contract_template_code)
    : CURRENT_CONTRACT_TEMPLATE_CODE

  const agreementSnapshot = shouldPreserveExistingTerms
    ? previous.agreement_snapshot
    : cloneAgreementSnapshot()

  const code = newCode()
  const salt = newToken()
  const token = newToken()
  const contractNo =
    previous?.contract_no ||
    String(body.contractNo || "") ||
    newContractNo()
  const expiresAt = new Date(
    Date.now() + 72 * 60 * 60 * 1000
  ).toISOString()

  const row = {
    application_id: String(body.id),
    application_date: body.applicationDate || null,
    pbcode: String(body.pbcode || ""),
    name: String(body.name),
    birth: String(body.birth || ""),
    phone: String(body.phone || ""),
    email: String(body.email || ""),
    address: String(body.address || ""),
    application_amount: money(body.amount),
    currency: String(body.currency || "USDT"),
    deposit_amount: money(body.depositAmount),
    deposit_date: body.depositDate,
    txid: String(body.txid),
    mismatch_reason: String(body.mismatchReason || ""),
    mismatch_note: String(body.mismatchNote || ""),
    contract_no: contractNo,
    contract_template_code: contractTemplateCode,
    agreement_snapshot: agreementSnapshot,
    document_hash: null,
    document_generated_at: null,
    status: "서명대기",
    public_token: token,
    verification_code_salt: salt,
    verification_code_hash: await sha256(`${salt}:${code}`),
    code_expires_at: expiresAt,
    company_signer: String(body.companySigner || ""),
    company_signature_data: String(body.companySign || ""),
    risk_agreed: false,
    info_agreed: false,
    signed_name: null,
    customer_signature_data: null,
    signed_at: null,
  }

  const data = await supabase(
    "kccs_contracts?on_conflict=application_id",
    {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
    }
  )

  const signUrl = `${signBaseUrl()}?token=${encodeURIComponent(token)}`

  return res.status(200).json({
    ok: true,
    row: mapRow(data?.[0] || row),
    contractNo,
    contractTemplateCode,
    agreementSnapshot,
    code,
    publicToken: token,
    signUrl,
    expiresAt,
  })
}

async function verify(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" })
  }

  const token = String(req.body?.token || "")
  const code = String(req.body?.code || "")

  if (!token || !/^\d{6}$/.test(code)) {
    return res.status(400).json({
      ok: false,
      error: "서명 링크와 6자리 확인코드를 확인해 주세요.",
    })
  }

  const rows = await supabase(
    `kccs_contracts?public_token=eq.${encodeURIComponent(
      token
    )}&select=*&limit=1`,
    { method: "GET" }
  )

  const contract = rows?.[0]

  if (!contract) {
    return res.status(404).json({
      ok: false,
      error: "유효하지 않은 서명 링크입니다.",
    })
  }

  if (contract.status === "서명완료") {
    return res.status(200).json({
      ok: true,
      alreadySigned: true,
      signedAt: contract.signed_at,
      contractNo: contract.contract_no,
      contractTemplateCode:
        contract.contract_template_code || CURRENT_CONTRACT_TEMPLATE_CODE,
    })
  }

  if (
    !contract.verification_code_hash ||
    !contract.verification_code_salt
  ) {
    return res.status(400).json({
      ok: false,
      error: "확인코드가 발급되지 않은 계약입니다.",
    })
  }

  if (
    contract.code_expires_at &&
    Date.now() > Date.parse(contract.code_expires_at)
  ) {
    return res.status(410).json({
      ok: false,
      error:
        "확인코드 유효시간이 만료되었습니다. 담당 직원에게 재발급을 요청해 주세요.",
    })
  }

  if (
    (await sha256(`${contract.verification_code_salt}:${code}`)) !==
    contract.verification_code_hash
  ) {
    return res.status(401).json({
      ok: false,
      error: "확인코드가 일치하지 않습니다.",
    })
  }

  return res.status(200).json({
    ok: true,
    contract: {
      contractNo: contract.contract_no,
      contractTemplateCode:
        contract.contract_template_code || CURRENT_CONTRACT_TEMPLATE_CODE,
      agreementSnapshot:
        contract.agreement_snapshot || cloneAgreementSnapshot(),
      name: contract.name,
      birth: contract.birth,
      applicationAmount: contract.application_amount,
      depositAmount: contract.deposit_amount,
      currency: contract.currency,
      pbcode: contract.pbcode,
      companySigner: contract.company_signer || "",
      depositDate: contract.deposit_date,
    },
  })
}

async function sign(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" })
  }

  const body: JsonRecord = req.body || {}
  const token = String(body.token || "")
  const code = String(body.code || "")
  const signName = String(body.signName || "").trim()
  const signature = String(body.signatureData || "")

  if (!token || !/^\d{6}$/.test(code)) {
    return res.status(400).json({
      ok: false,
      error: "확인코드를 다시 확인해 주세요.",
    })
  }

  if (!body.riskAgree || !body.infoAgree) {
    return res.status(400).json({
      ok: false,
      error:
        "계약내용·위험고지와 최종정보 확인에 모두 동의해 주세요.",
    })
  }

  if (
    !signature.startsWith("data:image/png;base64,") ||
    signature.length > 750000
  ) {
    return res.status(400).json({
      ok: false,
      error: "전자서명 이미지가 없거나 너무 큽니다.",
    })
  }

  const rows = await supabase(
    `kccs_contracts?public_token=eq.${encodeURIComponent(
      token
    )}&select=*&limit=1`,
    { method: "GET" }
  )

  const contract = rows?.[0]

  if (!contract) {
    return res.status(404).json({
      ok: false,
      error: "유효하지 않은 서명 링크입니다.",
    })
  }

  if (contract.status === "서명완료") {
    return res.status(200).json({
      ok: true,
      alreadySigned: true,
      signedAt: contract.signed_at,
    })
  }

  if (
    contract.code_expires_at &&
    Date.now() > Date.parse(contract.code_expires_at)
  ) {
    return res.status(410).json({
      ok: false,
      error: "확인코드 유효시간이 만료되었습니다.",
    })
  }

  if (
    (await sha256(`${contract.verification_code_salt}:${code}`)) !==
    contract.verification_code_hash
  ) {
    return res.status(401).json({
      ok: false,
      error: "확인코드가 일치하지 않습니다.",
    })
  }

  if (signName !== String(contract.name || "").trim()) {
    return res.status(400).json({
      ok: false,
      error: "전자서명자 성명은 계약자 성명과 동일해야 합니다.",
    })
  }

  const signedAt = new Date().toISOString()
  const patch = {
    status: "서명완료",
    risk_agreed: true,
    info_agreed: true,
    signed_name: signName,
    customer_signature_data: signature,
    signed_at: signedAt,
  }

  await supabase(
    `kccs_contracts?public_token=eq.${encodeURIComponent(token)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    }
  )

  return res.status(200).json({
    ok: true,
    signedAt,
    contractNo: contract.contract_no,
  })
}


async function documentData(req: any, res: any) {
  if (!requireOfficeKey(req, res)) return

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "GET only" })
  }

  const token = String(req.query?.token || "")

  if (!token) {
    return res.status(400).json({
      ok: false,
      error: "token required",
    })
  }

  const rows = await supabase(
    `kccs_contracts?public_token=eq.${encodeURIComponent(
      token
    )}&select=*&limit=1`,
    { method: "GET" }
  )

  const contract = rows?.[0]

  if (!contract) {
    return res.status(404).json({
      ok: false,
      error: "계약을 찾을 수 없습니다.",
    })
  }

  if (contract.status !== "서명완료") {
    return res.status(409).json({
      ok: false,
      error: "고객 전자서명이 완료된 뒤 계약서 PDF를 저장할 수 있습니다.",
      status: contract.status || "",
    })
  }

  if (!contract.customer_signature_data || !contract.signed_at) {
    return res.status(409).json({
      ok: false,
      error: "서명 이미지 또는 서명 완료시각이 아직 저장되지 않았습니다.",
    })
  }

  return res.status(200).json({
    ok: true,
    document: mapDocument(contract),
  })
}

async function status(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "GET only" })
  }

  const token = String(req.query?.token || "")

  if (!token) {
    return res.status(400).json({
      ok: false,
      error: "token required",
    })
  }

  const rows = await supabase(
    `kccs_contracts?public_token=eq.${encodeURIComponent(
      token
    )}&select=contract_no,status,signed_at&limit=1`,
    { method: "GET" }
  )

  const contract = rows?.[0]

  if (!contract) {
    return res.status(404).json({
      ok: false,
      error: "계약을 찾을 수 없습니다.",
    })
  }

  return res.status(200).json({
    ok: true,
    contractNo: contract.contract_no,
    contractTemplateCode:
      contract.contract_template_code || CURRENT_CONTRACT_TEMPLATE_CODE,
    status: contract.status,
    signedAt: contract.signed_at || "",
  })
}

export default async function handler(req: any, res: any) {
  setCors(req, res)

  if (req.method === "OPTIONS") {
    return res.status(204).end()
  }

  if (!requireAllowedOrigin(req, res)) return

  const action = actionFromRequest(req)

  try {
    switch (action) {
      case "health":
        return await health(req, res)
      case "list":
        return await list(req, res)
      case "pending":
        return await pending(req, res)
      case "finalize":
        return await finalize(req, res)
      case "verify":
        return await verify(req, res)
      case "sign":
        return await sign(req, res)
      case "status":
        return await status(req, res)
      case "document":
        return await documentData(req, res)
      default:
        return res.status(404).json({
          ok: false,
          error: "지원하지 않는 계약 API 경로입니다.",
          action,
        })
    }
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "계약 API 처리 실패",
    })
  }
}

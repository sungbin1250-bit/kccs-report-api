import { preflight, requireAllowedOrigin, sb, sha256 } from "./_shared"
export default async function handler(req:any,res:any){
  if(preflight(req,res)) return
  if(!requireAllowedOrigin(req,res)) return
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"POST only"})
  try{
    const token=String(req.body?.token||""), code=String(req.body?.code||"")
    if(!token||!/^\d{6}$/.test(code)) return res.status(400).json({ok:false,error:"서명 링크와 6자리 확인코드를 확인해 주세요."})
    const rows=await sb(`kccs_contracts?public_token=eq.${encodeURIComponent(token)}&select=*&limit=1`,{method:"GET"})
    const x=rows?.[0]
    if(!x) return res.status(404).json({ok:false,error:"유효하지 않은 서명 링크입니다."})
    if(x.status==="서명완료") return res.status(200).json({ok:true,alreadySigned:true,signedAt:x.signed_at,contractNo:x.contract_no})
    if(!x.verification_code_hash||!x.verification_code_salt) return res.status(400).json({ok:false,error:"확인코드가 발급되지 않은 계약입니다."})
    if(x.code_expires_at && Date.now()>Date.parse(x.code_expires_at)) return res.status(410).json({ok:false,error:"확인코드 유효시간이 만료되었습니다. 담당 직원에게 재발급을 요청해 주세요."})
    if(sha256(`${x.verification_code_salt}:${code}`)!==x.verification_code_hash) return res.status(401).json({ok:false,error:"확인코드가 일치하지 않습니다."})
    res.status(200).json({ok:true,contract:{
      contractNo:x.contract_no, name:x.name, birth:x.birth,
      applicationAmount:x.application_amount, depositAmount:x.deposit_amount,
      currency:x.currency, pbcode:x.pbcode, companySigner:x.company_signer||"",
      depositDate:x.deposit_date
    }})
  }catch(e:any){ res.status(500).json({ok:false,error:e?.message||"계약 확인 실패"}) }
}

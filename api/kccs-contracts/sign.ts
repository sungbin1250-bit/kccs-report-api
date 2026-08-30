import { preflight, requireAllowedOrigin, sb, sha256 } from "./_shared"
export default async function handler(req:any,res:any){
  if(preflight(req,res)) return
  if(!requireAllowedOrigin(req,res)) return
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"POST only"})
  try{
    const b=req.body||{}, token=String(b.token||""), code=String(b.code||""), signName=String(b.signName||"").trim(), sig=String(b.signatureData||"")
    if(!token||!/^\d{6}$/.test(code)) return res.status(400).json({ok:false,error:"확인코드를 다시 확인해 주세요."})
    if(!b.riskAgree||!b.infoAgree) return res.status(400).json({ok:false,error:"계약내용·위험고지와 최종정보 확인에 모두 동의해 주세요."})
    if(!sig.startsWith("data:image/png;base64,")||sig.length>750000) return res.status(400).json({ok:false,error:"전자서명 이미지가 없거나 너무 큽니다."})
    const rows=await sb(`kccs_contracts?public_token=eq.${encodeURIComponent(token)}&select=*&limit=1`,{method:"GET"})
    const x=rows?.[0]
    if(!x) return res.status(404).json({ok:false,error:"유효하지 않은 서명 링크입니다."})
    if(x.status==="서명완료") return res.status(200).json({ok:true,alreadySigned:true,signedAt:x.signed_at})
    if(x.code_expires_at && Date.now()>Date.parse(x.code_expires_at)) return res.status(410).json({ok:false,error:"확인코드 유효시간이 만료되었습니다."})
    if(sha256(`${x.verification_code_salt}:${code}`)!==x.verification_code_hash) return res.status(401).json({ok:false,error:"확인코드가 일치하지 않습니다."})
    if(signName!==String(x.name||"").trim()) return res.status(400).json({ok:false,error:"전자서명자 성명은 계약자 성명과 동일해야 합니다."})
    const when=new Date().toISOString()
    const patch={status:"서명완료",risk_agreed:true,info_agreed:true,signed_name:signName,customer_signature_data:sig,signed_at:when}
    await sb(`kccs_contracts?public_token=eq.${encodeURIComponent(token)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(patch)})
    res.status(200).json({ok:true,signedAt:when,contractNo:x.contract_no})
  }catch(e:any){ res.status(500).json({ok:false,error:e?.message||"전자서명 저장 실패"}) }
}

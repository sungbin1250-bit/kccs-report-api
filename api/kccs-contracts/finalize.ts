import { preflight, requireAllowedOrigin, requireOfficeKey, sb, money, newCode, newToken, newContractNo, sha256, signBaseUrl, mapRow } from "./_shared"
export default async function handler(req:any,res:any){
  if(preflight(req,res)) return
  if(!requireAllowedOrigin(req,res) || !requireOfficeKey(req,res)) return
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"POST only"})
  try{
    const b=req.body||{}
    if(!b.id||!b.name||!b.depositAmount||!b.depositDate||!b.txid) return res.status(400).json({ok:false,error:"계약 확정 필수정보가 부족합니다."})
    const existing=await sb(`kccs_contracts?application_id=eq.${encodeURIComponent(String(b.id))}&select=*&limit=1`,{method:"GET"})
    const prev=existing?.[0]||null
    const code=newCode(), salt=newToken(), token=newToken()
    const contractNo=prev?.contract_no||String(b.contractNo||"")||newContractNo()
    const expires=new Date(Date.now()+72*60*60*1000).toISOString()
    const row={
      application_id:String(b.id), application_date:b.applicationDate||null,
      pbcode:String(b.pbcode||""), name:String(b.name), birth:String(b.birth||""),
      phone:String(b.phone||""), email:String(b.email||""), address:String(b.address||""),
      application_amount:money(b.amount), currency:String(b.currency||"USDT"),
      deposit_amount:money(b.depositAmount), deposit_date:b.depositDate,
      txid:String(b.txid), mismatch_reason:String(b.mismatchReason||""), mismatch_note:String(b.mismatchNote||""),
      contract_no:contractNo, status:"서명대기", public_token:token,
      verification_code_salt:salt, verification_code_hash:sha256(`${salt}:${code}`), code_expires_at:expires,
      company_signer:String(b.companySigner||""), company_signature_data:String(b.companySign||""),
      risk_agreed:false, info_agreed:false, signed_name:null, customer_signature_data:null, signed_at:null
    }
    const data=await sb("kccs_contracts?on_conflict=application_id",{
      method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=representation"}, body:JSON.stringify(row)
    })
    const signUrl=`${signBaseUrl()}?token=${encodeURIComponent(token)}`
    res.status(200).json({ok:true,row:mapRow(data?.[0]||row),contractNo,code,publicToken:token,signUrl,expiresAt:expires})
  }catch(e:any){ res.status(500).json({ok:false,error:e?.message||"계약 확정 실패"}) }
}

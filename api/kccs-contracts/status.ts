import { preflight, requireAllowedOrigin, sb } from "./_shared"
export default async function handler(req:any,res:any){
  if(preflight(req,res)) return
  if(!requireAllowedOrigin(req,res)) return
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"GET only"})
  try{
    const token=String(req.query?.token||"")
    if(!token) return res.status(400).json({ok:false,error:"token required"})
    const rows=await sb(`kccs_contracts?public_token=eq.${encodeURIComponent(token)}&select=contract_no,status,signed_at&limit=1`,{method:"GET"})
    const x=rows?.[0]
    if(!x) return res.status(404).json({ok:false,error:"계약을 찾을 수 없습니다."})
    res.status(200).json({ok:true,contractNo:x.contract_no,status:x.status,signedAt:x.signed_at||""})
  }catch(e:any){ res.status(500).json({ok:false,error:e?.message||"상태 확인 실패"}) }
}

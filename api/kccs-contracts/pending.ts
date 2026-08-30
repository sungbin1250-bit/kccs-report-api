import { preflight, requireAllowedOrigin, requireOfficeKey, sb, money, mapRow } from "./_shared"
export default async function handler(req:any,res:any){
  if(preflight(req,res)) return
  if(!requireAllowedOrigin(req,res) || !requireOfficeKey(req,res)) return
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"POST only"})
  try{
    const b=req.body||{}
    if(!b.id||!b.name||!b.birth||!b.phone||!b.amount||!b.currency) return res.status(400).json({ok:false,error:"필수 신청정보가 부족합니다."})
    const row={
      application_id:String(b.id), application_date:b.applicationDate||null,
      pbcode:String(b.pbcode||""), name:String(b.name), birth:String(b.birth||""),
      phone:String(b.phone||""), email:String(b.email||""), address:String(b.address||""),
      application_amount:money(b.amount), currency:String(b.currency||"USDT"), status:"입금대기"
    }
    const data=await sb("kccs_contracts?on_conflict=application_id",{
      method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=representation"}, body:JSON.stringify(row)
    })
    res.status(200).json({ok:true,row:mapRow(data?.[0]||row)})
  }catch(e:any){ res.status(500).json({ok:false,error:e?.message||"입금대기 저장 실패"}) }
}

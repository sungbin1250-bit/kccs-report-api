import { preflight, requireAllowedOrigin, sb } from "./_shared"
export default async function handler(req:any,res:any){
  if(preflight(req,res)) return
  if(!requireAllowedOrigin(req,res)) return
  try{
    await sb("kccs_contracts?select=id&limit=1", { method:"GET" })
    res.status(200).json({ok:true, service:"kccs-remote-esign"})
  }catch(e:any){ res.status(500).json({ok:false,error:e?.message||"health failed"}) }
}

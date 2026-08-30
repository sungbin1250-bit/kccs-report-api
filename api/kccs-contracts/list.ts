import { preflight, requireAllowedOrigin, requireOfficeKey, sb, mapRow } from "./_shared"
export default async function handler(req:any,res:any){
  if(preflight(req,res)) return
  if(!requireAllowedOrigin(req,res) || !requireOfficeKey(req,res)) return
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"GET only"})
  try{
    const rows=await sb("kccs_contracts?select=*&order=created_at.desc&limit=200",{method:"GET"})
    res.status(200).json({ok:true,rows:(rows||[]).map(mapRow)})
  }catch(e:any){ res.status(500).json({ok:false,error:e?.message||"목록 조회 실패"}) }
}

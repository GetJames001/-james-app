const {requireAuth}=require('../auth.js');
const regions=new Set(['pnw','psw']);
const cache=new Map();

async function latestImage(region){
  const saved=cache.get(region);
  if(saved && Date.now()-saved.checked<300000)return saved.image;
  const response=await fetch('https://www.star.nesdis.noaa.gov/GOES/sector.php?sat=G18&sector='+region,{signal:AbortSignal.timeout(6000)});
  if(!response.ok)throw Error('Satellite unavailable');
  const page=await response.text();
  const pattern=new RegExp('(\\d{11})_GOES18-ABI-'+region+'-GEOCOLOR-600x600\\.jpg');
  const stamp=page.match(pattern)?.[1];
  if(!stamp)throw Error('Missing frame');
  const taken=Date.UTC(+stamp.slice(0,4),0,+stamp.slice(4,7),+stamp.slice(7,9),+stamp.slice(9));
  const age=Date.now()-taken;
  if(age<0 || age>60*60000)throw Error('No recent frame');
  const image={url:'https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/'+region+'/GEOCOLOR/'+stamp+'_GOES18-ABI-'+region+'-GEOCOLOR-600x600.jpg',taken};
  cache.set(region,{checked:Date.now(),image});
  return image;
}

module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(!requireAuth(req,res))return;
  if(req.method!=='GET')return res.status(405).end();
  if(!regions.has(req.query.region))return res.status(400).end();
  try{return res.json(await latestImage(req.query.region));}
  catch{return res.status(503).json({error:'Satellite unavailable'});}
};

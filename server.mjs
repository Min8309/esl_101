import {assetPath} from './server-path.mjs';
import {loadTranscript,transcriptInput} from './youtube-transcript.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));

export function createAppServer({transcript=loadTranscript}={}) {
  let importing=false;
  return http.createServer(async(req,res)=>{
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    let pathname;
    try {pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);} catch {res.writeHead(400);res.end('Bad request');return;}
    if(pathname==='/api/youtube-transcript') {
      if(req.method!=='POST'){res.setHeader('Allow','POST');json(405,{error:'POST 요청이 필요합니다.'});return;}
      const origin=req.headers.origin;
      if(origin && origin!==`http://${req.headers.host}` && origin!==`https://${req.headers.host}`){json(403,{error:'앱과 같은 주소에서 요청하세요.'});return;}
      if(!req.headers['content-type']?.startsWith('application/json')){json(415,{error:'JSON 요청이 필요합니다.'});return;}
      if(importing){json(429,{error:'다른 자막을 불러오는 중입니다. 완료 후 다시 시도하세요.'});return;}
      importing=true;
      try {
        let body='';
        for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)throw Object.assign(Error('요청이 너무 큽니다.'),{status:413});}
        let input;
        try {input=JSON.parse(body);} catch {throw Object.assign(Error('요청 형식이 올바르지 않습니다.'),{status:400});}
        if(!input || typeof input.url!=='string')throw Object.assign(Error('유튜브 주소를 입력하세요.'),{status:400});
        transcriptInput(input.url,input.language);
        json(200,await transcript(input.url,input.language));
      } catch(e){json(e.status||502,{error:e.status?e.message:'자막을 가져오지 못했습니다. 잠시 후 다시 시도하세요.'});}
      finally{importing=false;}
      return;
    }
    try {
      const data=await readFile(assetPath(root,pathname));
      res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[extname(pathname==='/'?'index.html':pathname)]||'application/octet-stream'});res.end(data);
    } catch {res.writeHead(404);res.end('Not found');}
  });
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=process.env.PORT||3000;
  createAppServer().listen(port,'0.0.0.0',()=>console.log(`말줍: http://localhost:${port}`));
}

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {videoId} from './src/core.js';
const run = promisify(execFile);
const worker = fileURLToPath(new URL('./scripts/youtube_transcript.py', import.meta.url));
export function transcriptInput(value, language = 'en') {
  let url;
  try {url = new URL(value);} catch {}
  const id = url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.port && videoId(value);
  if (!id || !['en', 'ko', 'ja'].includes(language)) {
    throw Object.assign(Error('올바른 유튜브 영상 주소와 자막 언어를 선택하세요.'), {status: 400});
  }
  return {id, language};
}
export async function loadTranscript(value, language) {
  const input = transcriptInput(value, language);
  let stdout;
  try {
    ({stdout} = await run(process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3'),
      [worker, input.id, input.language], {timeout: 65000, maxBuffer: 8 * 1024 * 1024, windowsHide: true}));
  } catch (e) {
    if (e.code === 'ENOENT') throw Object.assign(Error('Python 3.10 이상을 설치하고 python -m pip install -r requirements-youtube.txt 를 실행하세요.'), {status: 503});
    throw Object.assign(Error('자막 도구 실행이 실패했거나 시간이 초과되었습니다. 설치 상태와 네트워크를 확인하세요.'), {status: 502});
  }
  let result;
  try { result = JSON.parse(stdout); } catch {throw Object.assign(Error('자막 도구 응답을 읽지 못했습니다.'), {status: 502});}
  if (result.error) {
    console.error('[youtube-transcript]',JSON.stringify({video:input.id,phase:result.phase||'setup',code:result.code||'YOUTUBE_UNAVAILABLE'}));
    throw Object.assign(Error(result.error), {code:result.code,status: result.code === 'TOOL_MISSING' ? 503 : result.code === 'NO_CAPTIONS' ? 404 : result.code === 'RATE_LIMITED' ? 429 : 502});
  }
  return result;
}

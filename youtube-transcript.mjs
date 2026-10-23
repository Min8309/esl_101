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
  const provider = process.env.TRANSCRIPT_PROVIDER || (process.env.SUPADATA_API_KEY?.trim() ? 'supadata' : 'local');
  if (provider === 'supadata') return supadata(input);
  if (provider !== 'local') throw apiError('자막 제공자 설정을 확인하세요.', 'API_CONFIG_ERROR', 503);
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


function apiError(message, code, status = 502) {
  return Object.assign(Error(message), {code, status});
}

// Fixed HTTPS destination: API keys never reach browser assets or arbitrary URLs.
export function createSupadataLoader({fetcher = globalThis.fetch, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  getKey = () => process.env.SUPADATA_API_KEY?.trim()} = {}) {
  const cache = new Map();
  const pending = new Map();
  let requests = [];
  return async function load({id, language}) {
    const key = getKey();
    if (!key) throw apiError('Render 환경 변수에 SUPADATA_API_KEY를 등록하세요.', 'API_KEY_MISSING', 503);
    const cacheKey = `${id}:${language}`;
    const saved = cache.get(cacheKey);
    if (saved && saved.expires > now()) return saved.data;
    if (pending.has(cacheKey)) return pending.get(cacheKey);
    requests = requests.filter(time => time > now() - 60000);
    if (requests.length >= 10) throw apiError('자막 요청이 많습니다. 1분 뒤 다시 시도하세요.', 'API_RATE_LIMITED', 429);
    requests.push(now());
    const promise = retrieve();
    pending.set(cacheKey, promise);
    try { return await promise; } finally { pending.delete(cacheKey); }

    async function retrieve() {
      const signal = AbortSignal.timeout(55000);
      async function request(path) {
        let response;
        try {
          response = await fetcher(`https://api.supadata.ai/v1/${path}`, {
            headers: {'x-api-key': key, Accept: 'application/json'}, signal, redirect: 'error'
          });
        } catch {
          throw apiError('자막 API에 연결하지 못했거나 시간이 초과되었습니다. 잠시 후 다시 시도하세요.', 'API_NETWORK_ERROR');
        }
        if (!response.ok) {
          await response.body?.cancel();
          if ([401, 403].includes(response.status)) throw apiError('Supadata API 키와 계정 권한을 확인하세요.', 'API_AUTH_ERROR', 503);
          if (response.status === 402) throw apiError('Supadata 크레딧 또는 요금제 한도를 확인하세요.', 'API_QUOTA_EXCEEDED', 503);
          if (response.status === 429) throw apiError('Supadata 요청 또는 사용량 한도에 도달했습니다. 대시보드를 확인하세요.', 'API_RATE_LIMITED', 429);
          if ([404, 422].includes(response.status)) throw apiError('이 영상의 공개 자막을 API에서 찾지 못했습니다. 영상과 자막 언어를 확인하세요.', 'NO_CAPTIONS', 404);
          throw apiError('자막 API에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.', 'API_UPSTREAM_ERROR');
        }
        let body;
        try {
          const chunks = []; let size = 0;
          for await (const chunk of response.body) {
            size += chunk.byteLength;
            if (size > 8 * 1024 * 1024) throw Error('too large');
            chunks.push(chunk);
          }
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          throw apiError('자막 API 응답 형식을 읽지 못했거나 응답이 너무 큽니다.', 'API_FORMAT_ERROR');
        }
        return body;
      }
      const params = new URLSearchParams({url: `https://www.youtube.com/watch?v=${id}`, lang: language, text: 'false', mode: 'native'});
      let result = await request(`transcript?${params}`);
      if (result?.jobId) {
        const jobId = result.jobId;
        if (typeof jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(jobId)) throw apiError('자막 API 작업 응답이 올바르지 않습니다.', 'API_FORMAT_ERROR');
        for (let attempts = 0; attempts < 25; attempts++) {
          await sleep(1500);
          result = await request(`transcript/${encodeURIComponent(jobId)}`);
          if (result?.status === 'completed') { result = result.result || result; break; }
          if (result?.status === 'failed') throw apiError('자막 API 작업이 실패했습니다. 다른 영상이나 자막 파일을 사용하세요.', 'API_UPSTREAM_ERROR');
          if (!['queued', 'active'].includes(result?.status)) throw apiError('자막 API 작업 상태를 읽지 못했습니다.', 'API_FORMAT_ERROR');
        }
      }
      if (result?.status === 'queued' || result?.status === 'active') throw apiError('자막 준비 시간이 초과되었습니다. 잠시 후 다시 시도하세요.', 'API_TIMEOUT');
      if (!Array.isArray(result?.content) || typeof result.lang !== 'string') throw apiError('시간 정보가 있는 자막 응답을 읽지 못했습니다.', 'API_FORMAT_ERROR');
      if (result.lang !== language && !result.lang.startsWith(language + '-')) throw apiError('선택한 언어의 자막을 찾지 못했습니다. 다른 언어를 선택하세요.', 'NO_CAPTIONS', 404);
      const cues = result.content.map(chunk => {
        if (typeof chunk?.text !== 'string' || typeof chunk.offset !== 'number' || !Number.isFinite(chunk.offset) || chunk.offset < 0)
          throw apiError('자막의 시간 또는 문장 형식이 올바르지 않습니다.', 'API_FORMAT_ERROR');
        return {start: chunk.offset / 1000, text: chunk.text.trim()};
      }).filter(cue => cue.text).sort((a, b) => a.start - b.start);
      if (!cues.length) throw apiError('이 영상의 자막 내용이 비어 있습니다.', 'NO_CAPTIONS', 404);
      const data = {title: `YouTube · ${id}`, url: `https://www.youtube.com/watch?v=${id}`, language: result.lang,
        automatic: null, provider: 'supadata', cues};
      if (cache.size >= 40) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, {expires: now() + 30 * 60000, data});
      return data;
    }
  };
}
const supadata = createSupadataLoader();

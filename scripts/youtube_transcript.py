"""Read publicly available YouTube captions. Never download video or audio."""
import html
import json
import math
import re
import sys


def select_track(info, language):
    for automatic, tracks in [(False, info.get('subtitles') or {}),
                              (True, info.get('automatic_captions') or {})]:
        languages = [language] + sorted(k for k in tracks if k.startswith(language + '-'))
        for key in languages:
            for fmt in ('json3', 'vtt'):
                for track in tracks.get(key, []):
                    if track.get('ext') == fmt:
                        return key, automatic, track
    return None


def parse_captions(data):
    cues = []
    for event in data.get('events', []):
        text = html.unescape(''.join(s.get('utf8', '') for s in event.get('segs', []))).strip()
        start = event.get('tStartMs')
        if text and isinstance(start, (int, float)) and not isinstance(start, bool) and math.isfinite(start) and start >= 0:
            cue = {'start': start / 1000, 'text': text}
            if not cues or cue != cues[-1]:
                cues.append(cue)
    return cues


def parse_vtt(raw):
    cues = []
    def seconds(value):
        total = 0.0
        for part in value.split(':'):
            total = total * 60 + float(part.replace(',', '.'))
        return total
    for block in re.split(r'\n\s*\n', raw.replace('\r', '')):
        lines = block.split('\n')
        for index, line in enumerate(lines):
            match = re.match(r'\s*((?:\d+:)?\d{2}:\d{2}[.,]\d+)\s+-->', line)
            if match:
                text = html.unescape(re.sub(r'<[^>]*>', '', ' '.join(lines[index + 1:]))).strip()
                if text:
                    cues.append({'start': seconds(match.group(1)), 'text': text})
                break
    return cues


def classify_error(exc, phase):
    message = str(exc).lower()
    if any(word in message for word in ('429', 'too many requests', 'rate limit')):
        return {'code': 'RATE_LIMITED', 'error': 'YouTube가 서버의 요청을 일시적으로 제한했습니다. 반복 요청을 멈추고 나중에 다시 시도하세요.'}
    if any(word in message for word in ('not a bot', 'sign in to confirm', 'bot detection')):
        return {'code': 'YOUTUBE_BOT_CHECK', 'error': 'YouTube가 이 서버에 봇 확인 또는 로그인을 요구하고 있습니다. 브라우저에서 자막이 보여도 Render 서버에서는 가져오기가 차단될 수 있습니다. 자막 파일 불러오기를 이용하거나 로컬 앱에서 확인하세요.'}
    if any(word in message for word in ('age-restricted', 'age restricted', 'private video', 'not available in your country', 'video unavailable', 'members-only')):
        return {'code': 'VIDEO_RESTRICTED', 'error': '이 영상은 비공개·연령·지역·회원 제한으로 서버에서 접근할 수 없습니다.'}
    if 'tunnel connection failed' in message or 'proxyerror' in message:
        return {'code': 'NETWORK_ERROR', 'error': '서버의 네트워크 프록시가 YouTube 접속을 허용하지 않았습니다. 서버 네트워크 설정을 확인해야 합니다.'}
    if any(word in message for word in ('403', 'forbidden', 'po token', 'potoken')):
        return {'code': 'YOUTUBE_ACCESS_DENIED', 'error': 'YouTube가 서버의 영상 또는 자막 요청을 거부했습니다. 영상에 자막이 없다는 뜻은 아닙니다. 자막 파일 불러오기나 로컬 앱을 이용해 확인하세요.'}
    if any(word in message for word in ('timed out', 'timeout', 'certificate', 'ssl', 'connection', 'name resolution', 'proxy', 'network')):
        return {'code': 'NETWORK_ERROR', 'error': '서버에서 YouTube에 연결하지 못했습니다. 서버 네트워크 또는 인증서 설정을 확인해야 합니다.'}
    if phase == 'parse':
        return {'code': 'CAPTION_FORMAT_ERROR', 'error': '자막 응답 형식을 읽지 못했습니다. 잠시 후 다시 시도하거나 자막 파일로 불러오세요.'}
    return {'code': 'YOUTUBE_UNAVAILABLE', 'error': '서버에서 YouTube 자막을 가져오지 못했습니다. Render 로그의 youtube-transcript 오류 코드로 원인을 확인할 수 있습니다.'}


def main():
    try:
        import yt_dlp
        from yt_dlp.networking import Request
    except ImportError:
        return {'error': '자막 도구를 먼저 설치하세요: python -m pip install -r requirements-youtube.txt', 'code': 'TOOL_MISSING'}
    video_id, language = sys.argv[1:3]
    if not re.fullmatch(r'[\w-]{11}', video_id) or language not in ('en', 'ko', 'ja'):
        return {'error': '영상 주소 또는 자막 언어가 올바르지 않습니다.', 'code': 'INVALID_INPUT'}
    url = 'https://www.youtube.com/watch?v=' + video_id
    class Logger:
        def debug(self, msg): pass
        def warning(self, msg): pass
        def error(self, msg): pass
    phase = 'metadata'
    try:
        with yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True, 'logger': Logger(),
                              'skip_download': True, 'noplaylist': True, 'socket_timeout': 15,
                              'retries': 1, 'extractor_retries': 1, 'cachedir': False,
                              'extractor_args': {'youtube': {'skip': ['translated_subs']}},
                              'js_runtimes': {'node': {}}}) as ydl:
            info = ydl.extract_info(url, download=False, process=False)
            selected = select_track(info, language)
            if not selected:
                languages = sorted(set(info.get('subtitles', {})) | set(info.get('automatic_captions', {})))
                available = ', '.join(languages[:12]) or '없음'
                return {'error': '선택한 언어의 읽을 수 있는 공개 자막을 찾지 못했습니다. 확인된 자막 언어: ' + available + '. 해당 언어를 선택하거나 자막 파일을 사용하세요.', 'code': 'NO_CAPTIONS', 'phase': 'metadata'}
            lang, automatic, track = selected
            phase = 'captions'
            headers = {**(info.get('http_headers') or {}), **(track.get('http_headers') or {})}
            with ydl.urlopen(Request(track['url'], headers=headers)) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                return {'error': '자막이 너무 큽니다. 짧은 영상을 선택하세요.', 'code': 'TOO_LARGE'}
            phase = 'parse'
            cues = parse_captions(json.loads(raw)) if track['ext'] == 'json3' else parse_vtt(raw.decode('utf-8-sig'))
            if not cues:
                return {'error': '자막 내용이 비어 있습니다. 다른 언어나 영상을 선택하세요.', 'code': 'NO_CAPTIONS'}
            return {'title': info.get('title') or video_id, 'url': url, 'language': lang,
                    'automatic': automatic, 'cues': cues}
    except Exception as exc:
        return {**classify_error(exc, phase), 'phase': phase}



if __name__ == '__main__':
    print(json.dumps(main(), ensure_ascii=True))

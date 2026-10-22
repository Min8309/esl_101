"""Read publicly available YouTube captions. Never download video or audio."""
import html
import json
import re
import sys


def select_track(info, language):
    for automatic, tracks in [(False, info.get('subtitles') or {}),
                              (True, info.get('automatic_captions') or {})]:
        languages = [language] + sorted(k for k in tracks if k.startswith(language + '-'))
        for key in languages:
            for track in tracks.get(key, []):
                if track.get('ext') == 'json3':
                    return key, automatic, track
    return None


def parse_captions(data):
    cues = []
    for event in data.get('events', []):
        text = html.unescape(''.join(s.get('utf8', '') for s in event.get('segs', []))).strip()
        start = event.get('tStartMs')
        if text and isinstance(start, (int, float)) and start >= 0:
            cue = {'start': start / 1000, 'text': text}
            if not cues or cue != cues[-1]:
                cues.append(cue)
    return cues


def main():
    try:
        import yt_dlp
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
    try:
        with yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True, 'logger': Logger(),
                              'skip_download': True, 'noplaylist': True, 'socket_timeout': 15,
                              'retries': 1, 'extractor_retries': 1, 'cachedir': False,
                              'extractor_args': {'youtube': {'skip': ['translated_subs']}},
                              'js_runtimes': {'node': {}}}) as ydl:
            info = ydl.extract_info(url, download=False, process=False)
            selected = select_track(info, language)
            if not selected:
                return {'error': '선택한 언어의 공개 자막이 없습니다. 다른 언어를 선택하거나 자막 파일을 사용하세요.', 'code': 'NO_CAPTIONS'}
            lang, automatic, track = selected
            with ydl.urlopen(track['url']) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                return {'error': '자막이 너무 큽니다. 짧은 영상을 선택하세요.', 'code': 'TOO_LARGE'}
            cues = parse_captions(json.loads(raw))
            if not cues:
                return {'error': '자막 내용이 비어 있습니다. 다른 언어나 영상을 선택하세요.', 'code': 'NO_CAPTIONS'}
            return {'title': info.get('title') or video_id, 'url': url, 'language': lang,
                    'automatic': automatic, 'cues': cues}
    except Exception:
        return {'error': '유튜브에서 자막을 가져오지 못했습니다. 비공개·연령 제한·지역 제한·접근 차단 또는 네트워크 문제일 수 있습니다. 유튜브에서 공개 자막을 확인하고 잠시 후 다시 시도하세요.', 'code': 'YOUTUBE_UNAVAILABLE'}


if __name__ == '__main__':
    print(json.dumps(main(), ensure_ascii=True))

import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('transcript', Path(__file__).resolve().parents[1] / 'scripts/youtube_transcript.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class TranscriptTests(unittest.TestCase):
    def test_manual_before_auto_and_regional_language(self):
        manual = {'ext': 'json3', 'url': 'manual'}
        auto = {'ext': 'json3', 'url': 'auto'}
        self.assertEqual(worker.select_track({'subtitles': {'en-US': [manual]}, 'automatic_captions': {'en': [auto]}}, 'en'), ('en-US', False, manual))
        self.assertEqual(worker.select_track({'automatic_captions': {'en': [auto]}}, 'en'), ('en', True, auto))
        self.assertIsNone(worker.select_track({'subtitles': {'fr': [manual]}}, 'en'))

    def test_segments_timestamps_entities_empty_events_and_duplicates(self):
        event = {'tStartMs': 1230, 'segs': [{'utf8': 'Hello '}, {'utf8': '&amp; welcome'}]}
        self.assertEqual(worker.parse_captions({'events': [{}, event, event, {'tStartMs': 5, 'segs': [{'utf8': '\n'}]}]}), [{'start': 1.23, 'text': 'Hello & welcome'}])

    def test_worker_fetches_selected_caption_and_preserves_video_metadata(self):
        seen = {}
        class FakeYDL:
            def __init__(self, options): self.options = options; seen['options'] = options
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def extract_info(self, url, **kwargs):
                seen['url'], seen['kwargs'] = url, kwargs
                return {'title': 'A lesson', 'http_headers': {'User-Agent': 'test-agent', 'Referer': 'https://www.youtube.com/'}, 'automatic_captions': {'en': [{'ext': 'json3', 'url': 'caption-url'}]}}
            def urlopen(self, request):
                seen['caption'] = request.url
                seen['headers'] = request.headers
                return io.BytesIO(json.dumps({'events': [{'tStartMs': 4200, 'segs': [{'utf8': 'A phrase'}]}]}).encode())
        class FakeRequest:
            def __init__(self, url, headers): self.url, self.headers = url, headers
        with patch.dict(sys.modules, {'yt_dlp': types.SimpleNamespace(YoutubeDL=FakeYDL), 'yt_dlp.networking': types.SimpleNamespace(Request=FakeRequest)}), patch.object(sys, 'argv', ['worker', 'HWv1x2We9ag', 'en']):
            result = worker.main()
        self.assertEqual(result['cues'], [{'start': 4.2, 'text': 'A phrase'}])
        self.assertEqual(result['title'], 'A lesson')
        self.assertTrue(result['automatic'])
        self.assertEqual(seen['caption'], 'caption-url')
        self.assertEqual(seen['headers']['User-Agent'], 'test-agent')
        self.assertEqual(seen['headers']['Referer'], 'https://www.youtube.com/')
        self.assertEqual(seen['kwargs'], {'download': False, 'process': False})
        self.assertTrue(seen['options']['skip_download'])

    def test_vtt_track_fallback_and_timestamps(self):
        track = {'ext': 'vtt', 'url': 'vtt-track'}
        self.assertEqual(worker.select_track({'subtitles': {'en': [track]}}, 'en'), ('en', False, track))
        self.assertEqual(worker.parse_vtt('WEBVTT\n\n00:05:36.250 --> 00:05:38.000 align:start\nHoney &amp; <i>welcome</i>.\n'), [{'start': 336.25, 'text': 'Honey & welcome.'}])

    def test_distinguishes_access_restrictions_from_missing_captions(self):
        cases = [('HTTP Error 429: Too Many Requests', 'RATE_LIMITED'),
                 ("Sign in to confirm you’re not a bot", 'YOUTUBE_BOT_CHECK'),
                 ('HTTP Error 403: Forbidden', 'YOUTUBE_ACCESS_DENIED'),
                 ('Private video', 'VIDEO_RESTRICTED'),
                 ('Connection timed out', 'NETWORK_ERROR'),
                 ('Tunnel connection failed: 403 Forbidden; Confirm you are on the latest version', 'NETWORK_ERROR')]
        for message, code in cases:
            with self.subTest(code=code):
                error = worker.classify_error(Exception(message), 'metadata')
                self.assertEqual(error['code'], code)
                self.assertNotIn(message, error['error'])
        self.assertEqual(worker.classify_error(ValueError('secret caption URL'), 'parse')['code'], 'CAPTION_FORMAT_ERROR')

    def test_nonfinite_or_boolean_timestamps_are_ignored(self):
        self.assertEqual(worker.parse_captions({'events': [{'tStartMs': x, 'segs': [{'utf8': 'invalid'}]} for x in [float('inf'), float('nan'), True, -1]]}), [])

if __name__ == '__main__':
    unittest.main()

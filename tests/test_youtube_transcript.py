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
                return {'title': 'A lesson', 'automatic_captions': {'en': [{'ext': 'json3', 'url': 'caption-url'}]}}
            def urlopen(self, url):
                seen['caption'] = url
                return io.BytesIO(json.dumps({'events': [{'tStartMs': 4200, 'segs': [{'utf8': 'A phrase'}]}]}).encode())
        with patch.dict(sys.modules, {'yt_dlp': types.SimpleNamespace(YoutubeDL=FakeYDL)}), patch.object(sys, 'argv', ['worker', 'HWv1x2We9ag', 'en']):
            result = worker.main()
        self.assertEqual(result['cues'], [{'start': 4.2, 'text': 'A phrase'}])
        self.assertEqual(result['title'], 'A lesson')
        self.assertTrue(result['automatic'])
        self.assertEqual(seen['caption'], 'caption-url')
        self.assertEqual(seen['kwargs'], {'download': False, 'process': False})
        self.assertTrue(seen['options']['skip_download'])

if __name__ == '__main__':
    unittest.main()

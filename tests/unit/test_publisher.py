import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from import_site import import_site
from build_site import build_site
from publish_common import PublishError, canonical, release_id, release_manifest


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        (self.repo / 'sites.json').write_text('{"version":1,"sites":[]}')
        (self.repo / 'portal').mkdir()
        (self.repo / 'portal/index.html').write_text('<title>Portal</title>')
        (self.repo / 'portal/app.js').write_text('fetch("./sites.json")')
        self.artifact = self.base / 'artifact'
        self.artifact.mkdir()
        (self.artifact / 'index.html').write_text('<title>Since v1</title>')
        (self.artifact / 'old.js').write_text('old version')
        self.output = self.base / 'published'

    def import_since(self):
        return import_site(self.repo, 'since', self.artifact, '判断力', '主题与来源')

    def snapshot(self, folder):
        return {p.relative_to(folder).as_posix(): p.read_bytes() for p in folder.rglob('*') if p.is_file()}

    def test_second_site_survives_local_update_and_old_files_are_removed(self):
        first = self.import_since()
        second_artifact = self.base / 'second'
        second_artifact.mkdir()
        (second_artifact / 'index.html').write_text('<title>Second</title>')
        import_site(self.repo, 'second', second_artifact, '第二站', '独立示例')
        other_before = self.snapshot(self.repo / 'sites/second')
        release_before = (self.repo / 'releases/second.json').read_bytes()
        registry_before = json.loads((self.repo / 'sites.json').read_text())['sites'][1]
        (self.artifact / 'index.html').write_text('<title>Since v2</title>')
        (self.artifact / 'old.js').unlink()
        (self.artifact / 'new.js').write_text('new version')
        updated = self.import_since()
        self.assertEqual(updated['previous_release_id'], first['release_id'])
        self.assertNotEqual(updated['release_id'], first['release_id'])
        self.assertFalse((self.repo / 'sites/since/old.js').exists())
        self.assertTrue((self.repo / 'sites/since/new.js').exists())
        self.assertEqual(self.snapshot(self.repo / 'sites/second'), other_before)
        self.assertEqual((self.repo / 'releases/second.json').read_bytes(), release_before)
        self.assertEqual(json.loads((self.repo / 'sites.json').read_text())['sites'][1], registry_before)
        result = build_site(self.repo, self.output)
        self.assertEqual(result['sites'], ['since', 'second'])
        self.assertEqual((self.output / 'since/index.html').read_text(), '<title>Since v2</title>')
        self.assertEqual((self.output / 'second/index.html').read_text(), '<title>Second</title>')
        self.assertTrue((self.output / '.nojekyll').exists())
        for unwanted in ('releases', 'sites', 'tools', '.git'):
            self.assertFalse((self.output / unwanted).exists())

    def test_release_is_reproducible_traceable_and_idempotent(self):
        first = self.import_since()
        before = (self.repo / 'releases/since.json').read_bytes()
        second = self.import_since()
        self.assertEqual(first['release_id'], second['release_id'])
        self.assertEqual(before, (self.repo / 'releases/since.json').read_bytes())
        manifest = release_manifest(self.repo, 'since')
        self.assertEqual(manifest['release_id'], hashlib.sha256(canonical({'site_id': 'since', 'files': manifest['files']})).hexdigest())
        self.assertEqual(manifest['files'], sorted(manifest['files'], key=lambda f: f['path']))

    def test_build_rejects_tampered_file_missing_file_and_extra_file(self):
        self.import_since()
        path = self.repo / 'sites/since/index.html'
        path.write_text('tampered')
        with self.assertRaisesRegex(PublishError, '清单不匹配'):
            build_site(self.repo, self.output)
        self.assertFalse(self.output.exists())
        path.write_bytes((self.artifact / 'index.html').read_bytes())
        path.unlink()
        with self.assertRaises(PublishError):
            build_site(self.repo, self.output)
        path.write_bytes((self.artifact / 'index.html').read_bytes())
        (path.parent / 'extra.html').write_text('untracked content')
        with self.assertRaisesRegex(PublishError, '清单不匹配'):
            build_site(self.repo, self.output)

    def test_corrupt_manifest_hash_and_traversal_are_rejected(self):
        self.import_since()
        path = self.repo / 'releases/since.json'
        original = json.loads(path.read_text())
        for kind in ('release_hash', 'file_hash', 'traversal'):
            with self.subTest(kind=kind):
                manifest = copy.deepcopy(original)
                if kind == 'release_hash':
                    manifest['release_id'] = '0' * 64
                elif kind == 'file_hash':
                    manifest['files'][0]['sha256'] = '0' * 64
                    manifest['release_id'] = release_id('since', manifest['files'])
                else:
                    manifest['files'][0]['path'] = '../escape.html'
                    manifest['release_id'] = release_id('since', manifest['files'])
                path.write_text(json.dumps(manifest))
                with self.assertRaises(PublishError):
                    build_site(self.repo, self.output)
                self.assertFalse(self.output.exists())

    def test_site_id_and_registry_path_are_strict(self):
        before = (self.repo / 'sites.json').read_bytes()
        for key in ('../since', 'a/b', 'Since', '1since', 'a' * 49, '.env'):
            with self.subTest(key=key), self.assertRaises(PublishError):
                import_site(self.repo, key, self.artifact, '标题', '描述')
        self.assertEqual((self.repo / 'sites.json').read_bytes(), before)
        (self.repo / 'sites.json').write_text('{"version":1,"sites":[{"id":"since","title":"x","description":"x","path":"https://evil/"}]}')
        with self.assertRaises(PublishError):
            build_site(self.repo, self.output)

    def test_symlinks_hidden_credentials_private_keys_and_nonstatic_sources_are_rejected(self):
        for name, content in (('.env', 'API_KEY=secret'), ('credentials.json', '{}'), ('main.py', 'print(1)'), ('private.txt', '-----BEGIN PRIVATE KEY-----')):
            with self.subTest(name=name):
                path = self.artifact / name
                path.write_text(content)
                with self.assertRaises(PublishError):
                    self.import_since()
                path.unlink()
        (self.artifact / 'link.js').symlink_to(self.repo / 'sites.json')
        with self.assertRaises(PublishError):
            self.import_since()
        (self.artifact / 'link.js').unlink()
        (self.artifact / 'linked').symlink_to(self.repo, target_is_directory=True)
        with self.assertRaises(PublishError):
            self.import_since()

    def test_unregistered_directory_and_source_overlap_are_not_overwritten(self):
        target = self.repo / 'sites/since'
        target.mkdir(parents=True)
        (target / 'keep.txt').write_text('keep')
        with self.assertRaisesRegex(PublishError, '未登记'):
            self.import_since()
        self.assertEqual((target / 'keep.txt').read_text(), 'keep')
        for artifact in (self.repo, target, self.base):
            with self.assertRaises(PublishError):
                import_site(self.repo, 'other', artifact, 'x', 'y')

    def test_failed_local_update_restores_previous_site_manifest_and_registry(self):
        self.import_since()
        old_site = self.snapshot(self.repo / 'sites/since')
        old_registry = (self.repo / 'sites.json').read_bytes()
        old_manifest = (self.repo / 'releases/since.json').read_bytes()
        (self.artifact / 'index.html').write_text('new version')
        import os
        replace = os.replace
        def fail_registry(source, destination):
            if Path(source).name == 'new-registry.json':
                raise OSError('simulated registry write failure')
            return replace(source, destination)
        with mock.patch('import_site.os.replace', side_effect=fail_registry):
            with self.assertRaises(OSError):
                self.import_since()
        self.assertEqual(self.snapshot(self.repo / 'sites/since'), old_site)
        self.assertEqual((self.repo / 'sites.json').read_bytes(), old_registry)
        self.assertEqual((self.repo / 'releases/since.json').read_bytes(), old_manifest)
        release_manifest(self.repo, 'since')
        self.assertEqual(list(self.repo.glob('.site-import-*')), [])
        self.assertFalse((self.repo / '.publisher.lock').exists())

    def test_build_existing_output_and_failed_publish_preserve_sources(self):
        self.import_since()
        self.output.mkdir()
        (self.output / 'keep.txt').write_text('KEEP')
        with self.assertRaises(PublishError):
            build_site(self.repo, self.output)
        self.assertEqual((self.output / 'keep.txt').read_text(), 'KEEP')
        with self.assertRaises(PublishError):
            build_site(self.repo, self.repo / 'generated')
        new_output = self.base / 'failed-output'
        with mock.patch('build_site.os.rename', side_effect=OSError('publish failed')):
            with self.assertRaises(OSError):
                build_site(self.repo, new_output)
        self.assertFalse(new_output.exists())
        self.assertEqual(list(self.base.glob('.web-publish-*')), [])
        release_manifest(self.repo, 'since')

    def test_duplicate_json_keys_and_directory_links_are_rejected(self):
        self.import_since()
        path = self.repo / 'releases/since.json'
        path.write_text('{"release_id":"ignored",' + path.read_text()[1:])
        with self.assertRaisesRegex(PublishError, 'JSON字段重复'):
            build_site(self.repo, self.output)
        other = self.base / 'outside'
        other.mkdir()
        linked = self.base / 'linked-repo'
        linked.mkdir()
        (linked / 'sites').symlink_to(other, target_is_directory=True)
        (linked / 'sites.json').write_text('{"version":1,"sites":[]}')
        with self.assertRaises(PublishError):
            import_site(linked, 'since', self.artifact, 'x', 'y')


if __name__ == '__main__':
    unittest.main()

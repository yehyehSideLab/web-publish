#!/usr/bin/env python3
"""Independent CLI transaction tests and subpath browser checks; no production writes."""
import argparse
import functools
import hashlib
import http.server
import json
import re
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[2]


def inventory(root):
    return {path.relative_to(root).as_posix(): path.read_bytes() for path in root.rglob('*') if path.is_file()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo-root', default=str(ROOT))
    parser.add_argument('--built-artifact', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--playwright-path', default='/tmp/ganzhili-reference-tools/node_modules/playwright')
    parser.add_argument('--chrome', default='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    parser.add_argument('--public-url', help='Optional real Pages root; only reads this URL')
    parser.add_argument('--since-reference', help='Optional already-approved static Since artifact; never raw sources')
    args = parser.parse_args()
    source, artifact, output = Path(args.repo_root).resolve(), Path(args.built_artifact).resolve(), Path(args.output).resolve()
    assert artifact.is_dir() and (artifact/'index.html').is_file()
    assert artifact != output and artifact not in output.parents
    output.mkdir(parents=True, exist_ok=True)
    checks = []

    def check(name, value):
        assert value, name
        checks.append(name)

    def cli(repo, tool, *params, succeeds=True):
        result = subprocess.run(['python3', str(repo/'tools'/tool), '--repo-root', str(repo), *params], capture_output=True, text=True)
        if succeeds:
            assert result.returncode == 0, result.stdout+'\n'+result.stderr
        else:
            assert result.returncode != 0, 'invalid input accepted: '+tool
        return result

    with tempfile.TemporaryDirectory(prefix='web-publish-qa-') as directory:
        temporary = Path(directory); repo = temporary/'repo'; repo.mkdir()
        for folder in ['tools', 'portal']:
            shutil.copytree(source/folder, repo/folder)
        (repo/'sites.json').write_text(json.dumps({'version': 1, 'sites': []}))
        (repo/'sites').mkdir(); (repo/'releases').mkdir()
        def example(name, text):
            path = temporary/name; path.mkdir()
            (path/'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./style.css"></head><body>'+text+'</body></html>')
            (path/'style.css').write_text('body { color: #123; }\n')
            return path
        first = example('first', 'First approved static test site')
        second = example('second', 'Second approved static test site')
        updated = example('updated', 'Updated second static test site')
        def import_site(identity, path, succeeds=True):
            return cli(repo, 'import_site.py', '--site-id', identity, '--artifact', str(path), '--title', identity, '--description', 'QA temporary site', succeeds=succeeds)
        import_site('alpha', first)
        old_site = inventory(repo/'sites/alpha'); old_release = (repo/'releases/alpha.json').read_bytes()
        old_entry = json.loads((repo/'sites.json').read_text())['sites'][0]
        import_site('beta', second)
        first_beta_release = json.loads((repo/'releases/beta.json').read_text())
        before = inventory(repo)
        import_site('beta', updated)
        after = inventory(repo)
        check('updating second site retains first site byte-for-byte', inventory(repo/'sites/alpha') == old_site)
        check('first release manifest unchanged', (repo/'releases/alpha.json').read_bytes() == old_release)
        allowed = lambda path: path.startswith('sites/beta/') or path in {'sites.json', 'releases/beta.json'}
        check('single-site update touches no unrelated file', {p: b for p, b in before.items() if not allowed(p)} == {p: b for p, b in after.items() if not allowed(p)})
        registry = json.loads((repo/'sites.json').read_text())
        check('unrelated registry metadata remains unchanged', next(s for s in registry['sites'] if s['id'] == 'alpha') == old_entry)
        check('registry retains both entries with canonical paths', registry['version'] == 1 and {s['id']: s['path'] for s in registry['sites']} == {'alpha': 'alpha/', 'beta': 'beta/'})
        release = json.loads((repo/'releases/beta.json').read_text())
        check('updated release retains previous release id', release['previous_release_id'] == first_beta_release['release_id'] and release['release_id'] != first_beta_release['release_id'])
        build_count = 0
        def reject_build(name):
            nonlocal build_count
            build_count += 1; target = temporary/('rejected-'+str(build_count))
            cli(repo, 'build_site.py', '--output', str(target), succeeds=False)
            check(name, not target.exists())
        manifest = repo/'releases/alpha.json'; original = manifest.read_bytes()
        broken = json.loads(original); broken['files'][0]['sha256'] = '0'*64
        manifest.write_text(json.dumps(broken)); reject_build('hash-corrupt manifest rejected without output'); manifest.write_bytes(original)
        manifest.write_text(original.decode().replace('"version":1', '"version":1,"version":1', 1).replace('"version": 1', '"version": 1,"version": 1', 1))
        # Ensure this is actually a duplicate-key fixture regardless of serialization whitespace.
        if manifest.read_bytes() == original:
            manifest.write_text('{"version":1,'+original.decode().lstrip()[1:])
        reject_build('duplicate-key manifest rejected without output'); manifest.write_bytes(original)
        broken = json.loads(original); broken['files'][0]['path'] = '../outside.html'
        manifest.write_text(json.dumps(broken)); reject_build('escaping manifest path rejected without output'); manifest.write_bytes(original)
        extra = repo/'sites/alpha/unlisted.txt'; extra.write_text('unlisted public file')
        reject_build('unlisted file rejected without output'); extra.unlink()
        victim = repo/'sites/alpha/index.html'; original_index = victim.read_bytes(); victim.write_bytes(original_index+b'changed')
        reject_build('actual site bytes drifting from manifest rejected'); victim.write_bytes(original_index)
        broken_artifact = example('private-artifact', 'must not import')
        (broken_artifact/'archive').mkdir(); (broken_artifact/'archive/private.md').write_text('PRIVATE TEST MARKER')
        stable = inventory(repo); import_site('beta', broken_artifact, succeeds=False)
        check('rejected private artifact leaves complete repo unchanged', inventory(repo) == stable)
        broken_artifact = example('symlink-artifact', 'must not import')
        (broken_artifact/'outside.txt').symlink_to(first/'index.html')
        import_site('beta', broken_artifact, succeeds=False)
        check('rejected symlink import leaves complete repo unchanged', inventory(repo) == stable)
        assembled = temporary/'assembled'; cli(repo, 'build_site.py', '--output', str(assembled))
        check('whole-site assembly preserves first site original bytes', inventory(assembled/'alpha') == old_site)
        check('whole-site assembly publishes updated second site', inventory(assembled/'beta') == inventory(updated))
        check('whole-site assembly retains root portal and registry', (assembled/'index.html').is_file() and json.loads((assembled/'sites.json').read_text()) == registry)
        forbidden = {'.git', 'archive', 'tools', 'tests', 'docs', 'releases', '__pycache__'}
        check('assembled temporary release excludes sources and history', all(not (set(p.split('/')) & forbidden) and Path(p).suffix != '.py' for p in inventory(assembled)))
        # Verify the actual delivered release, not the temporary test sites.
        actual_files = inventory(artifact)
        check('delivered release excludes tools, sources and histories', all(not (set(p.split('/')) & forbidden) and Path(p).suffix != '.py' for p in actual_files))
        actual_registry = json.loads((artifact/'sites.json').read_text())
        allowed_suffixes = {'.html', '.js', '.css', '.svg', '.json', '.woff2', '.woff', '.ttf', '.txt', '.png', '.jpg', '.jpeg', '.ico', '.webp'}
        check('delivered files contain only public static formats', all(Path(p).suffix.lower() in allowed_suffixes or Path(p).name == '.nojekyll' for p in actual_files))
        secret = re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{20,}')
        check('delivered files contain no known credentials or environment files', all(not Path(p).name.startswith('.env') and not secret.search(b) for p, b in actual_files.items()))
        def no_history(value):
            if isinstance(value, dict): return not ({'revisions', 'parent_revision', 'request_sha256', 'operation_id', 'writer_id'} & value.keys()) and all(no_history(x) for x in value.values())
            if isinstance(value, list): return all(no_history(x) for x in value)
            return True
        check('published JSON contains no private store history or writer receipts', all(no_history(json.loads(b)) for p, b in actual_files.items() if p.endswith('.json')))
        check('delivered registry declares Since canonical child path', any(s['id'] == 'since' and s['path'] == 'since/' for s in actual_registry['sites']))
        if args.since_reference:
            check('Since exactly reuses previously approved static bytes and display tags', inventory(artifact/'since') == inventory(Path(args.since_reference).resolve()))
        views = {json.loads(p.read_text())['theme']['id']: json.loads(p.read_text()) for p in sorted((artifact/'since/data/themes').glob('*.json'))}
        check('Since ships exactly two explicit demo projections', set(views) == {'example-agent-work', 'example-information-feed'} and all(v.get('is_demo') is True for v in views.values()))
        summaries = json.loads((artifact/'since/data/themes.json').read_text())
        check('Since summaries contain only the same two demos', len(summaries) == 2 and {v['theme']['id'] for v in summaries} == set(views) and all(v.get('is_demo') is True for v in summaries))
        check('Since original markdown hashes match public projections', all(hashlib.sha256(v['analysis_markdown'].encode()).hexdigest() == v['analysis_sha256'] for v in views.values()))
        config = temporary/'expected.json'; config.write_text(json.dumps({'registry': actual_registry, 'views': views}))
        serving = temporary/'http'; serving.mkdir(); shutil.copytree(artifact, serving/'web-publish')
        class QuietHandler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_): pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(serving)))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        browser_args = ['node', str(ROOT/'tests/integration/publishing-browser.cjs')]
        try:
            subprocess.run(browser_args+['http://127.0.0.1:'+str(server.server_port)+'/web-publish/', str(config), str(output), 'local', args.playwright_path, args.chrome], check=True)
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=5)
        if args.public_url:
            subprocess.run(browser_args+[args.public_url, str(config), str(output), 'online', args.playwright_path, args.chrome], check=True)
    (output/'publishing-results.json').write_text(json.dumps({'passed': checks, 'artifact_files': [{'path': p, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()} for p, b in sorted(actual_files.items())], 'qa_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()}, indent=2))
    print(json.dumps({'integration_assertions': len(checks), 'artifact_files': len(actual_files)}))

if __name__ == '__main__': main()

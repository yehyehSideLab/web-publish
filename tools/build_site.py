#!/usr/bin/env python3
"""校验登记及每站文件清单，再将门户与独立站点组装到全新目录。"""
import argparse
import json
import os
from pathlib import Path
import shutil
import tempfile

from publish_common import PublishError, json_bytes, publish_lock, registry, release_manifest, repository, require, static_files, write_files


def build_site(repo_root, output):
    root = repository(repo_root)
    raw_output = Path(output)
    require(not raw_output.is_symlink(), '输出不能是符号链接')
    output = raw_output.resolve()
    require(not output.exists(), '输出目录已存在，拒绝覆盖')
    require(not output.is_relative_to(root), '输出不能位于发布仓库内')
    with publish_lock(root):
        catalog = registry(root)
        files = static_files(root / 'portal')
        require('sites.json' not in files, 'portal不能维护第二份sites.json')
        for entry in catalog['sites']:
            key = entry['id']
            require(not any(name.split('/')[0] == key for name in files), '站点ID与门户资产路径冲突: ' + key)
            site_files = static_files(root / 'sites' / key)
            release_manifest(root, key, site_files)
            files.update({key + '/' + path: content for path, content in site_files.items()})
        files['sites.json'] = json_bytes(catalog)
        files['.nojekyll'] = b''
        output.parent.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix='.web-publish-', dir=str(output.parent)))
        try:
            write_files(stage, files)
            require(not output.exists() and not output.is_symlink(), '构建期间输出已出现，未覆盖')
            os.rename(stage, output)
        finally:
            if stage.exists():
                shutil.rmtree(stage)
    return {'output': str(output), 'sites': [entry['id'] for entry in catalog['sites']], 'file_count': len(files), 'deployed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(build_site(args.repo_root, args.output), ensure_ascii=False, indent=2))
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()

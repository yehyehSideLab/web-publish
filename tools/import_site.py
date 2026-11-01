#!/usr/bin/env python3
"""只更新指定静态站点、登记项与发布清单，不提交Git或访问网络。"""
import argparse
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import tempfile

from publish_common import PublishError, file_inventory, json_bytes, publish_lock, registry, release_id, release_manifest, repository, require, site_id, static_files, write_files


def import_site(repo_root, key, artifact, title, description):
    root = repository(repo_root)
    key = site_id(key)
    raw_artifact = Path(artifact)
    require(not raw_artifact.is_symlink(), '静态产物目录不能是符号链接')
    artifact = raw_artifact.resolve()
    require(not artifact.is_relative_to(root) and not root.is_relative_to(artifact), '产物与发布仓库不能互相包含，避免覆盖源目录')
    files = static_files(artifact)
    inventory = file_inventory(files)
    entry = {'id': key, 'title': title, 'description': description, 'path': key + '/'}
    with publish_lock(root):
        catalog = registry(root)
        current = next((s for s in catalog['sites'] if s['id'] == key), None)
        target = root / 'sites' / key
        manifest_path = root / 'releases' / (key + '.json')
        require(not target.is_symlink() and not manifest_path.is_symlink(), '目标站点与发布清单不能为符号链接')
        if current:
            previous = release_manifest(root, key)
        else:
            require(not target.exists() and not manifest_path.exists(), '已有未登记的站点目录或清单，拒绝歧义覆盖')
            previous = None
        updated = copy.deepcopy(catalog)
        updated['sites'] = [entry if s['id'] == key else s for s in catalog['sites']]
        if current is None:
            updated['sites'].append(entry)
        # 与公开登记读取相同的契约，写前验证元数据，不放宽共享字段。
        for field, limit in (('title', 120), ('description', 1000)):
            import re
            require(isinstance(entry[field], str) and bool(entry[field].strip()) and len(entry[field]) <= limit and not re.search(r'[\x00-\x1f\x7f]', entry[field]), field + '必须为公开文本')
        version = release_id(key, inventory)
        if previous and previous['release_id'] == version:
            manifest = previous
        else:
            manifest = {'version': 1, 'site_id': key, 'release_id': version,
                        'previous_release_id': previous['release_id'] if previous else None,
                        'created_at': datetime.now(timezone.utc).isoformat(), 'files': inventory}
        stage = Path(tempfile.mkdtemp(prefix='.site-import-', dir=str(root)))
        old_registry = (root / 'sites.json').read_bytes()
        old_manifest = manifest_path.read_bytes() if previous else None
        moved_old = installed = manifest_written = registry_written = False
        recovered = True
        try:
            write_files(stage / 'new-site', files)
            (stage / 'new-registry.json').write_bytes(json_bytes(updated))
            (stage / 'new-release.json').write_bytes(json_bytes(manifest))
            (stage / 'old-registry.json').write_bytes(old_registry)
            if old_manifest is not None:
                (stage / 'old-release.json').write_bytes(old_manifest)
            target.parent.mkdir(exist_ok=True)
            manifest_path.parent.mkdir(exist_ok=True)
            if previous:
                os.rename(target, stage / 'old-site')
                moved_old = True
            os.rename(stage / 'new-site', target)
            installed = True
            os.replace(stage / 'new-release.json', manifest_path)
            manifest_written = True
            os.replace(stage / 'new-registry.json', root / 'sites.json')
            registry_written = True
        except BaseException:
            try:
                if registry_written:
                    os.replace(stage / 'old-registry.json', root / 'sites.json')
                if manifest_written:
                    if old_manifest is None:
                        manifest_path.unlink()
                    else:
                        os.replace(stage / 'old-release.json', manifest_path)
                if installed:
                    shutil.rmtree(target)
                if moved_old:
                    os.rename(stage / 'old-site', target)
            except OSError:
                recovered = False
                raise PublishError('回滚失败；保留恢复目录: ' + str(stage))
            raise
        finally:
            if recovered:
                shutil.rmtree(stage, ignore_errors=True)
    return {'site_id': key, 'release_id': version, 'previous_release_id': manifest['previous_release_id'],
            'file_count': len(files), 'registered_sites': len(updated['sites']), 'git_committed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo-root', required=True, type=Path)
    parser.add_argument('--site-id', required=True)
    parser.add_argument('--artifact', required=True, type=Path)
    parser.add_argument('--title', required=True)
    parser.add_argument('--description', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(import_site(args.repo_root, args.site_id, args.artifact, args.title, args.description), ensure_ascii=False, indent=2))
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()

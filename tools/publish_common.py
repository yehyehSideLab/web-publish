"""静态发布工具共用的路径、登记、清单和文件校验。仅使用标准库。"""
import hashlib
import json
import os
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path, PurePosixPath
import re


class PublishError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise PublishError(message)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'JSON字段重复: ' + key)
        result[key] = value
    return result


def load_json(path):
    require(not path.is_symlink(), 'JSON文件不能是符号链接')
    def invalid(value):
        raise PublishError('JSON包含非法数值: ' + value)
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique_object, parse_constant=invalid)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')


def site_id(value):
    require(isinstance(value, str) and bool(re.fullmatch(r'[a-z][a-z0-9-]{0,47}', value)), '站点ID必须为小写字母开头的1–48位字母、数字或连字符')
    return value


def relative_path(value):
    require(isinstance(value, str) and bool(value) and not re.search(r'[\\\x00-\x1f\x7f]', value), '文件路径无效')
    path = PurePosixPath(value)
    require(not path.is_absolute() and not re.match(r'^[A-Za-z]:', value) and all(p not in {'', '.', '..'} for p in value.split('/')), '文件路径必须为严格相对路径')
    return path


def repository(path):
    path = Path(path).resolve()
    require(path.is_dir(), '发布仓库目录不存在')
    for name in ('sites', 'releases', 'portal'):
        candidate = path / name
        require(not candidate.is_symlink() and (not candidate.exists() or candidate.is_dir()), name + '必须为真实目录')
    return path


def registry(root):
    value = load_json(root / 'sites.json')
    require(isinstance(value, dict) and set(value) == {'version', 'sites'} and type(value['version']) is int and value['version'] == 1 and isinstance(value['sites'], list), 'sites.json结构无效')
    seen = set()
    for entry in value['sites']:
        require(isinstance(entry, dict) and set(entry) == {'id', 'title', 'description', 'path'}, '站点登记字段无效')
        key = site_id(entry['id'])
        require(key not in seen, '站点ID重复')
        seen.add(key)
        require(entry['path'] == key + '/', '站点path必须等于id加斜杠')
        for field, limit in (('title', 120), ('description', 1000)):
            require(isinstance(entry[field], str) and bool(entry[field].strip()) and len(entry[field]) <= limit and not re.search(r'[\x00-\x1f\x7f]', entry[field]), field + '必须为不含控制符的公开文本')
    return value


STATIC_SUFFIXES = {'.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.txt', '.xml', '.webmanifest', '.pdf', '.mp3', '.mp4', '.webm', '.ogg', '.wav'}
SENSITIVE_NAMES = {'credentials.json', 'credential.json', 'secrets.json', 'secret.json', 'token.json', 'tokens.json', 'package.json', 'package-lock.json', 'composer.json', 'tsconfig.json'}
NON_SITE_DIRS = {'node_modules', '__pycache__', 'archive', 'personal'}


def static_files(folder):
    folder = Path(folder)
    require(not folder.is_symlink() and folder.is_dir(), '静态产物必须为真实目录')
    root = folder.resolve()
    result = {}
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root).as_posix()
        relative_path(relative)
        require(not path.is_symlink(), '静态产物不能包含符号链接: ' + relative)
        parts = relative.split('/')
        require(all(not p.startswith('.') for p in parts) or relative == '.nojekyll', '静态产物不能包含隐藏文件或目录: ' + relative)
        require(not any(p in NON_SITE_DIRS for p in parts), '产物包含原始资料或依赖目录: ' + relative)
        if path.is_dir():
            continue
        require(path.is_file(), '产物包含非普通文件: ' + relative)
        require(path.name.lower() not in SENSITIVE_NAMES and (path.suffix.lower() in STATIC_SUFFIXES or relative == '.nojekyll'), '不是可发布的静态文件: ' + relative)
        content = path.read_bytes()
        require(not re.search(br'-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----', content), '产物包含私钥: ' + relative)
        result[relative] = content
    require('index.html' in result, '静态产物必须包含index.html')
    return result


def file_inventory(files):
    return [{'path': path, 'sha256': sha256(content), 'size': len(content)} for path, content in sorted(files.items())]


def release_id(key, inventory):
    return sha256(canonical({'site_id': key, 'files': inventory}))


def release_manifest(root, key, files=None):
    value = load_json(root / 'releases' / (key + '.json'))
    fields = {'version', 'site_id', 'release_id', 'previous_release_id', 'created_at', 'files'}
    require(isinstance(value, dict) and set(value) == fields and type(value['version']) is int and value['version'] == 1 and value['site_id'] == key, '发布清单结构无效: ' + key)
    require(isinstance(value['created_at'], str), '发布清单时间无效')
    try:
        parsed = datetime.fromisoformat(value['created_at'].replace('Z', '+00:00'))
        require(parsed.tzinfo is not None, '发布时间须包含时区')
    except ValueError as error:
        raise PublishError('发布清单时间无效') from error
    require(isinstance(value['files'], list) and bool(value['files']), '发布清单文件列表无效')
    paths = []
    for item in value['files']:
        require(isinstance(item, dict) and set(item) == {'path', 'sha256', 'size'}, '发布清单文件字段无效')
        relative_path(item['path'])
        require(isinstance(item['sha256'], str) and bool(re.fullmatch(r'[0-9a-f]{64}', item['sha256'])), '文件哈希无效')
        require(type(item['size']) is int and item['size'] >= 0, '文件大小无效')
        paths.append(item['path'])
    require(paths == sorted(set(paths)) and 'index.html' in paths, '发布清单路径重复、无序或缺少入口')
    require(value['release_id'] == release_id(key, value['files']), '发布清单版本哈希不匹配: ' + key)
    previous = value['previous_release_id']
    require(previous is None or (isinstance(previous, str) and bool(re.fullmatch(r'[0-9a-f]{64}', previous)) and previous != value['release_id']), '上一发布版本无效')
    actual = static_files(root / 'sites' / key) if files is None else files
    require(file_inventory(actual) == value['files'], '站点文件与发布清单不匹配: ' + key)
    return value


@contextmanager
def publish_lock(root):
    path = root / '.publisher.lock'
    try:
        descriptor = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise PublishError('其他发布工具正在操作；不自动移除写锁')
    try:
        os.close(descriptor)
        yield
    finally:
        path.unlink(missing_ok=True)


def write_files(folder, files):
    for relative, content in files.items():
        target = folder / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

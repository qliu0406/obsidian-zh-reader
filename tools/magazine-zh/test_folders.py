"""Folder tests for magazine_zh (no network, no ChatGPT): old 杂志中文稿 folders are merged into 杂志, an issue split
over two places is gathered into one, links become relative and every link resolves the way Obsidian resolves it."""
import json
import os
import sys
import tempfile
import time
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import magazine_zh as m  # noqa: E402


def obsidian_resolve(files, linkpath, source):
    """Port of Obsidian's MetadataCache.getLinkpathDest (app.js 1.12): which vault file a [[link]] opens."""
    base = lambda p: p.rsplit('/', 1)[-1]
    parent = lambda p: p.rsplit('/', 1)[0] if '/' in p else ''
    lookup = {}
    for f in files:
        lookup.setdefault(base(f).lower(), []).append(f)
    n = linkpath.lower()
    i = base(n)
    r = lookup.get(i) if '.' in i else None
    if not r:
        n = (linkpath + '.md').lower()
        i = base(n)
        r = lookup.get(i)
    if not r:
        return None
    if i == n and len(r) == 1:
        return r[0]
    o = parent(source).lower()
    if n.startswith('./') or n.startswith('../'):
        if n.startswith('./../'):
            n = n[2:]
        if n.startswith('./'):
            n = (o + '/' if o else '') + n[2:]
        else:
            while n.startswith('../'):
                n, o = n[3:], parent(o)
            n = (o + '/' if o else '') + n
        hit = [f for f in r if f.lower() == n]
        if hit:
            return hit[0]
    n = n.lstrip('/')
    hit = [f for f in r if f.lower() == n]
    if hit:
        return hit[0]
    near = sorted(f for f in r if f.lower().endswith(n) and f.lower().startswith(o))
    far = sorted(f for f in r if f.lower().endswith(n) and not f.lower().startswith(o))
    return (near + far + [None])[0]


def broken_links(vault):
    files = [p.relative_to(vault).as_posix() for p in vault.rglob('*') if p.is_file()]
    bad = []
    for f in files:
        if f.endswith('.md'):
            for link in __import__('re').findall(r'\[\[([^\]|#]+)', (vault / f).read_text(encoding='utf-8')):
                if not obsidian_resolve(files, link, f):
                    bad.append((f, link))
    return bad


def note(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')


with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    m.VAULT, m.CACHE = tmp / 'vault', tmp / 'cache'
    v = m.VAULT
    toc = '---\nmagazine: "Wired"\nissue: "2026-10-02"\ntags:\n  - 杂志\n---\n'

    # 1. The situation of 2026-10-02: Liuqing renamed 杂志中文稿 → 杂志 while Wired was being translated, so the tool
    #    re-created 杂志中文稿/Wired with absolute links; another issue already sits in 杂志 with Obsidian-updated links.
    old = v / '杂志中文稿/Wired 2026-10-02'
    note(old / '00 目录.md', toc + '- [[杂志中文稿/Wired 2026-10-02/01 甲|甲]]\n- [[杂志中文稿/Wired 2026-10-02/02 乙|乙]]\n')
    note(old / '01 甲.md', '[[杂志中文稿/Wired 2026-10-02/00 目录|← 返回目录]]\n![[杂志中文稿/Wired 2026-10-02/images/01-1.jpg]]\n')
    note(old / '02 乙.md', '![[杂志中文稿/Wired 2026-10-02/images/02-1.png]]\n![[杂志中文稿/Wired 2026-10-02/images/02-2.jpg]]\n')
    for img in ('01-1.jpg', '02-1.png', '02-2.jpg'):
        note(old / 'images' / img, 'x' * 2000)
    eco = v / '杂志/The Economist 2026-09-26'
    note(eco / '00 目录.md', '---\nmagazine: "The Economist"\nissue: "2026-09-26"\n---\n- [[01 政治|政治]]\n')
    note(eco / '01 政治.md', '[[杂志/The Economist 2026-09-26/00 目录|← 返回目录]]\n![[杂志/The Economist 2026-09-26/images/01-1.jpg]]\n')
    note(eco / 'images/01-1.jpg', 'y' * 2000)
    # A second, newer copy of note 02 left in 杂志/ (the split case): the newer file wins.
    time.sleep(0.05)
    note(v / '杂志/Wired 2026-10-02/02 乙.md', '![[杂志/Wired 2026-10-02/images/02-1.png]]\n新版\n![[杂志/Wired 2026-10-02/images/02-2.jpg]]\n')

    wired = {'magazine': 'Wired', 'issue': '2026-10-02', 'kind': 'magazine', 'root': '杂志中文稿', 'folder': 'Wired 2026-10-02',
             'articles': [{'id': 1, 'title': 'A', 'title_zh': '甲', 'section': '', 'paras': [], 'note': '杂志中文稿/Wired 2026-10-02/01 甲.md'},
                          {'id': 2, 'title': 'B', 'title_zh': '乙', 'section': '', 'paras': [], 'note': '杂志中文稿/Wired 2026-10-02/02 乙.md'},
                          {'id': 3, 'title': 'C', 'title_zh': '丙', 'section': '', 'paras': []}]}
    economist = {'magazine': 'The Economist', 'issue': '2026-09-26', 'kind': 'magazine', 'root': '杂志中文稿',
                 'folder': 'The Economist 2026-09-26',
                 'articles': [{'id': 1, 'title': 'P', 'title_zh': '政治', 'section': '', 'paras': [], 'note': '杂志中文稿/The Economist 2026-09-26/01 政治.md'}]}
    gone = dict(economist, issue='2026-09-12', folder='The Economist 2026-09-12')  # deleted on purpose: must stay gone
    # A leftover test import with the same name but other articles (the real cache had two): never touches the real TOC.
    twin = dict(economist, articles=[{'id': i, 'title': f'T{i}', 'title_zh': f'测试{i}', 'section': '', 'paras': [],
                                      'note': f'杂志中文稿/The Economist 2026-09-26/0{i} 测试{i}.md'} for i in (1, 2)]
                                    + [{'id': i, 'title': f'T{i}', 'title_zh': f'测试{i}', 'section': '', 'paras': []} for i in (3, 4)])
    for key, state in (('e', economist), ('t', twin), ('w', wired), ('g', gone)):
        note(m.CACHE / key / 'issue.json', json.dumps(state, ensure_ascii=False))

    assert broken_links(v), 'the fixture should start with the split Wired folder'
    m.tidy()
    assert not (v / '杂志中文稿').exists(), '杂志中文稿 should be gone'
    assert not (v / '杂志/The Economist 2026-09-12').exists(), 'a deleted issue must not be re-created'
    w = v / '杂志/Wired 2026-10-02'
    assert sorted(p.name for p in (w / 'images').iterdir()) == ['01-1.jpg', '02-1.png', '02-2.jpg']
    assert '新版' in (w / '02 乙.md').read_text(encoding='utf-8'), 'the newer copy of a note wins'
    assert '![[./images/01-1.jpg]]' in (w / '01 甲.md').read_text(encoding='utf-8')
    assert '[[./00 目录|← 返回目录]]' in (w / '01 甲.md').read_text(encoding='utf-8')
    assert '![[./images/01-1.jpg]]' in (eco / '01 政治.md').read_text(encoding='utf-8')
    eco_toc = (eco / '00 目录.md').read_text(encoding='utf-8')
    assert '- [[./01 政治|政治]]' in eco_toc and '共 1 篇' in eco_toc and '测试' not in eco_toc and '2026-09-26' in eco_toc, eco_toc
    assert '- [[./01 甲|甲]]' in (w / '00 目录.md').read_text(encoding='utf-8')
    assert '丙 *（未翻译）*' in (w / '00 目录.md').read_text(encoding='utf-8')
    saved = json.loads((m.CACHE / 'w/issue.json').read_text(encoding='utf-8'))
    assert saved['where'] == '杂志/Wired 2026-10-02' and saved['root'] == '杂志'
    assert [a.get('note') for a in saved['articles']] == ['杂志/Wired 2026-10-02/01 甲.md', '杂志/Wired 2026-10-02/02 乙.md', None]
    assert m.public(saved)['index'] == '杂志/Wired 2026-10-02/00 目录.md'
    assert broken_links(v) == [], broken_links(v)

    # 2. Liuqing moves and renames the issue folder (in Finder, so no link is updated): links still work and the
    #    next article lands in the moved folder instead of a fresh 杂志/Wired 2026-10-02.
    os.makedirs(v / '杂志/2026', exist_ok=True)
    w.rename(v / '杂志/2026/连线 十月')
    moved = v / '杂志/2026/连线 十月'
    assert broken_links(v) == [], broken_links(v)
    assert m.issue_folder(saved) == moved
    m.settle(saved)
    epub = tmp / 'w.epub'
    with zipfile.ZipFile(epub, 'w') as z:
        z.writestr('OEBPS/pic.jpg', b'\xff' * 3000)
    third = dict(saved['articles'][2], paras=[{'kind': 'p', 'text': 'Hello.'}, {'kind': 'image', 'text': '', 'src': 'OEBPS/pic.jpg'}])
    path = m.write_article(epub, saved, third, ['你好。', None], ['gpt-5.6-sol'])
    assert path == '杂志/2026/连线 十月/03 丙.md', path
    third['note'] = path
    saved['articles'][2] = third
    m.write_index(epub, saved)
    assert (moved / 'images/03-1.jpg').is_file()
    assert not (v / '杂志/Wired 2026-10-02').exists()
    assert '- [[./03 丙|丙]]' in (moved / '00 目录.md').read_text(encoding='utf-8')
    assert broken_links(v) == [], broken_links(v)

    # 3. A new book goes to 书籍/, never 书籍中文稿/.
    book = {'magazine': 'Some Book', 'issue': '', 'kind': 'book', 'folder': 'Some Book', 'articles': []}
    assert m.issue_folder(book) == v / '书籍/Some Book'

print('FOLDER TESTS PASSED')

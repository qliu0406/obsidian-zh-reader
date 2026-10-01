"""Parser tests for magazine_zh on synthetic EPUBs (no network, no ChatGPT)."""
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import magazine_zh as m  # noqa: E402

LOREM = ' '.join(['The committee said inflation remained elevated while growth slowed in the third quarter.'] * 6)
CONTAINER = '''<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'''


def build(path, files, opf):
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip')
        z.writestr('META-INF/container.xml', CONTAINER)
        z.writestr('OEBPS/content.opf', opf)
        for name, body in files.items():
            z.writestr('OEBPS/' + name, body)


def xhtml(body):
    return f'<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{{}}</style></head><body>{body}</body></html>'


def calibre_epub(path):
    files, items, spine, nav = {}, [], [], []
    files['index.html'] = xhtml('<h1>The Economist</h1><ul><li><a href="feed_0/index.html">Leaders</a></li></ul>')
    items.append(('index', 'index.html')); spine.append('index')
    for s, section in enumerate(['Leaders', 'United States']):
        files[f'feed_{s}/index.html'] = xhtml(f'<h2>{section}</h2><ul><li><a href="article_0/index.html">A</a></li></ul>')
        items.append((f'f{s}', f'feed_{s}/index.html')); spine.append(f'f{s}')
        kids = []
        for a in range(2):
            title = f'{section} story {a}: the "big" question'
            body = (f'<div class="calibre_navbar">| <a href="#">Next</a> | <a href="#">Section Menu</a> | Main Menu |</div>'
                    f'<h1>{title}</h1><p class="rubric">A standfirst for {section} {a}.</p>'
                    f'<p>{LOREM}</p><h2>A subheading</h2><p>{LOREM} &amp; more.</p>'
                    '<div>This article was downloaded by calibre from https://www.economist.com/x</div>')
            files[f'feed_{s}/article_{a}/index.html'] = xhtml(body)
            items.append((f'a{s}{a}', f'feed_{s}/article_{a}/index.html')); spine.append(f'a{s}{a}')
            kids.append(f'<navPoint id="n{s}{a}"><navLabel><text>{title.replace(chr(34), "&quot;")}</text></navLabel><content src="feed_{s}/article_{a}/index.html"/></navPoint>')
        nav.append(f'<navPoint id="s{s}"><navLabel><text>{section}</text></navLabel><content src="feed_{s}/index.html"/>{"".join(kids)}</navPoint>')
    files['toc.ncx'] = f'<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>{"".join(nav)}</navMap></ncx>'
    manifest = ''.join(f'<item id="{i}" href="{h}" media-type="application/xhtml+xml"/>' for i, h in items)
    opf = f'''<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>The Economist [Sep 26th, 2026]</dc:title><dc:date>2026-09-26T00:00:00+00:00</dc:date></metadata>
<manifest>{manifest}<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
<spine toc="ncx">{"".join(f'<itemref idref="{i}"/>' for i in spine)}</spine></package>'''
    build(path, files, opf)


def epub3_anchors(path):
    body = ''
    for n in range(3):
        body += f'<section><h2 id="art{n}">Feature {n}</h2><p>{LOREM}</p><p>{LOREM}</p></section>'
    files = {'issue.xhtml': xhtml('<p>Cover credits, masthead and legal text that is not an article at all but long enough to count.</p>' + body),
             'nav.xhtml': xhtml('<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol><li><span>Features</span><ol>'
                                + ''.join(f'<li><a href="issue.xhtml#art{n}">Feature {n}</a></li>' for n in range(3))
                                + '</ol></li></ol></nav>')}
    opf = '''<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Sample Monthly</dc:title><dc:date>2026-10</dc:date></metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="issue" href="issue.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="issue"/></spine></package>'''
    build(path, files, opf)


if '--make' in sys.argv:  # write a sample EPUB for the plugin's end-to-end test
    calibre_epub(Path(sys.argv[sys.argv.index('--make') + 1]))
    sys.exit(0)

with tempfile.TemporaryDirectory() as tmp:
    a = Path(tmp) / 'calibre.epub'
    calibre_epub(a)
    meta, arts = m.split_articles(a)
    assert meta['title'].startswith('The Economist'), meta
    assert [x['section'] for x in arts] == ['Leaders', 'Leaders', 'United States', 'United States'], [x['section'] for x in arts]
    assert arts[0]['title'] == 'Leaders story 0: the "big" question'
    texts = [p['text'] for p in arts[0]['paras']]
    assert not any('Main Menu' in t or 'downloaded by calibre' in t for t in texts), texts
    assert texts[0].startswith('A standfirst'), texts[0]
    assert arts[0]['paras'][0]['kind'] == 'p' and any(p['kind'] == 'heading' for p in arts[0]['paras'])
    assert '& more.' in texts[-1]
    print('calibre-style EPUB2: ok', [(x['id'], x['words']) for x in arts])

    b = Path(tmp) / 'anchors.epub'
    epub3_anchors(b)
    meta, arts = m.split_articles(b)
    assert [x['title'] for x in arts] == ['Feature 0', 'Feature 1', 'Feature 2'], [x['title'] for x in arts]
    assert all(x['section'] == 'Features' for x in arts), [x['section'] for x in arts]
    assert all(len(x['paras']) == 2 for x in arts), [len(x['paras']) for x in arts]
    assert not any('masthead' in p['text'] for x in arts for p in x['paras'])
    print('EPUB3 nav + anchors: ok', [(x['id'], x['words']) for x in arts])
print('PARSE TESTS PASSED')

"""The client's review copy of a Word file: what the firm sends, without what is internal to the firm.

- Comments are removed (their anchors and references in the text, and every comment in the comment parts), so
  a note between the junior and the senior never reaches the client.
- Open tracked changes are accepted (insertions kept, deletions dropped), so the client reads the version as
  it stands and their own edits are the only tracked changes in their copy.
Other file types (PDF, Excel, images) are sent as they are.
"""

import io
import zipfile

from lxml import etree

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
_STORY_PARTS = ('word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml')
_COMMENT_PARTS = ('word/comments.xml', 'word/commentsExtended.xml', 'word/commentsIds.xml',
                  'word/commentsExtensible.xml')


def _q(tag):
    return f'{{{W}}}{tag}'


def _clean_story(xml):
    root = etree.fromstring(xml)
    # Comments: their ranges and the runs holding a reference mark.
    for tag in ('commentRangeStart', 'commentRangeEnd'):
        for el in root.iter(_q(tag)):
            el.getparent().remove(el)
    for ref in list(root.iter(_q('commentReference'))):
        run = ref.getparent()
        if run is not None and run.tag == _q('r') and run.getparent() is not None:
            run.getparent().remove(run)
    # Tracked changes, accepted: deletions dropped, insertions unwrapped, property-change records dropped.
    for tag in ('del', 'moveFrom'):
        for el in list(root.iter(_q(tag))):
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)
    for tag in ('ins', 'moveTo'):
        for el in list(root.iter(_q(tag))):
            parent = el.getparent()
            if parent is None:
                continue
            if parent.tag == _q('rPr'):                     # a paragraph mark's "inserted" flag
                parent.remove(el)
                continue
            i = parent.index(el)
            for child in list(el):
                parent.insert(i, child)
                i += 1
            parent.remove(el)
    for tag in ('rPrChange', 'pPrChange', 'sectPrChange', 'tblPrChange', 'trPrChange', 'tcPrChange',
                'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd'):
        for el in list(root.iter(_q(tag))):
            el.getparent().remove(el)
    return etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)


def _empty_comments(xml):
    root = etree.fromstring(xml)
    for child in list(root):
        root.remove(child)
    return etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)


def review_copy(data, name):
    """(bytes, editable): the copy the client gets. A .docx is cleaned and editable; anything else as it is."""
    if not name.lower().endswith('.docx'):
        return data, False
    src = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            body = src.read(item.filename)
            if item.filename in _STORY_PARTS:
                body = _clean_story(body)
            elif item.filename in _COMMENT_PARTS:
                body = _empty_comments(body)
            dst.writestr(item, body)
    return out.getvalue(), True

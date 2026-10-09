"""A demo "returned" Word file for any draft: the draft as the other side's counsel or the client would
send it back by email, for trying Import changes (docs/DEMO_REDLINE.md, 7D / 8A).

    manage.py make_returned_file --draft 126 --sender counsel   # tracked changes + a Word comment
    manage.py make_returned_file --draft 126 --sender client    # edited without Track Changes + comments

What it changes (only what the draft actually contains, so it works on any draft):
- the first amount "Rs. N" becomes a lower one (counsel: half; client: corrected figure);
- the first "N days" becomes a longer period;
- a new paragraph is added to the clause that holds the amount;
- a Word comment is put on a sentence of a later clause (the client adds a second one).
The file is written to docs/demo-files/ unless --out is given; the draft itself is not touched.
"""

import copy
import io
import os
import re
import zipfile
from html import escape

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from drafting.export.docx import session_title
from drafting.export.redline import render_redline_docx
from drafting.models import DraftSession
from drafting.versions import snapshot_blocks

SENDERS = {
    'counsel': {
        'author': 'R. Arun Prakash (opposite counsel)',
        'amount': lambda n: n // 2,
        'days': lambda d: d * 2,
        'para': 'My client states that part of the amount claimed was paid in cash, for which no receipt was '
                'issued, and disputes the balance.',
        'comments': ['My client needs more time to comply. Please confirm whether an extension is acceptable.'],
    },
    'client': {
        'author': 'K. Kannan (client)',
        'amount': lambda n: n + n // 8,
        'days': lambda d: max(d // 2, 7),
        'para': 'The tenant has also not paid the electricity charges for the same period.',
        'comments': ['Please check this part. The tenant paid Rs. 10,000 in August by UPI; I have the screenshot.',
                     'Can we also ask for interest on the late payment?'],
    },
}

_AMOUNT = re.compile(r'(Rs\.?\s*)(\d[\d,]*)')
_DAYS = re.compile(r'\b(\d{1,3})(\s+days)\b')


def _fmt_inr(n):
    """Indian digit grouping: 1,20,000."""
    s = str(n)
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    head = re.sub(r'(\d)(?=(\d{2})+$)', r'\1,', head)
    return f'{head},{tail}'


def _sentence_after(xml, start):
    """A run of plain text in document.xml at/after `start` long enough to carry a comment."""
    # Text that starts a sentence (a capital letter), not a piece left over where a tracked change split it.
    for m in re.finditer(r'<w:r>(?:(?!</w:r>).)*?<w:t[^>]*>([A-Z][^<]{30,})</w:t>(?:(?!</w:r>).)*?</w:r>', xml[start:], re.S):
        at = start + m.start()
        if xml.rfind('<w:ins ', 0, at) > xml.rfind('</w:ins>', 0, at):
            continue                                    # their own insertion: not in the draft to point at
        return at, start + m.end()
    return None


class Command(BaseCommand):
    help = 'Write a demo Word file "sent back" by the counsel or the client, for Import changes.'

    def add_arguments(self, parser):
        parser.add_argument('--draft', type=int, required=True)
        parser.add_argument('--sender', choices=sorted(SENDERS), default='counsel')
        parser.add_argument('--out', help='Output .docx path (default: docs/demo-files/...)')

    def handle(self, *args, **o):
        session = DraftSession.objects.filter(id=o['draft']).first()
        if session is None:
            raise CommandError(f'No draft #{o["draft"]}.')
        who = SENDERS[o['sender']]
        base = snapshot_blocks(session)
        if not base:
            raise CommandError('The draft is empty.')
        theirs = copy.deepcopy(base)
        done = []

        amount_block = None
        # A real clause before the opening block (a notice repeats the amount in its "Sub:" line).
        for b in (theirs[1:] + theirs[:1]):
            m = _AMOUNT.search(b['content_html'])
            if m:
                old = int(m.group(2).replace(',', ''))
                new = who['amount'](old)
                b['content_html'] = b['content_html'][:m.start(2)] + _fmt_inr(new) + b['content_html'][m.end(2):]
                done.append(f'amount Rs. {m.group(2)} -> Rs. {_fmt_inr(new)} ({b["heading"] or "first clause"})')
                amount_block = b
                break
        for b in theirs:
            m = _DAYS.search(b['content_html'])
            if m:
                new = who['days'](int(m.group(1)))
                b['content_html'] = b['content_html'][:m.start(1)] + str(new) + b['content_html'][m.end(1):]
                done.append(f'{m.group(1)} days -> {new} days ({b["heading"] or "a clause"})')
                break
        target = amount_block or theirs[min(1, len(theirs) - 1)]
        target['content_html'] += f'<p>{escape(who["para"])}</p>'
        done.append(f'new paragraph in {target["heading"] or "a clause"}')

        title = session_title(session)
        tracked = o['sender'] == 'counsel'
        # Counsel: Track Changes on (their changes as w:ins / w:del). Client: plain edited copy.
        out = render_redline_docx(base, theirs, title, author=who['author']) if tracked \
            else render_redline_docx(theirs, theirs, title, author=who['author'])
        data = out[0] if isinstance(out, tuple) else out
        data, notes = self._comments(data, who)
        done += notes

        path = o.get('out') or os.path.join(
            os.path.dirname(settings.BASE_DIR), 'docs', 'demo-files',
            f'Draft{session.id}_Returned_By_{o["sender"].title()}.docx')
        with open(path, 'wb') as f:
            f.write(data)
        self.stdout.write(self.style.SUCCESS(f'Wrote {path}'))
        self.stdout.write(f'From: {who["author"]} ({"tracked changes" if tracked else "no Track Changes"})')
        for line in done:
            self.stdout.write(f'  - {line}')

    def _comments(self, data, who):
        """Add Word comments on sentences in the second half of the document."""
        zin = zipfile.ZipFile(io.BytesIO(data))
        xml = zin.read('word/document.xml').decode('utf-8')
        notes, comments = [], []
        pos = len(xml) // 2
        for cid, text in enumerate(who['comments']):
            span = _sentence_after(xml, pos)
            if span is None:
                break
            start, end = span
            quoted = re.search(r'<w:t[^>]*>([^<]*)</w:t>', xml[start:end]).group(1)
            xml = (xml[:start] + f'<w:commentRangeStart w:id="{cid}"/>' + xml[start:end]
                   + f'<w:commentRangeEnd w:id="{cid}"/><w:r><w:commentReference w:id="{cid}"/></w:r>' + xml[end:])
            pos = end + 200
            comments.append(f'<w:comment w:id="{cid}" w:author="{escape(who["author"])}" w:initials="RA">'
                            f'<w:p><w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p></w:comment>')
            notes.append(f'comment on "{quoted[:50]}…": {text}')
        if not comments:
            return data, notes
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                body = zin.read(item.filename)
                if item.filename == 'word/document.xml':
                    body = xml.encode('utf-8')
                elif item.filename == '[Content_Types].xml':
                    body = body.replace(b'</Types>', b'<Override PartName="/word/comments.xml" ContentType="application/'
                                        b'vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>')
                elif item.filename == 'word/_rels/document.xml.rels':
                    body = body.replace(b'</Relationships>', b'<Relationship Id="rIdCmt1" Type="http://schemas.'
                                        b'openxmlformats.org/officeDocument/2006/relationships/comments" '
                                        b'Target="comments.xml"/></Relationships>')
                zout.writestr(item, body)
            zout.writestr('word/comments.xml',
                          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                          '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                          + ''.join(comments) + '</w:comments>')
        return buf.getvalue(), notes

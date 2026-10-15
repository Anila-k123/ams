"""Compare two Word files with LibreOffice's "Compare Document" (run by LibreOffice's own Python, not Django).

    <LibreOffice python> lo_compare.py <soffice> <profile url> <older.docx> <newer.docx> <out.docx> <author>

Opens the newer file in a hidden LibreOffice, compares it with the older one and saves the result as Word:
the newer file, in its own look (letterhead, fonts, numbering, tables), with every difference as a tracked
change by `author`. Prints {"inserted": n, "deleted": n} (words) as JSON. Called by export/libre_redline.py.
"""

import json
import os
import subprocess
import sys
import time

import uno
from com.sun.star.beans import PropertyValue


def _prop(name, value):
    p = PropertyValue()
    p.Name, p.Value = name, value
    return p


def _connect(pipe, tries=240):
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    for _ in range(tries):
        try:
            return resolver.resolve(f'uno:pipe,name={pipe};urp;StarOffice.ComponentContext')
        except Exception:  # noqa: BLE001 - LibreOffice still starting
            time.sleep(0.25)
    raise SystemExit('LibreOffice did not start')


def _set_author(ctx, author):
    """Tracked changes carry the LibreOffice user's name: this run's profile gets the PactPro user's."""
    provider = ctx.ServiceManager.createInstanceWithContext('com.sun.star.configuration.ConfigurationProvider', ctx)
    node = provider.createInstanceWithArguments('com.sun.star.configuration.ConfigurationUpdateAccess',
                                                (_prop('nodepath', '/org.openoffice.UserProfile/Data'),))
    node.setPropertyValue('givenname', author)
    node.setPropertyValue('sn', '')
    node.commitChanges()


def _words(text):
    return len((text or '').split())


def _stats(doc):
    inserted = deleted = 0
    redlines = doc.getRedlines().createEnumeration()
    while redlines.hasMoreElements():
        r = redlines.nextElement()
        kind = r.getPropertyValue('RedlineType')
        try:
            n = _words(r.getString())
        except Exception:  # noqa: BLE001 - some redline kinds have no text
            n = 1
        if kind == 'Insert':
            inserted += n
        elif kind == 'Delete':
            deleted += n
    return {'inserted': inserted, 'deleted': deleted}


def main(soffice, profile, older, newer, out, author):
    pipe = f'pactpro_compare_{os.getpid()}'
    proc = subprocess.Popen([soffice, f'-env:UserInstallation={profile}', '--headless', '--invisible',
                             '--norestore', '--nologo', '--nodefault', '--nolockcheck',
                             f'--accept=pipe,name={pipe};urp;'])
    desktop = None
    try:
        ctx = _connect(pipe)
        _set_author(ctx, author)
        smgr = ctx.ServiceManager
        desktop = smgr.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
        doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(newer), '_blank', 0, (_prop('Hidden', True),))
        dispatcher = smgr.createInstanceWithContext('com.sun.star.frame.DispatchHelper', ctx)
        frame = doc.getCurrentController().getFrame()
        dispatcher.executeDispatch(frame, '.uno:CompareDocuments', '', 0, (
            _prop('URL', uno.systemPathToFileUrl(older)), _prop('NoAcceptDialog', True)))
        stats = _stats(doc)
        doc.storeToURL(uno.systemPathToFileUrl(out), (_prop('FilterName', 'MS Word 2007 XML'),))
        doc.close(True)
        print(json.dumps(stats))
    finally:
        try:
            if desktop is not None:
                desktop.terminate()
        except Exception:  # noqa: BLE001 - the bridge drops as LibreOffice exits
            pass
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == '__main__':
    main(*sys.argv[1:7])

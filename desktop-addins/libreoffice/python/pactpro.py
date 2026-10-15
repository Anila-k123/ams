# PactPro for LibreOffice (docs/DESKTOP_EDITING.md, "Save to PactPro inside Word / LibreOffice").
#
# A file opened from PactPro lives at <PactPro>/dav/<signed token>/<name> (LibreOffice shows it as
# vnd-webdav://...). Saving it in LibreOffice only updates PactPro's working copy. These commands call
# <PactPro>/dav/<token>/.pactpro/status | save | discard | submit | review with that same token, so no PactPro
# login is needed; PactPro checks what this person may do.
#
# The PactPro button opens one window (pactpro_window) that shows only what applies to this person and file:
# Save to PactPro / Discard (may edit), Submit to task (the assignee), Approve / Request changes (the reviewer).
# The PactPro menu offers the same actions one by one.
import json
import urllib.error
import urllib.request

import unohelper
from com.sun.star.awt import XActionListener
from com.sun.star.awt.MessageBoxButtons import BUTTONS_OK, BUTTONS_YES_NO
from com.sun.star.awt.MessageBoxType import ERRORBOX, INFOBOX, QUERYBOX

TITLE = "PactPro"
YES = 2


# --- PactPro and the file ---------------------------------------------------------------------------

def _document():
    return XSCRIPTCONTEXT.getDocument()  # noqa: F821 - provided by LibreOffice to every Python macro


def _context():
    return XSCRIPTCONTEXT.getComponentContext()  # noqa: F821


def _message(text, kind=INFOBOX, buttons=BUTTONS_OK):
    window = _document().getCurrentController().getFrame().getContainerWindow()
    box = window.getToolkit().createMessageBox(window, kind, buttons, TITLE, text)
    return box.execute()


def _folder(url):
    """<PactPro>/dav/<token> for a file opened from PactPro, else None."""
    for prefix, scheme in (("vnd-webdavs://", "https://"), ("vnd-webdav://", "http://")):
        if url.startswith(prefix):
            url = scheme + url[len(prefix):]
    if not url.startswith(("http://", "https://")) or "/dav/" not in url:
        return None
    base, rest = url.split("/dav/", 1)
    return f"{base}/dav/{rest.split('/', 1)[0]}"


def _call(folder, action, body=None, method="POST"):
    data = None if method == "GET" else json.dumps(body or {}).encode()
    request = urllib.request.Request(f"{folder}/.pactpro/{action}", data=data, method=method,
                                     headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=60) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read() or b"{}")
        except ValueError:
            return exc.code, {}
    except (urllib.error.URLError, OSError) as exc:
        return 0, {"error": f"PactPro could not be reached: {exc}"}


def _target():
    doc = _document()
    folder = _folder(doc.getURL() or "")
    if folder is None:
        _message("This file was not opened from PactPro, so it can't be saved to PactPro.", ERRORBOX)
    return doc, folder


def _status(folder):
    status, body = _call(folder, "status", method="GET")
    if status != 200:
        _message(body.get("error") or "PactPro doesn't recognise this file any more. Open it again from PactPro.",
                 ERRORBOX)
        return None
    return body


def _store_if_modified(doc):
    if doc.isModified():
        doc.store()


def _reload(doc):
    doc.setModified(False)
    frame = doc.getCurrentController().getFrame()
    ctx = _context()
    dispatcher = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.DispatchHelper", ctx)
    dispatcher.executeDispatch(frame, ".uno:Reload", "", 0, ())


# --- the actions (shared by the window and the menu): (done, message) ------------------------------------

def _do_save(doc, folder):
    try:
        _store_if_modified(doc)
    except Exception as exc:  # noqa: BLE001 - shown to the user
        return False, f"The file could not be saved: {exc}"
    status, body = _call(folder, "save")
    if status == 200:
        version = body.get("version")
        return True, f"Saved to PactPro as version {version}." if version else "Saved to PactPro."
    if body.get("code") == "nothing":
        return True, "Nothing new to save to PactPro."
    return False, body.get("error") or f"Saving to PactPro failed ({status})."


def _do_discard(folder):
    """Drop the edits in PactPro (the caller reloads the file afterwards)."""
    if _message("Discard your edits since the last Save to PactPro? The PactPro version stays as it is.",
                QUERYBOX, BUTTONS_YES_NO) != YES:
        return False, None
    status, body = _call(folder, "discard")
    if status not in (200, 404):
        return False, body.get("error") or f"Discarding failed ({status})."
    return True, "Edits discarded: the file shows the PactPro version again."


def _do_submit(doc, folder, task, note, hours):
    if not note.strip():
        return False, "Say what was done."
    try:
        _store_if_modified(doc)
    except Exception as exc:  # noqa: BLE001
        return False, f"The file could not be saved: {exc}"
    status, body = _call(folder, "submit", {"taskId": task["id"], "note": note, "hours": (hours or "").strip() or None})
    if status == 200:
        return True, f'Saved to PactPro and submitted "{task["title"]}" for review.'
    return False, body.get("error") or f"Submitting failed ({status})."


def _do_review(doc, folder, task, action, note):
    if action == "request_changes":
        if not note.strip():
            return False, "Say what needs to change."
        status, body = _call(folder, "review", {"taskId": task["id"], "action": action, "note": note})
        if status == 200:
            return True, f'Sent "{task["title"]}" back with your comments.'
        return False, body.get("error") or f"Sending back failed ({status})."
    try:
        _store_if_modified(doc)
    except Exception as exc:  # noqa: BLE001
        return False, f"The file could not be saved: {exc}"
    body = {"taskId": task["id"], "action": "approve", "note": note}
    status, res = _call(folder, "review", body)
    if status == 409 and res.get("code") == "unsaved":
        # The reviewer edited it here: approve what is on screen (save it to PactPro first), or only the
        # version that was handed in (the edits stay waiting).
        if _message("You edited this document. Save your edits to PactPro and approve that version?\n"
                    "(No: approve the version that was handed in; your edits stay unsaved in PactPro.)",
                    QUERYBOX, BUTTONS_YES_NO) == YES:
            saved, out = _call(folder, "save")
            if saved != 200:
                return False, out.get("error") or f"Saving failed ({saved})."
        else:
            body["unsaved_ok"] = True
        status, res = _call(folder, "review", body)
    if status == 200:
        return True, f'Approved "{task["title"]}": the task is complete.'
    return False, res.get("error") or f"Approving failed ({status})."


# --- the PactPro window ---------------------------------------------------------------------------------

class _Click(unohelper.Base, XActionListener):
    def __init__(self, handler):
        self.handler = handler

    def actionPerformed(self, _event):
        self.handler()

    def disposing(self, _event):
        pass


class _Window:
    """A dialog built in code: rows are added top to bottom, buttons get a Python handler."""

    WIDTH = 250

    def __init__(self, title):
        ctx = _context()
        self.smgr = ctx.ServiceManager
        self.ctx = ctx
        self.model = self.smgr.createInstanceWithContext("com.sun.star.awt.UnoControlDialogModel", ctx)
        self.model.Width, self.model.Title = self.WIDTH, title
        self.y = 6
        self.handlers = {}
        self.count = 0

    def _add(self, kind, height, width=None, x=6, **props):
        self.count += 1
        name = f"c{self.count}"
        control = self.model.createInstance(f"com.sun.star.awt.UnoControl{kind}Model")
        control.PositionX, control.PositionY = x, self.y
        control.Width, control.Height = width or self.WIDTH - 12, height
        for key, value in props.items():
            setattr(control, key, value)
        self.model.insertByName(name, control)
        return name

    def text(self, label, bold=False, height=10):
        name = self._add("FixedText", height, Label=label, MultiLine=height > 10)
        if bold:
            self.model.getByName(name).FontWeight = 150.0
        self.y += height + 2
        return name

    def heading(self, label):
        self.y += 6
        self._add("FixedLine", 8)
        self.y += 9
        return self.text(label, bold=True)

    def field(self, label, lines=1):
        self.text(label)
        height = 14 if lines == 1 else 12 * lines
        name = self._add("Edit", height, MultiLine=lines > 1, VScroll=lines > 1)
        self.y += height + 4
        return name

    def choice(self, label, items):
        self.text(label)
        name = self._add("ListBox", 14, Dropdown=True, StringItemList=tuple(items), SelectedItems=(0,))
        self.y += 18
        return name

    def buttons(self, *specs):
        """specs: (label, handler, primary). Laid out in one row."""
        width = (self.WIDTH - 12 - 6 * (len(specs) - 1)) // len(specs)
        names = []
        for i, (label, handler, primary) in enumerate(specs):
            name = self._add("Button", 15, width=width, x=6 + i * (width + 6), Label=label, DefaultButton=primary)
            self.handlers[name] = handler
            names.append(name)
        self.y += 20
        return names

    def show(self):
        self.y += 4
        self._add("Button", 15, width=60, x=self.WIDTH - 66, Label="Close", PushButtonType=2)
        self.model.Height = self.y + 20
        self.dialog = self.smgr.createInstanceWithContext("com.sun.star.awt.UnoControlDialog", self.ctx)
        self.dialog.setModel(self.model)
        for name, handler in self.handlers.items():
            self.dialog.getControl(name).addActionListener(_Click(handler))
        self.dialog.createPeer(self.smgr.createInstanceWithContext("com.sun.star.awt.Toolkit", self.ctx), None)
        self.dialog.execute()
        self.dialog.dispose()

    def value(self, name):
        return self.dialog.getControl(name).getText()

    def index(self, name):
        return max(self.dialog.getControl(name).getSelectedItemPos(), 0)

    def close(self):
        self.dialog.endExecute()


def pactpro_window(*_args):
    """The PactPro button: one window showing only what this person can do with this file."""
    doc, folder = _target()
    if folder is None:
        return
    info = _status(folder)
    if info is None:
        return
    tasks = info.get("tasks") or []
    submit_tasks = [t for t in tasks if t.get("canSubmit")]
    review_tasks = [t for t in tasks if t.get("canReview")]
    after = {"reload": False}

    win = _Window("PactPro")
    win.text(info.get("name") or "", bold=True)
    state = f"Version {info.get('version')} in PactPro"
    if not info.get("editable"):
        state += " · read only for you"
    elif info.get("pending") or doc.isModified():
        state += " · you have edits not saved to PactPro"
    win.text(state)

    def finish(result):
        done, message = result
        if message:
            _message(message, INFOBOX if done else ERRORBOX)
        if done:
            win.close()

    if info.get("editable"):
        win.heading("Save")

        def discard():
            done, message = _do_discard(folder)
            if done:
                after["reload"] = True
            finish((done, message))

        win.buttons(("Save to PactPro", lambda: finish(_do_save(doc, folder)), True),
                    ("Discard edits", discard, False))

    if submit_tasks:
        win.heading("Hand in for review")
        pick = win.choice("Task", [t["title"] for t in submit_tasks]) if len(submit_tasks) > 1 else None
        note = win.field("What was done?", lines=4)
        hours = win.field("Hours spent (optional)")
        win.buttons(("Save and submit to task", lambda: finish(_do_submit(
            doc, folder, submit_tasks[win.index(pick) if pick else 0], win.value(note), win.value(hours))), True))

    if review_tasks:
        win.heading("Review")
        pick_r = win.choice("Task", [t["title"] for t in review_tasks]) if len(review_tasks) > 1 else None
        comment = win.field("Comment (needed to request changes)", lines=4)

        def task_r():
            return review_tasks[win.index(pick_r) if pick_r else 0]

        win.buttons(("Approve task", lambda: finish(_do_review(doc, folder, task_r(), "approve", win.value(comment))), True),
                    ("Request changes", lambda: finish(_do_review(
                        doc, folder, task_r(), "request_changes", win.value(comment))), False))

    if not info.get("editable") and not submit_tasks and not review_tasks:
        win.text("Nothing to do here: you can read this file but not change it in PactPro.", height=20)
    win.show()
    if after["reload"]:
        _reload(doc)


# --- the PactPro menu (the same actions one by one) -------------------------------------------------------

def save_to_pactpro(*_args):
    doc, folder = _target()
    if folder is not None:
        done, message = _do_save(doc, folder)
        _message(message, INFOBOX if done else ERRORBOX)


def discard_edits(*_args):
    doc, folder = _target()
    if folder is None:
        return
    done, message = _do_discard(folder)
    if message and not done:
        _message(message, ERRORBOX)
    if done:
        _reload(doc)


def _dialog(title, fields):
    """A small form for the menu items: fields (name, label, 'line' | 'text' | 'list'[, items]).
    Returns {name: value} (a list's value is the chosen index), or None when cancelled."""
    win = _Window(title)
    names = {}
    for field in fields:
        name, label, kind = field[:3]
        names[name] = (win.choice(label, field[3]) if kind == "list"
                       else win.field(label, lines=4 if kind == "text" else 1))
    values = {}

    def ok():
        for name, (_, _, kind, *_rest) in zip(names, fields):
            values[name] = win.index(names[name]) if kind == "list" else win.value(names[name])
        win.close()

    win.buttons(("OK", ok, True))
    win.show()
    return values or None


def _tasks_for(folder, flag, none_message):
    info = _status(folder)
    if info is None:
        return None
    tasks = [t for t in info.get("tasks") or [] if t.get(flag)]
    if not tasks:
        _message(none_message)
        return None
    return tasks


def _task_field(tasks):
    return [("task", "Task", "list", [t["title"] for t in tasks])] if len(tasks) > 1 else []


def submit_to_task(*_args):
    doc, folder = _target()
    if folder is None:
        return
    tasks = _tasks_for(folder, "canSubmit", "This document isn't on a task assigned to you that is waiting to be handed in.")
    if not tasks:
        return
    values = _dialog("Submit to task", _task_field(tasks) + [
        ("note", "What was done?", "text"), ("hours", "Hours spent (optional)", "line")])
    if values is None:
        return
    done, message = _do_submit(doc, folder, tasks[values.get("task", 0)], values["note"], values["hours"])
    _message(message, INFOBOX if done else ERRORBOX)


def _review_from_menu(action, title, label):
    doc, folder = _target()
    if folder is None:
        return
    tasks = _tasks_for(folder, "canReview", "This document isn't waiting for your review.")
    if not tasks:
        return
    values = _dialog(title, _task_field(tasks) + [("note", label, "text")])
    if values is None:
        return
    done, message = _do_review(doc, folder, tasks[values.get("task", 0)], action, values["note"])
    _message(message, INFOBOX if done else ERRORBOX)


def approve_task(*_args):
    _review_from_menu("approve", "Approve task", "Comment (optional)")


def request_changes(*_args):
    _review_from_menu("request_changes", "Request changes", "What should be changed?")


g_exportedScripts = (pactpro_window, save_to_pactpro, discard_edits, submit_to_task, approve_task, request_changes)

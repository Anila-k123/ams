/* PactPro add-in for Word / Excel / PowerPoint (docs/DESKTOP_EDITING.md, desktop-addins/word).
 * A file opened from PactPro lives at <PactPro>/dav/<signed token>/<name>. Saving it in Office only
 * updates PactPro's working copy; these buttons call <PactPro>/dav/<token>/.pactpro/save | discard with
 * that same token (no PactPro login). Plain script: Office loads this page as is, outside the React app. */
/* global Office, Word, Excel */
(function () {
  "use strict";
  var folder = null;
  var $ = function (id) { return document.getElementById(id); };

  function show(text, kind) {
    var el = $("status");
    el.textContent = text;
    el.className = kind || "";
  }

  // <PactPro>/dav/<token> for a file opened from PactPro, else null.
  function folderOf(url) {
    if (!url || !/^https?:\/\//i.test(url) || url.indexOf("/dav/") < 0) return null;
    var parts = url.split("/dav/");
    return parts[0] + "/dav/" + parts[1].split("/")[0];
  }

  function call(action, method, body) {
    var opts = { method: method || "POST" };
    if (body) { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(body); }
    return fetch(folder + "/.pactpro/" + action, opts)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, body: b }; }); });
  }

  // Save the file where it came from (PactPro's working copy) before saving to PactPro.
  function saveHere() {
    var host = Office.context.host;
    if (host === Office.HostType.Word && typeof Word !== "undefined") {
      return Word.run(function (ctx) { ctx.document.save(); return ctx.sync(); });
    }
    if (host === Office.HostType.Excel && typeof Excel !== "undefined" && Office.context.requirements.isSetSupported("ExcelApi", "1.11")) {
      return Excel.run(function (ctx) { ctx.workbook.save(); return ctx.sync(); });
    }
    return Promise.resolve();   // PowerPoint: the user saves (Ctrl+S) first
  }

  function refresh() {
    call("status", "GET").then(function (r) {
      if (!r.ok) { show(r.body.error || "PactPro doesn't recognise this file any more. Open it again from PactPro.", "bad"); return; }
      $("name").textContent = r.body.name;
      showTasks(r.body.tasks || []);
      $("save").disabled = !r.body.editable;
      $("discard").disabled = !r.body.editable;
      show(!r.body.editable ? "Read only: you can't change this document in PactPro."
        : r.body.pending ? "You have saved edits that aren't in PactPro yet." : "No edits waiting. Save here, then Save to PactPro.");
    }).catch(function () { show("PactPro could not be reached.", "bad"); });
  }

  function busy(on) {
    ["save", "discard", "submit", "approve", "changes"].forEach(function (id) { $(id).disabled = on; });
  }

  // The task loop: the assignee hands this document in, the reviewer approves or sends it back.
  var submitTasks = [], reviewTasks = [];
  function fill(select, tasks) {
    select.innerHTML = "";
    tasks.forEach(function (t) { var o = document.createElement("option"); o.value = t.id; o.textContent = t.title; select.appendChild(o); });
    select.hidden = tasks.length < 2;
  }
  function showTasks(tasks) {
    submitTasks = tasks.filter(function (t) { return t.canSubmit; });
    reviewTasks = tasks.filter(function (t) { return t.canReview; });
    $("submit-box").hidden = submitTasks.length === 0;
    $("review-box").hidden = reviewTasks.length === 0;
    fill($("submit-task"), submitTasks);
    fill($("review-task"), reviewTasks);
  }
  function chosen(select, tasks) {
    var id = Number(select.value) || (tasks[0] && tasks[0].id);
    return tasks.filter(function (t) { return t.id === id; })[0];
  }
  function review(action, unsavedOk) {
    var task = chosen($("review-task"), reviewTasks);
    var note = $("review-note").value.trim();
    if (action === "request_changes" && !note) { show("Say what needs to change.", "bad"); return Promise.resolve(); }
    var body = { taskId: task.id, action: action, note: note };
    if (unsavedOk) body.unsaved_ok = true;
    return call("review", "POST", body).then(function (r) {
      if (r.ok) {
        show(action === "approve" ? "Approved “" + task.title + "”: the task is complete."
          : "Sent “" + task.title + "” back with your comments.", "ok");
        $("review-note").value = "";
        refresh();
      } else if (r.body.code === "unsaved") {
        // The reviewer edited here: approve what is on screen (save it first) or the version handed in.
        // (Office task panes can't show confirm(): the choice is two buttons.)
        $("unsaved-choice").hidden = false;
        show("Choose which version to approve.");
      } else {
        show(r.body.error || "The review could not be saved.", "bad");
      }
    });
  }

  Office.onReady(function () {
    folder = folderOf(Office.context.document.url);
    if (!folder) {
      $("name").textContent = "";
      show("This file was not opened from PactPro, so it can't be saved to PactPro.", "bad");
      return;
    }
    refresh();

    $("save").onclick = function () {
      busy(true);
      show("Saving…");
      saveHere()
        .then(function () { return call("save"); })
        .then(function (r) {
          if (r.ok) show(r.body.version ? "Saved to PactPro as version " + r.body.version + "." : "Saved to PactPro.", "ok");
          else if (r.body.code === "nothing") show("Nothing new to save to PactPro.");
          else show(r.body.error || "Saving to PactPro failed.", "bad");
        })
        .catch(function (e) { show("Could not save: " + (e && e.message ? e.message : e), "bad"); })
        .then(function () { busy(false); });
    };

    $("submit").onclick = function () {
      var task = chosen($("submit-task"), submitTasks);
      var note = $("submit-note").value.trim();
      if (!note) { show("Say what was done.", "bad"); return; }
      busy(true);
      show("Saving and submitting…");
      saveHere()
        .then(function () { return call("submit", "POST", { taskId: task.id, note: note, hours: $("submit-hours").value || null }); })
        .then(function (r) {
          if (r.ok) {
            show("Saved to PactPro and submitted “" + task.title + "” for review.", "ok");
            $("submit-note").value = ""; $("submit-hours").value = "";
            refresh();
          } else show(r.body.error || "Submitting failed.", "bad");
        })
        .catch(function (e) { show("Could not submit: " + (e && e.message ? e.message : e), "bad"); })
        .then(function () { busy(false); });
    };
    $("approve").onclick = function () {
      busy(true);
      saveHere().then(function () { return review("approve"); })
        .catch(function () { show("PactPro could not be reached.", "bad"); })
        .then(function () { busy(false); });
    };
    $("approve-saved").onclick = function () {
      $("unsaved-choice").hidden = true;
      busy(true);
      call("save").then(function () { return review("approve"); })
        .catch(function () { show("PactPro could not be reached.", "bad"); })
        .then(function () { busy(false); });
    };
    $("approve-handed").onclick = function () {
      $("unsaved-choice").hidden = true;
      busy(true);
      review("approve", true).catch(function () { show("PactPro could not be reached.", "bad"); })
        .then(function () { busy(false); });
    };
    $("changes").onclick = function () {
      busy(true);
      review("request_changes").catch(function () { show("PactPro could not be reached.", "bad"); })
        .then(function () { busy(false); });
    };

    $("discard").onclick = function () {
      busy(true);
      call("discard")
        .then(function (r) {
          show(r.ok || r.body.code === "nothing"
            ? "Edits discarded in PactPro. Close this file without saving, then open it again from PactPro."
            : (r.body.error || "Discarding failed."), r.ok ? "ok" : "bad");
        })
        .catch(function () { show("PactPro could not be reached.", "bad"); })
        .then(function () { busy(false); });
    };
  });
})();

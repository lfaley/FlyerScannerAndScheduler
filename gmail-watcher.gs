/**
 * FlyerSnap Gmail Watcher -- Google Apps Script
 *
 * Runs on Google's servers every 15 minutes, reads only emails from senders you
 * list, asks Claude to pull out dates, and holds them in a small queue that the
 * FlyerSnap app fetches.
 *
 * Nothing is emailed, deleted, or replied to. Read-only.
 *
 * SETUP: see the step-by-step in the chat. In short --
 *   1. Script Properties: CLAUDE_KEY, SECRET, SENDERS
 *   2. Deploy > New deployment > Web app > Execute as Me > Anyone
 *   3. Triggers > checkMail > Time-driven > Every 15 minutes
 */

var MODEL = 'claude-sonnet-4-6';
var MAX_QUEUE = 60;        // keep the queue small; Script Properties cap at 9KB/value
var LOOKBACK = '7d';       // how far back to search on each run

// --- Cost guards. Without these a single unreadable email retries every 15
// --- minutes forever, which is ~96 paid API calls a day going nowhere.
var MAX_PER_RUN = 12;      // most messages we'll send to Claude in one run
var MAX_TRIES = 3;         // give up on a message after this many failures
var DAILY_CALL_CAP = 80;   // hard ceiling on Claude calls per day

function props() { return PropertiesService.getScriptProperties(); }
function getProp(k) { return props().getProperty(k); }

function senders() {
  var raw = getProp('SENDERS') || '';
  return raw.split(',').map(function (s) { return s.trim(); }).filter(String);
}

// ---------- Cost guards ----------

function todayStr() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function callsUsedToday() {
  var rec = JSON.parse(getProp('CALLS') || '{}');
  return rec.date === todayStr() ? (rec.count || 0) : 0;
}

function countCall() {
  var rec = JSON.parse(getProp('CALLS') || '{}');
  if (rec.date !== todayStr()) rec = { date: todayStr(), count: 0 };
  rec.count++;
  props().setProperty('CALLS', JSON.stringify(rec));
  return rec.count;
}

// ---------- Claude ----------

function claudePrompt(today) {
  return 'You are reading an email sent to a parent -- school flyers, dance studio notices, ' +
    'volleyball schedules, enrollment forms, permission slips, newsletters.\n\n' +
    "Today's date is " + today + '. Use it to resolve dates that omit the year (assume the nearest future occurrence).\n\n' +
    'Extract EVERY actionable date. Respond with ONLY a JSON array, no markdown fences, no commentary. Each item:\n' +
    '{"title":"short human-friendly name","date":"YYYY-MM-DD","time":"HH:MM in 24h or null",' +
    '"location":"string or null","kind":"deadline" if it is a due date / registration cutoff / form return date, ' +
    'otherwise "event","notes":"one short useful sentence or null"}\n\n' +
    'Rules:\n' +
    '- Registration/signup/payment/form-due dates are "deadline". Performances, games, meetings, picture days are "event".\n' +
    '- Ignore generic newsletter chatter with no actionable date.\n' +
    '- Ignore unsubscribe footers, privacy notices, and boilerplate.\n' +
    '- If no real dates are found, return [].';
}

// When true the script does no AI work at all -- it just hands the app the
// prepared text (prose + flattened tables) and lets the app extract.
var RAW_MODE = true;

function callClaude(contentBlocks) {
  var key = getProp('CLAUDE_KEY');
  if (!key) throw new Error('CLAUDE_KEY script property is not set');

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: 'user', content: contentBlocks }]
    }),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('Claude API ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  }

  var data = JSON.parse(res.getContentText());
  var text = (data.content || []).map(function (b) {
    return b.type === 'text' ? b.text : '';
  }).join('\n');
  return text.replace(/```json|```/g, '').trim();
}


// ---------------------------------------------------------------------------
// Tables: resolve merged cells in code, then emit flat text.
//
// Research on table serialisation for LLMs (arXiv 2305.16344) measured average
// extraction accuracy of PLAIN 0.699 / CSV 0.691 / HTML 0.509 / XML 0.456 --
// tag-heavy formats lose because the markup inflates tokens and fragments the
// table. Markdown scores better than HTML too, but Markdown cannot express
// colspan/rowspan, and schedule grids depend on merged cells.
//
// So we expand rowspan/colspan deterministically here and emit one line per
// cell in the winning PLAIN form:  "<column header> | <row label> | <cell>"
// The model then never has to infer which day or time a cell belongs to.
// ---------------------------------------------------------------------------
function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&rsquo;|&apos;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attrNum(tag, name) {
  var m = new RegExp(name + '\\s*=\\s*["\']?(\\d+)', 'i').exec(tag);
  return m ? Math.max(1, Math.min(30, parseInt(m[1], 10))) : 1;
}

// Turn one <table> into a grid with merges expanded into real cells.
function tableToGrid(tableHtml) {
  var rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  var grid = [];
  var pending = {};   // column -> { left: rowsRemaining, text: value }

  for (var r = 0; r < rows.length; r++) {
    var cellTags = rows[r].match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || [];
    var row = [];
    var c = 0;
    var ci = 0;

    while (ci < cellTags.length || hasPending(pending, c)) {
      // A rowspan from an earlier row occupies this column.
      if (pending[c] && pending[c].left > 0) {
        row[c] = pending[c].text;
        pending[c].left--;
        c++;
        continue;
      }
      if (ci >= cellTags.length) break;

      var tag = cellTags[ci];
      var open = (tag.match(/<t[dh][^>]*>/i) || [''])[0];
      var text = stripTags(tag.replace(/<t[dh][^>]*>/i, '').replace(/<\/t[dh]>/i, ''));
      var cs = attrNum(open, 'colspan');
      var rs = attrNum(open, 'rowspan');

      for (var k = 0; k < cs; k++) {
        row[c] = text;
        if (rs > 1) pending[c] = { left: rs - 1, text: text };
        c++;
      }
      ci++;
    }
    grid.push(row);
  }
  return grid;
}

function hasPending(pending, c) {
  return !!(pending[c] && pending[c].left > 0);
}

// Flatten every table in the html into PLAIN "column | row | cell" lines.
function tablesToPlainText(html) {
  var tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  var out = [];

  for (var t = 0; t < tables.length; t++) {
    var grid = tableToGrid(tables[t]);
    if (grid.length < 2) continue;

    // Leading rows whose first cell is blank are header rows (dates, then day
    // names). Combine them so a column reads "8/3 Monday".
    var headerRows = 0;
    while (headerRows < 2 && headerRows < grid.length &&
           !String(grid[headerRows][0] || '').trim()) headerRows++;
    if (headerRows === 0) headerRows = 1;

    var width = 0;
    for (var g = 0; g < grid.length; g++) width = Math.max(width, grid[g].length);

    var headers = [];
    for (var c = 0; c < width; c++) {
      var parts = [];
      for (var h = 0; h < headerRows; h++) {
        var v = String((grid[h] || [])[c] || '').trim();
        if (v && parts.indexOf(v) < 0) parts.push(v);
      }
      headers[c] = parts.join(' ');
    }

    out.push('TABLE ' + (t + 1) + ' -- one line per cell, already matched to its column and row:');
    for (var r = headerRows; r < grid.length; r++) {
      var label = String((grid[r] || [])[0] || '').trim();
      // A row where every column holds the same value is a full-width band
      // (Lunch, Dinner). Emit once, not once per day.
      var vals = [];
      for (var cc = 1; cc < width; cc++) vals.push(String((grid[r] || [])[cc] || '').trim());
      var nonEmpty = vals.filter(function (v) { return v; });
      var allSame = nonEmpty.length > 1 && nonEmpty.every(function (v) { return v === nonEmpty[0]; });
      if (allSame) {
        out.push('  [' + label + '] all columns: ' + nonEmpty[0]);
        continue;
      }
      for (var c2 = 1; c2 < width; c2++) {
        var cell = String((grid[r] || [])[c2] || '').trim();
        if (!cell || cell === label) continue;
        out.push('  ' + (headers[c2] || ('col' + c2)) + ' | ' + label + ' | ' + cell);
      }
    }
    out.push('');
  }
  return out.join('\n');
}


// ---------------------------------------------------------------------------
// "Exception: Gmail operation not allowed." is a transient Gmail service error,
// not a permissions problem. It is well documented that scheduled Gmail scripts
// hit it intermittently -- reports of ~3 failures out of 24 hourly runs are
// common. The accepted remedy is to catch it and retry with a short backoff
// rather than let the whole run die and email a failure notice.
// ---------------------------------------------------------------------------
function gmailSearchWithRetry(query, start, max) {
  var attempts = 3;
  var lastErr = null;
  for (var i = 0; i < attempts; i++) {
    try {
      return GmailApp.search(query, start, max);
    } catch (e) {
      lastErr = e;
      var msg = String(e && e.message || e);
      var transient = /not allowed|service invoked too many|internal error|try again|timeout/i.test(msg);
      if (!transient || i === attempts - 1) throw e;
      // 2s, then 6s, with a little jitter so retries do not align.
      var waitMs = (i === 0 ? 2000 : 6000) + Math.floor(Math.random() * 1500);
      Logger.log('  Gmail hiccup (' + msg + ') -- retrying in ' + waitMs + 'ms');
      Utilities.sleep(waitMs);
    }
  }
  throw lastErr;
}

function parseEvents(text) {
  var arr;
  try { arr = JSON.parse(text); } catch (e) { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.filter(function (e) {
    return e && e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date || '');
  }).map(function (e) {
    return {
      title: String(e.title),
      date: e.date,
      time: (e.time && /^\d{2}:\d{2}$/.test(e.time)) ? e.time : null,
      endTime: (e.endTime && /^\d{2}:\d{2}$/.test(e.endTime)) ? e.endTime : null,
      location: e.location || null,
      kind: e.kind === 'deadline' ? 'deadline' : 'event',
      notes: e.notes || null
    };
  });
}

// ---------- The watcher ----------

function checkMail() {
  var list = senders();
  if (!list.length) {
    Logger.log('No SENDERS configured -- nothing to do.');
    return;
  }

  var seen = JSON.parse(getProp('SEEN') || '[]');
  var seenSet = {};
  seen.forEach(function (id) { seenSet[id] = true; });

  var query = '(' + list.map(function (s) { return 'from:' + s; }).join(' OR ') +
    ') newer_than:' + LOOKBACK;

  var threads;
  try {
    threads = gmailSearchWithRetry(query, 0, 25);
  } catch (e) {
    // Gmail is having a moment. Exit cleanly so the trigger does not report a
    // failure -- the next run in 15 minutes will try again.
    Logger.log('Gmail unavailable after retries (' + (e && e.message) +
      '). Skipping this run; will retry on the next trigger.');
    props().setProperty('LAST_SKIP', new Date().toISOString());
    return;
  }
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var queue = JSON.parse(getProp('QUEUE') || '[]');
  var fails = JSON.parse(getProp('FAILS') || '{}');
  var added = 0;
  var processed = 0;
  var stop = false;

  for (var t = 0; t < threads.length && !stop; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      var id = msg.getId();
      if (seenSet[id]) continue;

      if (processed >= MAX_PER_RUN) {
        Logger.log('Hit MAX_PER_RUN (' + MAX_PER_RUN + ') -- the rest wait for the next run.');
        stop = true; break;
      }
      if (callsUsedToday() >= DAILY_CALL_CAP) {
        Logger.log('Hit DAILY_CALL_CAP (' + DAILY_CALL_CAP + ') -- stopping until tomorrow.');
        stop = true; break;
      }

      try {
        var blocks = [];

        // PDF attachments first -- richest source when they exist
        var atts = msg.getAttachments();
        for (var a = 0; a < atts.length && a < 3; a++) {
          if (atts[a].getContentType() === 'application/pdf' && atts[a].getSize() < 4000000) {
            blocks.push({
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: Utilities.base64Encode(atts[a].getBytes())
              }
            });
          }
        }

        // The email body itself -- this is what makes ParentSquare work without
        // ever touching their login wall.
        // Plain text destroys table layout: a schedule grid collapses into a run
        // of cells with no way to tell which column (day) each belongs to. When
        // the message contains a table, send trimmed HTML so the row/column
        // structure survives and every cell can be tied to its date.
        var body = msg.getPlainBody() || '';
        var html = '';
        try { html = msg.getBody() || ''; } catch (err) { html = ''; }
        var bodySource = 'plain';
        if (html && /<table/i.test(html)) {
          var flat = '';
          try { flat = tablesToPlainText(html); } catch (errT) { flat = ''; }
          if (flat && flat.length > 40) {
            // Prose from the plain body + every table cell already resolved to
            // its own day and time. This is the PLAIN format the benchmarks
            // favour, with merges handled here rather than by the model.
            body = body + '\n\n--- SCHEDULE TABLES (expanded) ---\n' + flat;
            bodySource = 'plain+flattened-tables';
          }
        }
        if (false) {
          var trimmed = html
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<head[\s\S]*?<\/head>/gi, ' ')
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/<(img|br|hr|input|meta|link)[^>]*>/gi, ' ')
            .replace(/<a[^>]*>/gi, ' ').replace(/<\/a>/gi, ' ')
            .replace(/<\/?(span|font|b|i|u|em|strong|div|p|center|o:p)[^>]*>/gi, ' ')
            .replace(/\s(style|class|id|dir|lang|width|height|align|valign|bgcolor|cellpadding|cellspacing|border|colspan|rowspan)="[^"]*"/gi,
                     function (m) { return /colspan|rowspan/i.test(m) ? m : ''; })
            .replace(/&nbsp;/gi, ' ')
            .replace(/>\s+</g, '><')
            .replace(/\s+/g, ' ');
          // Keep only the region containing tables if the message is huge.
          if (trimmed.length > 90000) {
            var firstT = trimmed.search(/<table/i);
            if (firstT > 0) trimmed = trimmed.slice(Math.max(0, firstT - 500));
          }
          if (trimmed.length < 90000) { body = trimmed; bodySource = 'html-table'; }
        }
        if (body.length > 60000) { body = body.slice(0, 60000); bodySource += '-truncated'; }
        Logger.log('  body: ' + bodySource + ', ' + body.length + ' chars' +
          (/<table/i.test(body) ? ' (table structure preserved)' : ' (NO TABLE MARKUP -- grid will not extract well)'));
        var header = 'From: ' + msg.getFrom() + '\nSubject: ' + msg.getSubject() +
          '\nSent: ' + Utilities.formatDate(msg.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd') +
          '\n\n' + body;

        blocks.push({ type: 'text', text: header });
        blocks.push({ type: 'text', text: claudePrompt(today) });

        countCall();
        processed++;
        // RAW_MODE forwards the prepared email text to the app, which then runs
        // extraction with whichever model it is configured for (Anthropic or the
        // local Ollama one). Leave it false to keep extracting here.
        if (RAW_MODE) {
          queue.push({
            msgId: id,
            raw: body,
            subject: msg.getSubject().slice(0, 120),
            from: (function () {
              var fm = String(msg.getFrom() || '').match(/[\w.+-]+@[\w.-]+\.[\w.-]+/);
              return fm ? fm[0].toLowerCase() : '';
            })(),
            received: msg.getDate().toISOString()
          });
          added++;
          Logger.log('  forwarded raw (' + body.length + ' chars) -- app will extract');
          seen.push(id);
          seenSet[id] = true;
          continue;
        }

        var raw = callClaude(blocks);
        var events = parseEvents(raw);
        Logger.log('  Claude returned ' + events.length + ' event(s)' +
          (events.length === 0 && raw && raw.length > 50
            ? ' -- response did not parse; first 200 chars: ' + raw.slice(0, 200)
            : ''));

        var fromRaw = msg.getFrom() || '';
        var fromMatch = fromRaw.match(/[\w.+-]+@[\w.-]+\.[\w.-]+/);
        var fromAddr = fromMatch ? fromMatch[0].toLowerCase() : '';
        for (var e = 0; e < events.length; e++) {
          events[e].msgId = id;
          events[e].source = 'Email - ' + msg.getSubject().slice(0, 60);
          events[e].from = fromAddr;          // lets FlyerSnap map sender -> person
          queue.push(events[e]);
          added++;
        }

        seen.push(id);
        seenSet[id] = true;
        delete fails[id];
      } catch (err) {
        fails[id] = (fails[id] || 0) + 1;
        if (fails[id] >= MAX_TRIES) {
          // Some messages will never parse. Retrying them forever just burns money.
          Logger.log('GIVING UP on ' + id + ' after ' + MAX_TRIES + ' tries: ' + err.message);
          seen.push(id);
          seenSet[id] = true;
          delete fails[id];
        } else {
          Logger.log('Will retry ' + id + ' (' + fails[id] + '/' + MAX_TRIES + '): ' + err.message);
        }
      }
    }
  }

  // Trim: drop past events and keep the queue bounded
  queue = queue.filter(function (e) { return e.date >= today; });
  if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
  if (seen.length > 300) seen = seen.slice(seen.length - 300);

  props().setProperty('QUEUE', JSON.stringify(queue));
  props().setProperty('SEEN', JSON.stringify(seen));
  props().setProperty('FAILS', JSON.stringify(fails));
  props().setProperty('LAST_RUN', new Date().toISOString());

  Logger.log('Scanned ' + threads.length + ' threads, sent ' + processed + ' to Claude, added ' +
    added + ' events. Queue: ' + queue.length + '. Calls today: ' + callsUsedToday() + '/' + DAILY_CALL_CAP);
}

// ---------- The endpoint FlyerSnap fetches ----------

function doGet(e) {
  // Browsers cannot fetch() an Apps Script web app cross-origin: /exec redirects
  // to script.googleusercontent.com without usable CORS headers. So when a
  // ?callback= is supplied we answer as JSONP, which loads via a <script> tag
  // and is exempt from CORS. Without it we return plain JSON, so pasting the
  // URL into a browser still works for testing.
  var callback = (e && e.parameter && e.parameter.callback) || '';
  var safeCallback = /^[A-Za-z_$][A-Za-z0-9_$]{0,64}$/.test(callback) ? callback : '';

  var out = function (obj) {
    var body = JSON.stringify(obj);
    if (safeCallback) {
      return ContentService.createTextOutput(safeCallback + '(' + body + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(body)
      .setMimeType(ContentService.MimeType.JSON);
  };

  var secret = getProp('SECRET');
  if (!secret || !e || !e.parameter || e.parameter.token !== secret) {
    return out({ error: 'unauthorized' });
  }

  var action = (e.parameter.action || '').toLowerCase();

  // Manage the watched sender list from inside FlyerSnap.
  if (action === 'setsenders') {
    var incoming = (e.parameter.senders || '').split(',')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0 && s.length < 120; });
    // de-dupe, cap the count so a runaway can't bloat properties
    var seen = {}, clean = [];
    for (var i = 0; i < incoming.length && clean.length < 40; i++) {
      var low = incoming[i].toLowerCase();
      if (!seen[low]) { seen[low] = true; clean.push(incoming[i]); }
    }
    props().setProperty('SENDERS', clean.join(', '));
    return out({ ok: true, senders: clean });
  }

  if (action === 'senders') {
    return out({ ok: true, senders: senders() });
  }

  return out({
    ok: true,
    lastRun: getProp('LAST_RUN') || null,
    callsToday: callsUsedToday(),
    dailyCap: DAILY_CALL_CAP,
    senders: senders(),
    items: JSON.parse(getProp('QUEUE') || '[]')
  });
}

// ---------- Helpers you can run by hand from the editor ----------

/** Run once to confirm setup: checks properties and does a dry search. */
function testSetup() {
  var issues = [];
  if (!getProp('CLAUDE_KEY')) issues.push('CLAUDE_KEY is missing');
  if (!getProp('SECRET')) issues.push('SECRET is missing');
  if (!senders().length) issues.push('SENDERS is missing');
  if (issues.length) { Logger.log('PROBLEMS:\n- ' + issues.join('\n- ')); return; }

  var query = '(' + senders().map(function (s) { return 'from:' + s; }).join(' OR ') +
    ') newer_than:' + LOOKBACK;
  var threads = gmailSearchWithRetry(query, 0, 25);
  Logger.log('Setup looks good.\nQuery: ' + query + '\nMatching threads in the last ' +
    LOOKBACK + ': ' + threads.length);
  if (!threads.length) {
    Logger.log('No matches -- check the SENDERS domains against a real email.');
  } else {
    Logger.log('Most recent: "' + threads[0].getFirstMessageSubject() + '"');
  }
}

/** Clears the queue and history -- use if you want to re-scan from scratch. */
function resetWatcher() {
  props().deleteProperty('QUEUE');
  props().deleteProperty('SEEN');
  props().deleteProperty('FAILS');
  props().deleteProperty('CALLS');
  Logger.log('Queue, history, failures and the daily counter are cleared. ' +
    'Next run will re-scan the last ' + LOOKBACK + '.');
}

/** Shows today's spend and anything currently stuck. */
function watcherStatus() {
  var fails = JSON.parse(getProp('FAILS') || '{}');
  var stuck = Object.keys(fails);
  Logger.log('Claude calls today: ' + callsUsedToday() + ' / ' + DAILY_CALL_CAP +
    '\nQueue: ' + JSON.parse(getProp('QUEUE') || '[]').length + ' events' +
    '\nLast run: ' + (getProp('LAST_RUN') || 'never') +
    '\nMessages retrying: ' + (stuck.length ? stuck.length + ' (give up at ' + MAX_TRIES + ' tries)' : 'none'));
}

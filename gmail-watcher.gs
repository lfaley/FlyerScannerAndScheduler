/**
 * FlyerSnap Gmail Watcher — Google Apps Script
 *
 * Runs on Google's servers every 15 minutes, reads only emails from senders you
 * list, asks Claude to pull out dates, and holds them in a small queue that the
 * FlyerSnap app fetches.
 *
 * Nothing is emailed, deleted, or replied to. Read-only.
 *
 * SETUP: see the step-by-step in the chat. In short —
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
  return 'You are reading an email sent to a parent — school flyers, dance studio notices, ' +
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

function callClaude(contentBlocks) {
  var key = getProp('CLAUDE_KEY');
  if (!key) throw new Error('CLAUDE_KEY script property is not set');

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
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
    Logger.log('No SENDERS configured — nothing to do.');
    return;
  }

  var seen = JSON.parse(getProp('SEEN') || '[]');
  var seenSet = {};
  seen.forEach(function (id) { seenSet[id] = true; });

  var query = '(' + list.map(function (s) { return 'from:' + s; }).join(' OR ') +
    ') newer_than:' + LOOKBACK;
  var threads = GmailApp.search(query, 0, 25);
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
        Logger.log('Hit MAX_PER_RUN (' + MAX_PER_RUN + ') — the rest wait for the next run.');
        stop = true; break;
      }
      if (callsUsedToday() >= DAILY_CALL_CAP) {
        Logger.log('Hit DAILY_CALL_CAP (' + DAILY_CALL_CAP + ') — stopping until tomorrow.');
        stop = true; break;
      }

      try {
        var blocks = [];

        // PDF attachments first — richest source when they exist
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

        // The email body itself — this is what makes ParentSquare work without
        // ever touching their login wall.
        var body = msg.getPlainBody() || '';
        if (body.length > 12000) body = body.slice(0, 12000);
        var header = 'From: ' + msg.getFrom() + '\nSubject: ' + msg.getSubject() +
          '\nSent: ' + Utilities.formatDate(msg.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd') +
          '\n\n' + body;

        blocks.push({ type: 'text', text: header });
        blocks.push({ type: 'text', text: claudePrompt(today) });

        countCall();
        processed++;
        var events = parseEvents(callClaude(blocks));

        for (var e = 0; e < events.length; e++) {
          events[e].msgId = id;
          events[e].source = 'Email · ' + msg.getSubject().slice(0, 60);
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
  var out = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  };

  var secret = getProp('SECRET');
  if (!secret || !e || !e.parameter || e.parameter.token !== secret) {
    return out({ error: 'unauthorized' });
  }

  return out({
    ok: true,
    lastRun: getProp('LAST_RUN') || null,
    callsToday: callsUsedToday(),
    dailyCap: DAILY_CALL_CAP,
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
  var threads = GmailApp.search(query, 0, 25);
  Logger.log('Setup looks good.\nQuery: ' + query + '\nMatching threads in the last ' +
    LOOKBACK + ': ' + threads.length);
  if (!threads.length) {
    Logger.log('No matches — check the SENDERS domains against a real email.');
  } else {
    Logger.log('Most recent: "' + threads[0].getFirstMessageSubject() + '"');
  }
}

/** Clears the queue and history — use if you want to re-scan from scratch. */
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

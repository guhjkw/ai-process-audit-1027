// src/processAudit.js: reviews a business's recurring processes and works out where AI genuinely helps,
// where a plain feature you already pay for is enough, and where the process should be fixed (or left
// human) before anything is automated. The page and the tests load this same file.
//   assess(processes, settings) -> each process: approach, AI fit, risk, hours saved, build hours, payback
//   plan(result, settings)      -> a 12-week roadmap, scheduled against part-time capacity
//   toCsv(result, roadmap)      -> the plan as a spreadsheet
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProcessAudit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- settings you can change ----------
  const DEFAULTS = {
    staffCost: 62,          // A$ per hour, what an hour of your team's time costs you
    copilotPerSeat: 31.4,   // A$ per user per month: enter your Microsoft quote (default from a third-party AU guide, unverified)
    weeksPerMonth: 4.33,
    capacity: 10,           // implementation hours a week (part-time)
    fixFirst: { reworkShare: 0.2, errorRate: 10, steps: 9 }, // when to question a process before automating it
    riskBands: { high: 55, medium: 30 },
  };
  // How much of the time each approach typically takes off the process, and the base build effort.
  // These are planning assumptions, shown on the page and tuned to your numbers in the audit.
  const APPROACH = {
    builtin: { label: 'Switch on a feature you already have', share: 0.7, base: 2 },
    fix: { label: 'Fix the process first', share: 0.25, base: 8 },
    manual: { label: 'Keep it human', share: 0.05, base: 2 },
    tooling: { label: 'AI tools inside the app you use', share: 0.3, base: 4 },
    copilot: { label: 'Microsoft 365 Copilot', share: 0.35, base: 5 },
    automate: { label: 'Automation with an AI step', share: 0.6, base: 14 },
    draft: { label: 'AI drafts, a person approves', share: 0.45, base: 10 },
  };
  const SENS = { public: 0, client: 20, financial: 35 };
  const FREQ = { daily: 15, weekly: 10, monthly: 5 };

  function settings(over) {
    const s = JSON.parse(JSON.stringify(DEFAULTS)), errors = [];
    Object.keys(over || {}).forEach((k) => { s[k] = over[k]; });
    const num = (k, lo, hi) => { if (typeof s[k] !== 'number' || !isFinite(s[k]) || s[k] < lo || s[k] > hi) errors.push(k + ' must be a number from ' + lo + ' to ' + hi); };
    num('staffCost', 10, 500); num('copilotPerSeat', 0, 200); num('capacity', 1, 40);
    return { s, errors };
  }

  // ---------- input checks: bad rows are skipped and reported ----------
  function validate(rows) {
    const ok = [], problems = [], ids = new Set();
    (rows || []).forEach((p, i) => {
      const at = 'process ' + (p && p.id ? p.id : '#' + (i + 1));
      if (!p || typeof p !== 'object') return problems.push(at + ': not a process, skipped');
      if (!String(p.name || '').trim()) return problems.push(at + ': no name, skipped');
      const h = Number(p.hoursPerWeek), st = Number(p.steps);
      if (!isFinite(h) || h <= 0 || h > 60) return problems.push(at + ': hours a week must be more than 0 and at most 60, skipped');
      if (!Number.isInteger(st) || st < 1 || st > 40) return problems.push(at + ': steps must be a whole number from 1 to 40, skipped');
      if (!(p.sensitivity in SENS)) return problems.push(at + ': data sensitivity must be public, client or financial, skipped');
      const rw = Number(p.reworkHours || 0);
      if (rw < 0 || rw > h) return problems.push(at + ': rework hours cannot exceed the hours spent, skipped');
      let id = String(p.id || 'P' + (i + 1));
      if (ids.has(id)) { problems.push(at + ': duplicate id, renamed ' + id + 'b'); id = id + 'b'; }
      ids.add(id);
      const lvl = (x) => Math.max(0, Math.min(3, Math.round(Number(x) || 0)));
      ok.push(Object.assign({}, p, { id, name: String(p.name).trim(), hoursPerWeek: h, steps: st, reworkHours: rw, errorRate: Math.max(0, Math.min(100, Number(p.errorRate) || 0)),
        judgement: lvl(p.judgement), structured: lvl(p.structured), tools: Array.isArray(p.tools) ? p.tools : [], frequency: p.frequency in FREQ ? p.frequency : 'weekly' }));
    });
    return { rows: ok, problems };
  }

  // ---------- the decision, in order; the first rule that fits wins ----------
  function decide(p, s) {
    const rework = p.reworkHours / p.hoursPerWeek;
    if (p.builtIn) return { key: 'builtin', why: 'You already pay for ' + p.builtIn + '. Switch it on before building anything.' };
    if (rework >= s.fixFirst.reworkShare || (p.errorRate >= s.fixFirst.errorRate && p.steps >= s.fixFirst.steps))
      return { key: 'fix', why: Math.round(rework * 100) + '% of the time goes on rework and ' + p.errorRate + '% of items need correcting across ' + p.steps + ' steps. Automating it now would lock in the waste.' };
    if (p.judgement >= 3) return { key: 'manual', why: 'The value here is expert judgement. AI can prepare the material, not run it.' };
    if (p.structured >= 2) return { key: 'automate', why: 'Structured data moving between ' + p.tools.slice(0, 3).join(', ') + '. An automation moves it; AI reads the messy parts' + (p.clientFacing ? ', and anything client-facing waits for approval.' : '.') };
    if (p.m365 && p.textHeavy && !p.clientFacing) return { key: 'copilot', why: 'Internal writing in ' + p.tools.filter((t) => /Word|Outlook|Teams|Excel/.test(t)).join(' and ') + '. Copilot does it where the work already happens.' };
    if (p.textHeavy && p.clientFacing) return { key: 'draft', why: 'Client-facing writing: AI produces the first draft' + (p.m365 ? ' (Copilot in Word)' : '') + ', a person edits and approves before it goes out.' };
    if (!p.textHeavy && p.structured < 2) return { key: 'tooling', why: 'Hands-on production work: the AI features inside your tools (captions, rough cuts, clean-up) save time without a new system.' };
    return { key: p.m365 ? 'copilot' : 'draft', why: 'General writing support.' };
  }

  function assess(rows, over) {
    const st = settings(over), s = st.s, v = validate(rows);
    const out = v.rows.map((p) => {
      const d = decide(p, s), a = APPROACH[d.key];
      const fit = Math.max(0, Math.min(100, (p.textHeavy ? 25 : 0) + p.structured * 8 + FREQ[p.frequency] + Math.min(20, p.hoursPerWeek * 2) - p.judgement * 10 + (p.errorRate >= 5 ? 6 : 0)));
      // A built-in feature keeps the data inside the system you already trust, so its risk stays low.
      const raw = Math.min(100, SENS[p.sensitivity] + (p.clientFacing ? 20 : 0) + p.judgement * 10 + (d.key === 'automate' && p.sensitivity === 'financial' ? 10 : 0));
      const risk = d.key === 'builtin' ? Math.min(raw, 20) : raw;
      const level = risk >= s.riskBands.high ? 'high' : risk >= s.riskBands.medium ? 'medium' : 'low';
      const saved = Math.round((p.hoursPerWeek * a.share + (d.key === 'fix' ? p.reworkHours : 0)) * 10) / 10;
      const build = d.key === 'manual' || d.key === 'builtin' ? a.base : Math.round((a.base + 1.5 * Math.max(0, p.steps - 4) + 2 * Math.max(0, p.tools.length - 2)) * 10) / 10;
      const monthly = Math.round(saved * s.weeksPerMonth * s.staffCost);
      const seat = (d.key === 'copilot' || (d.key === 'draft' && p.m365)) ? p.owner : null;
      const control = level === 'high' ? 'A person approves before anything is sent or posted; every action logged' : level === 'medium' ? 'Spot-check 1 in 5 for the first month, then monthly' : 'Monthly review of results';
      return { id: p.id, name: p.name, owner: p.owner, hoursPerWeek: p.hoursPerWeek, approach: d.key, label: a.label, why: d.why, fit, risk, level, saved, build, monthly, seat, control,
        payback: saved > 0 ? Math.round(build / saved * 10) / 10 : null, score: saved > 0 ? Math.round(saved / build * 100 * (1 - risk / 200)) : 0, p };
    });
    // Most hours back per build hour first, discounted for risk; ties keep your order.
    out.sort((x, y) => y.score - x.score || v.rows.indexOf(x.p) - v.rows.indexOf(y.p));
    out.forEach((r, i) => { r.rank = i + 1; });
    const seats = [...new Set(out.map((r) => r.seat).filter(Boolean))];
    const licences = Math.round(seats.length * s.copilotPerSeat * 100) / 100;
    const savedWeek = Math.round(out.reduce((a, r) => a + r.saved, 0) * 10) / 10;
    const monthly = out.reduce((a, r) => a + r.monthly, 0);
    const build = Math.round(out.reduce((a, r) => a + r.build, 0) * 10) / 10;
    return {
      rows: out, problems: v.problems.concat(st.errors), settings: s, seats, licences,
      totals: { processes: out.length, hoursPerWeek: Math.round(out.reduce((a, r) => a + r.hoursPerWeek, 0) * 10) / 10, savedWeek, monthly, net: Math.round(monthly - licences), build, payback: savedWeek ? Math.round(build / savedWeek * 10) / 10 : null },
      challenges: out.filter((r) => ['fix', 'manual', 'builtin'].includes(r.approach)).map(challenge),
    };
  }

  // When I disagree with a process: the question, the evidence, a small trial, how we measure it, and the way back.
  function challenge(r) {
    const p = r.p;
    if (r.approach === 'fix') return { id: r.id, name: r.name, question: 'Do all ' + p.steps + ' steps need to exist?', evidence: p.reworkHours + ' of ' + p.hoursPerWeek + ' hours a week go on rework, and ' + p.errorRate + '% of items need correcting.', trial: 'Two weeks with one intake form, one owner and the duplicate checks removed.', measure: 'Rework under ' + Math.max(0.5, Math.round(p.reworkHours / 4 * 10) / 10) + ' hours a week and errors under ' + Math.max(2, Math.round(p.errorRate / 3)) + '%.', rollback: 'The old checklist runs alongside during the trial, so nothing is lost.' };
    if (r.approach === 'manual') return { id: r.id, name: r.name, question: 'Should AI take over ' + r.name.toLowerCase() + '?', evidence: 'This is where your judgement is the product (judgement level ' + p.judgement + ' of 3).', trial: 'Keep the session human. Let AI prepare a one-page pre-read from the client file and past call notes.', measure: 'Preparation time per session, and whether you use the pre-read.', rollback: 'Stop the pre-read; nothing else changes.' };
    return { id: r.id, name: r.name, question: 'Does this need AI at all?', evidence: p.builtIn + ' is already in your subscription.', trial: 'Switch it on for 30 days with your own wording.', measure: 'Hours spent on it each week, and how quickly clients respond.', rollback: 'Switch it off in one click.' };
  }

  // ---------- roadmap: phases first, then the work scheduled against weekly capacity ----------
  function plan(result, over) {
    const s = settings(over).s;
    const phase = (r) => (r.approach === 'manual' ? null : ['builtin', 'fix', 'copilot', 'tooling'].includes(r.approach) && r.level !== 'high' ? 1 : r.level === 'high' ? 3 : 2);
    const NAMES = { 1: 'Quick wins and process fixes', 2: 'Automations and drafting', 3: 'Higher-risk work, piloted with approval' };
    const items = result.rows.filter((r) => phase(r)).map((r) => ({ r, phase: phase(r) })).sort((a, b) => a.phase - b.phase || a.r.rank - b.r.rank);
    let used = 0;
    const out = items.map(({ r, phase: ph }) => {
      const start = used;
      used += r.build;
      return { id: r.id, name: r.name, approach: r.label, phase: ph, phaseName: NAMES[ph], hours: r.build, startWeek: Math.floor(start / s.capacity) + 1, endWeek: Math.max(Math.floor(start / s.capacity) + 1, Math.ceil(used / s.capacity)), control: r.control };
    });
    return { items: out, weeks: out.length ? out[out.length - 1].endWeek : 0, notAutomated: result.rows.filter((r) => r.approach === 'manual').map((r) => r.name), capacity: s.capacity };
  }

  function toCsv(result, roadmap) {
    const q = (v) => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const lines = [['Rank', 'Process', 'Owner', 'Approach', 'Why', 'Risk', 'Hours/week now', 'Hours/week saved', 'A$/month saved', 'Build hours', 'Payback (weeks)', 'Control'].join(',')];
    result.rows.forEach((r) => lines.push([r.rank, r.name, r.owner, r.label, r.why, r.level, r.hoursPerWeek, r.saved, r.monthly, r.build, r.payback == null ? '' : r.payback, r.control].map(q).join(',')));
    lines.push('', ['Week from', 'Week to', 'Phase', 'Process', 'Approach', 'Hours'].join(','));
    roadmap.items.forEach((i) => lines.push([i.startWeek, i.endWeek, i.phaseName, i.name, i.approach, i.hours].map(q).join(',')));
    return lines.join('\n');
  }

  return { DEFAULTS, APPROACH, settings, validate, decide, assess, plan, toCsv };
});

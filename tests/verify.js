// tests/verify.js: node tests against the same engine the page loads.  Run: node tests/verify.js
'use strict';
const A = require('../src/processAudit.js');
const DATA = require('../data/processes.json');
const clone = (x) => JSON.parse(JSON.stringify(x));
let passed = 0, failed = 0;
const ok = (name, cond, detail) => { if (cond) { passed++; console.log('  PASS ' + name); } else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); } };
const section = (t) => console.log('\n' + t);
const run = (rows, s) => A.assess(rows || DATA.processes, Object.assign({}, DATA.settings, s));
const byId = (res) => Object.fromEntries(res.rows.map((r) => [r.id, r]));

section('1. Input checks: bad rows are skipped and reported');
const bad = clone(DATA.processes);
bad.push({ id: 'X1', name: '', hoursPerWeek: 3, steps: 3, sensitivity: 'public' }, { id: 'X2', name: 'Negative hours', hoursPerWeek: -2, steps: 3, sensitivity: 'public' },
  { id: 'X3', name: 'Half a step', hoursPerWeek: 2, steps: 2.5, sensitivity: 'public' }, { id: 'X4', name: 'Odd data', hoursPerWeek: 2, steps: 2, sensitivity: 'secret' },
  { id: 'X5', name: 'More rework than work', hoursPerWeek: 2, steps: 2, sensitivity: 'public', reworkHours: 3 }, { id: 'P1', name: 'Same id', hoursPerWeek: 1, steps: 2, sensitivity: 'public' }, null);
const vb = A.validate(bad);
ok('a process with no name is skipped', vb.problems.some((p) => /X1: no name/.test(p)));
ok('negative hours are refused', vb.problems.some((p) => /X2: hours a week/.test(p)));
ok('a fractional step count is refused', vb.problems.some((p) => /X3: steps must be a whole number/.test(p)));
ok('an unknown data sensitivity is refused', vb.problems.some((p) => /X4: data sensitivity/.test(p)));
ok('rework larger than the work is refused', vb.problems.some((p) => /X5: rework hours cannot exceed/.test(p)));
ok('a duplicate id is renamed and reported', vb.rows.some((r) => r.id === 'P1b') && vb.problems.some((p) => /duplicate id/.test(p)));
ok('a non-object row is skipped', vb.problems.some((p) => /not a process/.test(p)));
ok('the review still runs on the 10 good rows', run(bad).rows.length === 10);
ok('settings out of range are refused with a reason', A.settings({ staffCost: 2, capacity: 0 }).errors.length === 2);

section('2. The approach for each process');
const res = run(), R = byId(res);
ok('invoice reminders: switch on the Xero feature you already pay for', R.P9.approach === 'builtin' && /Xero invoice reminders/.test(R.P9.why));
ok('enrolment admin: fix the process first (40% rework, 12% errors, 11 steps)', R.P7.approach === 'fix' && /40% of the time goes on rework and 12%/.test(R.P7.why));
ok('strategy sessions: keep them human', R.P8.approach === 'manual');
ok('bookkeeping data entry and website enquiries: automation with an AI step', R.P3.approach === 'automate' && R.P4.approach === 'automate');
ok('internal call notes in Teams: Microsoft 365 Copilot', R.P6.approach === 'copilot');
ok('podcast-to-blog and proposals: AI drafts, a person approves', R.P1.approach === 'draft' && R.P5.approach === 'draft' && /Copilot in Word/.test(R.P5.why));
ok('video edits: the AI tools inside the editor', R.P2.approach === 'tooling');
ok('client-facing enquiries wait for approval before anything goes out', /waits for approval/.test(R.P4.why));

section('3. Risk, savings, build effort and ranking');
ok('financial, client-facing automation is high risk with approval as the control', R.P3.level === 'high' && /approves before anything is sent or posted/.test(R.P3.control));
ok('a built-in feature stays low risk', R.P9.level === 'low');
ok('call notes save 1.4 of 4 hours a week (35%)', R.P6.saved === 1.4);
ok('fixing enrolment saves the 2 hours of rework plus a quarter of the rest: 3.3', R.P7.saved === 3.3);
ok('bookkeeping saves 6 of 10 hours: A$1,611 a month at A$62 an hour', R.P3.saved === 6 && R.P3.monthly === 1611);
ok('build hours grow with steps and tools (enrolment: 8 + 1.5 x 7 + 2 x 3 = 24.5)', R.P7.build === 24.5);
ok('payback in weeks = build hours / hours saved (bookkeeping 19 / 6 = 3.2)', R.P3.payback === 3.2);
ok('the Xero switch-on ranks first, proposals last', res.rows[0].id === 'P9' && res.rows[res.rows.length - 1].id === 'P5', res.rows.map((r) => r.id));
ok('totals: 47 hours a week now, 20.8 saved, A$5,584 a month', res.totals.hoursPerWeek === 47 && res.totals.savedWeek === 20.8 && res.totals.monthly === 5584);
ok('three Copilot seats (Advisers, Marketing coordinator, Director): A$94.20 a month', res.seats.length === 3 && res.licences === 94.2);
ok('net of licences: A$5,490 a month; 103 build hours pay back in 5 weeks', res.totals.net === 5490 && res.totals.build === 103 && res.totals.payback === 5);

section('4. Changing the inputs changes the answer');
ok('a higher staff cost raises the monthly value', run(null, { staffCost: 90 }).totals.monthly > 5584);
ok('a pricier Copilot seat lowers the net', run(null, { copilotPerSeat: 60 }).totals.net < 5490);
const more = clone(DATA.processes); more[2].hoursPerWeek = 20;
ok('doubling bookkeeping hours to 20 doubles its savings to 12', byId(run(more)).P3.saved === 12);
const fixed = clone(DATA.processes); fixed[6].reworkHours = 0.5; fixed[6].errorRate = 4;
ok('once enrolment rework drops, it is no longer "fix first" and becomes an automation', byId(run(fixed)).P7.approach === 'automate');
const noBuiltin = clone(DATA.processes); delete noBuiltin[8].builtIn;
ok('without the built-in feature, invoice reminders become an automation', byId(run(noBuiltin)).P9.approach === 'automate');
const judge = clone(DATA.processes); judge[4].judgement = 3;
ok('raising proposal judgement to 3 keeps proposals human', byId(run(judge)).P5.approach === 'manual');
ok('a stricter fix-first rule (10% rework) flags bookkeeping too', byId(run(null, { fixFirst: { reworkShare: 0.1, errorRate: 10, steps: 9 } })).P3.approach === 'fix');

section('5. Disagreeing with a process, constructively');
ok('three challenges: the built-in feature, the human sessions, the enrolment fix', res.challenges.map((c) => c.id).sort().join() === 'P7,P8,P9');
const c7 = res.challenges.find((c) => c.id === 'P7');
ok('each states the question, evidence, a small trial, a measure and a way back', c7.question === 'Do all 11 steps need to exist?' && /2 of 5 hours/.test(c7.evidence) && /Two weeks/.test(c7.trial) && /errors under 4%/.test(c7.measure) && /alongside/.test(c7.rollback), c7);

section('6. The 12-week roadmap');
const plan = A.plan(res, DATA.settings);
ok('quick wins first: Xero reminders and Copilot notes in week 1', plan.items[0].id === 'P9' && plan.items[1].id === 'P6' && plan.items[1].startWeek === 1);
ok('high-risk work last, piloted with approval: bookkeeping and proposals', plan.items.filter((i) => i.phase === 3).map((i) => i.id).join() === 'P3,P5');
ok('strategy sessions are listed as not automated', plan.notAutomated.join() === 'Strategy advice sessions' && !plan.items.some((i) => i.id === 'P8'));
ok('at 10 hours a week the plan fits in 11 weeks', plan.weeks === 11);
ok('at 20 hours a week it fits in 6', A.plan(res, { capacity: 20 }).weeks === 6);
ok('weeks never run backwards', plan.items.every((i, k) => i.endWeek >= i.startWeek && (!k || i.startWeek >= plan.items[k - 1].startWeek)));

section('7. Export');
const csv = A.toCsv(res, plan);
ok('the CSV holds the ranked review and the schedule', csv.startsWith('Rank,Process,Owner,Approach') && csv.split('\n').length === 1 + 9 + 2 + 8);
ok('commas inside reasons are quoted', /"Structured data moving between Xero, Excel, Outlook\./.test(csv));

console.log('\n' + (passed + failed) + ' checks: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

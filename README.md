# AI Process Review (live demo)

A working review of a business's recurring processes, built from an Upwork job post ("review my current business processes and identify opportunities to automate or improve them using AI ... and help implement"). It runs in the browser on an invented Perth advisory and education business with nine processes.

For each process it decides, in order: switch on a feature you already pay for; fix the process first (when rework or errors say automation would lock in waste); keep it human (judgement work); automation with an AI step (structured data between systems); Microsoft 365 Copilot (internal writing where the work already happens); AI draft with a person approving (client-facing writing); or the AI tools inside an app you already use. It then works out risk and the control that goes with it, hours saved, A$ value at your staff cost, build hours, payback, Copilot seats and licence cost, and schedules the work into a 12-week plan against part-time capacity. Where it disagrees with a process it says so, with the evidence, a small trial, a measure and the way back.

## Try it

Open `index.html` (works off disk), or `python3 -m http.server 8803`.

Try: set course enrolment rework to 0.5 hours and errors to 4%; raise the Copilot seat price; set proposal judgement to 3; add a process with no name; double build capacity.

## Files

```
index.src.html          page source (build.py embeds data/processes.json into index.html)
index.html              the built page
src/processAudit.js     settings, validate, decide, assess, plan, toCsv (the logic)
data/processes.json     the invented business
tests/verify.js         node tests against src/
tests/browser-check.py  Playwright: drives the page and downloads the plan
```

## Run the tests

```
node tests/verify.js            # 45 checks: 45 passed, 0 failed
python3 tests/browser-check.py  # 23 browser checks: 23 passed, 0 failed
```

## How the logic works

| Step | What it does |
|---|---|
| Input checks | No name, hours outside 0-60, fractional steps, unknown data sensitivity, rework above the hours, duplicate ids: skipped or renamed and reported |
| Decision | First rule that fits: built-in feature, fix first (rework share or errors with many steps), keep human (judgement 3), automate (structured data), Copilot (internal Microsoft 365 writing), AI draft with approval (client-facing writing), AI tools in the app |
| Risk | Data sensitivity + client-facing + judgement (+ financial postings); built-in features stay low. Control by band: approval and logging, spot checks, or monthly review |
| Value | Hours saved = hours x approach share (+ rework removed when fixing first); A$ = hours x 4.33 x staff cost; Copilot seats = distinct owners using it |
| Build and payback | Base effort by approach + steps over 4 + tools over 2; payback in weeks = build hours / hours saved |
| Ranking | Hours back per build hour, discounted for risk |
| Plan | Quick wins and fixes, then automations and drafting, then high-risk work piloted with approval; scheduled at your weekly capacity |

Savings shares and build hours are planning assumptions shown on the page; the real review replaces them with measured numbers.

Sample data is invented. Built by Taiwo, Pathfinder Automation Solutions.

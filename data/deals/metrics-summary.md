# Deal Metrics Summary

Comparison run: default `solveBoard` settings. Target deals are the 11 files in
`data/deals/`. Strategy summaries used 200 generated deals per strategy with
seed base `metrics-200`.

## Aggregate Metrics

| Group | n | Solved | Path length | Visited states | Peak frontier | Drought | Max cascade | Park moves | Avg empty cols | Initial blockers |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| target deals | 11 | 11 | mean 104.5, med 110, range 73-118 | mean 20,350, med 7,131, range 2,057-102,432 | mean 106,391 | mean 19.7, range 8-41 | mean 14.5, range 11-19 | mean 11.2 / 11.0 | mean 2.17 | mean 19.1 |
| one-move-constructive | 200 | 200 | 1 always | 2 always | mean 21.7 | 0 always | 70 always | 0 / 0 | 6.00 | mean 18.5 |
| multi-gate-cascade | 200 | 200 | 3 always | 4 always | mean 86.8 | 0 always | mean 35.2 | 0 / 0 | 6.25 | mean 18.5 |
| scripted-tableau-rearrangement | 200 | 200 | 2 always | 3 always | mean 59.7 | 0 always | mean 35.8 | 0 / 0 | 6.00 | mean 18.4 |
| park-locked-minor-cascade | 200 | 200 | 2 always | 3 always | mean 53.4 | 0 always | mean 46.4 | 0 / 0 | 6.37 | mean 18.3 |

## Target Deal Profile

The target deals are materially harder than the generated strategy outputs:

- Solution lengths range from 73 to 118 moves, with a median of 110.
- Solver effort ranges from 2,057 to 102,432 visited states, with a median of
  7,131.
- Longest foundation drought ranges from 8 to 41 moves.
- Park usage is substantial: target deals average 11.2 moves to park and 11.0
  moves from park.
- Cascades are smaller but repeated: target deals average 19.5 cascade events,
  with max cascade size averaging 14.5.
- Average empty columns during solution replay are much lower than generated
  deals: 2.17 versus about 6.00-6.37.

## Strategy Assessment

None of the four current generation strategies are suitable for creating deals
at the target difficulty as-is.

They match the target deals only on `initialBlockerScore`, which averages around
18-19 for both target and generated deals. The actual play and search profiles
are very different: target deals require long solutions, thousands to 100k
visited states, long foundation droughts, repeated park use, and many small
cascades. The generated deals are proof-scripted into 1-3 moves, have zero
drought, require almost no search, use no park moves in the solver path, and end
in huge cascades.

The closest conceptual starting point is `park-locked-minor-cascade`, because it
tries to model a lock/gate. In practice it still solves in 2 moves with no park
usage in the solver's chosen path, so it would need significant changes.

To target the desired difficulty, generation should reject or optimize candidates
against metric bands closer to the target deals:

- Path length: about 85-118 moves.
- Longest foundation drought: about 10-41 moves.
- Park moves: about 6-19 moves to park and 6-19 moves from park.
- Average empty columns: about 1.8-2.6.
- Visited states: at least in the low thousands.
- Cascades: many smaller cascades rather than one or two huge proof cascades.

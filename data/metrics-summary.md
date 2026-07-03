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


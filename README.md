https://tillkrischer.github.io/ff-solitaire/

## Offline deal generation

Generate a large batch of random-reference deals with the standalone parallel generator:

```sh
node src/cli.ts random-reference-bulk \
  --seed reference-2026-07 \
  --attempts 1000000 \
  --target-count 5000 \
  --workers 16 \
  --chunk-size 100 \
  --out-dir data/reference-generated \
  --max-visited 250000 \
  --beam 1000 \
  --trim-every 10000
```

This writes `deals.txt`, `manifest.jsonl`, and `summary.json` to the output directory. Add `--overwrite` to replace an existing output directory.

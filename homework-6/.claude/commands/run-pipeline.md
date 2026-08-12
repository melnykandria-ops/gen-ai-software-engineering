---
description: "Run the multi-agent banking pipeline end-to-end and summarize results"
---

Run the multi-agent banking pipeline end-to-end.

Steps:
1. Check that `sample-transactions.json` exists (abort with a clear message if not).
2. Clear the `shared/` stage directories (`input/`, `processing/`, `output/`) —
   keep `shared/logs/` history.
3. Run the pipeline: `python3 integrator.py`
4. Show a summary of results from `shared/results/pipeline-summary.json`
   (total / settled / held_for_review / rejected / total fees).
5. Report every transaction that was **rejected** and why (read the `reason`
   field from its result file in `shared/results/`).

---
description: "Validate all transactions in sample-transactions.json without running the pipeline"
---

Validate all transactions in `sample-transactions.json` **without** processing them.

Steps:
1. Run the validator in dry-run mode: `python3 agents/transaction_validator.py --dry-run`
2. Report: total count, valid count, invalid count, and the reasons for rejection.
3. Show the results as a table (transaction_id | amount | currency | verdict | reason).

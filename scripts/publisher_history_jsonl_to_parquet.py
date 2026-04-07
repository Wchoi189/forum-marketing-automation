#!/usr/bin/env python3
"""
Convert publisher history JSONL partitions into parquet datasets.

Input:
  artifacts/publisher-history/*.jsonl

Output:
  artifacts/publisher-history/parquet/runs.parquet
  artifacts/publisher-history/parquet/errors.parquet
  artifacts/publisher-history/parquet/posts.parquet (optional)
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd


@dataclass
class Row:
    at: str
    success: bool
    force: bool
    message: str
    runId: str | None
    artifactDir: str | None
    decision: str | None
    partition_date: str


def _parse_line(line: str, partition_date: str) -> Row | None:
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, dict):
        return None
    if not isinstance(payload.get("at"), str):
        return None
    if not isinstance(payload.get("success"), bool):
        return None
    if not isinstance(payload.get("force"), bool):
        return None
    if not isinstance(payload.get("message"), str):
        return None

    return Row(
        at=payload["at"],
        success=payload["success"],
        force=payload["force"],
        message=payload["message"],
        runId=payload.get("runId") if isinstance(payload.get("runId"), str) else None,
        artifactDir=payload.get("artifactDir")
        if payload.get("artifactDir") is None or isinstance(payload.get("artifactDir"), str)
        else None,
        decision=payload.get("decision") if isinstance(payload.get("decision"), str) else None,
        partition_date=partition_date,
    )


def load_rows(input_dir: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for file_path in sorted(input_dir.glob("*.jsonl")):
        partition_date = file_path.stem
        with file_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                parsed = _parse_line(line, partition_date)
                if parsed is None:
                    continue
                rows.append(parsed.__dict__)
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert publisher history JSONL into parquet datasets.")
    parser.add_argument(
        "--input-dir",
        default="artifacts/publisher-history",
        help="Directory containing partitioned jsonl files (default: artifacts/publisher-history)",
    )
    parser.add_argument(
        "--output-dir",
        default="artifacts/publisher-history/parquet",
        help="Directory for parquet outputs (default: artifacts/publisher-history/parquet)",
    )
    parser.add_argument(
        "--include-posts",
        action="store_true",
        help="Also emit posts.parquet placeholder for future post-level ETL.",
    )
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    rows = load_rows(input_dir)
    if not rows:
        print(f"No rows found in {input_dir}")
        return 0

    runs = pd.DataFrame(rows)
    runs["at"] = pd.to_datetime(runs["at"], utc=True, errors="coerce")
    runs = runs.sort_values(by="at", ascending=False)
    runs.to_parquet(output_dir / "runs.parquet", index=False)

    errors = runs.loc[runs["success"] == False].copy()  # noqa: E712
    errors.to_parquet(output_dir / "errors.parquet", index=False)

    if args.include_posts:
        posts = pd.DataFrame(
            {
                "runId": pd.Series(dtype="string"),
                "title": pd.Series(dtype="string"),
                "author": pd.Series(dtype="string"),
                "capturedAt": pd.Series(dtype="datetime64[ns, UTC]"),
            }
        )
        posts.to_parquet(output_dir / "posts.parquet", index=False)

    print(f"Wrote {len(runs)} rows to {output_dir / 'runs.parquet'}")
    print(f"Wrote {len(errors)} rows to {output_dir / 'errors.parquet'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

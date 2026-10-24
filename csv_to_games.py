#!/usr/bin/env python3
"""Convert a BILLA catalog CSV into Costcodle's games.json format."""

from __future__ import annotations

import argparse
import csv
import json
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path


REQUIRED_COLUMNS = {"name", "current_price_eur", "image_url"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "input_csv",
        type=Path,
        nargs="?",
        default=Path("billa_catalog.csv"),
        help="Catalog CSV produced by scrape_billa.py",
    )
    parser.add_argument(
        "output_json",
        type=Path,
        nargs="?",
        default=Path("games.json"),
        help="Costcodle JSON output path",
    )
    parser.add_argument(
        "--currency-symbol",
        default="€",
        help="Currency prefix stored in each price (default: €)",
    )
    return parser.parse_args()


def format_price(value: str, currency_symbol: str) -> str:
    try:
        price = Decimal(value.strip()).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, AttributeError) as exc:
        raise ValueError(f"invalid price {value!r}") from exc
    if price < 0:
        raise ValueError(f"price cannot be negative: {value!r}")
    return f"{currency_symbol}{price:.2f}"


def convert_catalog(input_csv: Path, currency_symbol: str) -> dict[str, dict[str, str]]:
    with input_csv.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        columns = set(reader.fieldnames or ())
        missing = REQUIRED_COLUMNS - columns
        if missing:
            names = ", ".join(sorted(missing))
            raise ValueError(f"CSV is missing required column(s): {names}")

        games: dict[str, dict[str, str]] = {}
        for line_number, row in enumerate(reader, start=2):
            name = (row.get("name") or "").strip()
            # Use the regular price for the game when Glovo exposes one, so
            # temporary promotions do not change the daily answer.
            price = (row.get("original_price_eur") or "").strip() or (
                row.get("current_price_eur") or ""
            ).strip()
            image = (row.get("image_url") or "").strip()
            if not name or not price or not image:
                raise ValueError(
                    f"CSV line {line_number} is missing name, current price, or image URL"
                )

            game_number = len(games) + 1
            games[f"game-{game_number}"] = {
                "name": name,
                "price": format_price(price, currency_symbol),
                "image": image,
            }
    return games


def main() -> int:
    args = parse_args()
    try:
        games = convert_catalog(args.input_csv, args.currency_symbol)
    except (OSError, ValueError) as exc:
        print(f"error: {exc}")
        return 1

    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(
        json.dumps(games, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(games)} games to {args.output_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

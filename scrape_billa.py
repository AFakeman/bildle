#!/usr/bin/env python3
"""Scrape the public Glovo catalog for a store such as BILLA.

Glovo's store page renders product tiles server-side.  The page also embeds
the store's category tree as ``data-testid`` attributes.  This scraper first
discovers the leaf categories, then requests each category URL and parses the
rendered product tiles.

Use only at a modest rate and check Glovo's terms before running this against
their service.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import sys
import time
from collections import OrderedDict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import quote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup, Tag


LOG = logging.getLogger("billa-scraper")

DEFAULT_STORE_URL = "https://glovoapp.com/bg/bg/sofia/stores/billa-sof1"
PRODUCT_TILE_SELECTOR = '[data-testid="product-tile"]'
CATEGORY_ITEM_RE = re.compile(
    r"^list-item-(?P<slug>.+?)-(?P<kind>sc|c)\.(?P<id>\d+)$"
)
SUBLIST_RE = re.compile(r"^sublist-(?P<slug>.+?)-sc\.(?P<id>\d+)$")
# Match the complete first price token.  The previous non-greedy expression
# matched only the first digit of values such as ``11,99`` and produced
# ``1.0`` in the catalog.
PRICE_RE = re.compile(r"-?\d(?:[\d\s.]*\d)?(?:,\d{1,2})?")


@dataclass(frozen=True)
class Category:
    name: str
    slug: str
    kind: str
    category_id: str
    parent_slug: str
    parent_id: str

    @property
    def content(self) -> str:
        return (
            f"{self.parent_slug}-sc.{self.parent_id}/"
            f"{self.slug}-{self.kind}.{self.category_id}"
        )


@dataclass
class Product:
    scraped_at: str
    store: str
    category: str
    category_content: str
    category_url: str
    name: str
    sku: str
    current_price_eur: float | None
    original_price_eur: float | None
    promotion: str
    image_url: str


def clean_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def parse_price(value: str | None) -> float | None:
    """Parse Glovo's Bulgarian-formatted price text into euros."""

    text = clean_text(value).replace("\xa0", " ")
    match = PRICE_RE.search(text)
    if not match:
        return None

    number = match.group(0).replace(" ", "")
    if "," in number:
        number = number.replace(".", "").replace(",", ".")
    else:
        # A dot is a decimal separator when there is only one dot and at most
        # two digits follow it; otherwise treat dots as thousands separators.
        if number.count(".") > 1:
            number = number.replace(".", "")
    try:
        return round(float(number), 2)
    except ValueError:
        return None


def make_session(user_agent: str) -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "bg-BG,bg;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache",
        }
    )
    return session


def fetch_html(
    session: requests.Session,
    url: str,
    timeout: float,
    retries: int,
) -> str:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            # A category URL can return a 307 to Glovo's generic city page.
            # Following it would make an unavailable/invalid category look
            # like a valid page with zero products.
            response = session.get(url, timeout=timeout, allow_redirects=False)
            if response.status_code == 429:
                wait = min(30.0, 2.0 ** attempt)
                LOG.warning("Rate limited for %s; waiting %.1fs", url, wait)
                time.sleep(wait)
                continue
            if 300 <= response.status_code < 400:
                location = response.headers.get("Location", "")
                target = urljoin(url, location) if location else "an unspecified URL"
                last_error = RuntimeError(
                    f"Glovo redirected the catalog request to {target}"
                )
                if attempt >= retries:
                    break
                wait = min(10.0, 1.5 * (attempt + 1))
                LOG.warning("%s; retrying in %.1fs", last_error, wait)
                time.sleep(wait)
                continue
            response.raise_for_status()
            return response.text
        except requests.RequestException as exc:
            last_error = exc
            if attempt >= retries:
                break
            wait = min(10.0, 1.5 * (attempt + 1))
            LOG.warning("Request failed (%s); retrying in %.1fs", exc, wait)
            time.sleep(wait)
    raise RuntimeError(f"Could not fetch {url}: {last_error}") from last_error


def discover_categories(html: str) -> list[Category]:
    soup = BeautifulSoup(html, "html.parser")
    categories: list[Category] = []
    seen: set[tuple[str, str]] = set()

    for item in soup.select('[data-testid^="list-item-"]'):
        test_id = item.get("data-testid", "")
        match = CATEGORY_ITEM_RE.match(test_id)
        if not match or match.group("kind") != "c":
            continue

        sublist = item.find_parent("ul", attrs={"data-testid": True})
        if not sublist:
            LOG.debug("Skipping category without a parent sublist: %s", test_id)
            continue
        parent_match = SUBLIST_RE.match(sublist.get("data-testid", ""))
        if not parent_match:
            LOG.debug("Skipping category with unknown parent: %s", test_id)
            continue

        key = (match.group("slug"), match.group("id"))
        if key in seen:
            continue
        seen.add(key)
        categories.append(
            Category(
                name=clean_text(item.get_text(" ", strip=True)),
                slug=match.group("slug"),
                kind=match.group("kind"),
                category_id=match.group("id"),
                parent_slug=parent_match.group("slug"),
                parent_id=parent_match.group("id"),
            )
        )

    return categories


def parse_product_tile(
    tile: Tag,
    *,
    store: str,
    category: Category,
    category_url: str,
    scraped_at: str,
) -> Product | None:
    title_element = tile.select_one("h3")
    title = clean_text(title_element.get_text(" ", strip=True) if title_element else "")
    if not title:
        return None

    name = title
    sku = ""
    if " / " in title:
        name, sku = title.rsplit(" / ", 1)
        name = name.strip()
        sku = sku.strip()

    current_element = tile.select_one('[class*="discountedPrice"]')
    if current_element is None:
        current_element = tile.select_one('[class*="Price"]')
    original_element = tile.select_one('[class*="originalPrice"]')
    promotion_element = tile.select_one('[data-style="promotion"]')
    image_element = tile.select_one("img[alt], img[src]")

    return Product(
        scraped_at=scraped_at,
        store=store,
        category=category.name,
        category_content=category.content,
        category_url=category_url,
        name=name,
        sku=sku,
        current_price_eur=parse_price(
            current_element.get_text(" ", strip=True) if current_element else None
        ),
        original_price_eur=parse_price(
            original_element.get_text(" ", strip=True) if original_element else None
        ),
        promotion=clean_text(
            promotion_element.get_text(" ", strip=True) if promotion_element else ""
        ),
        image_url=(image_element.get("src", "") if image_element else ""),
    )


def parse_products(html: str, category: Category, category_url: str) -> list[Product]:
    soup = BeautifulSoup(html, "html.parser")
    store_heading = soup.select_one("h1, h2")
    store = clean_text(store_heading.get_text(" ", strip=True) if store_heading else "BILLA")
    scraped_at = datetime.now(timezone.utc).isoformat()
    products: list[Product] = []
    for tile in soup.select(PRODUCT_TILE_SELECTOR):
        product = parse_product_tile(
            tile,
            store=store,
            category=category,
            category_url=category_url,
            scraped_at=scraped_at,
        )
        if product:
            products.append(product)
    return products


def category_url(store_url: str, category: Category) -> str:
    separator = "&" if "?" in store_url else "?"
    return f"{store_url}{separator}content={quote(category.content, safe='')}"


def dedupe_products(products: Iterable[Product]) -> list[dict[str, object]]:
    """Deduplicate repeated products while retaining all seen categories."""

    merged: OrderedDict[str, dict[str, object]] = OrderedDict()
    for product in products:
        key = product.sku or f"{product.name.lower()}::{product.current_price_eur}"
        row = asdict(product)
        if key not in merged:
            row["categories"] = [product.category]
            merged[key] = row
            continue
        existing = merged[key]
        categories = existing.setdefault("categories", [])
        if product.category not in categories:
            categories.append(product.category)
        # Preserve a populated price/image/promotion if the first occurrence
        # came from an incomplete tile.
        for field in ("current_price_eur", "original_price_eur", "promotion", "image_url"):
            if not existing.get(field) and row.get(field):
                existing[field] = row[field]

    for row in merged.values():
        row["categories"] = "; ".join(row.pop("categories", []))
    return list(merged.values())


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    fieldnames = [
        "scraped_at",
        "store",
        "categories",
        "category",
        "category_content",
        "category_url",
        "name",
        "sku",
        "current_price_eur",
        "original_price_eur",
        "promotion",
        "image_url",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--store-url", default=DEFAULT_STORE_URL)
    parser.add_argument("--output", type=Path, default=Path("billa_catalog.csv"))
    parser.add_argument("--json-output", type=Path)
    parser.add_argument("--delay", type=float, default=0.75, help="Seconds between category requests")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--max-categories", type=int, help="Limit categories for a quick test")
    parser.add_argument(
        "--category-slug",
        action="append",
        help="Only scrape this leaf-category slug; repeat for multiple slugs",
    )
    parser.add_argument("--no-dedupe", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument(
        "--user-agent",
        default=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    parsed_url = urlparse(args.store_url)
    if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
        LOG.error("--store-url must be an absolute http(s) URL")
        return 2

    session = make_session(args.user_agent)
    LOG.info("Discovering BILLA categories from %s", args.store_url)
    try:
        landing_html = fetch_html(session, args.store_url, args.timeout, args.retries)
    except RuntimeError as exc:
        LOG.error("%s", exc)
        return 1

    categories = discover_categories(landing_html)
    if args.category_slug:
        wanted = set(args.category_slug)
        categories = [category for category in categories if category.slug in wanted]
        missing = sorted(wanted - {category.slug for category in categories})
        if missing:
            LOG.warning("Category slug(s) not found: %s", ", ".join(missing))
    if args.max_categories is not None:
        categories = categories[: args.max_categories]
    if not categories:
        LOG.error("No leaf categories found; Glovo may have changed its markup or blocked the request")
        return 1
    LOG.info("Found %d leaf categories", len(categories))

    all_products: list[Product] = []
    failures: list[dict[str, str]] = []
    for index, category in enumerate(categories, start=1):
        url = category_url(args.store_url, category)
        LOG.info("[%d/%d] %s", index, len(categories), category.name)
        try:
            html = fetch_html(session, url, args.timeout, args.retries)
            products = parse_products(html, category, url)
            if not products:
                LOG.warning("No product tiles found for %s", category.name)
            all_products.extend(products)
            LOG.info("  %d products", len(products))
        except RuntimeError as exc:
            LOG.error("  failed: %s", exc)
            failures.append({"category": category.name, "url": url, "error": str(exc)})
        if index < len(categories):
            time.sleep(max(0.0, args.delay))

    rows = [asdict(product) for product in all_products] if args.no_dedupe else dedupe_products(all_products)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_csv(args.output, rows)
    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    LOG.info("Wrote %d rows to %s", len(rows), args.output)
    if failures:
        LOG.warning("%d categories failed", len(failures))
        for failure in failures:
            LOG.warning("  %s: %s", failure["category"], failure["error"])
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())

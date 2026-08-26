# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""
Helpers for building a dashboard's data server-side, as a scheduled report does.

The dashboard frontend merges native filter state into each chart's form data and lets
the chart plugin rebuild a query context. A report has no browser, so it works from the
chart's saved query context instead and folds the filter state in here.

Scope deliberately does not use the ``chartsInScope`` / ``tabsInScope`` values persisted
in a dashboard's ``json_metadata``. Those are a browser-side cache: the frontend
recomputes them on every render and never writes them back, so they have been observed
both stale and absent. ``scope`` plus the layout is the authoritative input.
"""

from __future__ import annotations

import copy
import logging
import re
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from superset.common.query_context import QueryContext

logger = logging.getLogger(__name__)

CHART_TYPE = "CHART"
ROOT_ID = "ROOT_ID"

# Excel's own limits. Exceeding them does not raise - it produces a workbook that
# refuses to open, which is why these are enforced rather than trusted.
SHEET_NAME_MAX_LEN = 31
ILLEGAL_SHEET_CHARS = re.compile(r"[\[\]:*?/\\]")

# The keys of an ``extraFormData`` payload this module knows how to apply. Anything a
# report cannot emit is deliberately absent - see the module docstring.
SUPPORTED_EXTRA_FORM_DATA_KEYS = frozenset(
    {"filters", "time_range", "time_grain_sqla", "granularity_sqla"}
)


def charts_in_scope(
    scope: dict[str, Any],
    chart_ids: list[int],
    position: dict[str, Any],
) -> list[int]:
    """
    Resolve which of ``chart_ids`` a native filter applies to.

    A Python port of the frontend's ``getChartIdsInFilterScope``: a chart is in scope
    when it is not excluded and at least one of its layout ancestors is named by
    ``rootPath``.

    :param scope: the filter's ``scope`` - ``{"rootPath": [...], "excluded": [...]}``
    :param chart_ids: the charts actually on the dashboard
    :param position: the dashboard's parsed ``position_json``
    :return: the ids in scope, in ``chart_ids`` order
    """
    root_path = scope.get("rootPath") or []
    excluded = set(scope.get("excluded") or [])
    parents_by_chart = _chart_parents(position)

    return [
        chart_id
        for chart_id in chart_ids
        if chart_id not in excluded
        and any(parent in root_path for parent in parents_by_chart.get(chart_id, []))
    ]


def _chart_parents(position: dict[str, Any]) -> dict[int, list[str]]:
    """Map each chart id to its layout ancestors, as recorded in ``position_json``."""
    parents: dict[int, list[str]] = {}
    for item in position.values():
        if not isinstance(item, dict) or item.get("type") != CHART_TYPE:
            continue
        chart_id = (item.get("meta") or {}).get("chartId")
        if chart_id is not None:
            parents[chart_id] = list(item.get("parents") or [])
    return parents


def ordered_chart_ids(position: dict[str, Any], chart_ids: list[int]) -> list[int]:
    """
    Order charts the way the dashboard lays them out, rather than by database id.

    Sheets in the delivered workbook should follow what the recipient sees on screen.
    Any chart the layout does not reach - an orphan left behind by an edit - is appended
    rather than dropped, so a report never silently loses data.
    """
    remaining = set(chart_ids)
    ordered: list[int] = []

    def walk(key: str) -> None:
        item = position.get(key)
        if not isinstance(item, dict):
            return
        if item.get("type") == CHART_TYPE:
            chart_id = (item.get("meta") or {}).get("chartId")
            if chart_id in remaining:
                remaining.discard(chart_id)
                ordered.append(chart_id)
            return
        for child in item.get("children") or []:
            walk(child)

    walk(ROOT_ID)
    return ordered + sorted(remaining)


def charts_in_tab(
    position: dict[str, Any], tab_id: str, chart_ids: list[int]
) -> list[int]:
    """Restrict to the charts inside one tab, for a report pinned to a single tab."""
    parents_by_chart = _chart_parents(position)
    return [
        chart_id
        for chart_id in chart_ids
        if tab_id in parents_by_chart.get(chart_id, [])
    ]


def merge_extra_form_data(payloads: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Combine the ``extraFormData`` of several filters applying to the same chart.

    ``filters`` accumulate, because two filters both narrowing a chart should both
    narrow it. The scalar keys cannot accumulate, so the last one wins - the same
    outcome as the frontend spreading one payload over another.
    """
    merged: dict[str, Any] = {}
    for payload in payloads:
        for key, value in payload.items():
            if key not in SUPPORTED_EXTRA_FORM_DATA_KEYS:
                logger.debug("Ignoring unsupported extraFormData key %s", key)
                continue
            if key == "filters":
                merged.setdefault("filters", []).extend(value or [])
            else:
                merged[key] = value
    return merged


def apply_extra_form_data(
    query_context: QueryContext,
    extra_form_data: dict[str, Any],
) -> QueryContext:
    """
    Fold a filter payload into a chart's saved query context.

    Handles only the keys a report schedule can produce - see
    ``ReportSchedule._generate_native_filter``. It is not a general ``extraFormData``
    interpreter and must not become one: every key added here is frontend behaviour
    reimplemented server-side, which is the one part of this feature that can silently
    disagree with what a dashboard shows.

    The passed context is updated and returned. Structures it shares with the caller's
    saved JSON are copied first, so nothing outside this call is mutated.

    :param query_context: a context freshly built from ``Slice.get_query_context()``
    :param extra_form_data: merged filter payload for this chart
    :return: the same context, with the filters applied
    """
    if not extra_form_data:
        return query_context

    for query in query_context.queries:
        # Copy before touching: the query context is built from the slice's stored
        # JSON, and these dicts may be shared with it.
        query.filter = [copy.deepcopy(flt) for flt in query.filter]
        query.extras = dict(query.extras)

        if extra_filters := extra_form_data.get("filters"):
            query.filter.extend(copy.deepcopy(extra_filters))

        if time_range := extra_form_data.get("time_range"):
            _apply_time_range(query, time_range)

        if time_grain := extra_form_data.get("time_grain_sqla"):
            query.extras["time_grain_sqla"] = time_grain

        if granularity := extra_form_data.get("granularity_sqla"):
            query.granularity = granularity

    return query_context


def _apply_time_range(query: Any, time_range: str) -> None:
    """
    Point the query's temporal filter at ``time_range``.

    Overriding the existing ``TEMPORAL_RANGE`` filter rather than appending a new one is
    what makes a single dashboard time filter work across charts built on different
    temporal columns - the column stays whatever the chart already chose.
    """
    applied = False
    for flt in query.filter:
        if flt.get("op") == "TEMPORAL_RANGE":
            flt["val"] = time_range
            applied = True

    if not applied and (column := query.granularity):
        # A chart saved without a temporal filter still has a temporal column; without
        # this the time range would be dropped in silence.
        query.filter.append({"col": column, "op": "TEMPORAL_RANGE", "val": time_range})
        applied = True

    if not applied:
        logger.warning(
            "Could not apply time range %s: the query has no temporal filter and no "
            "temporal column",
            time_range,
        )


def sheet_name(name: str, taken: set[str]) -> str:
    """
    Turn a chart name into a legal, unique Excel sheet name.

    Excel rejects five characters, caps names at 31 and requires uniqueness, and a
    workbook that breaks any of those opens as a corrupt file rather than reporting the
    problem. ``taken`` is updated with the returned name.
    """
    clean = ILLEGAL_SHEET_CHARS.sub(" ", name or "").strip()
    clean = re.sub(r"\s+", " ", clean).strip("'")
    clean = clean[:SHEET_NAME_MAX_LEN] or "Sheet"

    if clean not in taken:
        taken.add(clean)
        return clean

    for suffix_n in range(2, 1000):
        suffix = f" ({suffix_n})"
        candidate = clean[: SHEET_NAME_MAX_LEN - len(suffix)].strip() + suffix
        if candidate not in taken:
            taken.add(candidate)
            return candidate

    raise ValueError(f"Unable to derive a unique sheet name from {name!r}")


def attachment_filename(name: str, extension: str) -> str:
    """
    Build an attachment filename that survives being emailed.

    A space in the name can make the attachment invisible to a receiving parser,
    because ``send_email_smtp`` emits Content-Disposition as a Content-Type parameter
    rather than as its own header. Dashboard titles contain spaces almost always, so the
    name is slugified rather than used verbatim.
    """
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", (name or "").strip()).strip("._-")
    return f"{slug or 'report'}.{extension}"

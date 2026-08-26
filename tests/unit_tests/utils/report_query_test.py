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
"""Unit tests for superset.utils.report_query."""

from types import SimpleNamespace

import pytest

from superset.utils.report_query import (
    apply_extra_form_data,
    attachment_filename,
    charts_in_scope,
    charts_in_tab,
    merge_extra_form_data,
    ordered_chart_ids,
    sheet_name,
)

TAB_1 = "TAB-one"
TAB_2 = "TAB-two"

# Two tabs, charts 1 and 2 in the first, chart 3 in the second - the shape the feature
# was developed against.
POSITION = {
    "ROOT_ID": {"type": "ROOT", "children": ["TABS-1"]},
    "TABS-1": {"type": "TABS", "children": [TAB_1, TAB_2]},
    TAB_1: {"type": "TAB", "children": ["ROW-1", "ROW-2"]},
    TAB_2: {"type": "TAB", "children": ["ROW-3"]},
    "ROW-1": {"type": "ROW", "children": ["CHART-1"]},
    "ROW-2": {"type": "ROW", "children": ["CHART-2"]},
    "ROW-3": {"type": "ROW", "children": ["CHART-3"]},
    "CHART-1": {
        "type": "CHART",
        "meta": {"chartId": 1},
        "parents": ["ROOT_ID", "TABS-1", TAB_1, "ROW-1"],
    },
    "CHART-2": {
        "type": "CHART",
        "meta": {"chartId": 2},
        "parents": ["ROOT_ID", "TABS-1", TAB_1, "ROW-2"],
    },
    "CHART-3": {
        "type": "CHART",
        "meta": {"chartId": 3},
        "parents": ["ROOT_ID", "TABS-1", TAB_2, "ROW-3"],
    },
}
CHART_IDS = [1, 2, 3]


def query(filters=None, extras=None, granularity=None):
    """A stand-in for a QueryObject, which only needs these three attributes here."""
    return SimpleNamespace(
        filter=filters if filters is not None else [],
        extras=extras if extras is not None else {},
        granularity=granularity,
    )


def context(*queries):
    return SimpleNamespace(queries=list(queries))


def test_charts_in_scope_global():
    """A dashboard-wide scope reaches every chart, including ones added later."""
    scope = {"rootPath": ["ROOT_ID"], "excluded": []}
    assert charts_in_scope(scope, CHART_IDS, POSITION) == [1, 2, 3]


def test_charts_in_scope_honours_excluded():
    """The scope observed in the wild: both tabs listed, one chart excluded."""
    scope = {"rootPath": [TAB_1, TAB_2], "excluded": [2]}
    assert charts_in_scope(scope, CHART_IDS, POSITION) == [1, 3]


def test_charts_in_scope_single_tab():
    scope = {"rootPath": [TAB_2], "excluded": []}
    assert charts_in_scope(scope, CHART_IDS, POSITION) == [3]


def test_charts_in_scope_ignores_charts_not_on_the_dashboard():
    """A stale id in the caller's list must not conjure a chart into scope."""
    scope = {"rootPath": ["ROOT_ID"], "excluded": []}
    assert charts_in_scope(scope, [1, 99], POSITION) == [1]


def test_charts_in_scope_empty_scope_matches_nothing():
    """An empty rootPath means no ancestor matches - not "everything"."""
    assert charts_in_scope({}, CHART_IDS, POSITION) == []


def test_ordered_chart_ids_follows_the_layout():
    """Sheet order should match the screen, not the database."""
    assert ordered_chart_ids(POSITION, [3, 1, 2]) == [1, 2, 3]


def test_ordered_chart_ids_appends_orphans():
    """A chart the layout does not reach is still exported, never dropped."""
    assert ordered_chart_ids(POSITION, [1, 2, 3, 42]) == [1, 2, 3, 42]


def test_charts_in_tab():
    assert charts_in_tab(POSITION, TAB_1, CHART_IDS) == [1, 2]
    assert charts_in_tab(POSITION, TAB_2, CHART_IDS) == [3]
    assert charts_in_tab(POSITION, "TAB-missing", CHART_IDS) == []


def test_merge_extra_form_data_accumulates_filters():
    """Two filters narrowing one chart must both narrow it."""
    merged = merge_extra_form_data(
        [
            {"filters": [{"col": "a", "op": "IN", "val": ["x"]}]},
            {"filters": [{"col": "b", "op": "IN", "val": ["y"]}]},
        ]
    )
    assert merged["filters"] == [
        {"col": "a", "op": "IN", "val": ["x"]},
        {"col": "b", "op": "IN", "val": ["y"]},
    ]


def test_merge_extra_form_data_scalars_last_wins():
    merged = merge_extra_form_data([{"time_range": "first"}, {"time_range": "second"}])
    assert merged == {"time_range": "second"}


def test_merge_extra_form_data_drops_unsupported_keys():
    """Only the keys a report can emit are honoured; the rest must not leak through."""
    assert merge_extra_form_data([{"adhoc_filters": [1], "time_range": "x"}]) == {
        "time_range": "x"
    }


def test_apply_extra_form_data_appends_filters():
    qc = context(query(filters=[{"col": "kept", "op": "IN", "val": ["1"]}]))
    apply_extra_form_data(qc, {"filters": [{"col": "new", "op": "IN", "val": ["2"]}]})
    assert qc.queries[0].filter == [
        {"col": "kept", "op": "IN", "val": ["1"]},
        {"col": "new", "op": "IN", "val": ["2"]},
    ]


def test_apply_extra_form_data_overrides_the_temporal_filter():
    """
    The override, not an append, is what lets one dashboard time filter serve charts
    built on different temporal columns.
    """
    qc = context(
        query(
            filters=[{"col": "created_on", "op": "TEMPORAL_RANGE", "val": "No filter"}]
        )
    )
    apply_extra_form_data(qc, {"time_range": "2026-01-01 : 2026-01-02"})
    assert qc.queries[0].filter == [
        {"col": "created_on", "op": "TEMPORAL_RANGE", "val": "2026-01-01 : 2026-01-02"}
    ]


def test_apply_extra_form_data_adds_a_temporal_filter_when_absent():
    """A chart saved without a time filter must not silently ignore the time range."""
    qc = context(query(granularity="ts"))
    apply_extra_form_data(qc, {"time_range": "2026-01-01 : 2026-01-02"})
    assert qc.queries[0].filter == [
        {"col": "ts", "op": "TEMPORAL_RANGE", "val": "2026-01-01 : 2026-01-02"}
    ]


def test_apply_extra_form_data_time_range_without_temporal_column_is_noop():
    qc = context(query())
    apply_extra_form_data(qc, {"time_range": "2026-01-01 : 2026-01-02"})
    assert qc.queries[0].filter == []


def test_apply_extra_form_data_grain_and_granularity():
    qc = context(query(extras={"having": ""}))
    apply_extra_form_data(
        qc, {"time_grain_sqla": "P1M", "granularity_sqla": "other_col"}
    )
    assert qc.queries[0].extras == {"having": "", "time_grain_sqla": "P1M"}
    assert qc.queries[0].granularity == "other_col"


def test_apply_extra_form_data_applies_to_every_query():
    qc = context(query(), query())
    apply_extra_form_data(qc, {"filters": [{"col": "a", "op": "IN", "val": ["x"]}]})
    assert all(len(q.filter) == 1 for q in qc.queries)


def test_apply_extra_form_data_does_not_mutate_shared_structures():
    """
    The query context is built from the slice's stored JSON, so the dicts it hands us
    may be shared. Mutating them would corrupt the next chart in the same report.
    """
    source_filter = {"col": "created_on", "op": "TEMPORAL_RANGE", "val": "No filter"}
    source_extras = {"having": ""}
    incoming = [{"col": "a", "op": "IN", "val": ["x"]}]

    qc = context(query(filters=[source_filter], extras=source_extras))
    apply_extra_form_data(
        qc,
        {
            "time_range": "2026-01-01 : 2026-01-02",
            "time_grain_sqla": "P1M",
            "filters": incoming,
        },
    )

    assert source_filter["val"] == "No filter"
    assert source_extras == {"having": ""}
    assert incoming == [{"col": "a", "op": "IN", "val": ["x"]}]


def test_apply_extra_form_data_empty_payload_is_a_noop():
    qc = context(query(filters=[{"col": "a", "op": "IN", "val": ["x"]}]))
    original = list(qc.queries[0].filter)
    apply_extra_form_data(qc, {})
    assert qc.queries[0].filter == original


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Revenue", "Revenue"),
        ("a:b*c?d", "a b c d"),
        ("with/slash\\and[brackets]", "with slash and brackets"),
        ("", "Sheet"),
        ("   ", "Sheet"),
        ("'quoted'", "quoted"),
    ],
)
def test_sheet_name_sanitises(raw, expected):
    assert sheet_name(raw, set()) == expected


def test_sheet_name_truncates_to_the_excel_limit():
    name = sheet_name("x" * 60, set())
    assert name == "x" * 31
    assert len(name) == 31


def test_sheet_name_disambiguates_collisions_within_the_limit():
    taken: set[str] = set()
    first = sheet_name("Revenue by region and product", taken)
    second = sheet_name("Revenue by region and product", taken)
    third = sheet_name("Revenue by region and product", taken)
    assert first != second != third
    assert second.endswith("(2)")
    assert third.endswith("(3)")
    assert all(len(n) <= 31 for n in (first, second, third))


def test_sheet_name_disambiguates_after_truncation():
    """Two different long names can collide only once truncated."""
    taken: set[str] = set()
    a = sheet_name("y" * 40 + "first", taken)
    b = sheet_name("y" * 40 + "second", taken)
    assert a != b
    assert len(b) <= 31


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Superset users table", "Superset_users_table.xlsx"),
        ("[AIMES] Q1 report", "AIMES_Q1_report.xlsx"),
        ("", "report.xlsx"),
        ("...", "report.xlsx"),
        ("already_fine", "already_fine.xlsx"),
    ],
)
def test_attachment_filename_removes_spaces(raw, expected):
    """
    A space in the filename can make the attachment invisible to a receiving parser,
    because Content-Disposition is emitted as a Content-Type parameter upstream.
    """
    assert attachment_filename(raw, "xlsx") == expected

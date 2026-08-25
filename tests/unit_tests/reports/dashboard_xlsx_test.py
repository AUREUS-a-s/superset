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
Assembly of the dashboard XLSX report: the workbook, and the behaviour that keeps a
recipient from acting on data that is quietly not what they asked for.
"""

import io
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pandas as pd
import pytest

from superset.commands.report.exceptions import ReportScheduleXlsxFailedError
from superset.commands.report.execute import BaseReportState
from superset.utils.excel import df_dict_to_excel

TAB_1 = "TAB-one"
TAB_2 = "TAB-two"

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

FILTER_ID = "NATIVE_FILTER-abc"


def fake_slice(chart_id, name, has_query_context=True):
    return SimpleNamespace(
        id=chart_id,
        slice_name=name,
        query_context="{}" if has_query_context else None,
        get_query_context=lambda: SimpleNamespace(queries=[]),
    )


def fake_dashboard(slices, native_filters=None, position=None):
    metadata = {"native_filter_configuration": native_filters or []}
    return SimpleNamespace(
        id=1,
        dashboard_title="Sales",
        slices=slices,
        position_json=__import__("json").dumps(position or POSITION),
        json_metadata=__import__("json").dumps(metadata),
    )


def report_state(dashboard, extra=None, name="Nightly"):
    schedule = SimpleNamespace(
        name=name,
        dashboard=dashboard,
        extra=extra or {},
        get_native_filters_extra_form_data=lambda: ([], []),
    )
    state = BaseReportState.__new__(BaseReportState)
    state._report_schedule = schedule  # pylint: disable=protected-access
    state._scheduled_dttm = datetime(2026, 1, 1)  # pylint: disable=protected-access
    state._start_dttm = datetime(2026, 1, 1)  # pylint: disable=protected-access
    state._execution_id = uuid4()  # pylint: disable=protected-access
    state._filter_warnings = []  # pylint: disable=protected-access
    return state


def payload(data, colnames, rejected=None):
    result = {"data": data, "colnames": colnames}
    if rejected is not None:
        result["rejected_filters"] = rejected
    return {"queries": [result]}


# --------------------------------------------------------------------------- workbook


def test_df_dict_to_excel_round_trips_every_sheet():
    frames = {
        "First": pd.DataFrame({"a": [1, 2]}),
        "Second": pd.DataFrame({"b": ["x"]}),
    }
    book = pd.read_excel(
        io.BytesIO(df_dict_to_excel(frames, index=False)), sheet_name=None
    )
    assert list(book) == ["First", "Second"]
    assert book["First"]["a"].tolist() == [1, 2]


def test_df_dict_to_excel_keeps_headers_on_an_empty_sheet():
    """
    An empty result must still carry its columns, or the recipient cannot tell an
    empty answer from a broken export.
    """
    frames = {"Empty": pd.DataFrame([], columns=["created_on", "value"])}
    book = pd.read_excel(
        io.BytesIO(df_dict_to_excel(frames, index=False)), sheet_name=None
    )
    assert list(book["Empty"].columns) == ["created_on", "value"]
    assert len(book["Empty"]) == 0


def test_df_dict_to_excel_quotes_formulas():
    """Cells starting with = must not be live formulas in a delivered workbook."""
    frames = {"S": pd.DataFrame({"a": ["=SUM(A1:A9)"]})}
    book = pd.read_excel(
        io.BytesIO(df_dict_to_excel(frames, index=False)), sheet_name=None
    )
    assert (
        book["S"]["a"][0].startswith("'=") or book["S"]["a"][0].startswith("=") is False
    )


# ------------------------------------------------------------------ chart selection


def test_selected_chart_ids_defaults_to_every_chart_in_layout_order():
    dashboard = fake_dashboard(
        [fake_slice(3, "C"), fake_slice(1, "A"), fake_slice(2, "B")]
    )
    state = report_state(dashboard)
    assert state._selected_chart_ids(dashboard, POSITION) == [1, 2, 3]


def test_selected_chart_ids_narrows_to_the_pinned_tab():
    dashboard = fake_dashboard(
        [fake_slice(1, "A"), fake_slice(2, "B"), fake_slice(3, "C")]
    )
    state = report_state(dashboard, extra={"dashboard": {"anchor": TAB_2}})
    assert state._selected_chart_ids(dashboard, POSITION) == [3]


def test_selected_chart_ids_honours_an_explicit_selection():
    dashboard = fake_dashboard(
        [fake_slice(1, "A"), fake_slice(2, "B"), fake_slice(3, "C")]
    )
    state = report_state(dashboard, extra={"dashboard": {"charts": [3, 1]}})
    assert state._selected_chart_ids(dashboard, POSITION) == [1, 3]


def test_selected_chart_ids_ignores_a_multi_tab_anchor():
    """
    A list-valued anchor is a screenshot-only concept. Falling back to the whole
    dashboard beats guessing which tab was meant.
    """
    dashboard = fake_dashboard(
        [fake_slice(1, "A"), fake_slice(2, "B"), fake_slice(3, "C")]
    )
    state = report_state(dashboard, extra={"dashboard": {"anchor": '["TAB-one"]'}})
    assert state._selected_chart_ids(dashboard, POSITION) == [1, 2, 3]


# ------------------------------------------------------------------ filter scoping


def test_filters_by_chart_uses_scope_not_the_persisted_cache():
    """
    chartsInScope is a browser cache and has been observed stale. A deliberately wrong
    one is supplied here: honouring it would drop chart 3.
    """
    native_filters = [
        {
            "id": FILTER_ID,
            "scope": {"rootPath": ["ROOT_ID"], "excluded": []},
            "chartsInScope": [1],
        }
    ]
    dashboard = fake_dashboard(
        [fake_slice(1, "A"), fake_slice(2, "B"), fake_slice(3, "C")], native_filters
    )
    state = report_state(dashboard)
    state._report_schedule.get_native_filters_extra_form_data = lambda: (
        [(FILTER_ID, {"time_range": "a : b"})],
        [],
    )

    metadata = {"native_filter_configuration": native_filters}
    per_chart, warnings = state._filters_by_chart(metadata, POSITION, [1, 2, 3])

    assert sorted(per_chart) == [1, 2, 3]
    assert warnings == []


def test_filters_by_chart_respects_excluded():
    native_filters = [
        {"id": FILTER_ID, "scope": {"rootPath": [TAB_1, TAB_2], "excluded": [2]}}
    ]
    dashboard = fake_dashboard(
        [fake_slice(1, "A"), fake_slice(2, "B"), fake_slice(3, "C")], native_filters
    )
    state = report_state(dashboard)
    state._report_schedule.get_native_filters_extra_form_data = lambda: (
        [(FILTER_ID, {"time_range": "a : b"})],
        [],
    )
    per_chart, _ = state._filters_by_chart(
        {"native_filter_configuration": native_filters}, POSITION, [1, 2, 3]
    )
    assert sorted(per_chart) == [1, 3]


def test_filters_by_chart_warns_when_a_filter_no_longer_exists():
    """
    A report pinned to a filter somebody has since deleted must say so, not quietly
    deliver unfiltered numbers.
    """
    dashboard = fake_dashboard([fake_slice(1, "A")], native_filters=[])
    state = report_state(dashboard)
    state._report_schedule.get_native_filters_extra_form_data = lambda: (
        [(FILTER_ID, {"time_range": "a : b"})],
        [],
    )
    per_chart, warnings = state._filters_by_chart(
        {"native_filter_configuration": []}, POSITION, [1]
    )
    assert per_chart == {}
    assert any("no longer exists" in w for w in warnings)


# ------------------------------------------------------------------- sheet building


@patch("superset.commands.report.execute.ChartDataCommand")
def test_chart_frame_keeps_headers_when_the_result_is_empty(command):
    command.return_value.run.return_value = payload([], ["created_on", "value"])
    state = report_state(fake_dashboard([]))
    frame = state._chart_frame(fake_slice(1, "A"), {}, [])
    assert list(frame.columns) == ["created_on", "value"]
    assert len(frame) == 0


@patch("superset.commands.report.execute.ChartDataCommand")
def test_chart_frame_notes_a_rejected_filter(command):
    """
    The failure this guards against: a rejected filter still returns a successful,
    unfiltered query, so without the note the sheet looks filtered and is not.
    """
    command.return_value.run.return_value = payload(
        [{"a": 1}],
        ["a"],
        rejected=[{"reason": "not_in_datasource", "column": "region"}],
    )
    notes: list[str] = []
    state = report_state(fake_dashboard([]))
    state._chart_frame(fake_slice(1, "Sales"), {"filters": []}, notes)
    assert len(notes) == 1
    assert "region" in notes[0]
    assert "NOT filtered" in notes[0]


def test_chart_frame_rejects_a_chart_without_a_saved_query_context():
    state = report_state(fake_dashboard([]))
    with pytest.raises(ReportScheduleXlsxFailedError, match="save it again"):
        state._chart_frame(fake_slice(1, "A", has_query_context=False), {}, [])


@patch("superset.commands.report.execute.ChartDataCommand")
def test_build_dashboard_frames_isolates_a_failing_chart(command):
    """One broken chart must cost its own sheet, not the whole workbook."""

    def run_side_effect():
        if command.call_count == 2:
            raise ValueError("dataset exploded")
        return payload([{"a": 1}], ["a"])

    command.return_value.run.side_effect = lambda *a, **k: run_side_effect()

    dashboard = fake_dashboard(
        [fake_slice(1, "Good one"), fake_slice(2, "Bad one"), fake_slice(3, "Third")]
    )
    state = report_state(dashboard)
    frames, notes = state._build_dashboard_frames(dashboard)

    assert list(frames) == ["Good one", "Bad one", "Third"]
    assert list(frames["Bad one"].columns) == ["error"]
    assert "dataset exploded" in frames["Bad one"]["error"][0]
    assert any("Bad one" in note for note in notes)
    # and the warning reaches the execution log
    assert any("Bad one" in w for w in state._filter_warnings)


@patch("superset.commands.report.execute.ChartDataCommand")
def test_build_dashboard_frames_disambiguates_duplicate_chart_names(command):
    command.return_value.run.return_value = payload([{"a": 1}], ["a"])
    dashboard = fake_dashboard([fake_slice(1, "Same"), fake_slice(2, "Same")])
    state = report_state(dashboard)
    frames, _ = state._build_dashboard_frames(dashboard)
    assert list(frames) == ["Same", "Same (2)"]


# ----------------------------------------------------------------------- info sheet


def test_dashboard_info_frame_records_the_filter_state():
    """
    The original complaint was not only "too many emails" but "no idea which filter
    state produced them", so this sheet is part of the feature, not decoration.
    """
    dashboard = fake_dashboard([])
    state = report_state(
        dashboard,
        extra={
            "dashboard": {
                "nativeFilters": [
                    {
                        "filterName": "Period",
                        "filterType": "filter_time",
                        "filterValues": ["2026-01-01 : 2026-01-02"],
                    },
                    {
                        "columnName": "region",
                        "filterType": "filter_select",
                        "filterValues": ["North", "South"],
                    },
                ]
            }
        },
    )
    frame = state._dashboard_info_frame(["something was rejected"])
    rows = dict(zip(frame["Item"], frame["Value"], strict=True))

    assert rows["Report"] == "Nightly"
    assert rows["Dashboard"] == "Sales"
    assert rows["Filter: Period"] == "2026-01-01 : 2026-01-02"
    assert rows["Filter: region"] == "North, South"
    assert rows["Warning"] == "something was rejected"

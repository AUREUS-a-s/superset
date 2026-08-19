/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { useCallback, useEffect } from 'react';
import { t } from '@apache-superset/core/translation';
import { styled } from '@apache-superset/core/theme';
import {
  AntdThemeProvider,
  DatePicker,
  Loading,
} from '@superset-ui/core/components';
import { extendedDayjs } from '@superset-ui/core/utils/dates';
import { Dayjs } from 'dayjs';
import { useLocale } from 'src/hooks/useLocale';
import {
  guessSingleDate,
  singleDateEncode,
} from 'src/explore/components/controls/DateFilterControl/utils';
import { PluginFilterSingleDateProps } from './types';
import { FilterPluginStyle } from '../common';

const SingleDateFilterStyles = styled(FilterPluginStyle)`
  display: flex;
  align-items: center;
  overflow-x: visible;
`;

const ControlContainer = styled.div`
  display: flex;
  width: 100%;
  max-width: 100%;

  & .ant-picker {
    width: 100%;
  }
`;

/**
 * Filters a dashboard to a single day, chosen from a calendar shown directly in
 * the filter bar. The value is the day as a whole-day time range, the same
 * shape the time filter produces, so it applies to the temporal columns charts
 * already filter on.
 */
export default function SingleDateFilterPlugin(
  props: PluginFilterSingleDateProps,
) {
  const {
    setDataMask,
    setHoveredFilter,
    unsetHoveredFilter,
    setFocusedFilter,
    unsetFocusedFilter,
    setFilterActive,
    width,
    height,
    filterState,
    inputRef,
    isOverflowingFilterBar = false,
  } = props;

  const datePickerLocale = useLocale();

  const handleDateChange = useCallback(
    (timeRange?: string): void => {
      setDataMask({
        extraFormData: timeRange ? { time_range: timeRange } : {},
        filterState: { value: timeRange },
      });
    },
    [setDataMask],
  );

  // Republish the applied value so its extraFormData is derived on load too,
  // for instance when the dashboard restores a default.
  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-pass-data-to-parent -- mirrors the established TimeFilterPlugin on-load republish pattern for consistency between the two filter plugins
    handleDateChange(filterState.value);
  }, [filterState.value]);

  const currentDay = guessSingleDate(filterState.value ?? '');

  if (!props.formData?.inView) {
    return null;
  }

  return (
    <SingleDateFilterStyles width={width} height={height}>
      <ControlContainer
        ref={inputRef}
        onFocus={setFocusedFilter}
        onBlur={unsetFocusedFilter}
        onMouseEnter={setHoveredFilter}
        onMouseLeave={unsetHoveredFilter}
        tabIndex={-1}
      >
        {datePickerLocale === null ? (
          <Loading position="inline-centered" />
        ) : (
          <AntdThemeProvider locale={datePickerLocale}>
            <DatePicker
              aria-label={t('Date')}
              value={currentDay ? extendedDayjs(currentDay) : undefined}
              onChange={(datetime: Dayjs | null) =>
                handleDateChange(
                  datetime ? singleDateEncode(datetime) : undefined,
                )
              }
              onOpenChange={setFilterActive}
              status={filterState.validateStatus ? 'error' : undefined}
              getPopupContainer={(triggerNode: HTMLElement) =>
                isOverflowingFilterBar
                  ? (triggerNode.parentNode as HTMLElement)
                  : document.body
              }
            />
          </AntdThemeProvider>
        )}
      </ControlContainer>
    </SingleDateFilterStyles>
  );
}

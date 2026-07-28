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
import { t } from '@apache-superset/core/translation';
import {
  AntdThemeProvider,
  DatePicker,
  Loading,
  Row,
} from '@superset-ui/core/components';
import { extendedDayjs } from '@superset-ui/core/utils/dates';
import { Dayjs } from 'dayjs';
import { useLocale } from 'src/hooks/useLocale';
import {
  guessSingleDate,
  singleDateEncode,
} from 'src/explore/components/controls/DateFilterControl/utils';
import { SingleDateFrameProps } from 'src/explore/components/controls/DateFilterControl/types';

/**
 * Picks a single calendar date, stored as that whole day. Selecting
 * 2021-03-16 yields "2021-03-16T00:00:00 : 2021-03-17T00:00:00".
 *
 * The picker is empty until a day is chosen, including when arriving from a
 * range type that is not a whole day. Preselecting one would be a trap: the
 * date picker reports changes only, so picking the preselected day would do
 * nothing and there is no APPLY button to fall back on.
 *
 * Picking a day also applies it via `onApply` when provided, so the user does
 * not have to confirm a complete choice with the APPLY button.
 */
export function SingleDateFrame(props: SingleDateFrameProps) {
  const datePickerLocale = useLocale();
  const currentDay = guessSingleDate(props.value);

  // useLocale resolves asynchronously; mirror CustomFrame's loading behaviour.
  if (datePickerLocale === null) {
    return <Loading position="inline-centered" />;
  }

  return (
    <AntdThemeProvider locale={datePickerLocale}>
      <div data-test="single-date-frame">
        <div className="control-label">{t('Date')}</div>
        <Row>
          <DatePicker
            aria-label={t('Date')}
            value={currentDay ? extendedDayjs(currentDay) : undefined}
            onChange={(datetime: Dayjs) => {
              if (datetime) {
                const timeRange = singleDateEncode(datetime);
                props.onChange(timeRange);
                props.onApply?.(timeRange);
              }
            }}
            allowClear={false}
            getPopupContainer={(triggerNode: HTMLElement) =>
              props.isOverflowingFilterBar
                ? (triggerNode.parentNode as HTMLElement)
                : document.body
            }
          />
        </Row>
      </div>
    </AntdThemeProvider>
  );
}

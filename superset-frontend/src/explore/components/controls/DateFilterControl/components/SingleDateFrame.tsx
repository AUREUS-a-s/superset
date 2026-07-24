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
} from '@superset-ui/core/components';
import { extendedDayjs } from '@superset-ui/core/utils/dates';
import { Dayjs } from 'dayjs';
import { useLocale } from 'src/hooks/useLocale';
import {
  guessSingleDate,
  singleDateEncode,
} from 'src/explore/components/controls/DateFilterControl/utils';
import { FrameComponentProps } from 'src/explore/components/controls/DateFilterControl/types';

/**
 * A minimal single-date picker: the user selects one calendar date and the
 * value is stored as that whole day, e.g. picking 2021-03-16 yields
 * "2021-03-16T00:00:00 : 2021-03-16T23:59:59".
 */
export function SingleDateFrame(props: FrameComponentProps) {
  const datePickerLocale = useLocale();
  const currentDay = guessSingleDate(props.value);

  // Seed a valid single-date value when arriving from another frame type.
  if (currentDay === undefined) {
    props.onChange(singleDateEncode(extendedDayjs().startOf('day')));
  }

  // useLocale resolves asynchronously; mirror CustomFrame's loading behaviour.
  if (datePickerLocale === null) {
    return <Loading position="inline-centered" />;
  }

  return (
    <AntdThemeProvider locale={datePickerLocale}>
      <div className="control-label">{t('Date')}</div>
      <DatePicker
        value={currentDay ? extendedDayjs(currentDay) : undefined}
        onChange={(date: Dayjs | null) => {
          if (date) {
            props.onChange(singleDateEncode(date));
          }
        }}
        allowClear={false}
        style={{ width: '100%' }}
      />
    </AntdThemeProvider>
  );
}

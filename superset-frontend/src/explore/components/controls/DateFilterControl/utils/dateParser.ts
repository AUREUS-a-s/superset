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
import { extendedDayjs } from '@superset-ui/core/utils/dates';
import { Dayjs } from 'dayjs';
import { CustomRangeType } from 'src/explore/components/controls/DateFilterControl/types';
import { DAYJS_FORMAT } from './constants';

/* eslint-disable storybook/prefer-pascal-case -- rule is misconfigured upstream
 * as a global 'error' instead of being scoped to *.stories.* files (see
 * eslint-plugin-storybook's own recommended config); none of this file's
 * exports are stories. */

const SINGLE_DATE_DAY_FORMAT = 'YYYY-MM-DD';
// Matches a single boundary of a single-day range: a plain date at midnight.
const MIDNIGHT_ISO = /^(\d{4}-\d{2}-\d{2})T00:00:00$/;

/**
 * Encode a single calendar date as a whole-day, half-open range
 * [midnight, next midnight), e.g.
 * 2021-03-16 -> "2021-03-16T00:00:00 : 2021-03-17T00:00:00".
 * The exclusive next-day upper bound matches Superset's time_col < until.
 *
 * Only the calendar day is read off the Dayjs; the midnight boundary is
 * appended literally. Formatting the time instead would break in zones whose
 * DST transition happens at midnight (that local midnight does not exist, so
 * the clock reads 01:00 and the range would be shifted and 25 hours long).
 */
export const singleDateEncode = (date: Dayjs): string => {
  const since = date.format(SINGLE_DATE_DAY_FORMAT);
  const until = date.add(1, 'day').format(SINGLE_DATE_DAY_FORMAT);
  return `${since}T00:00:00 : ${until}T00:00:00`;
};

/**
 * If `timeRange` is a whole-day range produced by singleDateEncode (both bounds
 * at midnight, exactly one day apart), return the 'YYYY-MM-DD' day; otherwise
 * undefined. Relative/constant expressions (DATEADD, now, today) never match.
 */
export const guessSingleDate = (timeRange: string): string | undefined => {
  const parts = (timeRange ?? '').split(' : ');
  if (parts.length !== 2) return undefined;
  const startMatch = MIDNIGHT_ISO.exec(parts[0]);
  const endMatch = MIDNIGHT_ISO.exec(parts[1]);
  if (!startMatch || !endMatch) return undefined;
  const start = extendedDayjs(startMatch[1], SINGLE_DATE_DAY_FORMAT);
  const end = extendedDayjs(endMatch[1], SINGLE_DATE_DAY_FORMAT);
  if (!start.isValid() || !end.isValid()) return undefined;
  return end.isSame(start.add(1, 'day'), 'day') ? startMatch[1] : undefined;
};

/**
 * RegExp to test a string for a full ISO 8601 Date
 * Does not do any sort of date validation, only checks if the string is according to the ISO 8601 spec.
 *  YYYY-MM-DDThh:mm:ss
 *  YYYY-MM-DDThh:mm:ssTZD
 *  YYYY-MM-DDThh:mm:ss.sTZD
 * @see: https://www.w3.org/TR/NOTE-datetime
 */
const iso8601 = String.raw`\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:(?:[+-]\d\d:\d\d)|Z)?`;
const datetimeConstant = String.raw`(?:TODAY|NOW)`;

export const ISO8601_AND_CONSTANT = RegExp(
  String.raw`^${iso8601}$|^${datetimeConstant}$`,
  'i',
);

const SPECIFIC_MODE = ['specific', 'today', 'now'];

export const dttmToDayjs = (dttm: string): Dayjs => {
  if (dttm === 'now') {
    return extendedDayjs().utc().startOf('second');
  }
  if (dttm === 'today') {
    return extendedDayjs().utc().startOf('day');
  }
  return extendedDayjs(dttm);
};

export const dttmToString = (dttm: string): string =>
  dttmToDayjs(dttm).format(DAYJS_FORMAT);

export const customTimeRangeEncode = (customRange: CustomRangeType): string => {
  const {
    sinceDatetime,
    sinceMode,
    sinceGrain,
    sinceGrainValue,
    untilDatetime,
    untilMode,
    untilGrain,
    untilGrainValue,
    anchorValue,
  } = { ...customRange };
  // specific : specific
  if (SPECIFIC_MODE.includes(sinceMode) && SPECIFIC_MODE.includes(untilMode)) {
    const since =
      sinceMode === 'specific' ? dttmToString(sinceDatetime) : sinceMode;
    const until =
      untilMode === 'specific' ? dttmToString(untilDatetime) : untilMode;
    return `${since} : ${until}`;
  }

  // specific : relative
  if (SPECIFIC_MODE.includes(sinceMode) && untilMode === 'relative') {
    const since =
      sinceMode === 'specific' ? dttmToString(sinceDatetime) : sinceMode;
    const until = `DATEADD(DATETIME("${since}"), ${untilGrainValue}, ${untilGrain})`;
    return `${since} : ${until}`;
  }

  // relative : specific
  if (sinceMode === 'relative' && SPECIFIC_MODE.includes(untilMode)) {
    const until =
      untilMode === 'specific' ? dttmToString(untilDatetime) : untilMode;
    const since = `DATEADD(DATETIME("${until}"), ${-Math.abs(
      sinceGrainValue,
    )}, ${sinceGrain})`;
    return `${since} : ${until}`;
  }

  // relative : relative
  const since = `DATEADD(DATETIME("${anchorValue}"), ${-Math.abs(
    sinceGrainValue,
  )}, ${sinceGrain})`;
  const until = `DATEADD(DATETIME("${anchorValue}"), ${untilGrainValue}, ${untilGrain})`;
  return `${since} : ${until}`;
};

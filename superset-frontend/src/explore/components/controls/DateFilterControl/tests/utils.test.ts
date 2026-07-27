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
import {
  customTimeRangeEncode,
  singleDateEncode,
  guessSingleDate,
  guessFrame,
} from 'src/explore/components/controls/DateFilterControl/utils';

// eslint-disable-next-line no-restricted-globals -- TODO: Migrate from describe blocks
describe('Custom TimeRange', () => {
  // eslint-disable-next-line no-restricted-globals -- TODO: Migrate from describe blocks
  describe('customTimeRangeEncode', () => {
    test('1) specific : specific', () => {
      expect(
        customTimeRangeEncode({
          sinceDatetime: '2021-01-20T00:00:00',
          sinceMode: 'specific',
          sinceGrain: 'day',
          sinceGrainValue: -7,
          untilDatetime: '2021-01-27T00:00:00',
          untilMode: 'specific',
          untilGrain: 'day',
          untilGrainValue: 7,
          anchorMode: 'now',
          anchorValue: 'now',
        }),
      ).toEqual('2021-01-20T00:00:00 : 2021-01-27T00:00:00');
    });

    test('2) specific : relative', () => {
      expect(
        customTimeRangeEncode({
          sinceDatetime: '2021-01-20T00:00:00',
          sinceMode: 'specific',
          sinceGrain: 'day',
          sinceGrainValue: -7,
          untilDatetime: '2021-01-20T00:00:00',
          untilMode: 'relative',
          untilGrain: 'day',
          untilGrainValue: 7,
          anchorMode: 'now',
          anchorValue: 'now',
        }),
      ).toEqual(
        '2021-01-20T00:00:00 : DATEADD(DATETIME("2021-01-20T00:00:00"), 7, day)',
      );
    });

    test('3) now : relative', () => {
      expect(
        customTimeRangeEncode({
          sinceDatetime: 'now',
          sinceMode: 'now',
          sinceGrain: 'day',
          sinceGrainValue: -7,
          untilDatetime: 'now',
          untilMode: 'relative',
          untilGrain: 'day',
          untilGrainValue: 7,
          anchorMode: 'now',
          anchorValue: 'now',
        }),
      ).toEqual('now : DATEADD(DATETIME("now"), 7, day)');
    });

    test('4) today : relative', () => {
      expect(
        customTimeRangeEncode({
          sinceDatetime: 'today',
          sinceMode: 'today',
          sinceGrain: 'day',
          sinceGrainValue: -7,
          untilDatetime: 'today',
          untilMode: 'relative',
          untilGrain: 'day',
          untilGrainValue: 7,
          anchorMode: 'now',
          anchorValue: 'now',
        }),
      ).toEqual('today : DATEADD(DATETIME("today"), 7, day)');
    });

    test('5) relative : specific', () => {
      expect(
        customTimeRangeEncode({
          sinceDatetime: '2021-01-27T00:00:00',
          sinceMode: 'relative',
          sinceGrain: 'day',
          sinceGrainValue: -7,
          untilDatetime: '2021-01-27T00:00:00',
          untilMode: 'specific',
          untilGrain: 'day',
          untilGrainValue: 7,
          anchorMode: 'now',
          anchorValue: 'now',
        }),
      ).toEqual(
        'DATEADD(DATETIME("2021-01-27T00:00:00"), -7, day) : 2021-01-27T00:00:00',
      );
    });

    test('6) relative : now', () => {
      expect(
        customTimeRangeEncode({
          sinceDatetime: 'now',
          sinceMode: 'relative',
          sinceGrain: 'day',
          sinceGrainValue: -7,
          untilDatetime: 'now',
          untilMode: 'now',
          untilGrain: 'day',
          untilGrainValue: 7,
          anchorMode: 'now',
          anchorValue: 'now',
        }),
      ).toEqual('DATEADD(DATETIME("now"), -7, day) : now');
    });

    test('7) relative : today', () => {
      expect(
        customTimeRangeEncode({
          sinceDatetime: 'today',
          sinceMode: 'relative',
          sinceGrain: 'day',
          sinceGrainValue: -7,
          untilDatetime: 'today',
          untilMode: 'today',
          untilGrain: 'day',
          untilGrainValue: 7,
          anchorMode: 'now',
          anchorValue: 'now',
        }),
      ).toEqual('DATEADD(DATETIME("today"), -7, day) : today');
    });

    test('8) relative : relative (now)', () => {
      expect(
        customTimeRangeEncode({
          sinceDatetime: 'now',
          sinceMode: 'relative',
          sinceGrain: 'day',
          sinceGrainValue: -7,
          untilDatetime: 'now',
          untilMode: 'relative',
          untilGrain: 'day',
          untilGrainValue: 7,
          anchorMode: 'now',
          anchorValue: 'now',
        }),
      ).toEqual(
        'DATEADD(DATETIME("now"), -7, day) : DATEADD(DATETIME("now"), 7, day)',
      );
    });

    test('9) relative : relative (date/time)', () => {
      expect(
        customTimeRangeEncode({
          sinceDatetime: '2021-01-27T00:00:00',
          sinceMode: 'relative',
          sinceGrain: 'day',
          sinceGrainValue: -7,
          untilDatetime: '2021-01-27T00:00:00',
          untilMode: 'relative',
          untilGrain: 'day',
          untilGrainValue: 7,
          anchorMode: 'specific',
          anchorValue: '2021-01-27T00:00:00',
        }),
      ).toEqual(
        'DATEADD(DATETIME("2021-01-27T00:00:00"), -7, day) : DATEADD(DATETIME("2021-01-27T00:00:00"), 7, day)',
      );
    });
  });
});

test('singleDateEncode encodes a whole day as [midnight, next midnight)', () => {
  expect(singleDateEncode(extendedDayjs('2021-03-16'))).toBe(
    '2021-03-16T00:00:00 : 2021-03-17T00:00:00',
  );
});

test('singleDateEncode uses the calendar day, ignoring the time of day', () => {
  expect(singleDateEncode(extendedDayjs('2021-03-16T13:45:30'))).toBe(
    '2021-03-16T00:00:00 : 2021-03-17T00:00:00',
  );
});

test('singleDateEncode rolls over month/year boundaries', () => {
  expect(singleDateEncode(extendedDayjs('2021-03-31'))).toBe(
    '2021-03-31T00:00:00 : 2021-04-01T00:00:00',
  );
  expect(singleDateEncode(extendedDayjs('2021-12-31'))).toBe(
    '2021-12-31T00:00:00 : 2022-01-01T00:00:00',
  );
});

test('guessSingleDate recognizes an encoded whole-day range', () => {
  expect(guessSingleDate('2021-03-16T00:00:00 : 2021-03-17T00:00:00')).toBe(
    '2021-03-16',
  );
});

test('guessSingleDate round-trips singleDateEncode', () => {
  const value = singleDateEncode(extendedDayjs('2021-07-04'));
  expect(guessSingleDate(value)).toBe('2021-07-04');
});

test('guessSingleDate rejects multi-day, non-midnight, and non-range values', () => {
  // spans two days
  expect(
    guessSingleDate('2021-03-16T00:00:00 : 2021-03-18T00:00:00'),
  ).toBeUndefined();
  // bounds not at midnight
  expect(
    guessSingleDate('2021-03-16T00:00:00 : 2021-03-16T23:59:59'),
  ).toBeUndefined();
  expect(
    guessSingleDate('2021-03-16T08:00:00 : 2021-03-17T08:00:00'),
  ).toBeUndefined();
  // relative / named / empty
  expect(guessSingleDate('Last week')).toBeUndefined();
  expect(
    guessSingleDate('DATEADD(DATETIME("now"), -7, day) : now'),
  ).toBeUndefined();
  expect(guessSingleDate('')).toBeUndefined();
});

test('guessFrame returns SingleDate for an encoded whole-day range', () => {
  expect(guessFrame('2021-03-16T00:00:00 : 2021-03-17T00:00:00')).toBe(
    'SingleDate',
  );
});

test('guessFrame still returns Custom for a non-day-aligned specific range', () => {
  expect(guessFrame('2021-03-16T08:00:00 : 2021-03-20T00:00:00')).toBe(
    'Custom',
  );
});

/*
 * Both bounds must be literally midnight. This matters most in zones whose DST
 * transition happens at midnight (America/Sao_Paulo on 2018-11-04, where 00:00
 * does not exist): reading the clock off a Dayjs there yields 01:00 and a 25
 * hour range. That zone cannot be exercised here — jest.config.js pins TZ to
 * America/New_York, which transitions at 02:00, and Node ignores a later
 * reassignment of process.env.TZ — so this only guards the output contract.
 * The implementation is safe by construction instead: singleDateEncode reads
 * the calendar day and appends the boundary as a literal, never formatting a
 * clock time. Keep it that way.
 */
test.each(['2018-11-03', '2018-11-04', '2018-11-05', '2021-03-16'])(
  'singleDateEncode emits literal midnight boundaries for %s',
  day => {
    const encoded = singleDateEncode(extendedDayjs(day));
    const [since, until] = encoded.split(' : ');
    expect(since).toBe(`${day}T00:00:00`);
    expect(until).toBe(
      `${extendedDayjs(day).add(1, 'day').format('YYYY-MM-DD')}T00:00:00`,
    );
    // and the frame must still recognize its own output
    expect(guessSingleDate(encoded)).toBe(day);
  },
);

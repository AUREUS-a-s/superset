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
import { useState } from 'react';
import thunk from 'redux-thunk';
import { Provider } from 'react-redux';
import configureStore from 'redux-mock-store';

import {
  act,
  render,
  screen,
  selectOption,
  userEvent,
} from 'spec/helpers/testing-library';

import { NO_TIME_RANGE, fetchTimeRange } from '@superset-ui/core';
import { extendedDayjs } from '@superset-ui/core/utils/dates';
import DateFilterLabel from '..';
import { DateFilterControlProps } from '../types';
import { DateFilterTestKey } from '../utils';
import { DATE_LABEL_CLASS } from '../components';

jest.mock('@superset-ui/core', () => ({
  ...jest.requireActual('@superset-ui/core'),
  fetchTimeRange: jest.fn(async () => ({ value: 'evaluated range' })),
}));

const mockStore = configureStore([thunk]);

const defaultProps = {
  onChange: jest.fn(),
  onClosePopover: jest.fn(),
  onOpenPopover: jest.fn(),
};

function setup(
  props: Omit<DateFilterControlProps, 'name'> = defaultProps,
  store: any = mockStore({}),
) {
  return (
    <Provider store={store}>
      <DateFilterLabel name="time_range" {...props} />
    </Provider>
  );
}

test('DateFilter with default props', () => {
  render(setup());
  // label
  expect(screen.getByText(NO_TIME_RANGE)).toBeInTheDocument();

  // should be popover by default
  userEvent.click(screen.getByText(NO_TIME_RANGE));
  expect(
    screen.getByTestId(DateFilterTestKey.PopoverOverlay),
  ).toBeInTheDocument();
});

test('DateFilter should be applied the global config time_filter from the store', () => {
  render(
    setup(
      defaultProps,
      mockStore({
        common: { conf: { DEFAULT_TIME_FILTER: 'Last week' } },
      }),
    ),
  );
  // the label should be 'Last week'
  expect(screen.getByText('Last week')).toBeInTheDocument();

  userEvent.click(screen.getByText('Last week'));
  expect(screen.getByTestId(DateFilterTestKey.CommonFrame)).toBeInTheDocument();
});

test('Open and close popover', () => {
  render(setup());

  // click "Cancel"
  userEvent.click(screen.getByText(NO_TIME_RANGE));
  expect(defaultProps.onOpenPopover).toHaveBeenCalled();
  expect(screen.getByText('Edit time range')).toBeInTheDocument();
  userEvent.click(screen.getByText('CANCEL'));
  expect(defaultProps.onClosePopover).toHaveBeenCalled();
  expect(screen.queryByText('Edit time range')).not.toBeInTheDocument();

  // click "Apply"
  userEvent.click(screen.getByText(NO_TIME_RANGE));
  expect(defaultProps.onOpenPopover).toHaveBeenCalled();
  expect(screen.getByText('Edit time range')).toBeInTheDocument();
  userEvent.click(screen.getByText('APPLY'));
  expect(defaultProps.onClosePopover).toHaveBeenCalled();
  expect(screen.queryByText('Edit time range')).not.toBeInTheDocument();
});

test('DateFilter popover should attach to document.body when not overflowing', () => {
  render(setup({ ...defaultProps, isOverflowingFilterBar: false }));

  userEvent.click(screen.getByText(NO_TIME_RANGE));

  const popover = document.querySelector('.time-range-popover');
  expect(popover?.parentElement).toBe(document.body);
});

test('DateFilter popover should attach to parent node when overflowing in filter bar', () => {
  render(setup({ ...defaultProps, isOverflowingFilterBar: true }));

  userEvent.click(screen.getByText(NO_TIME_RANGE));

  const popover = document.querySelector('.time-range-popover');
  const trigger = screen.getByTestId(DateFilterTestKey.PopoverOverlay);

  expect(popover?.parentElement).toBe(trigger.parentElement);
});

test('DateFilter should properly handle isOverflowingFilterBar prop changes', () => {
  const { rerender } = render(
    setup({ ...defaultProps, isOverflowingFilterBar: false }),
  );

  // When not overflowing, popover should attach to document.body
  userEvent.click(screen.getByText(NO_TIME_RANGE));
  const popover = document.querySelector('.time-range-popover');
  expect(popover?.parentElement).toBe(document.body);

  userEvent.click(screen.getByText('CANCEL'));

  // When overflowing, popover should attach to parent node
  rerender(setup({ ...defaultProps, isOverflowingFilterBar: true }));
  userEvent.click(screen.getByText(NO_TIME_RANGE));

  const popoverAfterRerender = document.querySelector('.time-range-popover');
  const trigger = screen.getByTestId(DateFilterTestKey.PopoverOverlay);

  expect(popoverAfterRerender?.parentElement).toBe(trigger.parentElement);
  expect(popoverAfterRerender?.parentElement).not.toBe(document.body);
});

test('DateFilter seeds today as a whole-day range when switching to Single date', async () => {
  render(setup());
  userEvent.click(screen.getByText(NO_TIME_RANGE));
  await selectOption('Single date', 'Range type');
  // the picker is preselected with today, i.e. [midnight, next midnight)
  const today = extendedDayjs().format('YYYY-MM-DD');
  expect(await screen.findByDisplayValue(today)).toBeInTheDocument();
});

const singleDayValue = '2021-03-16T00:00:00 : 2021-03-17T00:00:00';

test('DateFilter shows day steppers only for a single date value', () => {
  const { rerender } = render(setup({ ...defaultProps, value: 'Last week' }));
  expect(screen.queryByLabelText('Next day')).not.toBeInTheDocument();

  rerender(setup({ ...defaultProps, value: singleDayValue }));
  expect(screen.getByLabelText('Next day')).toBeInTheDocument();
  expect(screen.getByLabelText('Previous day')).toBeInTheDocument();
});

test('DateFilter next day applies the following day without opening the popover', () => {
  const onChange = jest.fn();
  render(setup({ ...defaultProps, onChange, value: singleDayValue }));

  userEvent.click(screen.getByLabelText('Next day'));

  expect(onChange).toHaveBeenLastCalledWith(
    '2021-03-17T00:00:00 : 2021-03-18T00:00:00',
  );
  // no popover, so no APPLY to press
  expect(screen.queryByText('Edit time range')).not.toBeInTheDocument();
  expect(screen.queryByText('APPLY')).not.toBeInTheDocument();
});

test('DateFilter previous day applies the preceding day', () => {
  const onChange = jest.fn();
  render(setup({ ...defaultProps, onChange, value: singleDayValue }));

  userEvent.click(screen.getByLabelText('Previous day'));

  expect(onChange).toHaveBeenLastCalledWith(
    '2021-03-15T00:00:00 : 2021-03-16T00:00:00',
  );
});

// Real consumers feed the new value back (TimeFilterPlugin via setDataMask,
// Explore via redux), so stepping repeatedly must walk day by day.
function StatefulHost({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <Provider store={mockStore({})}>
      <span data-test="host-value">{value}</span>
      <DateFilterLabel name="time_range" value={value} onChange={setValue} />
    </Provider>
  );
}

test('DateFilter day steppers walk day by day when the parent applies the change', () => {
  render(<StatefulHost initial={singleDayValue} />);

  userEvent.click(screen.getByLabelText('Next day'));
  userEvent.click(screen.getByLabelText('Next day'));
  expect(screen.getByTestId('host-value')).toHaveTextContent(
    '2021-03-18T00:00:00 : 2021-03-19T00:00:00',
  );

  userEvent.click(screen.getByLabelText('Previous day'));
  expect(screen.getByTestId('host-value')).toHaveTextContent(
    '2021-03-17T00:00:00 : 2021-03-18T00:00:00',
  );
});

test('DateFilter shows just the day on the pill for a single date value', () => {
  render(setup({ ...defaultProps, value: singleDayValue }));

  // the pill reads 2021-03-16, not the range it expands to
  expect(screen.getByText('2021-03-16')).toBeInTheDocument();
  expect(screen.queryByText(singleDayValue)).not.toBeInTheDocument();
});

test('DateFilter pill follows the day steppers', () => {
  const { rerender } = render(
    setup({ ...defaultProps, value: singleDayValue }),
  );
  expect(screen.getByText('2021-03-16')).toBeInTheDocument();

  rerender(
    setup({
      ...defaultProps,
      value: '2021-03-17T00:00:00 : 2021-03-18T00:00:00',
    }),
  );
  expect(screen.getByText('2021-03-17')).toBeInTheDocument();
});

// The pill is written optimistically when the value is a whole day, so a
// response still in flight for a PREVIOUS value must not overwrite it.
test('DateFilter pill survives a stale time range response', async () => {
  let answerStaleRequest: (result: { value: string }) => void = () => {};
  (fetchTimeRange as jest.Mock)
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          answerStaleRequest = resolve;
        }),
    )
    .mockImplementation(async () => ({
      value: '2021-03-16 ≤ col < 2021-03-17',
    }));

  const { rerender } = render(setup({ ...defaultProps, value: 'Last week' }));
  rerender(setup({ ...defaultProps, value: singleDayValue }));
  expect(screen.getByText('2021-03-16')).toBeInTheDocument();

  // the request for 'Last week' only answers now
  await act(async () => {
    answerStaleRequest({ value: 'a week ago ≤ col < now' });
  });

  expect(screen.getByText('2021-03-16')).toBeInTheDocument();
  expect(screen.queryByText('Last week')).not.toBeInTheDocument();
});

// TimeFilterPlugin decorates the pill (focus ring, validation border) by this
// class. The day steppers wrap the pill, so it must not be position-dependent.
test('DateFilter keeps the pill styling hook with and without the steppers', () => {
  const { rerender } = render(setup({ ...defaultProps, value: 'Last week' }));
  expect(screen.getByTestId(DateFilterTestKey.PopoverOverlay)).toHaveClass(
    DATE_LABEL_CLASS,
  );

  rerender(setup({ ...defaultProps, value: singleDayValue }));
  expect(screen.getByTestId(DateFilterTestKey.PopoverOverlay)).toHaveClass(
    DATE_LABEL_CLASS,
  );
});

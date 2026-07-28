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
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from 'spec/helpers/testing-library';
import SingleDateFilterPlugin from './SingleDateFilterPlugin';
import type { PluginFilterSingleDateProps } from './types';

const WHOLE_DAY = '2021-03-16T00:00:00 : 2021-03-17T00:00:00';

const noOp = () => {};

function setup(props: Partial<PluginFilterSingleDateProps> = {}) {
  const setDataMask = jest.fn();
  const allProps = {
    formData: {
      datasource: '3__table',
      groupby: [],
      adhocFilters: [],
      extraFilters: [],
      extraFormData: {},
      viz_type: 'filter_singledate',
      inView: true,
    },
    height: 20,
    width: 220,
    filterState: { value: WHOLE_DAY },
    setDataMask,
    setFocusedFilter: noOp,
    unsetFocusedFilter: noOp,
    setHoveredFilter: noOp,
    unsetHoveredFilter: noOp,
    setFilterActive: noOp,
    behaviors: [],
    data: [],
    inputRef: { current: null },
    ...props,
  } as unknown as PluginFilterSingleDateProps;

  render(<SingleDateFilterPlugin {...allProps} />, { useRedux: true });
  return { setDataMask };
}

test('renders the calendar input inline, with no popover to open first', async () => {
  setup();
  const input = await screen.findByLabelText('Date');
  expect(input).toBeInTheDocument();
  // the day is shown directly, no "Edit time range" popover in between
  expect(screen.getByDisplayValue('2021-03-16')).toBeInTheDocument();
  expect(screen.queryByText('Edit time range')).not.toBeInTheDocument();
  expect(screen.queryByText('APPLY')).not.toBeInTheDocument();
});

test('publishes the picked day as a whole-day time range', async () => {
  const { setDataMask } = setup();
  const input = await screen.findByLabelText('Date');

  userEvent.click(input);
  userEvent.click(await screen.findByTitle('2021-03-10'));

  await waitFor(() =>
    expect(setDataMask).toHaveBeenLastCalledWith({
      extraFormData: {
        time_range: '2021-03-10T00:00:00 : 2021-03-11T00:00:00',
      },
      filterState: { value: '2021-03-10T00:00:00 : 2021-03-11T00:00:00' },
    }),
  );
});

test('publishes an empty filter when it has no value', async () => {
  const { setDataMask } = setup({ filterState: {} });
  await screen.findByLabelText('Date');

  expect(setDataMask).toHaveBeenLastCalledWith({
    extraFormData: {},
    filterState: { value: undefined },
  });
  expect(
    screen.queryByDisplayValue(/\d{4}-\d{2}-\d{2}/),
  ).not.toBeInTheDocument();
});

test('renders nothing while out of view', () => {
  setup({
    formData: {
      inView: false,
    } as unknown as PluginFilterSingleDateProps['formData'],
  });
  expect(screen.queryByLabelText('Date')).not.toBeInTheDocument();
});

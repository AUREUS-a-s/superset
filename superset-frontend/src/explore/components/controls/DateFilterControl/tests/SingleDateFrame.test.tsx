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
import thunk from 'redux-thunk';
import configureStore from 'redux-mock-store';
import {
  render,
  screen,
  waitForElementToBeRemoved,
} from 'spec/helpers/testing-library';
import { guessSingleDate } from 'src/explore/components/controls/DateFilterControl/utils';
import { SingleDateFrame } from '../components';

const mockStore = configureStore([thunk]);
const store = mockStore({ common: { locale: 'en' } });

const wholeDayValue = '2021-03-16T00:00:00 : 2021-03-17T00:00:00';

test('renders a single date picker', async () => {
  render(<SingleDateFrame onChange={jest.fn()} value={wholeDayValue} />, {
    store,
  });
  await waitForElementToBeRemoved(() => screen.queryByLabelText('Loading'));
  expect(screen.getByText('Date')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'calendar' })).toBeInTheDocument();
});

test('shows the selected day in the picker input', async () => {
  render(<SingleDateFrame onChange={jest.fn()} value={wholeDayValue} />, {
    store,
  });
  await waitForElementToBeRemoved(() => screen.queryByLabelText('Loading'));
  expect(screen.getByDisplayValue('2021-03-16')).toBeInTheDocument();
});

test('seeds a whole-day value when arriving from another frame type', () => {
  const onChange = jest.fn();
  render(<SingleDateFrame onChange={onChange} value="Last week" />, { store });
  expect(onChange).toHaveBeenCalled();
  // whatever it seeded must itself be a valid single-day range
  const [seeded] = onChange.mock.calls[0];
  expect(guessSingleDate(seeded)).toBeTruthy();
});

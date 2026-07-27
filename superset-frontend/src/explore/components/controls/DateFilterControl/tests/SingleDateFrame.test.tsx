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
  userEvent,
  waitForElementToBeRemoved,
} from 'spec/helpers/testing-library';
import { SingleDateFrame } from '../components';

const mockStore = configureStore([thunk]);
const store = mockStore({ common: { locale: 'en' } });

const wholeDayValue = '2021-03-16T00:00:00 : 2021-03-17T00:00:00';

test('renders a single date picker', async () => {
  render(<SingleDateFrame onChange={jest.fn()} value={wholeDayValue} />, {
    store,
  });
  await waitForElementToBeRemoved(() => screen.queryByLabelText('Loading'));
  // reachable by its accessible name, not just by display value
  expect(screen.getByLabelText('Date')).toBeInTheDocument();
});

test('shows the selected day in the picker input', async () => {
  render(<SingleDateFrame onChange={jest.fn()} value={wholeDayValue} />, {
    store,
  });
  await waitForElementToBeRemoved(() => screen.queryByLabelText('Loading'));
  expect(screen.getByDisplayValue('2021-03-16')).toBeInTheDocument();
});

test('renders an empty picker when the value is not a whole-day range', async () => {
  render(<SingleDateFrame onChange={jest.fn()} value="Last week" />, { store });
  await waitForElementToBeRemoved(() => screen.queryByLabelText('Loading'));
  expect(screen.getByText('Date')).toBeInTheDocument();
  expect(
    screen.queryByDisplayValue(/\d{4}-\d{2}-\d{2}/),
  ).not.toBeInTheDocument();
});

// Updating a parent's state while rendering a child triggers a React warning
// ("Cannot update a component while rendering a different component"), so the
// frame must stay pure; DateFilterLabel seeds the value on frame change.
test('does not change the value while rendering', () => {
  const onChange = jest.fn();
  render(<SingleDateFrame onChange={onChange} value="Last week" />, { store });
  expect(onChange).not.toHaveBeenCalled();
});

test('applies the value as soon as a day is picked', async () => {
  const onChange = jest.fn();
  const onApply = jest.fn();
  render(
    <SingleDateFrame
      onChange={onChange}
      onApply={onApply}
      value={wholeDayValue}
    />,
    { store },
  );
  await waitForElementToBeRemoved(() => screen.queryByLabelText('Loading'));

  userEvent.click(screen.getByDisplayValue('2021-03-16'));
  userEvent.click(await screen.findByTitle('2021-03-10'));

  const applied = '2021-03-10T00:00:00 : 2021-03-11T00:00:00';
  expect(onChange).toHaveBeenCalledWith(applied);
  expect(onApply).toHaveBeenCalledWith(applied);
});

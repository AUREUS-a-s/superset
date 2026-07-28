import { StrictMode, useState } from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { legacy_createStore as createStore } from 'redux';
import { ThemeProvider, supersetTheme } from '@apache-superset/core/theme';
import {
  CustomFrame,
  SingleDateFrame,
} from 'src/explore/components/controls/DateFilterControl/components';
import DateFilterLabel from 'src/explore/components/controls/DateFilterControl';
import SingleDateFilterPlugin from 'src/filters/components/SingleDate/SingleDateFilterPlugin';

// CustomFrame/SingleDateFrame read common.locale via useLocale() -> useSelector;
// a minimal static store is all they need.
const store = createStore(() => ({ common: { locale: 'en' } }));

const boxStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  padding: 24,
  borderRadius: 8,
  marginBottom: 24,
};
const valueStyle: React.CSSProperties = {
  background: '#f5f5f5',
  padding: 12,
  marginTop: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

// Each frame gets its own state so they don't fight over one shared value
// (SingleDateFrame re-seeds any value that isn't already a single-day range).
function FrameHarness({
  title,
  initial,
  children,
}: {
  title: string;
  initial: string;
  children: (value: string, onChange: (v: string) => void) => JSX.Element;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div style={boxStyle}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children(value, setValue)}
      <pre style={valueStyle}>{value || '(empty)'}</pre>
    </div>
  );
}

function Sandbox() {
  return (
    <div
      style={{
        maxWidth: 680,
        margin: '40px auto',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h2>DateFilterControl frames</h2>
      <FrameHarness
        title="SingleDateFrame (new) — pick one day"
        initial="2021-03-16T00:00:00 : 2021-03-17T00:00:00"
      >
        {(value, onChange) => (
          <SingleDateFrame value={value} onChange={onChange} />
        )}
      </FrameHarness>
      <FrameHarness
        title="DateFilterLabel — full control with day steppers"
        initial="2021-03-16T00:00:00 : 2021-03-17T00:00:00"
      >
        {(value, onChange) => (
          <div style={{ width: 320 }}>
            <DateFilterLabel
              name="time_range"
              value={value}
              onChange={onChange}
            />
          </div>
        )}
      </FrameHarness>
      <FrameHarness
        title="Single date filter plugin (option D) — inline, no popover"
        initial="2021-03-16T00:00:00 : 2021-03-17T00:00:00"
      >
        {(value, onChange) => (
          <div style={{ width: 260 }}>
            <SingleDateFilterPlugin
              {...({
                formData: { inView: true },
                height: 20,
                width: 0,
                filterState: { value },
                setDataMask: (mask: { filterState?: { value?: string } }) =>
                  onChange(mask.filterState?.value ?? ''),
                setFocusedFilter: () => {},
                unsetFocusedFilter: () => {},
                setHoveredFilter: () => {},
                unsetHoveredFilter: () => {},
                setFilterActive: () => {},
                behaviors: [],
                data: [],
                inputRef: { current: null },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any)}
            />
          </div>
        )}
      </FrameHarness>
      <FrameHarness
        title="CustomFrame (existing)"
        initial="2021-03-16T00:00:00 : 2021-03-17T00:00:00"
      >
        {(value, onChange) => <CustomFrame value={value} onChange={onChange} />}
      </FrameHarness>
    </div>
  );
}

ReactDOM.render(
  <StrictMode>
    <ThemeProvider theme={supersetTheme}>
      <Provider store={store}>
        <Sandbox />
      </Provider>
    </ThemeProvider>
  </StrictMode>,
  document.getElementById('root'),
);

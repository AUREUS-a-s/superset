import { StrictMode, useState } from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { legacy_createStore as createStore } from 'redux';
import { ThemeProvider, supersetTheme } from '@apache-superset/core/theme';
import { CustomFrame } from 'src/explore/components/controls/DateFilterControl/components';

// CustomFrame reads common.locale via useLocale() -> useSelector; a minimal
// static store is all it needs.
const store = createStore(() => ({ common: { locale: 'en' } }));

// A few representative starting values to exercise the picker's modes.
const PRESETS: Record<string, string> = {
  Specific: '2021-03-16T00:00:00 : 2021-03-17T00:00:00',
  'Relative (now)':
    'DATEADD(DATETIME("now"), -7, day) : DATEADD(DATETIME("now"), 7, day)',
  Empty: '',
};

function Sandbox() {
  const [value, setValue] = useState(PRESETS.Specific);
  return (
    <div
      style={{
        maxWidth: 680,
        margin: '40px auto',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h2>DateFilterControl · CustomFrame</h2>
      <div style={{ marginBottom: 16 }}>
        {Object.entries(PRESETS).map(([label, v]) => (
          <button
            key={label}
            type="button"
            onClick={() => setValue(v)}
            style={{ marginRight: 8 }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        style={{
          border: '1px solid #ddd',
          padding: 24,
          borderRadius: 8,
        }}
      >
        <CustomFrame value={value} onChange={setValue} />
      </div>
      <pre
        style={{
          background: '#f5f5f5',
          padding: 12,
          marginTop: 16,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {value || '(empty)'}
      </pre>
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

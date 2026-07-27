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
import { ReactNode, useState, useEffect, useMemo, useRef } from 'react';
import { t } from '@apache-superset/core/translation';
import {
  NO_TIME_RANGE,
  useCSSTextTruncation,
  fetchTimeRange,
} from '@superset-ui/core';
import { extendedDayjs } from '@superset-ui/core/utils/dates';
import {
  css,
  styled,
  useTheme,
  SupersetTheme,
} from '@apache-superset/core/theme';
import {
  Button,
  Constants,
  Divider,
  Tooltip,
  Select,
} from '@superset-ui/core/components';
import ControlHeader from 'src/explore/components/ControlHeader';
import { Icons } from '@superset-ui/core/components/Icons';
import { useDebouncedEffect } from 'src/explore/exploreUtils';
import { noOp } from 'src/utils/common';
import ControlPopover from '../ControlPopover/ControlPopover';

import { DateFilterControlProps, FrameType } from './types';
import {
  DateFilterTestKey,
  FRAME_OPTIONS,
  guessFrame,
  guessSingleDate,
  singleDateEncode,
  useDefaultTimeFilter,
} from './utils';
import {
  CommonFrame,
  CalendarFrame,
  CustomFrame,
  SingleDateFrame,
  AdvancedFrame,
  DateLabel,
} from './components';
import { CurrentCalendarFrame } from './components/CurrentCalendarFrame';

const StyledRangeType = styled(Select)`
  width: 272px;
`;

const ContentStyleWrapper = styled.div`
  ${({ theme }) => css`
    .ant-row {
      margin-top: 8px;
    }

    .ant-picker {
      padding: 4px 17px 4px;
      border-radius: 4px;
    }

    .ant-divider-horizontal {
      margin: 16px 0;
    }

    .control-label {
      font-size: ${theme.fontSizeSM}px;
      line-height: 16px;
      margin: 8px 0;
    }

    .section-title {
      font-style: normal;
      font-weight: ${theme.fontWeightStrong};
      font-size: 15px;
      line-height: 24px;
      margin-bottom: 8px;
    }

    .control-anchor-to {
      margin-top: 16px;
    }

    .control-anchor-to-datetime {
      width: 217px;
    }

    .footer {
      text-align: right;
    }
  `}
`;

const IconWrapper = styled.span`
  span {
    margin-right: ${({ theme }) => 2 * theme.sizeUnit}px;
    vertical-align: middle;
  }
  .text {
    vertical-align: middle;
  }
  .error {
    color: ${({ theme }) => theme.colorError};
  }
`;

const DayStepper = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  gap: ${({ theme }) => theme.sizeUnit}px;

  /* the popover trigger takes the space left over by the two buttons */
  & > * {
    flex: 1 1 auto;
    min-width: 0;
  }

  & > button {
    flex: none;
  }
`;

const getTooltipTitle = (
  isLabelTruncated: boolean,
  label: string | undefined,
  range: string | undefined,
) =>
  isLabelTruncated ? (
    <div>
      {label && <strong>{label}</strong>}
      {range && (
        <div
          css={(theme: SupersetTheme) => css`
            margin-top: ${theme.sizeUnit}px;
          `}
        >
          {range}
        </div>
      )}
    </div>
  ) : (
    range || null
  );

export default function DateFilterLabel(props: DateFilterControlProps) {
  const {
    name,
    onChange,
    onOpenPopover = noOp,
    onClosePopover = noOp,
    isOverflowingFilterBar = false,
  } = props;
  const defaultTimeFilter = useDefaultTimeFilter();

  const value = props.value ?? defaultTimeFilter;
  const [actualTimeRange, setActualTimeRange] = useState<string>(value);

  const [show, setShow] = useState<boolean>(false);
  const guessedFrame = useMemo(() => guessFrame(value), [value]);
  const [frame, setFrame] = useState<FrameType>(guessedFrame);
  const [lastFetchedTimeRange, setLastFetchedTimeRange] = useState(value);
  const [timeRangeValue, setTimeRangeValue] = useState(value);
  const [validTimeRange, setValidTimeRange] = useState<boolean>(false);
  const [evalResponse, setEvalResponse] = useState<string>(value);
  const [tooltipTitle, setTooltipTitle] = useState<ReactNode | null>(value);
  const theme = useTheme();
  const [labelRef, labelIsTruncated] = useCSSTextTruncation<HTMLSpanElement>();

  useEffect(() => {
    if (value === NO_TIME_RANGE) {
      setActualTimeRange(NO_TIME_RANGE);
      setTooltipTitle(null);
      setValidTimeRange(true);
      return;
    }
    // A single date reads better on the pill than the range it expands to, and
    // it is derivable without the API, so show it before the request settles
    // rather than flashing the raw range.
    const singleDay = guessSingleDate(value);
    if (singleDay !== undefined) {
      setActualTimeRange(singleDay);
    }
    fetchTimeRange(value).then(({ value: actualRange, error }) => {
      if (error) {
        setEvalResponse(error || '');
        setValidTimeRange(false);
        setTooltipTitle(value || null);
      } else {
        /*
          HRT == human readable text
          ADR == actual datetime range
          DAY == the picked calendar day, e.g. 2021-03-16
          +--------------+------+----------+--------+----------+-------------+-----------+
          |              | Last | Previous | Custom | Advanced | Single date | No Filter |
          +--------------+------+----------+--------+----------+-------------+-----------+
          | control pill | HRT  | HRT      | ADR    | ADR      |     DAY     |   HRT     |
          +--------------+------+----------+--------+----------+-------------+-----------+
          | tooltip      | ADR  | ADR      | HRT    | HRT      |     ADR     |   ADR     |
          +--------------+------+----------+--------+----------+-------------+-----------+
        */
        if (singleDay !== undefined) {
          // the pill is already showing the day; only the tooltip needs the
          // range the day expands to
          setTooltipTitle(
            getTooltipTitle(labelIsTruncated, singleDay, actualRange),
          );
        } else if (
          guessedFrame === 'Common' ||
          guessedFrame === 'Calendar' ||
          guessedFrame === 'Current' ||
          guessedFrame === 'No filter'
        ) {
          setActualTimeRange(value);
          setTooltipTitle(
            getTooltipTitle(labelIsTruncated, value, actualRange),
          );
        } else {
          setActualTimeRange(actualRange || '');
          setTooltipTitle(
            getTooltipTitle(labelIsTruncated, actualRange, value),
          );
        }
        setValidTimeRange(true);
      }
      setLastFetchedTimeRange(value);
      setEvalResponse(actualRange || value);
    });
  }, [guessedFrame, labelIsTruncated, labelRef, value]);

  useDebouncedEffect(
    () => {
      if (timeRangeValue === NO_TIME_RANGE) {
        setEvalResponse(NO_TIME_RANGE);
        setLastFetchedTimeRange(NO_TIME_RANGE);
        setValidTimeRange(true);
        return;
      }
      if (lastFetchedTimeRange !== timeRangeValue) {
        fetchTimeRange(timeRangeValue).then(({ value: actualRange, error }) => {
          if (error) {
            setEvalResponse(error || '');
            setValidTimeRange(false);
          } else {
            setEvalResponse(actualRange || '');
            setValidTimeRange(true);
          }
          setLastFetchedTimeRange(timeRangeValue);
        });
      }
    },
    Constants.SLOW_DEBOUNCE,
    [timeRangeValue],
  );

  function onSave() {
    onChange(timeRangeValue);
    setShow(false);
    onClosePopover();
  }

  // Applies a value straight away, bypassing the APPLY button. Takes the value
  // as an argument because callers fire it in the same tick as the state
  // update, when `timeRangeValue` is still the previous value.
  function onApplyValue(nextValue: string) {
    onChange(nextValue);
    setShow(false);
    onClosePopover();
  }

  function onOpen() {
    setTimeRangeValue(value);
    setFrame(guessedFrame);
    setShow(true);
    onOpenPopover();
  }

  function onHide() {
    setTimeRangeValue(value);
    setFrame(guessedFrame);
    setShow(false);
    onClosePopover();
  }

  const toggleOverlay = () => {
    if (show) {
      onHide();
    } else {
      onOpen();
    }
  };

  function onChangeFrame(value: FrameType) {
    if (value === NO_TIME_RANGE) {
      setTimeRangeValue(NO_TIME_RANGE);
    }
    // Seed a whole-day range so the single date picker always shows a date,
    // unless the current value already is one.
    if (
      value === 'SingleDate' &&
      guessSingleDate(timeRangeValue) === undefined
    ) {
      setTimeRangeValue(singleDateEncode(extendedDayjs()));
    }
    setFrame(value);
  }

  // A whole-day value can be stepped a day at a time without opening the
  // popover, which is the common case when scanning consecutive days.
  const singleDay = guessSingleDate(value);
  // Two clicks can land before the new value arrives from the parent, which
  // would step twice from the same day; remember the day just emitted until
  // the prop catches up.
  const steppedDayRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    steppedDayRef.current = undefined;
  }, [value]);

  function stepDay(days: number) {
    const base = steppedDayRef.current ?? singleDay;
    if (base === undefined) {
      return;
    }
    const next = extendedDayjs(base).add(days, 'day');
    steppedDayRef.current = next.format('YYYY-MM-DD');
    onChange(singleDateEncode(next));
  }

  const overlayContent = (
    <ContentStyleWrapper>
      <div className="control-label">{t('Range type')}</div>
      <StyledRangeType
        ariaLabel={t('Range type')}
        options={FRAME_OPTIONS}
        value={frame}
        onChange={onChangeFrame}
      />
      {frame !== 'No filter' && <Divider />}
      {frame === 'Common' && (
        <CommonFrame value={timeRangeValue} onChange={setTimeRangeValue} />
      )}
      {frame === 'Calendar' && (
        <CalendarFrame value={timeRangeValue} onChange={setTimeRangeValue} />
      )}
      {frame === 'Current' && (
        <CurrentCalendarFrame
          value={timeRangeValue}
          onChange={setTimeRangeValue}
        />
      )}
      {frame === 'Advanced' && (
        <AdvancedFrame value={timeRangeValue} onChange={setTimeRangeValue} />
      )}
      {frame === 'Custom' && (
        <CustomFrame
          value={timeRangeValue}
          onChange={setTimeRangeValue}
          isOverflowingFilterBar={isOverflowingFilterBar}
        />
      )}
      {frame === 'SingleDate' && (
        <SingleDateFrame
          value={timeRangeValue}
          onChange={setTimeRangeValue}
          onApply={onApplyValue}
          isOverflowingFilterBar={isOverflowingFilterBar}
        />
      )}
      {frame === 'No filter' && <div data-test={DateFilterTestKey.NoFilter} />}
      <Divider />
      <div>
        <div className="section-title">{t('Actual time range')}</div>
        {validTimeRange && (
          <div>
            {evalResponse === 'No filter' ? t('No filter') : evalResponse}
          </div>
        )}
        {!validTimeRange && (
          <IconWrapper className="warning">
            <Icons.ExclamationCircleOutlined iconColor={theme.colorError} />
            <span className="text error">{evalResponse}</span>
          </IconWrapper>
        )}
      </div>
      <Divider />
      <div className="footer">
        <Button
          buttonStyle="secondary"
          cta
          key="cancel"
          onClick={onHide}
          data-test={DateFilterTestKey.CancelButton}
        >
          {t('CANCEL')}
        </Button>
        <Button
          buttonStyle="primary"
          cta
          disabled={!validTimeRange}
          key="apply"
          onClick={onSave}
          data-test={DateFilterTestKey.ApplyButton}
        >
          {t('APPLY')}
        </Button>
      </div>
    </ContentStyleWrapper>
  );

  const popoverContent = (
    <ControlPopover
      autoAdjustOverflow={false}
      trigger="click"
      placement="right"
      content={overlayContent}
      title={
        <IconWrapper>
          <Icons.EditOutlined />
          <span className="text">{t('Edit time range')}</span>
        </IconWrapper>
      }
      defaultOpen={show}
      open={show}
      onOpenChange={toggleOverlay}
      overlayStyle={{ width: '600px' }}
      destroyTooltipOnHide
      getPopupContainer={nodeTrigger =>
        isOverflowingFilterBar
          ? (nodeTrigger.parentNode as HTMLElement)
          : document.body
      }
      overlayClassName="time-range-popover"
    >
      <Tooltip placement="top" title={tooltipTitle}>
        <DateLabel
          name={name}
          aria-labelledby={`filter-name-${props.name}`}
          aria-describedby={`date-label-${props.name}`}
          label={actualTimeRange}
          isActive={show}
          isPlaceholder={actualTimeRange === NO_TIME_RANGE}
          data-test={DateFilterTestKey.PopoverOverlay}
          ref={labelRef}
        />
      </Tooltip>
    </ControlPopover>
  );

  return (
    <>
      <ControlHeader {...props} />
      {singleDay === undefined ? (
        popoverContent
      ) : (
        <DayStepper data-test="day-stepper">
          <Button
            buttonSize="xsmall"
            buttonStyle="tertiary"
            onClick={() => stepDay(-1)}
            aria-label={t('Previous day')}
            tooltip={t('Previous day')}
            icon={<Icons.CaretLeftOutlined iconSize="s" />}
          />
          {popoverContent}
          <Button
            buttonSize="xsmall"
            buttonStyle="tertiary"
            onClick={() => stepDay(1)}
            aria-label={t('Next day')}
            tooltip={t('Next day')}
            icon={<Icons.CaretRightOutlined iconSize="s" />}
          />
        </DayStepper>
      )}
    </>
  );
}

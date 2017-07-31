import classNames from 'classnames';
import React from 'react';

import { CONTROL_TYPES, CONTROLS } from '../../constants/controls';
import Button from './Button';

import './preset-control.css';

export default ({ selectedValue, onChange }) =>
  <div
    className={classNames('preset-control', {
      'preset-control--active': selectedValue,
    })}
  >
    <Button
      modifiers={{ arrowLeft: true }}
      disabled={selectedValue === 0 || selectedValue === 1}
      onPress={() => onChange(selectedValue - 1)}
    />

    <div className="preset-control__select-wrapper">
      <select
        className="preset-control__select"
        onChange={({ target }) => onChange(parseInt(target.value, 10))}
        value={selectedValue}
      >
        {!selectedValue &&
          <option key={0} value={0}>
            Custom
          </option>}
        {CONTROLS[CONTROL_TYPES.PRESET].options
          .slice(1)
          .map(({ value, name }, index) =>
            <option key={value} value={index + 1}>
              {name}
            </option>,
          )}
      </select>
      <div className="preset-control__select-arrow" />
    </div>

    <Button
      modifiers={{ arrowRight: true }}
      disabled={
        selectedValue === CONTROLS[CONTROL_TYPES.PRESET].options.length - 1
      }
      onPress={() => onChange(selectedValue + 1)}
    />
  </div>;
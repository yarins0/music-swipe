/**
 * Patched copy of react-native/jest/mockComponent.js
 *
 * Fix: RN 0.81 introduced arrow-function components via the `component()` syntax.
 * Arrow functions have `prototype === undefined`, so the original line:
 *   RealComponent.prototype.constructor instanceof React.Component
 * throws "Cannot read properties of undefined (reading 'constructor')".
 * Added `RealComponent.prototype != null &&` guard to prevent the crash.
 *
 * Upstream: https://github.com/facebook/react-native/blob/main/packages/react-native/jest/mockComponent.js
 */

'use strict';

const React = require('react');
const { createElement } = React;

module.exports = function mockComponent(moduleName, instanceMethods, isESModule) {
  const RealComponent = isESModule
    ? jest.requireActual(moduleName).default
    : jest.requireActual(moduleName);

  // Guard added: RealComponent.prototype may be undefined for arrow-function components
  // (e.g. RN 0.81 Text defined with `component()` syntax). Without this check, reading
  // .constructor off undefined throws a TypeError.
  const SuperClass =
    typeof RealComponent === 'function' &&
    RealComponent.prototype != null &&
    RealComponent.prototype.constructor instanceof React.Component
      ? RealComponent
      : React.Component;

  const name =
    RealComponent.displayName ??
    RealComponent.name ??
    (RealComponent.render == null
      ? 'Unknown'
      : RealComponent.render.displayName ?? RealComponent.render.name);

  const nameWithoutPrefix = name.replace(/^(RCT|RK)/, '');

  class Component extends SuperClass {
    render() {
      const props = { ...(RealComponent.defaultProps ?? {}) };

      if (this.props) {
        Object.keys(this.props).forEach((prop) => {
          if (this.props[prop] !== undefined) {
            props[prop] = this.props[prop];
          }
        });
      }

      return createElement(nameWithoutPrefix, props, this.props.children);
    }
  }

  Object.defineProperty(Component, 'name', {
    value: name,
    writable: false,
    enumerable: false,
    configurable: true,
  });

  Component.displayName = nameWithoutPrefix;

  Object.keys(RealComponent).forEach((classStatic) => {
    Component[classStatic] = RealComponent[classStatic];
  });

  if (instanceMethods != null) {
    Object.assign(Component.prototype, instanceMethods);
  }

  return Component;
};

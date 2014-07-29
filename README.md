# Broccoli's ES6 Module Transpiler

[![Build Status](https://travis-ci.org/mmun/broccoli-es6-module-transpiler.svg?branch=tests)](https://travis-ci.org/mmun/broccoli-es6-module-transpiler)

A Broccoli plugin that transpiles ES6 modules to other module types using
**Square's [es6-module-transpiler][transpiler]**.

## Usage

### Transpiling to CommonJS

```javascript
var compileModules = require('broccoli-es6-module-transpiler');

var transpiledLib = compileModules(lib, {
  formatter: 'commonjs'
});
```

### Transpiling to Bundle Format

The bundle format is perfect for packaging your app's modules into one file that
can be loaded in the browser _without_ needing a module loader.

```javascript
var compileModules = require('broccoli-es6-module-transpiler');

var transpiledLib = compileModules(lib, {
  formatter: 'bundle',
  output   : 'app.js'
});
```

**Note:** The `output` option has a specified value to tell the transpiler where
to output the new JavaScript file that contains the bundled transpiled modules.
An `output` value is required when using the Bundle Format.

### Transpiling to AMD

The latest version of Square's [transpiler][] is flexible and pluggable, and
while it doesn't ship with AMD support built-in you can use the AMD formatter:
[es6-module-transpiler-amd-formatter][amd-formatter].

```javascript
var compileModules = require('broccoli-es6-module-transpiler');
var AMDFormatter = require('es6-module-transpiler-amd-formatter');

var transpiledLib = compileModules(lib, {
  formatter: new AMDFormatter()
});
```

## Documentation

### `compileModules(inputTree, [options])`

---

`options.formatter` *{String | Object}*

The formatter instance or built-in name to use to transpile the modules.
Built-in formatters: `bundle`, `commonjs`.

Default: `bundle`.

---

`options.output` *{String}*

The path where the transpiler should output the transpiled modules to. For
formatters that output one file per module, this should be a directory, while
formatters like the Bundle Format require a value for this option and it must be
a file path.

Default: `"."`.


[transpiler]: https://github.com/square/es6-module-transpiler
[amd-formatter]: https://github.com/caridy/es6-module-transpiler-amd-formatter

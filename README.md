# Broccoli's ES6 Module Transpiler

## Usage

Transpiling to AMD:

```javascript
var transpileES6 = require('broccoli-es6-module-transpiler');

var transpiledLib = transpileES6(lib, {
  moduleName: function(filePath) {
    return filePath.replace(/.js$/, '');
  }
});
```

Transpiling to CommonJS:

```javascript
var transpileES6 = require('broccoli-es6-module-transpiler');

var transpiledLib = transpileES6(lib, {
  type: 'cjs'
});
```

## Documentation

### `transpileES6(inputTree, options)`

---

`options.type` *{String}*

The type of module to transpile to.

Possible values: `amd`, `cjs`, `yui` or `globals`.
Default: `amd`.

---

`options.moduleName` *{Function, String, null}*

The module name that is passed to the transpiler for each file.

  - If `moduleName` is `null` an anonymous module will be generated.
  - If `moduleName` is a string it will be passed directly the transpiler for all files.
  - If `moduleName` is a function it will be called with the path of the current file as its sole argument. The return value of the function will be passed to the transpiler. 

Default: `null`.

---

`options.options` *{Function, Object, null}*

The options that are passed to the transpiler for each file.

 - If `options` is `null` no options will be passed.
 - If `options` is an object it will be passed directly the transpiler for all files.
 - If `options` is a function it will be called with the path of the current file as its sole argument. The return value of the function will be passed to the transpiler. 

Default: `null`.

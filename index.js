var Filter = require('broccoli-filter');
var Compiler = require('es6-module-transpiler').Compiler;

module.exports = TranspilerFilter;

TranspilerFilter.prototype = Object.create(Filter.prototype);;
TranspilerFilter.prototype.constructor = TranspilerFilter;

function TranspilerFilter(inputTree, options) {
  if (!(this instanceof TranspilerFilter)) {
    return new TranspilerFilter(inputTree, options);
  }

  options = options || {};
  this.inputTree = inputTree;
  this.type = 'amd';

  for (var key in options) {
    if (options.hasOwnProperty(key)) {
      this[key] = options[key]
    }
  }

  if (this.moduleName === true) {
    this.moduleName = function(filePath) {
      return filePath.slice(0, -3);
    };
  }
}

TranspilerFilter.prototype.extensions = ['js'];
TranspilerFilter.prototype.targetExtension = 'js';

TranspilerFilter.prototype.getModuleName = function(filePath) {
  if (typeof this.moduleName === 'function') {
    return this.moduleName(filePath);
  } else {
    return this.moduleName;
  }
};

TranspilerFilter.prototype.getTranspilerOptions = function(filePath) {
  if (typeof this.transpilerOptions === 'function') {
    return this.transpilerOptions(filePath);
  } else {
    return this.transpilerOptions;
  }
};

TranspilerFilter.prototype.processString = function (fileContents, filePath) {
  var name = this.getModuleName(filePath);
  var options = this.getTranspilerOptions(filePath);

  var compiler = new Compiler(fileContents, name, options);

  return compiler[transpilerMethods[this.type]]();
};

var transpilerMethods = {
  'amd': 'toAMD',
  'yui': 'toYUI',
  'cjs': 'toCJS',
  'globals': 'toGlobals'
};

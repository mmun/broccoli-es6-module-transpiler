var fs = require('fs');
var path = require('path');
var broccoli = require('broccoli');
var expect = require('expect.js');
var transpile = require('..');


describe('broccoli-es6-module-transpiler', function() {
  function getSourcePath(testName) {
    return path.join('tests/fixtures', testName, 'source');
  }

  function readTranspiled(directory, relativePath) {
    var filePath = path.join(directory, relativePath || "");
    return fs.readFileSync(filePath, {encoding: 'utf8'});
  }

  function readExpected(testName, relativePath) {
    var filePath = path.join('tests/fixtures', testName, 'expected', relativePath || "");
    return fs.readFileSync(filePath, {encoding: 'utf8'});
  }

  var builder;

  afterEach(function() {
    if (builder) {
      builder.cleanup();
    }
  });

  describe('transpiling commonjs', function() {
    it('should transpile to CommonJS', function() {
      var testName = 'commonjs';
      var tree = transpile(getSourcePath(testName), { formatter: 'commonjs' });

      builder = new broccoli.Builder(tree);
      return builder.build().then(function(node) {
        expect(readTranspiled(node.directory, 'foo.js')).to.be(readExpected(testName, 'foo.js'));
        expect(readTranspiled(node.directory, 'foo/bar.js')).to.be(readExpected(testName, 'foo/bar.js'));
      });
    });
  });

  describe('transpiling directory ending with .js', function() {
    it('should transpile to CommonJS', function() {
      var testName = 'dir_with_extension';
      var tree = transpile(getSourcePath(testName), { formatter: 'commonjs' });

      builder = new broccoli.Builder(tree);
      return builder.build().then(function(node) {
        expect(readTranspiled(node.directory, 'index.js')).to.be(readExpected(testName, 'index.js'));
        expect(readTranspiled(node.directory, 'accounting.js/accounting.js')).to.be(readExpected(testName, 'accounting.js/accounting.js'));
      });
    });
  });
});

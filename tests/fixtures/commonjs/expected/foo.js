"use strict";

Object.seal(Object.defineProperties(exports, {
  baz: {
    get: function() {
      return baz;
    },

    enumerable: true
  }
}));

var foo$bar$$ = require("./foo/bar");
var baz = foo$bar$$.default;

//# sourceMappingURL=foo.js.map
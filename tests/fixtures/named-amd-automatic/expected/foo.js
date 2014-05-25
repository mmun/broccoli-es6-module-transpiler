define("foo",
  ["./foo/bar","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var bar = __dependency1__["default"];

    var baz = bar;
    __exports__.baz = baz;
  });
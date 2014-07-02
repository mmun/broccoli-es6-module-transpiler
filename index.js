'use strict';

var path      = require('path'),
    util      = require('util'),
    mkdirp    = require('mkdirp'),
    quickTemp = require('quick-temp'),
    walkSync  = require('walk-sync'),
    helpers   = require('broccoli-kitchen-sink-helpers'),
    Writer    = require('broccoli-writer');

var transpiler   = require('es6-module-transpiler'),
    Container    = transpiler.Container,
    FileResolver = transpiler.FileResolver,
    Module       = require('es6-module-transpiler/lib/module');

module.exports = CompileModules;

// -- CompileModules -----------------------------------------------------------

function CompileModules(inputTree, options) {
    if (!(this instanceof CompileModules)) {
        return new CompileModules(inputTree, options);
    }

    options || (options = {});

    var formatter = options.formatter;

    if (!formatter) {
        formatter = transpiler.formatters.DEFAULT;
    }

    if (typeof formatter === 'string') {
        formatter = transpiler.formatters[formatter];
    }

    this.inputTree   = inputTree;
    this.formatter   = formatter;
    this.output      = options.output || '.';
    this.description = options.description;

    this._cache      = {};
    this._cacheIndex = 0;
}

util.inherits(CompileModules, Writer);

CompileModules.prototype.cleanup = function () {
    quickTemp.remove(this, 'tmpCacheDir');
    Writer.prototype.cleanup.apply(this, arguments);
};

CompileModules.prototype.getCacheDir = function () {
    return quickTemp.makeOrReuse(this, 'tmpCacheDir');
};

CompileModules.prototype.write = function (readTree, destDir) {
    return readTree(this.inputTree).then(function (srcDir) {
        var outputPath       = path.join(destDir, this.output),
            modules          = [],
            modulesToCompile = [],
            cache            = this._cache,
            cacheEntry;

        function hash(filePaths) {
            Array.isArray(filePaths) || (filePaths = [filePaths]);

            return filePaths.map(function (filePath) {
                return helpers.hashTree(path.join(srcDir, filePath));
            }).join(',');
        }

        walkSync(srcDir).forEach(function (relPath) {
            if (path.extname(relPath) === '.js') {
                modules.push(relPath);
                return;
            }

            // Skip doing anything with dir entries.
            if (relPath.charAt(relPath.length - 1) === '/') {
                return;
            }

            var srcPath  = path.join(srcDir, relPath),
                destPath = path.join(destDir, relPath);

            mkdirp.sync(path.dirname(destPath));
            helpers.copyPreserveSync(srcPath, destPath);
        });

        if (path.extname(outputPath) === '.js') {
            cacheEntry = cache[hash(modules)];

            if (cacheEntry) {
                this.copyFromCache(cacheEntry, path.dirname(outputPath));
            } else {
                modulesToCompile = modules;
            }
        } else {
            modules.forEach(function (module) {
                var cacheEntry = cache[hash(module)];

                if (cacheEntry) {
                    this.copyFromCache(cacheEntry, outputPath);
                } else {
                    modulesToCompile.push(module);
                }
            }, this);
        }

        this.compileAndCacheModules(modulesToCompile, srcDir, outputPath);
    }.bind(this));
};

CompileModules.prototype.compileAndCacheModules = function (modulePaths, srcDir, outputPath) {
    if (modulePaths.length < 1) { return; }

    var cache    = this._cache,
        cacheDir = this.getCacheDir();

    var container = new Container({
        formatter: this.formatter,
        resolvers: [
            new CacheResolver(cache, srcDir),
            new FileResolver([srcDir])
        ]
    });

    var modules = modulePaths.map(function (modulePath) {
        return container.getModule(modulePath);
    });

    container.write(outputPath);

    var outputIsFile = path.extname(outputPath) === '.js',
        outputHash   = [],
        cacheEntry;

    modules.forEach(function (module) {
        var hash = helpers.hashTree(module.path);

        var cacheEntry = cache[hash] = {
            ast    : module.ast,
            imports: module.imports,
            exports: module.exports,
            scope  : module.scope
        };

        if (outputIsFile) {
            outputHash.push(hash);
            return;
        }

        var relPath = path.relative(srcDir, module.path);

        // TODO: Add source map to `outputFiles`.
        cacheEntry.outputFiles = [
            relPath /*,
            relPath + '.map'*/
        ];

        this.cacheFiles(cacheEntry, outputPath, cacheDir);
    }, this);

    if (outputIsFile) {
        cacheEntry = cache[outputHash.join(',')] = {
            // TODO: Add source map to `outputFiles`.
            outputFiles: [
                path.basename(outputPath) /*,
                path.basename(outputPath) + '.map'*/
            ]
        };

        this.cacheFiles(cacheEntry, path.dirname(outputPath), cacheDir);
    }
};

CompileModules.prototype.cacheFiles = function (cacheEntry, outputDir, cacheDir) {
    cacheEntry.cacheFiles = [];

    cacheEntry.outputFiles.forEach(function (outputFile) {
        var cacheFile = (this._cacheIndex ++) + '';
        cacheEntry.cacheFiles.push(cacheFile);

        helpers.copyPreserveSync(
            path.join(outputDir, outputFile),
            path.join(cacheDir, cacheFile)
        );
    }, this);
};

CompileModules.prototype.copyFromCache = function (cacheEntry, destDir) {
    var cacheDir = this.getCacheDir();

    cacheEntry.outputFiles.forEach(function (outputFile, i) {
        var cacheFile = cacheEntry.cacheFiles[i],
            cachePath = path.join(cacheDir, cacheFile),
            destPath  = path.join(destDir, outputFile);

        mkdirp.sync(path.dirname(destPath));
        helpers.copyPreserveSync(cachePath, destPath);
    });
};

// -- CacheResolver ------------------------------------------------------------

function CacheResolver(cache, srcDir) {
    this.cache  = cache;
    this.srcDir = srcDir;
}

CacheResolver.prototype.resolveModule = function (importedPath, fromModule, container) {
    var resolvedPath = this.resolvePath(importedPath, fromModule),
        cachedModule = container.getCachedModule(resolvedPath);

    if (cachedModule) {
        return cachedModule;
    }

    var cacheEntry = this.cache[helpers.hashTree(resolvedPath)],
        module;

    if (cacheEntry) {
        module = new Module(resolvedPath, importedPath, container);

        module.ast     = cacheEntry.ast;
        module.imports = cacheEntry.imports;
        module.exports = cacheEntry.exports;
        module.scope   = cacheEntry.scope;

        return module;
    }

    return null;
};

CacheResolver.prototype.resolvePath = function (importedPath, fromModule) {
    var srcDir = this.srcDir,
        resolved;

    if (importedPath.charAt(0) === '.' && fromModule) {
        srcDir = path.dirname(fromModule.path);
    }

    resolved = path.resolve(srcDir, importedPath);

    if (path.extname(resolved) !== '.js') {
        resolved += '.js';
    }

    return resolved;
};

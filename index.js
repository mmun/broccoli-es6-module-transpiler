'use strict';

var fs        = require('fs'),
    path      = require('path'),
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
        var outputPath = path.join(destDir, this.output),
            modules    = [];

        function hash(filePaths) {
            Array.isArray(filePaths) || (filePaths = [filePaths]);

            return filePaths.map(function (filePath) {
                return hashFile(path.join(srcDir, filePath));
            }).join(',');
        }

        walkSync(srcDir).forEach(function (relPath) {
            // Keep track of all the JavaScript modules.
            if (path.extname(relPath) === '.js') {
                modules.push(relPath);
                return;
            }

            // Skip doing anything with dir entries. When outputting a bundle
            // format some dirs may go away. For non-JavaScript files, their
            // containing dir will be created before they are copied over.
            if (relPath.charAt(relPath.length - 1) === '/') {
                return;
            }

            var srcPath  = path.join(srcDir, relPath),
                destPath = path.join(destDir, relPath);

            // Copy over non-JavaScript files to the `destDir`.
            //
            // TODO: switch to `symlinkOrCopySync()` after:
            // https://github.com/broccolijs/broccoli/issues/179
            mkdirp.sync(path.dirname(destPath));
            helpers.copyPreserveSync(srcPath, destPath);
        });

        var modulesToCompile = [],
            cache            = this._cache,
            cacheEntry;

        // The specificed `output` can either be a file (for bundle formatters),
        // or a dir.
        //
        // When outputting to a single file, all the input files must must be
        // unchanged in order to use the cached compiled file.
        //
        // When outputting to a dir, we symlink/copy over the cached compiled
        // file for any modules that are unchanged. Any modified modules are
        // added to the `modulesToCompile` collection.
        if (path.extname(outputPath) === '.js') {
            cacheEntry = cache[path.basename(outputPath)];

            // Must hash _all_ modules when outputting to a single file.
            if (cacheEntry && cacheEntry.hash === hash(modules)) {
                this.copyFromCache(cacheEntry, path.dirname(outputPath));
            } else {
                // With a cache-miss, we need to re-generate the bundle output
                // file, so we have to visit all the modules. The CacheResolver
                // will make sure we don't have to read-and-parse the modules
                // that are unchanged.
                modulesToCompile = modules;
            }
        } else {
            // Iterate over all the modules and copy compiled files from the
            // cache for the ones that are unchanged.
            modules.forEach(function (module) {
                cacheEntry = cache[module];

                if (cacheEntry && cacheEntry.hash === hash(module)) {
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
    // Noop when no modules to compile.
    if (modulePaths.length < 1) { return; }

    var cache        = this._cache,
        outputIsFile = path.extname(outputPath) === '.js';

    // The container will first use the CacheResolver so that any unchanged
    // modules that need to be visited by the transpiler don't have to be
    // re-read from disk or re-parsed.
    //
    // If "foo" imports "bar", and "bar" is unchanged, the transpiler still will
    // need to vist it when re-processing "foo".
    var container = new Container({
        formatter: this.formatter,
        resolvers: [
            new CacheResolver(cache, srcDir),
            new FileResolver([srcDir])
        ]
    });

    // Returns transpiler `Module` instances.
    var modules = modulePaths.map(function (modulePath) {
        return container.getModule(modulePath);
    });

    // Create a new cache sub-dir for this compile run.
    var cacheDir = path.join(this.getCacheDir(), String(this._cacheIndex++));

    // Determine target path to compile modules to.
    var target = outputIsFile ?
            path.join(cacheDir, path.basename(outputPath)) : cacheDir;

    // Outputs the compiled modules to the cache.
    mkdirp(target);
    container.write(target);

    var outputHash = [],
        cacheEntry, outputFile;

    modules.forEach(function (module) {
        var hash       = hashFile(module.path),
            relPath    = path.relative(srcDir, module.path),
            modImports = module.imports,
            modExports = module.exports;

        // If the `module` was built with cached metadata, we want to un-wrap
        // its `imports` and `exports` before storing them in the `cacheEntry`.
        if (module instanceof CachedModule) {
            modImports = Object.getPrototypeOf(modImports);
            modExports = Object.getPrototypeOf(modExports);
        }

        // Adds an entry to the cache for the later use by the CacheResolver.
        // This holds the parsed and walked AST, so re-builds of unchanged
        // modules don't need to be re-read and re-parsed.
        var cacheEntry = cache[relPath] = {
            hash: hash,

            ast    : module.ast,
            scope  : module.scope,
            imports: modImports,
            exports: modExports
        };

        // Accumulate hashes if the final output is a single bundle file, and
        // return early.
        if (outputIsFile) {
            outputHash.push(hash);
            return;
        }

        // When outputting to a dir, add the compiled files to the cache entry
        // and copy the files from the cache dir to the `outputPath`.

        cacheEntry.dir = cacheDir;

        cacheEntry.outputFiles = [
            relPath,
            relPath + '.map'
        ];

        this.copyFromCache(cacheEntry, outputPath);
    }, this);

    if (outputIsFile) {
        outputFile = path.basename(outputPath);

        // Create a cache entry for the entire bundle output file and copy it
        // from the cache to the `outputPath`.
        cacheEntry = cache[outputFile] = {
            hash: outputHash.join(','),
            dir : cacheDir,

            outputFiles: [
                outputFile,
                outputFile + '.map'
            ]
        };

        this.copyFromCache(cacheEntry, path.dirname(outputPath));
    }
};

CompileModules.prototype.copyFromCache = function (cacheEntry, destDir) {
    var cacheDir = cacheEntry.dir;

    cacheEntry.outputFiles.forEach(function (outputFile) {
        var cachePath = path.join(cacheDir, outputFile),
            destPath  = path.join(destDir, outputFile);

        // TODO: switch to `symlinkOrCopySync()` after:
        // https://github.com/broccolijs/broccoli/issues/179
        mkdirp.sync(path.dirname(destPath));
        helpers.copyPreserveSync(cachePath, destPath);
    });
};

// -- CacheResolver ------------------------------------------------------------

// Used to speed up transpiling process on re-builds. The `cache` contains the
// `ast`s and other info from perviously read-and-parsed modules. This data can
// be reused for unchanged modules that the transpiler still needs to visit when
// it's compiling during a re-build.
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

    var cacheEntry = this.cache[path.relative(this.srcDir, resolvedPath)];

    // Gets a file-stats hash of the module file, then checks if there's a cache
    // entry with that hash.
    if (cacheEntry && cacheEntry.hash === hashFile(resolvedPath)) {
        return new CachedModule(resolvedPath, importedPath, container, cacheEntry);
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

// -- CachedModule -------------------------------------------------------------

function CachedModule(resolvedPath, importedPath, container, cachedMeta) {
    Module.call(this, resolvedPath, importedPath, container);

    this.ast   = cachedMeta.ast;
    this.scope = cachedMeta.scope;

    // Shadow cached `module` with `this`.
    this.imports = Object.create(cachedMeta.imports, {
        module: {value: this}
    });

    // Shadow cached `module` with `this`.
    this.exports = Object.create(cachedMeta.exports, {
        module: {value: this}
    });
}

util.inherits(CachedModule, Module);

// -- Utilities ----------------------------------------------------------------

var hashFile = helpers.hashTree;

// TODO: Determine if this impl is needed after:
// https://github.com/broccolijs/broccoli/issues/179
//
// Wrapper around `hashTree()` to dereference symbolic links within the Broccoli
// build chain, so when new symlinks are created they won't be considered as
// changed files, unless the real file they are pointing to hashes differently.
// function hashFile(path) {
//     if (fs.lstatSync(path).isSymbolicLink()) {
//         path = fs.realpathSync(path);
//     }
//
//     return helpers.hashTree(path);
// }

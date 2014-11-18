'use strict';

var fs            = require('fs');
var path          = require('path');
var util          = require('util');
var mkdirp        = require('mkdirp');
var quickTemp     = require('quick-temp');
var symlinkOrCopy = require('symlink-or-copy');
var walkSync      = require('walk-sync');
var helpers       = require('broccoli-kitchen-sink-helpers');
var Writer        = require('broccoli-writer');

var transpiler   = require('es6-module-transpiler');
var Container    = transpiler.Container;
var FileResolver = transpiler.FileResolver;
var Module       = require('es6-module-transpiler/lib/module');

module.exports = CompileModules;

// -----------------------------------------------------------------------------

var hashFile    = helpers.hashTree;
var hashStrings = helpers.hashStrings;

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

    var resolverClasses = options.resolvers;

    if (!resolverClasses) {
        resolverClasses = [ FileResolver ];
    }

    this.inputTree       = inputTree;
    this.resolverClasses = resolverClasses;
    this.formatter       = formatter;
    this.output          = options.output || '.';
    this.basePath        = options.basePath;
    this.sourceRoot      = options.sourceRoot || '/';
    this.description     = options.description;

    this._cache = {};
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
            if (Array.isArray(filePaths)) {
                return hashStrings(filePaths.map(function (filePath) {
                    return hashFile(path.join(srcDir, filePath));
                }));
            }

            return hashFile(path.join(srcDir, filePaths));
        }

        walkSync(srcDir).forEach(function (relPath) {
            // Skip doing anything with dir entries. When outputting a bundle
            // format some dirs may go away. For non-JavaScript files, their
            // containing dir will be created before they are copied over.
            if (relPath.charAt(relPath.length - 1) === '/') {
                return;
            }

            // Keep track of all the JavaScript modules.
            // path.extname does not take into account the trailing '/' when
            // checking for the file's extension.
            if (path.extname(relPath) === '.js') {
                modules.push(relPath);
                return;
            }

            var srcPath  = path.join(srcDir, relPath),
                destPath = path.join(destDir, relPath);

            // Copy over non-JavaScript files to the `destDir`.
            mkdirp.sync(path.dirname(destPath));
            symlinkOrCopy.sync(srcPath, destPath);
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
                // will make sure we don't have to re-read the modules that are
                // unchanged.
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

    var cache        = this._cache;
    var cacheDir     = this.getCacheDir();
    var outputIsFile = path.extname(outputPath) === '.js';

    // The container will first use the CacheResolver so that any unchanged
    // modules that need to be visited by the transpiler don't have to be
    // re-read from disk or re-parsed.
    //
    // If "foo" imports "bar", and "bar" is unchanged, the transpiler still will
    // need to vist it when re-processing "foo".
    var container = new Container({
        formatter : this.formatter,
        resolvers : this.getResolvers(cache, srcDir),
        basePath  : this.basePath || srcDir,
        sourceRoot: this.sourceRoot
    });

    // Returns transpiler `Module` instances.
    var modules = modulePaths.map(function (modulePath) {
        return container.getModule(modulePath);
    });

    // Determine target path to compile modules to.
    var target = outputIsFile ?
            path.join(cacheDir, path.basename(outputPath)) : cacheDir;

    // Creates the output dir, then outputs the compiled modules to the cache.
    mkdirp.sync(outputIsFile ? path.dirname(target) : target);
    container.write(target);

    var outputHashes = [],
        cacheEntry, outputFile;

    modules.forEach(function (module) {
        var hash    = hashFile(module.path),
            relPath = path.relative(srcDir, module.path),
            src     = module.src;

        // Adds an entry to the cache for the later use by the CacheResolver.
        // This holds the parsed and walked AST, so re-builds of unchanged
        // modules don't need to be re-read and re-parsed.
        var cacheEntry = cache[relPath] = {
            hash: hash,
            src : src
        };

        // Accumulate hashes if the final output is a single bundle file, and
        // return early.
        if (outputIsFile) {
            outputHashes.push(hash);
            return;
        }

        // When outputting to a dir, add the compiled files to the cache entry
        // and copy the files from the cache dir to the `outputPath`.

        cacheEntry.outputFiles = [
            relPath,
            relPath + '.map'
        ];

        this.copyFromCache(cacheEntry, outputPath);
    }, this);

    if (outputIsFile) {
        outputFile = path.basename(outputPath);

        // Create a cache entry for the entire bundle output file and copy it
        // from the cache to the `outputPath`. Compute the hash as a hash of
        // hashes.
        cacheEntry = cache[outputFile] = {
            hash: hashStrings(outputHashes),
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
    var cacheDir = this.getCacheDir();

    cacheEntry.outputFiles.forEach(function (outputFile) {
        var cachePath = path.join(cacheDir, outputFile),
            destPath  = path.join(destDir, outputFile);

        mkdirp.sync(path.dirname(destPath));
        symlinkOrCopy.sync(cachePath, destPath);
    });
};

CompileModules.prototype.getResolvers = function (cache, srcDir) {
    var includePaths = [ srcDir ],
        resolvers = [];

    resolvers.push(new CacheResolver(cache, srcDir));

    this.resolverClasses.forEach(function (resolverClass) {
        resolvers.push(new resolverClass(includePaths));
    });

    return resolvers;
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

    // Update the `Module` instance with the cached string srouce that so
    // the transpiler doesn't have re-read the file from disk.
    this.src = cachedMeta.src;
}

util.inherits(CachedModule, Module);

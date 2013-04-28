var range   = require('padded-semver').range
var peek    = require('level-peek')
var path    = require('path')
var pull    = require('pull-stream')
var inspect = require('util').inspect
var semver  = require('semver')
var opts    = require('optimist').argv
var cat     = require('pull-cat')
//experimenting with different installation resolve
//algs. the idea is to traverse the tree locally,
//figure out what is needed, and then install from
//cache if possible. Else, get the rest in just one
//bundle. (the registry can stream them into one 
//multipart or a tarball or something)

//I've implemented the basic algorithm that npm uses,
//and a greedy algorithm. the greedy algorithm
//would every module into $PWD/node_modules
//and only creates new node_modules directories
//when the version range specified is not available.

//testing with the trees for large projects, (such as npm and browserify)
//this may require 10-30% fewer installs

function resolve (db, module, vrange, cb) {
  var r = range(vrange || '*')
  r = {
    min: module + '!'+(r.start || ''),
    max: module + '!'+(r.end || '~'),
  }

  peek.last(db, r, function (err, key, pkg) {
    if(!semver.satisfies(pkg.version, vrange))
      return cb(new Error(module+'@'+pkg.version +'><'+ vrange))
    //console.log(module+'@'+vrange, '==>', pkg.version)
    cb(err, pkg)
  })
}

function check(pkg, name, range) {
  if(!pkg) return false
  if(pkg.tree[name] && semver.satisfies(pkg.tree[name].version, range))
    return true
  return check(pkg.parent, name, range)
}

function traverse (db, module, version, cb) {
  resolve(db, module, version, function (err, pkg) {
    pkg.indent = '-'
    cat([pull.values([pkg]),
      pull.depthFirst(pkg, function (pkg) {
        var deps = pkg.dependencies || {}
        pkg.tree = {}
        return pull.values(Object.keys(deps))
          .pipe(pull.asyncMap(function (name, cb) {
            //check if there is already a module that resolves this...

            //filter out versions that we already have.
            if(check(pkg, name, deps[name]))
              return cb()

            resolve(db, name, deps[name], cb)
          }, 10))
    
          .pipe(pull.filter(function (_pkg) {
            if(!_pkg) return
            _pkg.parent = pkg
            _pkg.indent = '-' + pkg.indent
            pkg.tree[_pkg.name] = _pkg
            return pkg
          }))
      })]
    )
    .pipe(pull.drain(function (pkg) {
      console.log('install', pkg.indent, pkg.name, pkg.version)
    }, function () {
      cb(null, pkg)
  //    console.log(inspect(pkg, null, 100))
    }))
  })
}

function traverse2 (db, module, version, cb) {
  resolve(db, module, version, function (err, pkg) {
    var root = pkg
    pkg.indent = '-'
 
    cat([pull.values([pkg]),
    pull.depthFirst(pkg, function (pkg) {
      var deps = pkg.dependencies || {}
      pkg.tree = {}
      return pull.values(Object.keys(deps))
        .pipe(pull.asyncMap(function (name, cb) {
          //check if there is already a module that resolves this...

          //filter out versions that we already have.
//          if (semver.satisfies(_pkg.version, deps[name]))
  //          return cb() //already installed

          if(check(pkg, name, deps[name]))
            return cb()

          resolve(db, name, deps[name], cb)
        }))
    
        .pipe(pull.filter(function (_pkg) {
          if(!_pkg) return
          if(!root.tree[_pkg.name]) {
            root.tree[_pkg.name] = _pkg
            _pkg.parent = root
            _pkg.indent = '-' + root.indent
          }
          else {
            _pkg.parent = pkg
            _pkg.indent = '-' + pkg.indent
            pkg.tree[_pkg.name] = _pkg
          }
          return pkg
        }))
    })])
    .pipe(pull.drain(function (pkg) {
      console.log('install', pkg.indent, pkg.name, pkg.version)
    }, function () {
      cb(null, pkg)
  //    console.log(inspect(pkg, null, 100))
    }))
  })
}

if(!module.parent) {
  var db = require('level-sublevel')
    (require('levelup')(path.join(process.env.HOME, '.npmd'), {encoding: 'json'}))

  require('./index')(db)
//  console.log(db)
  var versions = db.sublevel('ver')
//    .createReadStream({}).on('data', console.log)

  var parts = (opts._[0] || 'npmd').split('@')
  var name = parts.shift()
  var version = parts.pop()

    console.log(name, version)

  var i = 10
  ;(function loop () {
    var start = Date.now()
    if(opts.greedy)
      traverse2(versions, name, version, done)
    else
      traverse(versions, name, version, done)

    function done(){ 
      var end = Date.now()
      console.log(end - start)
      if(--i) loop()
    }

  })()
//*/
}

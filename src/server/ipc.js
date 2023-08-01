const { fdir } = require("fdir");
const xmlFormatter = require('xml-formatter');
const fastq = require('fastq')
const { minimatch } = require('minimatch')
const fs = require('fs')
const path = require('path')
const Diffusionbee = require('./crawler/diffusionbee')
const Standard = require('./crawler/standard')

class IPC {
  handlers = {}
  handle(name, fn) {
    this.handlers[name] = fn
  }
  async push(msg) {
    // if the filename matches any of the globs, push
    let globs = Array.from(this.globs)
    if (globs.length > 0) {
      let matched = false
      for(let g of globs) {
        if (minimatch(msg.file_path, g)) {
          matched = true
          break
        }
      }
      if (matched) {
        await this.queue.push({
          method: "new",
          params: [msg]
        })
      }
    }
  }
  constructor(app, session, config) {
    this.session = session
    this.globs = new Set()
    this.app = app
    if (config) {
      if (config.ipc) {
        this.ipc = config.ipc
      }
    }
    this.theme = (config && config.theme ? config.theme : "default")
    this.config = config
    this.gm = this.config.gm
    if (!this.ipc) {
      this.ipc = {
        handle: (name, fn) => {
          this.handlers[name] = fn
        },
        on: (name, fn) => {
          fn(name)
        }
      }
    }
    this.queue = fastq.promise(async (msg) => {
      try {
        console.debug(`session of ipc: ${this.session}`)
        console.debug(`socket is ${this.socket}`)
        this.socket.emit("msg", msg)
      } catch (ex) {
        console.warn(`failed to emit via socket`, ex)
      }
    }, 1)
    this.ipc.handle("theme", (session, _theme) => {
      this.theme = _theme
    })
    this.ipc.handle("style", (session, _style) => {
      this.style = _style
    })
    this.ipc.handle('subscribe', async (session, folderpaths) => {
      // store the folder paths
      // add to watcher

      this.app.watch(folderpaths)
      this.globs = new Set()
      for(let folder of folderpaths) {
        const glob = `${folder.replaceAll("\\", "/")}/**/*.png`
        //const glob = `${folder.replaceAll("\\", "/")}/**/*.{jpg,jpeg,png,webp}`
        this.globs.add(glob)
      }
    })
    this.ipc.handle('sync', async (session, rpc) => {
      let filter
      if (rpc.paths) {
        let diffusionbee;
        let standard;
        for(let i=0; i<rpc.paths.length; i++) {
          let { file_path, root_path } = rpc.paths[i]
          let res;
          try {
            if (/diffusionbee/g.test(root_path)) {
              if (!diffusionbee) {
                diffusionbee = new Diffusionbee(root_path, this.gm)
                await diffusionbee.init()
              }
              res = await diffusionbee.sync(file_path, rpc.force)
            } else {
              if (!standard) {
                standard = new Standard(root_path, this.gm)
                await standard.init()
              }
              res = await standard.sync(file_path, rpc.force)
            }
          } catch (e) {
            console.log("E", e)
          }
          if (res) {
            await this.queue.push({
              app: root_path,
              total: rpc.paths.length,
              progress: i,
              meta: res
            })
          } else {
            await this.queue.push({
              app: root_path,
              total: rpc.paths.length,
              progress: i,
            })
          }
        }
      } else if (rpc.root_path) {
        let filenames = await new fdir()
          .glob("**/*.png")
          //.glob("**/*.{jpg,jpeg,png,webp}")
          .withBasePath()
          .crawl(rpc.root_path)
          .withPromise()
        if (filenames.length > 0) {
          let crawler;
          if (/diffusionbee/g.test(rpc.root_path)) {
            crawler = new Diffusionbee(rpc.root_path, this.gm)
          } else {
            crawler = new Standard(rpc.root_path, this.gm)
          }
          await crawler.init()
          for(let i=0; i<filenames.length; i++) {
            let filename = filenames[i]
            let stat = await fs.promises.stat(filename)
            let btime = new Date(stat.birthtime).getTime()
            if (!rpc.checkpoint || btime > rpc.checkpoint) {
              let res = await crawler.sync(filename, rpc.force)
              if (res) {
                if (!res.btime) res.btime = res.mtime
                await this.queue.push({
                  app: rpc.root_path,
                  total: filenames.length,
                  progress: i,
                  meta: res
                })
                continue;
              }
            }
            await this.queue.push({
              app: rpc.root_path,
              total: filenames.length,
              progress: i,
            })
          }
        } else {
          await this.queue.push({
            app: rpc.root_path,
            total: 1,
            progress: 1,
          })
        }
      }
    })
    this.ipc.handle('del', async (session, filenames) => {
      for(let filename of filenames) {
        await fs.promises.rm(filename).catch((e) => {
          console.log("error", e)
        })
      }
    })
    this.ipc.handle('defaults', async (session) => {
      let settings = await this.app.settings()
      return settings.folders
    })
    this.ipc.handle('gm', async (session, rpc) => {
      if (rpc.cmd === "set" || rpc.cmd === "rm") {
        console.log("args", JSON.stringify(rpc.args, null, 2))
        let res = await this.gm[rpc.path][rpc.cmd](...rpc.args)
        return res
      }
    })
    this.ipc.handle('xmp', async (session, file_path) => {
      let res = await this.gm.agent.get(file_path)
      if (res && res.xmp) {
        return xmlFormatter(res.xmp, {
          indentation: "  "
        })
      } else {
        return ""
      }
    })
  }
  async call(session, name, ...args) {
    let r = await this.handlers[name](session, ...args)
    return r
  }
}
module.exports = IPC

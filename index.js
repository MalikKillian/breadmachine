const path = require('path')
const express = require('express')
const getport = require('getport')
const os = require('os')
const fs = require('fs')
const yaml = require('js-yaml');
const Updater = require('./updater/index')
const packagejson = require('./package.json')
const BasicAuth = require('./basicauth')
const IPC = require('./ipc')
class Breadmachine {
  async init(config) {
    this.config = config
    let settings = await this.settings()
    if (settings.accounts && Object.keys(settings.accounts).length > 0) {
      this.basicauth = new BasicAuth(settings.accounts)
    }
    if (settings.port) {
      this.port = parseInt(settings.port)
    } else {
      this.port = await new Promise((resolve, reject) => {
        getport(function (e, p) {
          if (e) throw e
          resolve(p)
        })
      })
    }
    this.VERSION = packagejson.version
    this.need_update = null
    this.default_sync_mode = "default"
    this.current_sorter_code = 0
    this.ipc = new IPC(this, config)
    await this.updateCheck().catch((e) => {
      console.log("update check error", e)
    })
    this.start()
  }
  async settings() {
    let str = await fs.promises.readFile(this.config.config, "utf8")
    const attrs = yaml.load(str)
    const home = os.homedir()
    const folders = attrs.folders.map((c) => {
      let homeResolved = c.replace(/^~(?=$|\/|\\)/, home)
      let relativeResolved = path.resolve(home, homeResolved)
      return relativeResolved
    })
    attrs.folders = folders
    return attrs
  }
  start() {
    let app = express()
    app.use((req, res, next) => {
      let a = req.get("user-agent")
      req.agent = (/breadboard/.test(a) ? "electron" : "web")
      next()
    })
    app.use(express.static(path.resolve(__dirname, 'public')))
    if (this.basicauth) {
      app.use(this.basicauth.auth.bind(this.basicauth))
    }
    app.use(express.json());

    app.set('view engine', 'ejs');
    app.set('views', path.resolve(__dirname, "views"))
    app.get("/", async (req, res) => {
      let sync_mode = (req.query.synchronize ? req.query.synchronize : this.default_sync_mode)
      let sync_folder = (req.query.sync_folder ? req.query.sync_folder : "")
      if (req.query && req.query.sorter_code) {
        this.current_sorter_code = req.query.sorter_code
      }
      res.render("index", {
        agent: req.agent,
        platform: process.platform,
        query: req.query,
        version: this.VERSION,
        sync_mode,
        sync_folder,
        need_update: this.need_update,
        current_sorter_code: this.current_sorter_code,
        theme: this.ipc.theme,
        style: this.ipc.style,
      })
      if (this.default_sync_mode) this.default_sync_mode = false   // disable sync after the first time at launch
    })
    app.get('/stream', (req, res, next) => {
      res.flush = () => {}; 
      next();
    }, this.ipc.sse.init);
    app.get("/settings", (req, res) => {
      let authorized = (this.basicauth ? true : false)
      res.render("settings", {
        authorized,
        agent: req.agent,
        config: this.config.config,
        platform: process.platform,
        version: this.VERSION,
        query: req.query,
        theme: this.ipc.theme,
        style: this.ipc.style,
      })
    })
    app.get("/connect", (req, res) => {
      res.render("connect", {
        agent: req.agent,
        config: this.config.config,
        platform: process.platform,
        version: this.VERSION,
        query: req.query,
        theme: this.ipc.theme,
        style: this.ipc.style,
      })
    })
    app.get("/favorites", (req, res) => {
      res.render("favorites", {
        agent: req.agent,
        platform: process.platform,
        version: this.VERSION,
        theme: this.ipc.theme,
        style: this.ipc.style,
      })
    })
    app.get('/file', (req, res) => {
      res.sendFile(req.query.file)
    })
    app.post("/ipc", async (req, res) => {
      let name = req.body.name
      let args = req.body.args
      let r = await this.ipc.call(name, ...args)
      if (r) {
        res.json(r)
      } else {
        res.json({})
      }
    })
    app.listen(this.port, () => {
      console.log(`Breadboard running at http://localhost:${this.port}`)
    })
    this.app = app
  }
  async updateCheck () {
    if (this.config.releases) {
      const releaseFeed = this.config.releases.feed
      const releaseURL = this.config.releases.url
      const updater = new Updater()
      let res = await updater.check(releaseFeed)
      if (res.feed && res.feed.entry) {
        let latest = (Array.isArray(res.feed.entry) ? res.feed.entry[0] : res.feed.entry)
        if (latest.title === this.VERSION) {
          console.log("UP TO DATE", latest.title, this.VERSION)
        } else {
          console.log("Need to update to", latest.id, latest.updated, latest.title)
          this.need_update = {
            $url: releaseURL,
            latest
          }
        }
      }
    }
  }
}
module.exports = Breadmachine

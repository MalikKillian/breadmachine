const path = require('path')
const express = require('express')
const http=require("http");
const os = require('os')
const fs = require('fs')
const yaml = require('js-yaml');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const packagejson = require('./package.json')
const BasicAuth = require('./src/server/basicauth')
const GM = require("gmgm")
class Breadmachine {
  ipc = {}
  async init(config) {
    this.config = config
    let settings = await this.settings()
    if (settings.accounts && Object.keys(settings.accounts).length > 0) {
      this.basicauth = new BasicAuth(settings.accounts)
    }

    // TODO: Reimplement port finder
    this.port = parseInt(settings.port || "4200");

    this.MACHINE_VERSION = packagejson.version
    this.VERSION = config.version ? config.version : ""
    console.log("versions", { agent: this.VERSION, core: this.MACHINE_VERSION })
    this.need_update = null
    this.default_sync_mode = "default"
    this.current_sorter_code = 0
    this.theme = config?.theme || "default";
    // Seems like there's only two options here
    this.style = ["default", "dark"][0];

    const home = os.homedir()
    this.home = path.resolve(home, "__breadboard__")

    this.config.gm = {
      user: new GM({
        store: path.resolve(this.home, "gm", "user"),
        schema: [{
          path: "dc:subject",
          keys: []
        }]
      }),
      agent: new GM({
        store: path.resolve(this.home, "gm", "agent"),
        schema: [{
          path: "xmp:gm",
          keys: [
            "xmp:prompt",
            "xmp:sampler",
            "xmp:steps",
            "xmp:cfg_scale",
            "xmp:input_strength",
            "xmp:seed",
            "xmp:negative_prompt",
            "xmp:model_name",
            "xmp:model_hash",
            "xmp:model_url",
            "xmp:agent",
            "xmp:width",
            "xmp:height",
            "xmp:aesthetic_score",
            "xmp:controlnet_module",
            "xmp:controlnet_model",
            "xmp:controlnet_weight",
            "xmp:controlnet_guidance_strength"
          ]
        }]
      })
    }


    this.engines = {}


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
  auth(req, res) {
    let session
    if (req.agent === "electron") {
      session = req.get("user-agent")
    } else {
      // FIXME: Restore normal session creation
      session = req.cookies.session ? req.cookies.session : "00000000-0000-0000-0000-000000000001" // uuidv4()
    }
    // if (!this.ipc[session]) {
    //   this.ipc[session] = new IPC(this, session, this.config)
    //   if (this.config.onconnect) {
    //     this.config.onconnect(session)
    //   }
    // }
    res.cookie('session', session)
    return session
  }
  start() {
    let app = express()
    const server = http.createServer(app);

    app.use(express.static(path.resolve(__dirname, 'public')))

    app.use(cookieParser());
    app.use((req, res, next) => {
      let a = req.get("user-agent")
      req.agent = (/breadboard/.test(a) ? "electron" : "web")
      next()
    })
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
      let session = this.auth(req, res)
      res.render("index", {
        agent: req.agent,
        platform: process.platform,
        query: req.query,
        version: this.VERSION,
        machine_version: this.MACHINE_VERSION,
        sync_mode,
        sync_folder,
        need_update: this.need_update,
        current_sorter_code: this.current_sorter_code,
        theme: this.theme,
        style: this.style,
      })
      if (this.default_sync_mode) this.default_sync_mode = false   // disable sync after the first time at launch
    })
    app.get("/settings", (req, res) => {
      let authorized = (this.basicauth ? true : false)
      let session = this.auth(req, res)
      res.render("settings", {
        authorized,
        agent: req.agent,
        config: this.config.config,
        platform: process.platform,
        version: this.VERSION,
        machine_version: this.MACHINE_VERSION,
        query: req.query,
        theme: this.theme,
        style: this.style,
      })
    })
    app.get("/help", (req, res) => {
      let items = [{
        name: "discord",
        description: "ask questions and share feedback",
        icon: "fa-brands fa-discord",
        href: "https://discord.gg/XahBUrbVwz"
      }, {
        name: "twitter",
        description: "stay updated on Twitter",
        icon: "fa-brands fa-twitter",
        href: "https://twitter.com/cocktailpeanut"
      }, {
        name: "github",
        description: "feature requests and bug report",
        icon: "fa-brands fa-github",
        href: "https://github.com/cocktailpeanut/breadboard/issues"
      }]
      let session = this.auth(req, res)
      res.render("help", {
        agent: req.agent,
        config: this.config.config,
        theme: this.theme,
        style: this.style,
        items,
        platform: process.platform,
        machine_version: this.MACHINE_VERSION,
        version: this.VERSION
      })
    })
    app.get("/connect", (req, res) => {
      let session = this.auth(req, res)
      res.render("connect", {
        agent: req.agent,
        config: this.config.config,
        platform: process.platform,
        version: this.VERSION,
        machine_version: this.MACHINE_VERSION,
        query: req.query,
        theme: this.theme,
        style: this.style,
      })
    })
    app.get("/favorites", (req, res) => {
      let session = this.auth(req, res)
      res.render("favorites", {
        agent: req.agent,
        platform: process.platform,
        version: this.VERSION,
        machine_version: this.MACHINE_VERSION,
        theme: this.theme,
        style: this.style,
      })
    })
    app.get('/card', (req, res) => {
      let session = this.auth(req, res)
      res.render("card", {
        agent: req.agent,
        theme: this.theme,
        style: this.style,
        version: this.VERSION,
        file_path: req.query.file
      })
    })
    app.get('/screen', (req, res) => {
      let session = this.auth(req, res)
      res.render("screen", {
        agent: req.agent,
        theme: this.theme,
        style: this.style,
        version: this.VERSION,
      })
    })

    server.listen(this.port, () => {
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

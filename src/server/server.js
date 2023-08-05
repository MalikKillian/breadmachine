const path = require('path')
const express = require('express')
const cookie = require('cookie')
const cors = require('cors')
const http=require("http");
const os = require('os')
const fs = require('fs')
const { Server } = require('socket.io')
const yaml = require('js-yaml');
const Watcher = require('watcher');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const Updater = require('./updater/index')
const packagejson = require('../../package.json')
const BasicAuth = require('./basicauth')
const IPC = require('./ipc')
const Diffusionbee = require('./crawler/diffusionbee')
const Standard = require('./crawler/standard')
const GM = require("gmgm")

const logger = require('tracer').colorConsole()

const APP_NAME = `Breadboard API`;

class Breadmachine {

  ipc = {}
  async init(config) {
    this.config = config
    let settings = await this.settings()
    if (settings.accounts && Object.keys(settings.accounts).length > 0) {
      this.basicauth = new BasicAuth(settings.accounts)
    }
    // TODO: Reimplement port finder
    this.port = parseInt(settings.port || "4200") + 1;

    this.MACHINE_VERSION = packagejson.version
    this.VERSION = config.version ? config.version : ""
    logger.info("versions", { agent: this.VERSION, core: this.MACHINE_VERSION })
    this.need_update = null
    this.default_sync_mode = "default"
    this.current_sorter_code = 0

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
      logger.error("update check error", e)
    })
    this.start()

  }
  async parse(filename) {
    let r
    const folder = path.dirname(filename)
    let diffusionbee;
    let standard;
    let file_path = filename
    let root_path = folder
    let res;
    try {
      if (/diffusionbee/g.test(root_path)) {
        if (!this.engines.diffusionbee) {
          this.engines.diffusionbee = new Diffusionbee(root_path, this.config.gm)
        }
        await this.engines.diffusionbee.init()
        res = await this.engines.diffusionbee.sync(file_path)
      } else {
        if (!this.engines.standard) {
          this.engines.standard = new Standard(root_path, this.config.gm)
        }
        await this.engines.standard.init()
        res = await this.engines.standard.sync(file_path)
      }
      return res
    } catch (e) {
      logger.error("ERROR", e)
      return null
    }
  }
  watch(paths) {
    if (this.watcher) {
      this.watcher.close()
    }
    if (paths.length > 0) {
      this.watcher = new Watcher(paths, {
        recursive: true,
        ignoreInitial: true
      })
      this.watcher.on("add", async (filename) => {
        // TODO: Support other formats
        if (filename.endsWith(".png")) {
          let res
          let last_mtime

          let attempts = 20;
          while(true) {
            let stat = await fs.promises.stat(filename)
            if (stat.mtimeMs === last_mtime) {
              // no more change. stop
              break;
            }
            last_mtime = stat.mtimeMs
            attempts--
            if (attempts <= 0) {
              logger.warn("Exhausted attempts waiting for file")
              return
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          // wait a bit to give time for the source apps to load the image
          await new Promise(resolve => setTimeout(resolve, 300));

          for(let i=0; i<5; i++) {
            res = await this.parse(filename)
            if (res) {
              break;
            } else {
              // try again in 1 sec
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
          if (res) {
            for(let session in this.ipc) {
              let ipc = this.ipc[session]
              await ipc.push(res)
            }
          }
        }
      })
    }
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
      session = req.cookies.session ? req.cookies.session : uuidv4()
    }
    logger.debug(`Session ID (auth): ${session}`);
    if (!this.ipc[session]) {
      logger.debug(`new IPC for session ${session}`)
      this.ipc[session] = new IPC(this, session, this.config)
      if (this.config.onconnect) {
        this.config.onconnect(session)
      }
    }
    res.cookie('session', session)
    return session
  }
  start() {
    let app = express()
    const httpServer = http.createServer(app);
    this.io = new Server(httpServer, {
      cors: {
        origin: "http://localhost:4200",
        credentials: true
      },
      cookie: true
    });
    this.io.on('connection', (socket) => {
      try {
        logger.info(socket.handshake.headers.cookie);
        let parsed = cookie.parse(socket.handshake.headers.cookie || "")
        logger.info("connect", parsed)
        let session = parsed.session
        logger.debug(`Session ID: ${session} <== ${socket}`);
        if (this.ipc[session]) {
          logger.debug(`Assigning socket to session ${session}`);
          this.ipc[session].socket = socket
          socket.on('disconnect', () => {
            logger.info('socket disconnect', parsed)
            delete this.ipc[session]
          })
        }
      } catch (e) {
        logger.error("io connection error", e)
      }
    });

    // Need this since UI and API have two different ports
    app.use(cors());

    // Can't imagine needing static files (maybe rearrange some of the JS)
    app.use(express.static(path.resolve(__dirname, 'public')))

    // TODO: Add metadata here??? Could use /card endpoint instead.
    app.get('/file', (req, res) => {
      res.sendFile(req.query.file)
    })

    // Does the order of this matter???
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

    // app.set('view engine', 'ejs');
    // app.set('views', path.resolve(__dirname, "views"))

    // TODO: Make this a generic app info endpoint??? API index (Swagger style)???
    app.get("/", async (req, res) => {
      res.status(404).json({message: `Nothing here right now. Come back later.`});
    })

    // TODO: Display current settings (e.g. what folders are connected)
    app.get("/settings", (req, res) => {
      res.status(404).json({message: `Nothing here right now. Come back later.`});
    })


    app.get("/help", (req, res) => {
      let items = [{
        name: "discord",
        description: "ask questions and share feedback",
        href: "https://discord.gg/XahBUrbVwz"
      }, {
        name: "twitter",
        description: "stay updated on Twitter",
        href: "https://twitter.com/cocktailpeanut"
      }, {
        name: "github",
        description: "feature requests and bug report",
        href: "https://github.com/cocktailpeanut/breadboard/issues"
      }]
      res.json(items);
    })

    // TODO: Update or remove (don't remember what this is for)
    app.get("/connect", (req, res) => {
      res.status(404).json({message: `Nothing here right now. Come back later.`});
    });

    // TODO: Return list of favorite images
    app.get("/favorites", (req, res) => {
      res.status(404).json({message: `Nothing here right now. Come back later.`});
    });

    // TODO: Send back info for given file??? Remove??? Could add metadata to /file endpoint.
    app.get('/card', (req, res) => {
      res.status(404).json({message: `Nothing here right now. Come back later.`});
    })

    // TODO: Remove??? This was the single-file viewer. No idea how this could be used from API perspective.
    app.get('/screen', (req, res) => {
      res.status(404).json({message: `Nothing here right now. Come back later.`});
    })

    // TODO: Remove??? Wouldn't have any more "inter" process communication.
    app.post("/ipc", async (req, res) => {
      let name = req.body.name
      let args = req.body.args
      let session = this.auth(req, res)

      logger.info(session);
      logger.info(name);
      logger.info(args);

      let r = await this.ipc[session].call(session, name, ...args)
      if (r) {
        res.json(r)
      } else {
        res.json({})
      }
    })

    httpServer.listen(this.port, () => {
      logger.info(`${APP_NAME} running at http://localhost:${this.port}`)
    })
    this.app = app
  }

  // TODO: Move this to the "app info" endpoint???
  async updateCheck () {
    if (this.config.releases) {
      const releaseFeed = this.config.releases.feed
      const releaseURL = this.config.releases.url
      const updater = new Updater()
      let res = await updater.check(releaseFeed)
      if (res.feed && res.feed.entry) {
        let latest = (Array.isArray(res.feed.entry) ? res.feed.entry[0] : res.feed.entry)
        if (latest.title === this.VERSION) {
          logger.info("UP TO DATE", latest.title, this.VERSION)
        } else {
          logger.info("Need to update to", latest.id, latest.updated, latest.title)
          this.need_update = {
            $url: releaseURL,
            latest
          }
        }
      }
    }
  }
}

// TODO: CommonJS ==> ES6
module.exports = Breadmachine

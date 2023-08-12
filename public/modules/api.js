class API {
  constructor(config) {
    // Otherwise the "IPC Session" may not yet be established
    this.ping();
    // UI and API are different servers
    this.socket = io("http://localhost:4201", {
      withCredentials: true
    })
    this.config = config
  }
  sync (rpc) {
    return this.request('sync', rpc)
  }
  subscribe (folderpaths) {
    return this.request('subscribe', folderpaths)
  }
  pin () {
    return this.request("pin")
  }
  pinned () {
    return this.request("pinned")
  }
  del (filenames) {
    if (Array.isArray(filenames)) {
      return this.request("del", filenames)
    } else {
      return this.request("del", [filenames])
    }
  }
  defaults () {
    return this.request("defaults")
  }
  gm (rpc) {
    return this.request("gm", rpc)
  }
  xmp (file_path) {
    return this.request("xmp", file_path)
  }
  theme (val) {
    return this.request("theme", val)
  }
  style (val) {
    return this.request("style", val)
  }


  startDrag (fileNames) {
    if (window.electronAPI) {
      window.electronAPI.startDrag(fileNames)
    }
  }
  listen (callback) {
    this.socket.offAny()
    this.socket.on("msg", (msg) => {
      callback(msg, msg)
    })
    this.socket.on("debug", (msg) => {
      console.log("debug", JSON.stringify(msg, null, 2))
    })
  }
  select () {
    return this.request("select")
  }
  copy(str) {
    const element = document.createElement('textarea');
    const previouslyFocusedElement = document.activeElement;

    element.value = str;

    // Prevent keyboard from showing on mobile
    element.setAttribute('readonly', '');

    element.style.contain = 'strict';
    element.style.position = 'absolute';
    element.style.left = '-9999px';
    element.style.fontSize = '12pt';

    const selection = document.getSelection();
    const originalRange = selection.rangeCount > 0 && selection.getRangeAt(0);

    document.body.append(element);
    element.select();

    element.selectionStart = 0;
    element.selectionEnd = str.length;

    let isSuccess = false;
    try {
      isSuccess = document.execCommand('copy');
    } catch {}

    element.remove();

    if (originalRange) {
      selection.removeAllRanges();
      selection.addRange(originalRange);
    }

    // Get the focus back on the previously focused element, if any
    if (previouslyFocusedElement) {
      previouslyFocusedElement.focus();
    }

    return isSuccess;
  }
  open (file_path) {
    if (this.config && this.config.agent === "web") {
      window.open(`http://localhost:4201/file?file=${encodeURIComponent(file_path)}`, "_blank")
    } else {
      return this.request("open", file_path)
    }
  }
  ping () {
    this.request("ping");
  }
  debug () {
    this.request("debug")
  }
  request(name, ...args) {
    // FIXME: Don't hardcode.
    return fetch("http://localhost:4201/ipc", {
      method: "post",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        args
      })
    }).then((res) => {
      return res.json()
    })
  }
}

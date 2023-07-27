const path = require('path');
const Breadmachine = require('../src/index');
(async () => {
  const bread = new Breadmachine()
  await bread.init({
    version: "dev",
    config: path.resolve(__dirname, "breadboard.yaml"),
  })
})();

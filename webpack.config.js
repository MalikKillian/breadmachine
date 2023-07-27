const path = require("path");

const config = {
    entry: {
        vendor: ["@babel/polyfill", "react"], // Third party libraries
        candybar: ["./src/components/entrypoints/candybar.jsx"]
        /// Every pages entry point should be mentioned here
    },
    output: {
        path: path.resolve(__dirname, "public"),
        filename: "[name]-bundle.js" // names of the bundled file will be name of the entry files (mentioned above)
    },
    watchOptions: {
        ignored: /node_modules/,
    },
    mode: "development",
    module: {
        rules: [
            {
                test: /\.(js|jsx)$/,
                use: {
                    loader: "babel-loader", // asks bundler to use babel loader to transpile es2015 code
                    options: {
                        presets: ["@babel/preset-env", "@babel/preset-react"]
                    }
                },
                exclude: [/node_modules/, /public/]
            }
        ]
    },
    resolve: {
        extensions: [".js", ".jsx", ".json", ".wasm", ".mjs", "*"]
        // If multiple files share the same name but have different extensions, webpack will resolve
        // the one with the extension listed first in the array and skip the rest.
    }
};

module.exports = config;

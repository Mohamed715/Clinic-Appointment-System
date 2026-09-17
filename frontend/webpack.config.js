'The tool that turns your many .tsx and .css files into one bundle the browser can load'
const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  entry: "./src/index.tsx",
  output: {
    path: path.resolve(__dirname, "build"),
    filename: "app.[contenthash].js",
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
  },
  module: {
    rules: [
      { test: /\.tsx?$/, exclude: /node_modules/, use: "babel-loader" },
      { test: /\.css$/, use: ["style-loader", "css-loader", "postcss-loader"] },
    ],
  },
  // The app is one small bundle, so skip the size warning.
  performance: { hints: false },
  plugins: [new HtmlWebpackPlugin({ template: "public/index.html" })],
  devServer: {
    port: 3000,
    open: true,
    historyApiFallback: true,
  },
};
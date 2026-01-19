const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: './src/index.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg|glb|gltf)$/i,
        type: 'asset/resource',
        // 只处理小于1MB的文件作为资源
        parser: {
          dataUrlCondition: {
            maxSize: 1024 * 1024, // 1MB
          },
        },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: 'public/index.html',
    }),
  ],
  devServer: {
    static: [
      {
        directory: path.join(__dirname, 'dist'),
      },
      {
        directory: path.join(__dirname, 'public'),
        publicPath: '/',
      },
      {
        directory: path.join(__dirname, 'src'),
        publicPath: '/src/',
      },
      {
        directory: path.join(__dirname, 'node_modules'),
        publicPath: '/node_modules/',
      },
      {
        directory: path.join(__dirname, 'three.js-dev'),
        publicPath: '/three.js-dev/',
      },
    ],
    hot: true,
    open: true,
  },
  resolve: {
    extensions: ['.js'],
  },
};

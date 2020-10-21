import resolve from '@rollup/plugin-node-resolve';
import buble from '@rollup/plugin-buble';
import {terser} from 'rollup-plugin-terser'
import ts from '@wessberg/rollup-plugin-ts';

const output = (file, plugins) => ({
  input: './src/index.ts',
  output: {
    name: 'Flatbush',
    format: 'umd',
    indent: false,
    file
  },
  plugins
});

export default [
  output('./build/flatbush.js', [ts(), resolve(), buble()]),
  output('./build/flatbush.min.js', [ts(), resolve(), terser({compress: {passes: 2}}), buble()])
];

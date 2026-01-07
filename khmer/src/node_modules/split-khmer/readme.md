![split-khmer](https://user-images.githubusercontent.com/15277233/175805541-d59f7720-c24c-42d7-8e7c-5549e22b5ef9.png)

# Split Khmer words

Split Khmer sentence into an array of words.

[![test](https://github.com/seanghay/split-khmer/actions/workflows/test.yml/badge.svg)](https://github.com/seanghay/split-khmer/actions/workflows/test.yml)
[![version](https://img.shields.io/npm/v/split-khmer)](https://npmjs.com/package/split-khmer)


## Installation

```
npm i split-khmer
```

## Usage

```js

// Node.js 16+ ESM
import { split } from 'split-khmer'

// Browser Module
import { split } from 'https://unpkg.com/split-khmer@latest/dist/index.mjs'

// CommonJS
const { split } = require('split-khmer') 

const values = split('កូនខ្មែរអាចធ្វើបាន');

console.log(values);
// [ 'កូន', 'ខ្មែរ', 'អាច', 'ធ្វើ', 'បាន' ]

```

## ⚠️ Note

`Intl.Segmenter` is available only in Node.js 16 and latest Chrome browser. You need to use a polyfill to make it available to older browsers.

We provided a [**BreakIterator**](./wasm/break_iterator_km.wasm) binary for you in order to create a polyfill for Khmer language. The binary file will be in `./dist/break_iterator_km.wasm`.

e.g. The distibuted url will be `https://unpkg.com/split-khmer@0.0.3/dist/break_iterator_km.wasm`

Use this library as a polyfill: [intl-segmenter-polyfill](https://github.com/surferseo/intl-segmenter-polyfill)

### Browser Supports

https://caniuse.com/mdn-javascript_builtins_intl_segmenter_segment

## License 


MIT

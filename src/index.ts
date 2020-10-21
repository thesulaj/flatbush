import FlatQueue from 'flatqueue';

const ARRAY_TYPES = [
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array,
];
type AnyArray = Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array
  | Float32Array
  | Float64Array;
type AnyArrayConstructor = Int8ArrayConstructor
  | Int16ArrayConstructor
  | Int32ArrayConstructor
  | Uint8ArrayConstructor
  | Uint8ClampedArrayConstructor
  | Uint16ArrayConstructor
  | Uint32ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor;
type FilterFn = (index: number) => boolean;

const VERSION = 3; // serialized format version

function axisDist(k: number, min: number, max: number): number {
  if (k < min) {
    return min - k;
  }

  return k <= max ? 0 : k - max;
}

// binary search for the first value in the array bigger than the given
function upperBound(value: number, arr: number[]): number {
  let i = 0;
  let j = arr.length - 1;
  while (i < j) {
    const m = (i + j) >> 1;
    if (arr[m] > value) {
      j = m;
    } else {
      i = m + 1;
    }
  }
  return arr[i];
}

// swap two values and two corresponding boxes
function swap(values: Uint32Array, boxes: AnyArray, indices: AnyArray, i: number, j: number) {
  const temp = values[i];
  values[i] = values[j];
  values[j] = temp;

  const k = 4 * i;
  const m = 4 * j;

  const a = boxes[k];
  const b = boxes[k + 1];
  const c = boxes[k + 2];
  const d = boxes[k + 3];
  boxes[k] = boxes[m];
  boxes[k + 1] = boxes[m + 1];
  boxes[k + 2] = boxes[m + 2];
  boxes[k + 3] = boxes[m + 3];
  boxes[m] = a;
  boxes[m + 1] = b;
  boxes[m + 2] = c;
  boxes[m + 3] = d;

  const e = indices[i];
  indices[i] = indices[j];
  indices[j] = e;
}

// custom quicksort that partially sorts bbox data alongside the hilbert values
function sort(values: Uint32Array, boxes: AnyArray, indices: AnyArray, left: number, right: number, nodeSize: number) {
  if (Math.floor(left / nodeSize) >= Math.floor(right / nodeSize)) return;

  const pivot = values[(left + right) >> 1];
  let i = left - 1;
  let j = right + 1;

  while (true) { // eslint-disable-line no-constant-condition
    do i++; while (values[i] < pivot);
    do j--; while (values[j] > pivot);
    if (i >= j) break;
    swap(values, boxes, indices, i, j);
  }

  sort(values, boxes, indices, left, j, nodeSize);
  sort(values, boxes, indices, j + 1, right, nodeSize);
}

// Fast Hilbert curve algorithm by http://threadlocalmutex.com/
// Ported from C++ https://github.com/rawrunprotected/hilbert_curves (public domain)
function hilbert(x: number, y: number): number {
  let a = x ^ y;
  let b = 0xFFFF ^ a;
  let c = 0xFFFF ^ (x | y);
  let d = x & (y ^ 0xFFFF);

  let A = a | (b >> 1);
  let B = (a >> 1) ^ a;
  let C = ((c >> 1) ^ (b & (d >> 1))) ^ c;
  let D = ((a & (c >> 1)) ^ (d >> 1)) ^ d;

  a = A; b = B; c = C; d = D;
  A = ((a & (a >> 2)) ^ (b & (b >> 2)));
  B = ((a & (b >> 2)) ^ (b & ((a ^ b) >> 2)));
  C ^= ((a & (c >> 2)) ^ (b & (d >> 2)));
  D ^= ((b & (c >> 2)) ^ ((a ^ b) & (d >> 2)));

  a = A; b = B; c = C; d = D;
  A = ((a & (a >> 4)) ^ (b & (b >> 4)));
  B = ((a & (b >> 4)) ^ (b & ((a ^ b) >> 4)));
  C ^= ((a & (c >> 4)) ^ (b & (d >> 4)));
  D ^= ((b & (c >> 4)) ^ ((a ^ b) & (d >> 4)));

  a = A; b = B; c = C; d = D;
  C ^= ((a & (c >> 8)) ^ (b & (d >> 8)));
  D ^= ((b & (c >> 8)) ^ ((a ^ b) & (d >> 8)));

  a = C ^ (C >> 1);
  b = D ^ (D >> 1);

  let i0 = x ^ y;
  let i1 = b | (0xFFFF ^ (i0 | a));

  i0 = (i0 | (i0 << 8)) & 0x00FF00FF;
  i0 = (i0 | (i0 << 4)) & 0x0F0F0F0F;
  i0 = (i0 | (i0 << 2)) & 0x33333333;
  i0 = (i0 | (i0 << 1)) & 0x55555555;

  i1 = (i1 | (i1 << 8)) & 0x00FF00FF;
  i1 = (i1 | (i1 << 4)) & 0x0F0F0F0F;
  i1 = (i1 | (i1 << 2)) & 0x33333333;
  i1 = (i1 | (i1 << 1)) & 0x55555555;

  return ((i1 << 1) | i0) >>> 0;
}

export default class Flatbush {
  nodeSize: number;

  numItems: number;

  data: ArrayBuffer;

  pos: number;

  minX: number;

  minY: number;

  maxX: number;

  maxY: number;

  queue: FlatQueue<number>;

  readonly boxes: AnyArray;

  readonly indices: AnyArray;

  readonly ArrayType: AnyArrayConstructor;

  readonly IndexArrayType: AnyArrayConstructor;

  readonly levelBounds: number[];

  static from(data: ArrayBuffer): Flatbush {
    if (!(data instanceof ArrayBuffer)) {
      throw new Error('Data must be an instance of ArrayBuffer.');
    }
    const [magic, versionAndType] = new Uint8Array(data, 0, 2);
    if (magic !== 0xfb) {
      throw new Error('Data does not appear to be in a Flatbush format.');
    }
    if (versionAndType >> 4 !== VERSION) {
      throw new Error(`Got v${versionAndType >> 4} data when expected v${VERSION}.`);
    }
    const [nodeSize] = new Uint16Array(data, 2, 1);
    const [numItems] = new Uint32Array(data, 4, 1);

    return new Flatbush(numItems, nodeSize, ARRAY_TYPES[versionAndType & 0x0f], data);
  }

  constructor(numItems: number, nodeSize: number = 16, ArrayType: AnyArrayConstructor = Float64Array, data?: ArrayBuffer) {
    if (numItems === undefined) throw new Error('Missing required argument: numItems.');
    if (Number.isNaN(numItems) || numItems <= 0) throw new Error(`Unpexpected numItems value: ${numItems}.`);

    this.numItems = +numItems;
    this.nodeSize = Math.min(Math.max(+nodeSize, 2), 65535);

    // calculate the total number of nodes in the R-tree to allocate space for
    // and the index of each tree level (used in search later)
    let n = numItems;
    let numNodes = n;
    this.levelBounds = [n * 4];
    do {
      n = Math.ceil(n / this.nodeSize);
      numNodes += n;
      this.levelBounds.push(numNodes * 4);
    } while (n !== 1);

    this.ArrayType = ArrayType || Float64Array;
    this.IndexArrayType = numNodes < 16384 ? Uint16Array : Uint32Array;

    const arrayTypeIndex = ARRAY_TYPES.indexOf(this.ArrayType);
    const nodesByteSize = numNodes * 4 * this.ArrayType.BYTES_PER_ELEMENT;

    if (arrayTypeIndex < 0) {
      throw new Error(`Unexpected typed array class: ${ArrayType}.`);
    }

    if (data !== undefined) {
      this.data = data;
      this.boxes = new this.ArrayType(this.data, 8, numNodes * 4);
      this.indices = new this.IndexArrayType(this.data, 8 + nodesByteSize, numNodes);

      this.pos = numNodes * 4;
      this.minX = this.boxes[this.pos - 4];
      this.minY = this.boxes[this.pos - 3];
      this.maxX = this.boxes[this.pos - 2];
      this.maxY = this.boxes[this.pos - 1];

    } else {
      this.data = new ArrayBuffer(8 + nodesByteSize + numNodes * this.IndexArrayType.BYTES_PER_ELEMENT);
      this.boxes = new this.ArrayType(this.data, 8, numNodes * 4);
      this.indices = new this.IndexArrayType(this.data, 8 + nodesByteSize, numNodes);
      this.pos = 0;
      this.minX = Infinity;
      this.minY = Infinity;
      this.maxX = -Infinity;
      this.maxY = -Infinity;

      new Uint8Array(this.data, 0, 2).set([0xfb, (VERSION << 4) + arrayTypeIndex]);
      new Uint16Array(this.data, 2, 1)[0] = nodeSize;
      new Uint32Array(this.data, 4, 1)[0] = numItems;
    }

    // a priority queue for k-nearest-neighbors queries
    this.queue = new FlatQueue<number>();
  }

  add(minX: number, minY: number, maxX: number, maxY: number): number {
    const index = this.pos >> 2;
    this.indices[index] = index;
    this.boxes[this.pos++] = minX;
    this.boxes[this.pos++] = minY;
    this.boxes[this.pos++] = maxX;
    this.boxes[this.pos++] = maxY;

    if (minX < this.minX) this.minX = minX;
    if (minY < this.minY) this.minY = minY;
    if (maxX > this.maxX) this.maxX = maxX;
    if (maxY > this.maxY) this.maxY = maxY;

    return index;
  }

  finish() {
    if (this.pos >> 2 !== this.numItems) {
      throw new Error(`Added ${this.pos >> 2} items when expected ${this.numItems}.`);
    }

    if (this.numItems <= this.nodeSize) {
      // only one node, skip sorting and just fill the root box
      this.boxes[this.pos++] = this.minX;
      this.boxes[this.pos++] = this.minY;
      this.boxes[this.pos++] = this.maxX;
      this.boxes[this.pos++] = this.maxY;
      return;
    }

    const width = this.maxX - this.minX;
    const height = this.maxY - this.minY;
    const hilbertValues = new Uint32Array(this.numItems);
    const hilbertMax = (1 << 16) - 1;

    // map item centers into Hilbert coordinate space and calculate Hilbert values
    for (let i = 0; i < this.numItems; i++) {
      let pos = 4 * i;
      const minX = this.boxes[pos++];
      const minY = this.boxes[pos++];
      const maxX = this.boxes[pos++];
      const maxY = this.boxes[pos++];
      const x = Math.floor(hilbertMax * ((minX + maxX) / 2 - this.minX) / width);
      const y = Math.floor(hilbertMax * ((minY + maxY) / 2 - this.minY) / height);
      hilbertValues[i] = hilbert(x, y);
    }

    // sort items by their Hilbert value (for packing later)
    sort(hilbertValues, this.boxes, this.indices, 0, this.numItems - 1, this.nodeSize);

    // generate nodes at each tree level, bottom-up
    for (let i = 0, pos = 0; i < this.levelBounds.length - 1; i++) {
      const end = this.levelBounds[i];

      // generate a parent node for each block of consecutive <nodeSize> nodes
      while (pos < end) {
        const nodeIndex = pos;

        // calculate bbox for the new node
        let nodeMinX = Infinity;
        let nodeMinY = Infinity;
        let nodeMaxX = -Infinity;
        let nodeMaxY = -Infinity;
        for (let ii = 0; ii < this.nodeSize && pos < end; ii++) {
          nodeMinX = Math.min(nodeMinX, this.boxes[pos++]);
          nodeMinY = Math.min(nodeMinY, this.boxes[pos++]);
          nodeMaxX = Math.max(nodeMaxX, this.boxes[pos++]);
          nodeMaxY = Math.max(nodeMaxY, this.boxes[pos++]);
        }

        // add the new node to the tree data
        this.indices[this.pos >> 2] = nodeIndex;
        this.boxes[this.pos++] = nodeMinX;
        this.boxes[this.pos++] = nodeMinY;
        this.boxes[this.pos++] = nodeMaxX;
        this.boxes[this.pos++] = nodeMaxY;
      }
    }
  }

  search(minX: number, minY: number, maxX: number, maxY: number, filterFn?: FilterFn): number[] {
    if (this.pos !== this.boxes.length) {
      throw new Error('Data not yet indexed - call index.finish().');
    }

    let nodeIndex: number|undefined = this.boxes.length - 4;
    const queue = [];
    const results = [];

    while (nodeIndex !== undefined) {
      // find the end index of the node
      const end = Math.min(nodeIndex + this.nodeSize * 4, upperBound(nodeIndex, this.levelBounds));

      // search through child nodes
      for (let pos: number = nodeIndex; pos < end; pos += 4) {
        const index = this.indices[pos >> 2] | 0;

        // check if node bbox intersects with query bbox
        if (maxX < this.boxes[pos]) continue; // maxX < nodeMinX
        if (maxY < this.boxes[pos + 1]) continue; // maxY < nodeMinY
        if (minX > this.boxes[pos + 2]) continue; // minX > nodeMaxX
        if (minY > this.boxes[pos + 3]) continue; // minY > nodeMaxY

        if (nodeIndex < this.numItems * 4) {
          if (filterFn === undefined || filterFn(index)) {
            results.push(index); // leaf item
          }

        } else {
          queue.push(index); // node; add it to the search queue
        }
      }

      nodeIndex = queue.pop();
    }

    return results;
  }

  neighbors(x: number, y: number, maxResults: number = Infinity, maxDistance: number = Infinity, filterFn?: FilterFn): number[] {
    if (this.pos !== this.boxes.length) {
      throw new Error('Data not yet indexed - call index.finish().');
    }

    let nodeIndex: number|undefined = this.boxes.length - 4;
    const q = this.queue;
    const results = [];
    const maxDistSquared = maxDistance * maxDistance;

    while (nodeIndex !== undefined) {
      // find the end index of the node
      const end = Math.min(nodeIndex + this.nodeSize * 4, upperBound(nodeIndex, this.levelBounds));

      // add child nodes to the queue
      for (let pos = nodeIndex; pos < end; pos += 4) {
        const index = this.indices[pos >> 2] | 0;

        const dx = axisDist(x, this.boxes[pos], this.boxes[pos + 2]);
        const dy = axisDist(y, this.boxes[pos + 1], this.boxes[pos + 3]);
        const dist = dx * dx + dy * dy;

        if (nodeIndex < this.numItems * 4) { // leaf node
          if (filterFn === undefined || filterFn(index)) {
            // put a negative index if it's an item rather than a node, to recognize later
            q.push(-index - 1, dist);
          }
        } else {
          q.push(index, dist);
        }
      }

      // pop items from the queue
      while (q.length && q.peek()! < 0) {
        const dist = q.peekValue()!;
        if (dist > maxDistSquared) {
          q.clear();
          return results;
        }
        results.push(-q.pop()! - 1);

        if (results.length === maxResults) {
          q.clear();
          return results;
        }
      }

      nodeIndex = q.pop();
    }

    q.clear();
    return results;
  }
}

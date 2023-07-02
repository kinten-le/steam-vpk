import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

import { Log } from './utils/log.js';
import * as JSON1 from './utils/json1.js';
import { Results } from './utils/result.js';

import { Utils } from './utils.js';
import { gobjectClass } from './utils/decorator.js';
import { Errors, FlatError } from './utils/errors.js';
import { Model } from './mvc.js';

export interface Subdir {
  id: string,
}

export class IndexFile {
  readonly subdirs: Subdir[];
  readonly comment?: string;

  constructor(param: { subdirs: Subdir[], comment?: string }) {
    this.subdirs = param.subdirs;
    this.comment = param.comment;
  }
}

export enum WriteOrders {
  Reset,
  DeleteEntry,
  AddEntry,
}

export type WriteOrder = WriteOrderReset | WriteOrderDeleteEntry | WriteOrderAddEntry;

export const WriteOrder = {
  compose: {
    Reset() {
      return new WriteOrderReset();
    },
    DeleteEntry(param: Subdir) {
      return new WriteOrderDeleteEntry(param);
    },
    AddEntry(param: Subdir) {
      return new WriteOrderAddEntry(param);
    },
  },
}

export class WriteOrderReset {
  readonly code = WriteOrders.Reset;
}

export class WriteOrderDeleteEntry {
  readonly code = WriteOrders.DeleteEntry;
  readonly param: Subdir;

  constructor(param: Subdir) {
    this.param = param;
  }
}

export class WriteOrderAddEntry {
  readonly code = WriteOrders.AddEntry;
  readonly param: Subdir;

  constructor(param: Subdir) {
    this.param = param;
  }
}

@gobjectClass({
  Signals: {
    'queue-changed': [],
  },
})
export class DirectoryWriter extends GObject.Object {
  queue: WriteOrder[] = [];
  index: Gio.File;
  readable: IndexDirectory;
  isRunning = false; // currently no multithreaded writing

  constructor(param: { readable: IndexDirectory, index: Gio.File }) {
    super({});
    this.readable = param.readable;
    this.index = param.index;
    this.connect('queue-changed', this.updateQueue);
  }

  order(order: WriteOrder): void;
  order(orders: WriteOrder[]): void;
  order(arg: WriteOrder | WriteOrder[]) {
    if (Array.isArray(arg)) {
      arg.forEach(x => this.queue.push(x));
    } else {
      this.queue.push(arg);
    }
    this.emit('queue-changed');
  }

  updateQueue = () => {
    if (this.isRunning)
      return;
    this.isRunning = true;
    const queue = this.queue;
    this.queue = [];
    let order = queue.pop();
    while (order !== undefined) {
      console.log('Handling a WriteOrder:')
      console.log(order);
      switch (order.code) {
      case WriteOrders.Reset:
        {
          const content: IndexFile = new IndexFile({
            subdirs: [],
            comment:  this.readable.comment,
          });
          const serialize = JSON1.stringify(content);
          if (serialize.code !== Results.OK) {
            Log.warn('Couldn\'t stringify JSObject, this is a programming error');
            break;
          }

          const buffer = Utils.Encoder.encode(serialize.data);
          // how to use encodeInto

          console.log(serialize.data);
          const writebytes = Utils.replaceContentsR(this.index, buffer, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
          if (writebytes.code !== Results.OK) {
            const error = writebytes.data;
            Log.warn(`Couldn\'t write index file. Must be resolved manually. Detail: ${error.message}`);
            break;
          }
          break;
        }
      case WriteOrders.DeleteEntry:
        {
          const id = order.param;
          if (id === undefined) {
            Log.warn('Did not pass in parameter for WriteOrder, this is a programming mistake');
            break;
          }
          const subdirs = new Map(this.readable.subdirs);
          const deletion = subdirs.delete(id.id);
          if (!deletion) {
            Log.warn('Tried to delete a non-existent subdir. Skipping...');
            break;
          }

          const content: IndexFile = new IndexFile({
            subdirs: (() => {
                      const arr: Subdir[] = [];
                      subdirs.forEach(x => { arr.push(x) });
                      return arr;
                    })(),
            comment:  this.readable.comment,
          });
          const serialize = JSON1.stringify(content);
          if (serialize.code !== Results.OK) {
            Log.warn('Couldn\'t stringify JSObject, this is a programming error');
            break;
          }

          const buffer = Utils.Encoder.encode(serialize.data);
          const writebytes = Utils.replaceContentsR(this.index, buffer, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
          if (writebytes.code !== Results.OK) {
            const error = writebytes.data;
            Log.warn(`Couldn\'t write index file. Must be resolved manually. Detail: ${error.message}`);
            break;
          }
          break;
        }
      case WriteOrders.AddEntry:
        {
          const id = order.param;
          if (id === undefined) {
            Log.warn('Did not pass in parameter for WriteOrder, this is a programming mistake');
            break;
          }
          const subdirs = new Map(this.readable.subdirs);
          if (subdirs.has(id.id)) {
            Log.warn('Add-on already exists. Skipping...');
            break;
          }
          subdirs.set(id.id, id);

          const content: IndexFile = new IndexFile({
            subdirs: (() => {
                      const arr: Subdir[] = [];
                      subdirs.forEach(x => { arr.push(x) });
                      return arr;
                    })(),
            comment:  this.readable.comment,
          });
          Log.debug(content);
          const serialize = JSON1.stringify(content);
          if (serialize.code !== Results.OK) {
            Log.warn('Couldn\'t stringify JSObject, this is a programming error');
            break;
          }

          const buffer = Utils.Encoder.encode(serialize.data);
          const writebytes = Utils.replaceContentsR(this.index, buffer, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
          if (writebytes.code !== Results.OK) {
            const error = writebytes.data;
            Log.warn(`Couldn\'t write index file. Must be resolved manually. Detail: ${error.message}`);
            break;
          }
          break;
        }
      default:
        throw new FlatError({ code: Errors.BAD_SWITCH_CASE });
        break;
      }
      order = queue.pop();
    }
    this.isRunning = false;
  }
}

@gobjectClass({
  Signals: {
    'subdirs-changed': [],
  },
})
export class IndexDirectory extends GObject.Object
implements Model {
  index: Gio.File;

  writeable: DirectoryWriter;
  subdirs: Readonly<Map<string, Subdir>>;
  monitor: Gio.FileMonitor;
  comment?: string;
  isRunning: boolean;

  constructor(param: { file: Gio.File }) {
    super({});
    this.index = param.file;
    Log.info(`index: ${this.index.get_path()}`);
    this.subdirs = new Map;
    this.writeable = new DirectoryWriter({ index: this.index, readable: this });
    this.isRunning = false;
    this.monitor = this.index.monitor_file(Gio.FileMonitorFlags.NONE, null);
    this.monitor.connect('changed', this.readIndexFile);
  }

  async start() {
    this.monitor.emit_event(this.index, this.index, Gio.FileMonitorEvent.CHANGED);
  }

  readIndexFile = (_: any, __: any, ___: any, ____: Gio.FileMonitorEvent) => {
    if (this.isRunning) {
      Log.warn('readIndexFile is busy...');
      return;
    }
    this.isRunning = true;
    Log.debug('Index is being read...');
    /*
    switch (event) {
    case Gio.FileMonitorEvent.CHANGED:
    case Gio.FileMonitorEvent.CREATED:
      break;
    default:
      Log.warn('Index file changed in unexpected ways. Skipping...');
      return;
    }
    */

    const readbytes = Utils.loadContentsR(this.index, null);
    if (readbytes.code !== Results.OK) {
      const error = readbytes.data;
      if (error.matches(error.domain, Gio.IOErrorEnum.NOT_FOUND)) {
        Log.warn('Index file not found! Requested a reset.');
        this.writeable.order({ code: WriteOrders.Reset });
        return;
      }
      else throw error;
    }
    const [, bytes, ] = readbytes.data;

    const decoding = Utils.Decoder.decode(bytes);
    if (decoding.code !== Results.OK) {
      Log.warn('Index file could not be decoded! Requested a reset.');
      this.writeable.order({ code: WriteOrders.Reset });
      return;
    }
    const strbuf = decoding.data;

    const parsing = Utils.parseJsonR(strbuf);
    if (parsing.code !== Results.OK) {
      Log.warn('Index file has JSON syntax error! Requested a reset.');
      this.writeable.order({ code: WriteOrders.Reset });
      return;
    }

    const obj = parsing.data;
    // validation
    const subdirs = obj['subdirs'];
    if (subdirs === undefined) {
      Log.warn('Index file lacks required fields! Resetting...')
      this.writeable.order({ code: WriteOrders.Reset });
      return;
    }
    if (!Array.isArray(subdirs)) {
      Log.warn('Should be an array!')
      this.writeable.order({ code: WriteOrders.Reset });
      return;
    }

    const map = new Map<string, Subdir>();
    subdirs.forEach(x => {
      if ('id' in x && x.id !== undefined) {
        map.set(x.id, x);
      }
    })

    this.subdirs = map;

    const comment = obj['comment'];
    this.comment = comment;
    Log.debug(`Index has finished reading! Result:\nsubdirs = NOT NOW\n`)
    this.emit('subdirs-changed');
    this.isRunning = false;
  }
}

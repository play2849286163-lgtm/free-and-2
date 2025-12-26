
export class PromptFlowDB {
  private dbName = 'PromptFlowDB';
  private version = 1;

  async open() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv');
        }
      };
    });
  }

  async set(key: string, value: any) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('kv', 'readwrite');
      const store = transaction.objectStore('kv');
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async get(key: string) {
    const db = await this.open();
    return new Promise<any>((resolve, reject) => {
      const transaction = db.transaction('kv', 'readonly');
      const store = transaction.objectStore('kv');
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clear() {
    const db = await this.open();
    const transaction = db.transaction('kv', 'readwrite');
    transaction.objectStore('kv').clear();
  }
}

export const db = new PromptFlowDB();

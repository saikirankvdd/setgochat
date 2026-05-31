// IndexedDB wrapper for local chat storage

const DB_NAME = 'StegoChatDB';
const DB_VERSION = 2;
const STORE_NAME = 'messages';

interface DBMessage {
  id: string;
  sessionId: string;
  fromId: string;
  toId: string;
  encryptedText: string;
  encryptedFile?: string; // base64 payload of the file
  timestamp: number;
  isSelfDestruct: boolean;
  expiresAt?: number;
}

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('sessionId', 'sessionId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('keys')) {
        db.createObjectStore('keys', { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveMessageLocal = async (msg: DBMessage): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(msg);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const savePrivateKeyLocal = async (userId: string, privateKey: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('keys', 'readwrite');
    const store = transaction.objectStore('keys');
    const request = store.put({ id: userId, privateKey });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getPrivateKeyLocal = async (userId: string): Promise<string | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('keys', 'readonly');
    const store = transaction.objectStore('keys');
    const request = store.get(userId);
    
    request.onsuccess = () => {
      resolve(request.result ? request.result.privateKey : null);
    };
    request.onerror = () => reject(request.error);
  });
};

export const getMessagesLocal = async (sessionId: string): Promise<DBMessage[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('sessionId');
    const request = index.getAll(sessionId);
    
    request.onsuccess = () => {
      resolve(request.result.sort((a, b) => a.timestamp - b.timestamp));
    };
    request.onerror = () => reject(request.error);
  });
};

export const deleteMessageLocal = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const clearSessionLocal = async (sessionId: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('sessionId');
    const request = index.getAllKeys(sessionId);
    
    request.onsuccess = () => {
      const keys = request.result;
      let deleted = 0;
      if (keys.length === 0) resolve();
      keys.forEach(key => {
        const delReq = store.delete(key);
        delReq.onsuccess = () => {
          deleted++;
          if (deleted === keys.length) resolve();
        };
      });
    };
    request.onerror = () => reject(request.error);
  });
};

export const getAllMessagesLocal = async (): Promise<DBMessage[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const importMessagesLocal = async (messages: DBMessage[]): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        let completed = 0;
        if (messages.length === 0) resolve();
        
        messages.forEach(msg => {
            const request = store.put(msg);
            request.onsuccess = () => {
                completed++;
                if (completed === messages.length) resolve();
            };
            request.onerror = (e) => {
                console.error("Failed to import message:", e);
                completed++;
                if (completed === messages.length) resolve();
            };
        });
    });
};

// IndexedDB wrapper for local chat storage
import { hashString } from './crypto';

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
      if (!db.objectStoreNames.contains('pins')) {
        db.createObjectStore('pins', { keyPath: 'sessionId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveMessageLocal = async (msg: DBMessage, bypassHashing = false): Promise<void> => {
  const db = await openDB();
  let msgToSave = msg;
  if (!bypassHashing) {
    const hashedSessionId = await hashString(msg.sessionId);
    const hashedFromId = msg.fromId === 'system' ? 'system' : await hashString(msg.fromId.toString());
    const hashedToId = await hashString(msg.toId.toString());
    
    msgToSave = {
        ...msg,
        sessionId: hashedSessionId,
        fromId: hashedFromId,
        toId: hashedToId
    };
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(msgToSave);
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
  const hashedSessionId = await hashString(sessionId);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('sessionId');
    const request = index.getAll(hashedSessionId);
    
    request.onsuccess = () => {
      const hashedResults = request.result || [];
      
      // Backward compatibility: also fetch old messages stored under plaintext sessionId
      const oldRequest = index.getAll(sessionId);
      oldRequest.onsuccess = () => {
         const oldResults = oldRequest.result || [];
         const combined = [...hashedResults, ...oldResults];
         // Deduplicate by ID just in case
         const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
         resolve(unique.sort((a, b) => a.timestamp - b.timestamp));
      };
      oldRequest.onerror = () => {
         resolve(hashedResults.sort((a, b) => a.timestamp - b.timestamp));
      };
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

export const deleteMessagesLocal = async (ids: string[]): Promise<void> => {
  if (ids.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    
    ids.forEach(id => {
      store.delete(id);
    });
  });
};

export const savePinLocal = async (sessionId: string, encryptedPin: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('pins', 'readwrite');
    const store = transaction.objectStore('pins');
    const request = store.put({ sessionId, pin: encryptedPin });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getPinLocal = async (sessionId: string): Promise<string | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('pins', 'readonly');
    const store = transaction.objectStore('pins');
    const request = store.get(sessionId);
    request.onsuccess = () => resolve(request.result ? request.result.pin : null);
    request.onerror = () => reject(request.error);
  });
};

export const clearSessionLocal = async (sessionId: string): Promise<void> => {
  const db = await openDB();
  const hashedSessionId = await hashString(sessionId);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('sessionId');
    const request = index.getAllKeys(hashedSessionId);
    
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

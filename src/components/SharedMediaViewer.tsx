import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Calendar, Download } from 'lucide-react';
import { getMessagesLocal } from '../utils/db';
import { decryptData } from '../utils/crypto';

interface SharedMediaViewerProps {
  sessionId: string;
  pin: string;
  onClose: () => void;
}

interface MediaItem {
  id: string;
  url: string;
  type: string;
  timestamp: number;
}

export const SharedMediaViewer: React.FC<SharedMediaViewerProps> = ({ sessionId, pin, onClose }) => {
  const [mediaItems, setMediaItems] = useState<{ [date: string]: MediaItem[] }>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMedia = async () => {
      try {
        const msgs = await getMessagesLocal(sessionId);
        const items: MediaItem[] = [];

        for (const msg of msgs) {
          if (msg.encryptedFile) {
            try {
              const fileDataStr = await decryptData(msg.encryptedFile, pin);
              const fileData = JSON.parse(fileDataStr);
              if (fileData.base64 && fileData.type.startsWith('image/')) {
                items.push({
                  id: msg.id,
                  url: fileData.base64,
                  type: fileData.type,
                  timestamp: msg.timestamp
                });
              }
            } catch (err) {
              console.error('Failed to decrypt media', err);
            }
          }
        }

        // Group by month/year
        const grouped: { [key: string]: MediaItem[] } = {};
        items.sort((a, b) => b.timestamp - a.timestamp).forEach(item => {
          const date = new Date(item.timestamp);
          const key = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(item);
        });

        setMediaItems(grouped);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchMedia();
  }, [sessionId, pin]);

  return createPortal(
    <div className="fixed inset-0 bg-[#0b141a]/90 z-[9999] flex flex-col animate-fade-in">
      <div className="h-16 bg-[#202c33] flex items-center px-6 border-b border-[#2a3942] justify-between shadow-md">
        <h2 className="text-xl font-bold text-white flex items-center">
          <Calendar className="w-5 h-5 mr-3 text-[#00a884]" />
          Shared Media
        </h2>
        <button onClick={onClose} className="text-[#8696a0] hover:text-white transition-colors">
          <X className="w-7 h-7" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-10 h-10 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : Object.keys(mediaItems).length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#8696a0]">
            <p className="text-lg mb-2">No media found</p>
            <p className="text-sm">Photos and videos shared in this chat will appear here.</p>
          </div>
        ) : (
          Object.entries(mediaItems).map(([date, items]) => (
            <div key={date} className="mb-8">
              <h3 className="text-[#e9edef] font-medium text-lg mb-4">{date}</h3>
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {items.map((item) => (
                  <div key={item.id} className="aspect-square relative group overflow-hidden rounded cursor-pointer bg-[#202c33]">
                    <img 
                      src={item.url} 
                      alt="Shared media" 
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      onClick={() => {
                         const w = window.open();
                         if (w) w.document.write(`<img src="${item.url}" style="max-width: 100%; margin: auto; display: block;" />`);
                      }}
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <a 
                        href={item.url} 
                        download={`media_${item.timestamp}`}
                        onClick={(e) => e.stopPropagation()}
                        className="p-2 bg-[#00a884] rounded-full hover:bg-[#06cf9c] transition-colors"
                      >
                        <Download className="w-5 h-5 text-white" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>,
    document.body
  );
};

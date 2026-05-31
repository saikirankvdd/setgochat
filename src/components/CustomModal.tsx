import React from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Info, CheckCircle } from 'lucide-react';

interface CustomModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  type?: 'alert' | 'confirm';
  iconType?: 'warning' | 'info' | 'success';
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
}

export const CustomModal: React.FC<CustomModalProps> = ({
  isOpen,
  onClose,
  title,
  message,
  type = 'alert',
  iconType = 'info',
  confirmText = 'OK',
  cancelText = 'Cancel',
  onConfirm,
}) => {
  if (!isOpen) return null;

  const getIcon = () => {
    switch (iconType) {
      case 'warning': return <AlertTriangle className="w-6 h-6 text-red-500" />;
      case 'success': return <CheckCircle className="w-6 h-6 text-[#00a884]" />;
      default: return <Info className="w-6 h-6 text-blue-500" />;
    }
  };

  const handleConfirm = () => {
    if (onConfirm) onConfirm();
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl p-6 w-full max-w-sm shadow-2xl transform transition-all">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            {getIcon()}
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
          </div>
          <button 
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <p className="text-[var(--text-secondary)] text-sm mb-6 leading-relaxed">
          {message}
        </p>
        
        <div className="flex justify-end gap-3">
          {type === 'confirm' && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors border border-[var(--border-color)]"
            >
              {cancelText}
            </button>
          )}
          <button
            onClick={handleConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${
              iconType === 'warning' 
                ? 'bg-red-500 hover:bg-red-600' 
                : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

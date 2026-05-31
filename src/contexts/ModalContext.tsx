import React, { createContext, useContext, useState, ReactNode } from 'react';
import { CustomModal } from '../components/CustomModal';

interface ModalOptions {
  title: string;
  message: string;
  type?: 'alert' | 'confirm';
  iconType?: 'warning' | 'info' | 'success';
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
}

interface ModalContextType {
  showModal: (options: ModalOptions) => void;
  hideModal: () => void;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [modalState, setModalState] = useState<{ isOpen: boolean; options: ModalOptions | null }>({
    isOpen: false,
    options: null,
  });

  const showModal = (options: ModalOptions) => {
    setModalState({ isOpen: true, options });
  };

  const hideModal = () => {
    setModalState(prev => ({ ...prev, isOpen: false }));
  };

  return (
    <ModalContext.Provider value={{ showModal, hideModal }}>
      {children}
      {modalState.options && (
        <CustomModal
          isOpen={modalState.isOpen}
          onClose={hideModal}
          {...modalState.options}
        />
      )}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const context = useContext(ModalContext);
  if (context === undefined) {
    throw new Error('useModal must be used within a ModalProvider');
  }
  return context;
}

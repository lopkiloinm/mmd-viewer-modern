import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';

export interface FolderInputRef {
  click: () => void;
}

interface FolderInputProps {
  onChange: (files: FileList | null) => void;
  className?: string;
}

export const FolderInput = forwardRef<FolderInputRef, FolderInputProps>(
  ({ onChange, className }, ref) => {
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      click: () => {
        inputRef.current?.click();
      }
    }));

    useEffect(() => {
      const input = inputRef.current;
      if (input) {
        // Set attributes imperatively to ensure they persist
        input.setAttribute('webkitdirectory', '');
        input.setAttribute('directory', '');
        input.setAttribute('multiple', '');
      }
    }, []);

    return (
      <input
        ref={inputRef}
        type="file"
        className={className || 'hidden'}
        onChange={(e) => onChange(e.target.files)}
      />
    );
  }
);

FolderInput.displayName = 'FolderInput';

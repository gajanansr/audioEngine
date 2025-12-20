import { useRef } from 'react';
import './FileUpload.css';

interface FileUploadProps {
    label: string;
    accept?: string;
    file: File | null;
    onFileSelect: (file: File | null) => void;
    required?: boolean;
    subtitle?: string;
}

export default function FileUpload({
    label,
    accept = 'audio/*',
    file,
    onFileSelect,
    required,
    subtitle
}: FileUploadProps) {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleClick = () => {
        inputRef.current?.click();
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        onFileSelect(selectedFile || null);
    };

    const handleRemove = (e: React.MouseEvent) => {
        e.stopPropagation();
        onFileSelect(null);
        if (inputRef.current) {
            inputRef.current.value = '';
        }
    };

    return (
        <div className="file-upload" onClick={handleClick}>
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                onChange={handleChange}
                hidden
            />

            <div className="upload-icon">
                {file ? '🎵' : '📁'}
            </div>

            <div className="upload-info">
                <span className="upload-label">
                    {label}
                    {required && <span className="required">*</span>}
                </span>

                {file ? (
                    <span className="upload-filename">{file.name}</span>
                ) : (
                    <span className="upload-hint">
                        {subtitle || 'Click to select file'}
                    </span>
                )}
            </div>

            {file && (
                <button className="remove-btn" onClick={handleRemove}>
                    ✕
                </button>
            )}
        </div>
    );
}
